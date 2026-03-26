import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, inArray } from '@0ne/db/server'
import { conversationSyncStatus } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'
import { safeErrorResponse } from '@/lib/security'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * Conversation Sync Status API
 *
 * Returns sync status for given conversation IDs
 * Used by the extension to know which conversations have been synced
 * and where to resume from for incremental sync.
 */

// =============================================
// Types
// =============================================

interface ConversationSyncState {
  conversationId: string
  participantName?: string
  lastSyncedMessageId: string | null
  lastSyncedMessageTime: string | null
  backfillComplete: boolean
  lastSyncTime: number
  totalMessagesSynced: number
}

interface GetSyncStatusRequest {
  staffSkoolId: string
  conversationIds: string[]
}

interface GetSyncStatusResponse {
  success: boolean
  conversations: ConversationSyncState[]
  error?: string
}

// =============================================
// POST /api/extension/conversation-sync-status
// =============================================

export async function POST(request: NextRequest) {
  // Validate auth
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { success: false, conversations: [], error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: GetSyncStatusRequest = await request.json()

    // If using Clerk auth and staffSkoolId not provided, use linked Skool ID
    if (authResult.authType === 'clerk' && !body.staffSkoolId && authResult.skoolUserId) {
      body.staffSkoolId = authResult.skoolUserId
    }

    // Validate request
    if (!body.staffSkoolId?.trim()) {
      return NextResponse.json(
        { success: false, conversations: [], error: 'Missing required field: staffSkoolId' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!Array.isArray(body.conversationIds)) {
      return NextResponse.json(
        { success: false, conversations: [], error: 'conversationIds must be an array' },
        { status: 400, headers: corsHeaders }
      )
    }

    const { staffSkoolId, conversationIds } = body

    console.log(
      `[Extension API] Getting sync status for ${conversationIds.length} conversations (staff: ${staffSkoolId})`
    )

    // If no conversation IDs provided, return empty array
    if (conversationIds.length === 0) {
      return NextResponse.json(
        { success: true, conversations: [] } as GetSyncStatusResponse,
        { headers: corsHeaders }
      )
    }

    // Fetch sync status for all requested conversations
    let data
    try {
      data = await db.select()
        .from(conversationSyncStatus)
        .where(and(
          eq(conversationSyncStatus.staffSkoolId, staffSkoolId),
          inArray(conversationSyncStatus.conversationId, conversationIds)
        ))
    } catch (dbError) {
      console.error('[Extension API] Error fetching sync status:', dbError)
      return NextResponse.json(
        { success: false, conversations: [], error: dbError instanceof Error ? dbError.message : 'Unknown error' },
        { status: 500, headers: corsHeaders }
      )
    }

    // Map database rows to response format
    const conversations: ConversationSyncState[] = (data || []).map((row) => ({
      conversationId: row.conversationId!,
      participantName: row.participantName || undefined,
      lastSyncedMessageId: row.lastSyncedMessageId,
      lastSyncedMessageTime: row.lastSyncedMessageTime?.toISOString() ?? null,
      backfillComplete: row.backfillComplete ?? false,
      lastSyncTime: row.lastSyncTime ? new Date(row.lastSyncTime).getTime() : Date.now(),
      totalMessagesSynced: row.totalMessagesSynced ?? 0,
    }))

    console.log(
      `[Extension API] Returning sync status for ${conversations.length} conversations`
    )

    const response: GetSyncStatusResponse = {
      success: true,
      conversations,
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST exception:', error)
    return safeErrorResponse('Failed to get conversation sync status', error, 500, corsHeaders)
  }
}
