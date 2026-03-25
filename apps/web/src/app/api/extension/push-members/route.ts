import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, inArray, isNull } from '@0ne/db/server'
import { skoolMembers, dmContactMappings } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'
import { GHLClient } from '@/features/kpi/lib/ghl-client'
import { parseDisplayName } from '@/features/dm-sync/lib/contact-mapper'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // Allow up to 2 minutes for auto-matching

/**
 * Chrome Extension Push Members API
 *
 * Receives member data from the Skool Chrome extension
 * and stores them in the skool_members table.
 *
 * Also extracts email/phone from survey answers and
 * auto-matches unmatched members to GHL contacts.
 */

// =============================================
// Types
// =============================================

interface IncomingMember {
  skoolUserId: string
  name?: string
  email?: string
  avatarUrl?: string
  level?: number
  points?: number
  joinedAt?: string | null
  lastSeenAt?: string | null
  // Additional fields from Phase 6 full member sync
  username?: string
  bio?: string
  location?: string
  role?: string                                       // 'admin', 'moderator', 'member'
  questionsAndAnswers?: Record<string, string>[] | null  // Survey/question answers on join
}

interface PushMembersRequest {
  staffSkoolId: string
  groupId: string
  members: IncomingMember[]
}

interface PushMembersResponse {
  success: boolean
  upserted: number
  matched: number
  created: number
  errors?: string[]
}

// =============================================
// Survey Email/Phone Extraction
// =============================================

function extractEmailFromSurvey(qa: Record<string, string>[] | null): string | null {
  if (!qa || !Array.isArray(qa)) return null

  for (const item of qa) {
    const answer = item.answer || ''
    // Check if the answer looks like an email
    if (answer.includes('@') && answer.includes('.')) {
      const emailMatch = answer.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
      if (emailMatch) return emailMatch[0].toLowerCase()
    }
  }
  return null
}

function extractPhoneFromSurvey(qa: Record<string, string>[] | null): string | null {
  if (!qa || !Array.isArray(qa)) return null

  for (const item of qa) {
    const question = (item.question || '').toLowerCase()
    const answer = item.answer || ''

    // Check if question mentions phone/cell/mobile
    if (question.includes('phone') || question.includes('cell') || question.includes('mobile') || question.includes('whatsapp')) {
      const digits = answer.replace(/\D/g, '')
      if (digits.length >= 10) {
        return digits.length === 10 ? `+1${digits}` : `+${digits}`
      }
    }
  }
  return null
}

// =============================================
// POST /api/extension/push-members
// =============================================

