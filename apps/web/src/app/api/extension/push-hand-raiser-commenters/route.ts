import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, inArray } from '@0ne/db/server'
import { staffUsers, dmHandRaiserCampaigns, dmHandRaiserSent, dmMessages } from '@0ne/db/server'
import { findOrCreateGhlContact } from '@/features/dm-sync/lib/contact-mapper'
import type { DmMessageRow } from '@/features/dm-sync/types'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

// =============================================
// Types
// =============================================

interface Commenter {
  campaignId: string
  skoolUserId: string
  username: string
  displayName: string
  commentContent: string
  commentCreatedAt: string
}

interface PushCommentersRequest {
  staffSkoolId: string
  commenters: Commenter[]
}

interface PushCommentersResponse {
  success: boolean
  processed: number
  tagged: number
  dmsQueued: number
  skipped: number
  errors: string[]
}

// =============================================
// GHL Tagging (extracted from sync-engine.ts:1227)
// =============================================

async function tagGhlContact(
  contactId: string,
  tag: string
): Promise<void> {
  const GHL_API_BASE = 'https://services.leadconnectorhq.com'
  const apiKey = process.env.GHL_API_KEY

  if (!apiKey) {
    console.warn('[Extension API] GHL_API_KEY not set, skipping contact tagging')
    return
  }

  try {
    const response = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({
        tags: [tag],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Extension API] Failed to tag contact: ${response.status} - ${errorText}`)
    } else {
      console.log(`[Extension API] Tagged contact ${contactId} with "${tag}"`)
    }
  } catch (error) {
    console.error('[Extension API] Error tagging contact:', error)
  }
}

// =============================================
// Template Interpolation (extracted from sync-engine.ts:1268)
// =============================================

function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] || match
  })
}

// =============================================
// POST /api/extension/push-hand-raiser-commenters
// =============================================

/**
 * Processes commenters found by the extension on hand-raiser campaign posts.
 *
 * Per commenter:
 * 1. Dedup check against dm_hand_raiser_sent (campaign_id + skool_user_id)
 * 2. Apply keyword_filter if campaign has one
 * 3. findOrCreateGhlContact() — map Skool user to GHL
 * 4. tagGhlContact() — tag in GHL (works server-side)
 * 5. If dm_template exists → interpolate → queue DM in dm_messages (source: 'hand-raiser')
 * 6. Insert dedup record into dm_hand_raiser_sent
 */
export async function POST(request: NextRequest) {
  // Validate auth (supports both Clerk and API key)
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: PushCommentersRequest = await request.json()

    // If using Clerk auth and staffSkoolId not provided, use linked Skool ID
    if (authResult.authType === 'clerk' && !body.staffSkoolId && authResult.skoolUserId) {
      body.staffSkoolId = authResult.skoolUserId
    }

    // Validate request
    if (!body.staffSkoolId?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: staffSkoolId' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!Array.isArray(body.commenters) || body.commenters.length === 0) {
      return NextResponse.json(
        { success: false, error: 'commenters must be a non-empty array' },
        { status: 400, headers: corsHeaders }
      )
    }

    const { staffSkoolId, commenters } = body

    console.log(
      `[Extension API] Received ${commenters.length} commenters from staff ${staffSkoolId}`
    )

    // Resolve staffSkoolId -> Clerk clerk_user_id via staff_users table
    const staffUserRows = await db.select({ clerkUserId: staffUsers.clerkUserId })
      .from(staffUsers)
      .where(eq(staffUsers.skoolUserId, staffSkoolId))

    const staffUser = staffUserRows[0]

    if (!staffUser) {
      return NextResponse.json(
        { success: false, error: `No staff_users mapping for staffSkoolId: ${staffSkoolId}` },
        { status: 400, headers: corsHeaders }
      )
    }

    const clerkUserId = staffUser.clerkUserId!

    // Collect unique campaign IDs to batch-fetch campaign details
    const campaignIds = [...new Set(commenters.map((c) => c.campaignId))]

    // Fetch all referenced campaigns
    let campaigns
    try {
      campaigns = await db.select({
        id: dmHandRaiserCampaigns.id,
        keywordFilter: dmHandRaiserCampaigns.keywordFilter,
        ghlTag: dmHandRaiserCampaigns.ghlTag,
        dmTemplate: dmHandRaiserCampaigns.dmTemplate,
        skoolPostId: dmHandRaiserCampaigns.skoolPostId,
      })
        .from(dmHandRaiserCampaigns)
        .where(and(
          eq(dmHandRaiserCampaigns.clerkUserId, clerkUserId),
          eq(dmHandRaiserCampaigns.isActive, true),
          inArray(dmHandRaiserCampaigns.id, campaignIds)
        ))
    } catch (campaignError) {
      console.error('[Extension API] Error fetching campaigns:', campaignError)
      return NextResponse.json(
        { success: false, error: campaignError instanceof Error ? campaignError.message : 'Unknown error' },
        { status: 500, headers: corsHeaders }
      )
    }

    const campaignMap = new Map(
      (campaigns || []).map((c) => [c.id, c])
    )

    // Batch-fetch existing dedup records for all commenters
    // Build composite keys: campaign_id + skool_user_id
    const existingSent = await db.select({
      campaignId: dmHandRaiserSent.campaignId,
      skoolUserId: dmHandRaiserSent.skoolUserId,
    })
      .from(dmHandRaiserSent)
      .where(inArray(dmHandRaiserSent.campaignId, campaignIds))

    const sentSet = new Set(
      (existingSent || []).map((r) => `${r.campaignId}:${r.skoolUserId}`)
    )

    // Process results
    let processed = 0
    let tagged = 0
    let dmsQueued = 0
    let skipped = 0
    const errors: string[] = []

    for (const commenter of commenters) {
      try {
        // 1. Look up campaign
        const campaign = campaignMap.get(commenter.campaignId)
        if (!campaign) {
          console.warn(
            `[Extension API] Campaign ${commenter.campaignId} not found or inactive — skipping`
          )
          skipped++
          continue
        }

        // 2. Dedup check
        const dedupKey = `${commenter.campaignId}:${commenter.skoolUserId}`
        if (sentSet.has(dedupKey)) {
          skipped++
          continue
        }

        // 3. Keyword filter (if campaign has one)
        if (campaign.keywordFilter) {
          const keywords = campaign.keywordFilter
            .split(',')
            .map((k: string) => k.trim().toLowerCase())
          const commentLower = commenter.commentContent.toLowerCase()
          const hasKeyword = keywords.some((keyword: string) =>
            commentLower.includes(keyword)
          )
          if (!hasKeyword) {
            skipped++
            continue
          }
        }

        // 4. Find or create GHL contact
        const contactResult = await findOrCreateGhlContact(
          clerkUserId,
          commenter.skoolUserId,
          commenter.username,
          commenter.displayName
        )

        // 5. Tag GHL contact if configured
        if (campaign.ghlTag && contactResult.ghlContactId) {
          await tagGhlContact(contactResult.ghlContactId, campaign.ghlTag)
          tagged++
        }

        // 6. Queue DM if template exists
        if (campaign.dmTemplate?.trim()) {
          const dmMessage = interpolateTemplate(campaign.dmTemplate, {
            name: commenter.displayName || commenter.username,
            username: commenter.username,
          })

          // Queue in dm_messages with source='hand-raiser' for extension pickup
          try {
            await db.insert(dmMessages).values({
              clerkUserId,
              staffSkoolId,
              skoolConversationId: `hr-pending-${commenter.skoolUserId}`, // Placeholder — extension will resolve actual conversation
              skoolMessageId: `hr-${commenter.campaignId}-${commenter.skoolUserId}-${Date.now()}`,
              ghlMessageId: null,
              skoolUserId: commenter.skoolUserId,
              direction: 'outbound',
              messageText: dmMessage,
              status: 'pending',
              source: 'hand-raiser',
              createdAt: new Date(),
              syncedAt: null,
            })
            dmsQueued++
          } catch (insertError) {
            console.error(`[Extension API] Failed to queue DM:`, insertError)
            errors.push(`DM queue for ${commenter.username}: ${insertError instanceof Error ? insertError.message : 'Unknown error'}`)
          }
        }

        // 7. Insert dedup record — only if we have a GHL contact
        if (contactResult.ghlContactId) {
          try {
            await db.insert(dmHandRaiserSent).values({
              campaignId: commenter.campaignId,
              skoolUserId: commenter.skoolUserId,
            })
          } catch (sentError: unknown) {
            // Duplicate insert is OK (race condition safety)
            const errCode = (sentError as { code?: string })?.code
            if (errCode !== '23505') {
              console.error(`[Extension API] Failed to record sent:`, sentError)
              errors.push(`Dedup record for ${commenter.username}: ${sentError instanceof Error ? sentError.message : 'Unknown error'}`)
            }
          }

          sentSet.add(dedupKey)
          processed++
        } else {
          // No GHL contact — skip dedup so they can be retried later
          console.log(`[Extension API] Skipping dedup for ${commenter.username} - no GHL contact (will retry)`)
          skipped++
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`[Extension API] Error processing commenter ${commenter.skoolUserId}:`, msg)
        errors.push(`${commenter.username}: ${msg}`)
      }
    }

    console.log(
      `[Extension API] Hand-raiser commenters complete: processed=${processed}, tagged=${tagged}, dmsQueued=${dmsQueued}, skipped=${skipped}, errors=${errors.length}`
    )

    const response: PushCommentersResponse = {
      success: errors.length === 0,
      processed,
      tagged,
      dmsQueued,
      skipped,
      errors,
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST push-hand-raiser-commenters exception:', error)
    return NextResponse.json(
      {
        success: false,
        processed: 0,
        tagged: 0,
        dmsQueued: 0,
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      } as PushCommentersResponse,
      { status: 500, headers: corsHeaders }
    )
  }
}
