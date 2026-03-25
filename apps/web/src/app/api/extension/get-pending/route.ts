import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, or, gte, asc, inArray, rawSql } from '@0ne/db/server'
import { dmMessages, dmSyncConfig, contactChannels } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

// =============================================
// Types
// =============================================

interface PendingMessage {
  id: string
  skool_conversation_id: string
  skool_user_id: string
  message_text: string
  created_at: string
  // Phase 5: Multi-staff support
  staff_skool_id: string | null
  staff_display_name: string | null
  // Channel resolution support
  skool_community_id: string | null
}

interface GetPendingResponse {
  success: boolean
  messages: PendingMessage[]
  count: number
  skool_community_id: string | null
}

// =============================================
// GET /api/extension/get-pending
// =============================================

/**
 * Get Pending Outbound Messages
 *
 * Returns messages that need to be sent via the Chrome extension.
 * These are messages created from GHL that need to be delivered to Skool.
 *
 * Enrichments:
 * - Includes skool_community_id from dm_sync_config for channel resolution
 * - Checks contact_channels for pre-resolved channels and substitutes placeholders
 *
 * Query params:
 * - staffSkoolId: The staff member's Skool user ID
 * - limit: Max messages to return (default 10)
 */
export async function GET(request: NextRequest) {
  // Validate auth (supports both Clerk and API key)
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    let staffSkoolId = searchParams.get('staffSkoolId')
    const limit = parseInt(searchParams.get('limit') || '10', 10)

    // If using Clerk auth and staffSkoolId not provided, use linked Skool ID
    if (authResult.authType === 'clerk' && !staffSkoolId && authResult.skoolUserId) {
      staffSkoolId = authResult.skoolUserId
    }

    if (!staffSkoolId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: staffSkoolId' },
        { status: 400, headers: corsHeaders }
      )
    }

    console.log(`[Extension API] Fetching pending outbound for staff ${staffSkoolId}`)

    // Debug: First check how many pending outbound messages exist at all
    const samplePending = await db.select({
      id: dmMessages.id,
      clerkUserId: dmMessages.clerkUserId,
      staffSkoolId: dmMessages.staffSkoolId,
      source: dmMessages.source,
    })
      .from(dmMessages)
      .where(and(
        eq(dmMessages.direction, 'outbound'),
        eq(dmMessages.status, 'pending')
      ))
      .limit(3)

    console.log(`[Extension API] Sample pending messages:`, JSON.stringify(samplePending))
    console.log(`[Extension API] Looking for staffSkoolId: ${staffSkoolId}`)

    // Fetch skool_community_id from dm_sync_config
    const syncConfigRows = await db.select({ skoolCommunityId: dmSyncConfig.skoolCommunityId })
      .from(dmSyncConfig)
      .limit(1)

    const skoolCommunityId = syncConfigRows[0]?.skoolCommunityId || null

    // Query for pending outbound messages
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    let pendingMessages
    try {
      pendingMessages = await db.select({
        id: dmMessages.id,
        skool_conversation_id: dmMessages.skoolConversationId,
        skool_user_id: dmMessages.skoolUserId,
        message_text: dmMessages.messageText,
        created_at: dmMessages.createdAt,
        staff_skool_id: dmMessages.staffSkoolId,
        staff_display_name: dmMessages.staffDisplayName,
        source: dmMessages.source,
      })
        .from(dmMessages)
        .where(and(
          eq(dmMessages.staffSkoolId, staffSkoolId),
          eq(dmMessages.direction, 'outbound'),
          eq(dmMessages.status, 'pending'),
          or(
            eq(dmMessages.source, 'manual'),
            eq(dmMessages.source, 'hand-raiser'),
            and(eq(dmMessages.source, 'ghl'), gte(dmMessages.createdAt, oneDayAgo))
          )
        ))
        .orderBy(asc(dmMessages.createdAt))
        .limit(limit)
    } catch (dbError) {
      console.error('[Extension API] Database error:', dbError)
      return NextResponse.json(
        { error: 'Database query failed', details: dbError instanceof Error ? dbError.message : 'Unknown error' },
        { status: 500, headers: corsHeaders }
      )
    }

    let messages: PendingMessage[] = (pendingMessages || []).map((msg) => ({
      id: msg.id,
      skool_conversation_id: msg.skool_conversation_id!,
      skool_user_id: msg.skool_user_id!,
      message_text: msg.message_text!,
      created_at: msg.created_at?.toISOString() || new Date().toISOString(),
      staff_skool_id: msg.staff_skool_id,
      staff_display_name: msg.staff_display_name,
      skool_community_id: skoolCommunityId,
    }))

    // Check contact_channels for pre-resolved channels and substitute placeholders
    const placeholderMessages = messages.filter(
      (m) => m.skool_conversation_id.startsWith('hr-pending-') || m.skool_conversation_id.startsWith('pending-')
    )

    if (placeholderMessages.length > 0) {
      const skoolUserIds = [...new Set(placeholderMessages.map((m) => m.skool_user_id))]

      const cachedChannels = await db.select({
        skoolUserId: contactChannels.skoolUserId,
        skoolChannelId: contactChannels.skoolChannelId,
      })
        .from(contactChannels)
        .where(and(
          eq(contactChannels.staffSkoolId, staffSkoolId),
          inArray(contactChannels.skoolUserId, skoolUserIds)
        ))

      if (cachedChannels && cachedChannels.length > 0) {
        const channelMap = new Map(cachedChannels.map((c) => [c.skoolUserId, c.skoolChannelId]))

        messages = messages.map((msg) => {
          if (
            (msg.skool_conversation_id.startsWith('hr-pending-') || msg.skool_conversation_id.startsWith('pending-')) &&
            channelMap.has(msg.skool_user_id)
          ) {
            return { ...msg, skool_conversation_id: channelMap.get(msg.skool_user_id)! }
          }
          return msg
        })

        console.log(`[Extension API] Substituted ${cachedChannels.length} cached channels for placeholders`)
      }
    }

    console.log(`[Extension API] Found ${messages.length} pending outbound messages`)

    const response: GetPendingResponse = {
      success: true,
      messages,
      count: messages.length,
      skool_community_id: skoolCommunityId,
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] GET pending exception:', error)
    return NextResponse.json(
      {
        success: false,
        messages: [],
        count: 0,
        skool_community_id: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    )
  }
}