export async function POST(request: NextRequest) {
  // Validate auth (supports both Clerk and API key)
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: PushMembersRequest = await request.json()

    // If using Clerk auth and staffSkoolId not provided, use linked Skool ID
    if (authResult.authType === 'clerk' && !body.staffSkoolId && authResult.skoolUserId) {
      body.staffSkoolId = authResult.skoolUserId
    }

    // Validate request structure
    const validationError = validateRequest(body)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400, headers: corsHeaders })
    }

    const { staffSkoolId, groupId, members } = body

    console.log(
      `[Extension API] Received ${members.length} members for group ${groupId}`
    )

    let upserted = 0
    const errors: string[] = []

    // Track members that need auto-matching (have email or phone, no ghl_contact_id)
    const needsMatching: Array<{
      skoolUserId: string
      email: string | null
      phone: string | null
      displayName: string
      username: string
      surveyAnswers: Record<string, string>[] | null
    }> = []

    // Upsert members in batches
    for (const member of members) {
      try {
        // Extract email/phone from survey answers if not already provided
        const surveyEmail = extractEmailFromSurvey(member.questionsAndAnswers ?? null)
        const surveyPhone = extractPhoneFromSurvey(member.questionsAndAnswers ?? null)
        const effectiveEmail = member.email || surveyEmail || null
        const effectivePhone = surveyPhone || null

        const memberRow: Record<string, unknown> = {
          groupSlug: groupId,
          skoolUserId: member.skoolUserId,
          displayName: member.name || null,
          email: effectiveEmail,
          profileImage: member.avatarUrl || null,
          level: member.level ?? null,
          points: member.points ?? null,
          memberSince: member.joinedAt ? new Date(member.joinedAt) : null,
          lastOnline: member.lastSeenAt ? new Date(member.lastSeenAt) : null,
        }

        // Add additional fields if present (Phase 6)
        if (member.username) memberRow.skoolUsername = member.username
        if (member.bio) memberRow.bio = member.bio
        if (member.location) memberRow.location = member.location
        if (member.role) memberRow.role = member.role
        if (member.questionsAndAnswers) memberRow.surveyAnswers = member.questionsAndAnswers
        if (effectivePhone) memberRow.phone = effectivePhone

        await db.insert(skoolMembers).values(memberRow as typeof skoolMembers.$inferInsert)
          .onConflictDoUpdate({
            target: skoolMembers.skoolUserId,
            set: memberRow as Record<string, unknown>,
          })

        upserted++

        // Queue for auto-matching if we have an email or phone
        if (effectiveEmail || effectivePhone) {
          needsMatching.push({
            skoolUserId: member.skoolUserId,
            email: effectiveEmail,
            phone: effectivePhone,
            displayName: member.name || '',
            username: member.username || member.name || '',
            surveyAnswers: member.questionsAndAnswers ?? null,
          })
        }
      } catch (memberError) {
        console.error(`[Extension API] Exception processing member ${member.skoolUserId}:`, memberError)
        errors.push(
          `Member ${member.skoolUserId}: ${memberError instanceof Error ? memberError.message : 'Unknown error'}`
        )
      }
    }

    console.log(
      `[Extension API] Members upserted: ${upserted}, errors: ${errors.length}, candidates for matching: ${needsMatching.length}`
    )

    // =========================================================================
    // Sync emails/phones to dm_contact_mappings (so they show in the UI)
    // =========================================================================

    if (needsMatching.length > 0) {
      const emailSyncIds = needsMatching.map((m) => m.skoolUserId)
      const existingMappings = await db.select({
        skoolUserId: dmContactMappings.skoolUserId,
        email: dmContactMappings.email,
        phone: dmContactMappings.phone,
      })
        .from(dmContactMappings)
        .where(inArray(dmContactMappings.skoolUserId, emailSyncIds))

      for (const mapping of existingMappings) {
        const memberInfo = needsMatching.find((m) => m.skoolUserId === mapping.skoolUserId)
        if (!memberInfo) continue

        if (memberInfo.email && !mapping.email) {
          await db.update(dmContactMappings)
            .set({ email: memberInfo.email, updatedAt: new Date() })
            .where(eq(dmContactMappings.skoolUserId, mapping.skoolUserId!))
        }
      }
    }

    // =========================================================================
    // Auto-match unmatched members against GHL
    // Cascade: search email → search phone → create contact
    // =========================================================================

    let matched = 0
    let created = 0

    if (needsMatching.length > 0) {
      // Find which of these members are still unmatched
      const candidateIds = needsMatching.map((m) => m.skoolUserId)
      const unmatched = await db.select({ skoolUserId: skoolMembers.skoolUserId })
        .from(skoolMembers)
        .where(and(
          inArray(skoolMembers.skoolUserId, candidateIds),
          isNull(skoolMembers.ghlContactId)
        ))

      const unmatchedIds = new Set(unmatched.map((m) => m.skoolUserId))
      const toMatch = needsMatching.filter((m) => unmatchedIds.has(m.skoolUserId))

      if (toMatch.length > 0) {
        console.log(`[Extension API] Auto-matching ${toMatch.length} unmatched members (email/phone/create)...`)

        try {
          const ghl = new GHLClient()
          const MAX_MATCHES_PER_PUSH = 25

          for (const member of toMatch.slice(0, MAX_MATCHES_PER_PUSH)) {
            try {
              let contact = null
              let matchMethod = ''

              // 1. Search by email
              if (member.email) {
                contact = await ghl.searchContactByEmail(member.email)
                if (contact) matchMethod = 'email'
                await new Promise((resolve) => setTimeout(resolve, 200))
              }

              // 2. Search by phone
              if (!contact && member.phone) {
                contact = await ghl.searchContactByPhone(member.phone)
                if (contact) matchMethod = 'phone'
                await new Promise((resolve) => setTimeout(resolve, 200))
              }

              // 3. Create if not found
              if (!contact && (member.email || member.phone)) {
                const { firstName, lastName } = parseDisplayName(member.displayName || 'Unknown')

                // Build survey answer custom fields
                const customFields: Array<{ key: string; field_value: string }> = []
                if (member.surveyAnswers) {
                  const fieldKeys = ['contact.skool_answer_1', 'contact.skool_answer_2', 'contact.skool_answer_3']
                  for (let i = 0; i < Math.min(member.surveyAnswers.length, 3); i++) {
                    const answer = member.surveyAnswers[i]?.answer
                    if (answer) {
                      customFields.push({ key: fieldKeys[i], field_value: answer })
                    }
                  }
                }

                try {
                  contact = await ghl.createContact({
                    email: member.email || undefined,
                    phone: member.phone || undefined,
                    firstName,
                    lastName: lastName || undefined,
                    tags: ['skool - completed registration', 'skool_auto_created'],
                    customFields: customFields.length > 0 ? customFields : undefined,
                  })
                  matchMethod = 'auto_created'
                  created++
                  console.log(`[Extension API] Created GHL contact for ${member.email || member.phone} → ${contact.id}`)
                } catch (createError) {
                  console.error(`[Extension API] Create error for ${member.email || member.phone}:`, createError)
                }
                await new Promise((resolve) => setTimeout(resolve, 200))
              }

              if (contact && matchMethod) {
                if (matchMethod !== 'auto_created') matched++

                // Update skool_members with the match
                await db.update(skoolMembers).set({
                  ghlContactId: contact.id,
                  matchedAt: new Date(),
                  matchMethod,
                }).where(eq(skoolMembers.skoolUserId, member.skoolUserId))

                // Also upsert into dm_contact_mappings so it shows in the contacts UI
                const clerkUserId = authResult.userId || authResult.skoolUserId || staffSkoolId
                await db.insert(dmContactMappings).values({
                  clerkUserId,
                  skoolUserId: member.skoolUserId,
                  skoolUsername: member.username,
                  skoolDisplayName: member.displayName,
                  ghlContactId: contact.id,
                  matchMethod,
                  email: member.email,
                  contactType: 'community_member',
                  updatedAt: new Date(),
                }).onConflictDoUpdate({
                  target: [dmContactMappings.clerkUserId, dmContactMappings.skoolUserId],
                  set: {
                    skoolUsername: member.username,
                    skoolDisplayName: member.displayName,
                    ghlContactId: contact.id,
                    matchMethod,
                    email: member.email,
                    contactType: 'community_member',
                    updatedAt: new Date(),
                  },
                })

                console.log(`[Extension API] ${matchMethod === 'auto_created' ? 'Created' : 'Matched'} ${member.email || member.phone} → GHL ${contact.id}`)
              }
            } catch (matchError) {
              console.error(`[Extension API] Match error for ${member.email || member.phone}:`, matchError)
            }
          }

          if (toMatch.length > MAX_MATCHES_PER_PUSH) {
            console.log(`[Extension API] ${toMatch.length - MAX_MATCHES_PER_PUSH} more unmatched members will be processed on next sync`)
          }
        } catch (ghlError) {
          console.error('[Extension API] GHL client error (auto-match skipped):', ghlError)
        }
      }
    }

    console.log(
      `[Extension API] Complete: upserted=${upserted}, matched=${matched}, created=${created}, errors=${errors.length}`
    )

    const response: PushMembersResponse = {
      success: errors.length === 0,
      upserted,
      matched,
      created,
      ...(errors.length > 0 && { errors }),
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST exception:', error)
    return NextResponse.json(
      {
        success: false,
        upserted: 0,
        matched: 0,
        created: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      } as PushMembersResponse,
      { status: 500, headers: corsHeaders }
    )
  }
}

// =============================================
// Validation
// =============================================

function validateRequest(body: PushMembersRequest): string | null {
  if (!body.staffSkoolId?.trim()) {
    return 'Missing required field: staffSkoolId'
  }

  if (!body.groupId?.trim()) {
    return 'Missing required field: groupId'
  }

  if (!Array.isArray(body.members)) {
    return 'members must be an array'
  }

  if (body.members.length === 0) {
    return 'members array cannot be empty'
  }

  // Validate each member
  for (let i = 0; i < body.members.length; i++) {
    const member = body.members[i]
    if (!member.skoolUserId?.trim()) {
      return `Member at index ${i}: missing required field "skoolUserId"`
    }
  }

  return null
}
