import { NextRequest, NextResponse } from 'next/server'
import { db } from '@0ne/db/server'
import { conversationSyncStatus } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * Update Conversation Sync Status API
 *
 * Updates sync status for a conversation after pushing messages.
 * Used by the extension to track where it left off for incremental sync.
 */

// =============================================
// Types
// =============================================

interface UpdateSyncStatusRequest {
  staffSkoolId: string
  conversationId: string
  lastSyncedMessageId: string
  lastSyncedMessageTime: string // ISO string
  backfillComplete: boolean
  messagesSynced: number
  participantName?: string
}

interface UpdateSyncStatusResponse {
  success: boolean
  updated: boolean
  error?: string
}

// =============================================
// POST /api/extension/update-conversation-sync
// =============================================

export async function POST(request: NextRequest) {
  // Validate auth
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { success: false, updated: false, error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: UpdateSyncStatusRequest = await request.json()

    // If using Clerk auth and staffSkoolId not provided, use linked Skool ID
    if (authResult.authType === 'clerk' && !body.staffSkoolId && authResult.skoolUserId) {
      body.staffSkoolId = authResult.skoolUserId
    }

    // Validate request
    const validationError = validateRequest(body)
    if (validationError) {
      return NextResponse.json(
        { success: false, updated: false, error: validationError },
        { status: 400, headers: corsHeaders }
      )
    }

    const {
      staffSkoolId,
      conversationId,
      lastSyncedMessageId,
      lastSyncedMessageTime,
      backfillComplete,
      messagesSynced,
      participantName,
    } = body

    console.log(
      `[Extension API] Updating sync status for conversation ${conversationId} (staff: ${staffSkoolId}, complete: ${backfillComplete}, messages: ${messagesSynced})`
    )

    // Upsert sync status (insert or update)
    try {
      await db.insert(conversationSyncStatus).values({
        staffSkoolId,
        conversationId,
        participantName: participantName || null,
        lastSyncedMessageId,
        lastSyncedMessageTime: new Date(lastSyncedMessageTime),
        backfillComplete,
        lastSyncTime: new Date(),
        totalMessagesSynced: messagesSynced,
      }).onConflictDoUpdate({
        target: [conversationSyncStatus.staffSkoolId, conversationSyncStatus.conversationId],
        set: {
          participantName: participantName || null,
          lastSyncedMessageId,
          lastSyncedMessageTime: new Date(lastSyncedMessageTime),
          backfillComplete,
          lastSyncTime: new Date(),
          totalMessagesSynced: messagesSynced,
        },
      })
    } catch (dbError) {
      console.error('[Extension API] Error updating sync status:', dbError)
      return NextResponse.json(
        { success: false, updated: false, error: dbError instanceof Error ? dbError.message : 'Unknown error' },
        { status: 500, headers: corsHeaders }
      )
    }

    console.log(
      `[Extension API] Sync status updated for ${conversationId}`
    )

    const response: UpdateSyncStatusResponse = {
      success: true,
      updated: true,
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST exception:', error)
    return NextResponse.json(
      {
        success: false,
        updated: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as UpdateSyncStatusResponse,
      { status: 500, headers: corsHeaders }
    )
  }
}

// =============================================
// Validation
// =============================================

function validateRequest(body: UpdateSyncStatusRequest): string | null {
  if (!body.staffSkoolId?.trim()) {
    return 'Missing required field: staffSkoolId'
  }

  if (!body.conversationId?.trim()) {
    return 'Missing required field: conversationId'
  }

  if (!body.lastSyncedMessageId?.trim()) {
    return 'Missing required field: lastSyncedMessageId'
  }

  if (!body.lastSyncedMessageTime?.trim()) {
    return 'Missing required field: lastSyncedMessageTime'
  }

  if (typeof body.backfillComplete !== 'boolean') {
    return 'Missing required field: backfillComplete'
  }

  if (typeof body.messagesSynced !== 'number') {
    return 'Missing required field: messagesSynced'
  }

  return null
}
