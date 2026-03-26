import { NextRequest, NextResponse } from 'next/server'
import { db, eq } from '@0ne/db/server'
import { dmMessages } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'
import { safeErrorResponse } from '@/lib/security'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

// =============================================
// Types
// =============================================

interface ConfirmSentRequest {
  messageId: string
  skoolMessageId?: string // The message ID from Skool after sending
  resolvedChannelId?: string // Real channel ID if resolved from placeholder
  success: boolean
  error?: string
}

interface ConfirmSentResponse {
  success: boolean
  updated: boolean
  error?: string
}

// =============================================
// POST /api/extension/confirm-sent
// =============================================

/**
 * Confirm Message Sent
 *
 * Called by the extension after successfully sending a message to Skool.
 * Updates the message status to 'synced' and records the Skool message ID.
 */
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
    const body: ConfirmSentRequest = await request.json()

    // Validate request
    if (!body.messageId) {
      return NextResponse.json(
        { error: 'Missing required field: messageId' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (typeof body.success !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing required field: success (boolean)' },
        { status: 400, headers: corsHeaders }
      )
    }

    console.log(
      `[Extension API] Confirming message ${body.messageId}: success=${body.success}`
    )

    if (body.success) {
      // Mark message as synced
      try {
        await db.update(dmMessages).set({
          status: 'synced',
          syncedAt: new Date(),
          // Update skoolMessageId if provided (message sent successfully to Skool)
          ...(body.skoolMessageId && { skoolMessageId: body.skoolMessageId }),
          // Update skoolConversationId if resolved from placeholder
          ...(body.resolvedChannelId && { skoolConversationId: body.resolvedChannelId }),
        }).where(eq(dmMessages.id, body.messageId))
      } catch (updateError) {
        console.error('[Extension API] Failed to update message status:', updateError)
        return NextResponse.json(
          { success: false, updated: false, error: updateError instanceof Error ? updateError.message : 'Unknown error' },
          { status: 500, headers: corsHeaders }
        )
      }

      console.log(`[Extension API] Message ${body.messageId} marked as synced`)

      const response: ConfirmSentResponse = {
        success: true,
        updated: true,
      }

      return NextResponse.json(response, { headers: corsHeaders })
    } else {
      // Mark message as failed
      try {
        await db.update(dmMessages).set({
          status: 'failed',
        }).where(eq(dmMessages.id, body.messageId))
      } catch (updateError) {
        console.error('[Extension API] Failed to update message status:', updateError)
        return NextResponse.json(
          { success: false, updated: false, error: updateError instanceof Error ? updateError.message : 'Unknown error' },
          { status: 500, headers: corsHeaders }
        )
      }

      console.log(
        `[Extension API] Message ${body.messageId} marked as failed: ${body.error || 'Unknown error'}`
      )

      const response: ConfirmSentResponse = {
        success: true,
        updated: true,
      }

      return NextResponse.json(response, { headers: corsHeaders })
    }
  } catch (error) {
    console.error('[Extension API] POST confirm-sent exception:', error)
    return safeErrorResponse('Failed to confirm sent message', error, 500, corsHeaders)
  }
}
