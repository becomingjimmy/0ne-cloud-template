import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, isNull } from '@0ne/db/server'
import { dmMessages, staffUsers, conversationSyncStatus, dmContactMappings } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'
import { safeErrorResponse } from '@/lib/security'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/extension/push-conversation-names
 *
 * Receives participant names from the extension's conversation poll
 * and stores them in conversation_sync_status for reliable lookup.
 * Also backfills sender_name on existing dm_messages rows where it's missing.
 */

interface Participant {
  conversationId: string
  userId: string
  name: string
  username?: string
}

interface PushNamesRequest {
  staffSkoolId?: string
  participants: Participant[]
}

export async function POST(request: NextRequest) {
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: PushNamesRequest = await request.json()

    if (!Array.isArray(body.participants) || body.participants.length === 0) {
      return NextResponse.json(
        { error: 'participants array is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Resolve staff Skool ID from request body, auth result, or staff_users lookup
    let staffSkoolId = body.staffSkoolId || authResult.skoolUserId || null
    if (!staffSkoolId && authResult.userId) {
      const staffUserRows = await db.select({ skoolUserId: staffUsers.skoolUserId })
        .from(staffUsers)
        .where(eq(staffUsers.clerkUserId, authResult.userId))
      staffSkoolId = staffUserRows[0]?.skoolUserId || null
    }

    let updatedMessages = 0
    let updatedSyncStatus = 0
    let enrichedContacts = 0
    let errors = 0

    for (const p of body.participants) {
      if (!p.conversationId || !p.name) continue

      // 1) Backfill sender_name on dm_messages where it's NULL
      try {
        const nullData = await db.update(dmMessages)
          .set({ senderName: p.name })
          .where(and(
            eq(dmMessages.skoolConversationId, p.conversationId),
            isNull(dmMessages.senderName)
          ))
          .returning({ id: dmMessages.id })
        updatedMessages += nullData?.length || 0
      } catch (nullError) {
        console.error(`[Extension API] push-names null update error (${p.conversationId}):`, nullError instanceof Error ? nullError.message : nullError)
        errors++
      }

      // 2) Backfill sender_name on dm_messages where it's "Unknown"
      try {
        const unknownData = await db.update(dmMessages)
          .set({ senderName: p.name })
          .where(and(
            eq(dmMessages.skoolConversationId, p.conversationId),
            eq(dmMessages.senderName, 'Unknown')
          ))
          .returning({ id: dmMessages.id })
        updatedMessages += unknownData?.length || 0
      } catch (unknownError) {
        console.error(`[Extension API] push-names Unknown update error (${p.conversationId}):`, unknownError instanceof Error ? unknownError.message : unknownError)
        errors++
      }

      // 3) Store name in conversation_sync_status for reliable lookup by conversations API
      if (staffSkoolId) {
        try {
          await db.insert(conversationSyncStatus).values({
            staffSkoolId,
            conversationId: p.conversationId,
            participantName: p.name,
          }).onConflictDoUpdate({
            target: [conversationSyncStatus.staffSkoolId, conversationSyncStatus.conversationId],
            set: {
              participantName: p.name,
            },
          })
          updatedSyncStatus++
        } catch (syncError) {
          console.error(`[Extension API] push-names sync status error (${p.conversationId}):`, syncError instanceof Error ? syncError.message : syncError)
          errors++
        }
      }

      // 4) Enrich dm_contact_mappings with username and display name
      // This fills in missing skool_username for DM contacts using the slug from chat-channels API
      if (p.userId && (p.username || p.name)) {
        try {
          const setFields: Record<string, unknown> = { updatedAt: new Date() }
          if (p.username) setFields.skoolUsername = p.username
          if (p.name) setFields.skoolDisplayName = p.name

          const enriched = await db.update(dmContactMappings)
            .set(setFields)
            .where(and(
              eq(dmContactMappings.skoolUserId, p.userId),
              isNull(dmContactMappings.skoolUsername)
            ))
            .returning({ id: dmContactMappings.id })

          if (enriched && enriched.length > 0) {
            enrichedContacts++
          }
        } catch (enrichError) {
          console.error(`[Extension API] push-names enrich error (${p.userId}):`, enrichError instanceof Error ? enrichError.message : enrichError)
        }
      }
    }

    console.log(
      `[Extension API] push-conversation-names: ${updatedMessages} messages backfilled, ${updatedSyncStatus} sync statuses updated, ${enrichedContacts} contacts enriched, ${errors} errors`
    )

    return NextResponse.json(
      { success: errors === 0, updated: updatedMessages, syncStatusUpdated: updatedSyncStatus, enrichedContacts, errors },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Extension API] push-conversation-names error:', error)
    return safeErrorResponse('Failed to push conversation names', error, 500, corsHeaders)
  }
}
