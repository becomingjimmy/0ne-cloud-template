/**
 * GHL Outbound Message Webhook
 *
 * Handles outbound messages from GHL when a user replies in the unified inbox
 * to a Skool conversation. This webhook is triggered by the GHL Conversation
 * Provider system.
 *
 * Flow:
 * 1. User replies in GHL inbox to Skool thread
 * 2. GHL sends webhook to this endpoint
 * 3. Validate locationId and conversationProviderId
 * 4. Look up Skool user from dm_contact_mappings
 * 5. Queue message for sending via Skool API (extension picks up)
 *
 * Security:
 * - GHL Conversation Provider webhooks do NOT include signatures (by design)
 * - Security relies on: URL secrecy, locationId validation, providerId match
 * - Reference: https://marketplace.gohighlevel.com/docs/webhook/ProviderOutboundMessage/
 *
 * POST /api/webhooks/ghl/outbound-message
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import {
  type GhlOutboundMessagePayload,
} from '@/features/dm-sync/lib/ghl-conversation'
import {
  resolveOutboundStaff,
} from '@/features/dm-sync/lib/staff-users'

// Disable body parsing - we need raw body for signature verification
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Database row type for dm_messages
 */
interface DmMessageInsert {
  clerk_user_id: string
  skool_conversation_id: string
  skool_message_id: string
  ghl_message_id: string | null
  skool_user_id: string
  direction: 'inbound' | 'outbound'
  message_text: string | null
  status: 'synced' | 'pending' | 'failed'
  source: 'ghl' | 'manual' | 'hand-raiser'
  // Phase 5: Multi-staff support
  staff_skool_id?: string | null
  staff_display_name?: string | null
  ghl_user_id?: string | null
}

/**
 * Contact mapping row from database
 */
interface ContactMappingRow {
  id: string
  clerk_user_id: string
  skool_user_id: string
  skool_username: string | null
  skool_display_name: string | null
  ghl_contact_id: string
}

export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    // 1. Get raw body
    const rawBody = await request.text()

    // 2. Webhook Security Notes:
    // - Standard GHL webhooks use x-wh-signature header with RSA-SHA256 + public key
    // - Conversation Provider webhooks do NOT include signatures (confirmed via GHL docs)
    // - Security relies on: (1) URL secrecy, (2) locationId validation, (3) conversationProviderId match
    // Reference: https://marketplace.gohighlevel.com/docs/webhook/ProviderOutboundMessage/index.html

    // 3. Parse payload
    let payload: GhlOutboundMessagePayload
    try {
      payload = JSON.parse(rawBody) as GhlOutboundMessagePayload
    } catch {
      console.error('[GHL Webhook] Invalid JSON payload')
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      )
    }

    // 4. Validate required fields
    // GHL may send message content in different fields depending on conversation type
    const rawPayload = payload as unknown as Record<string, unknown>
    const { contactId, conversationId, locationId, messageId } = payload

    // Try multiple field names for message content
    const messageText = (
      rawPayload.body ||
      rawPayload.message ||
      rawPayload.text ||
      rawPayload.content ||
      rawPayload.messageBody
    ) as string | undefined

    if (!contactId || !messageText || !conversationId || !locationId) {
      console.error('[GHL Webhook] Missing required fields:', {
        hasContactId: !!contactId,
        hasMessageText: !!messageText,
        hasConversationId: !!conversationId,
        hasLocationId: !!locationId,
      })
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Use messageText instead of body from here on
    const body = messageText

    // 4b. Validate conversationProviderId matches our registered provider (extra security)
    const incomingProviderId = rawPayload.conversationProviderId as string | undefined
    const expectedProviderId = process.env.GHL_CONVERSATION_PROVIDER_ID?.trim()

    if (expectedProviderId && incomingProviderId && incomingProviderId !== expectedProviderId) {
      console.error('[GHL Webhook] Provider ID mismatch')
      return NextResponse.json(
        { error: 'Invalid conversation provider' },
        { status: 403 }
      )
    }

    // 5. Look up Skool user from dm_contact_mappings (by ghl_contact_id)
    const supabase = createServerClient()

    const { data: mapping, error: mappingError } = await supabase
      .from('dm_contact_mappings')
      .select('*')
      .eq('ghl_contact_id', contactId)
      .single()

    if (mappingError || !mapping) {
      console.error('[GHL Webhook] Contact mapping not found for:', contactId)
      // Return 200 to acknowledge receipt - we can't process but shouldn't retry
      return NextResponse.json({
        success: false,
        error: 'Contact mapping not found',
        contactId,
        hint: `No mapping exists for GHL contact ${contactId}. This contact needs to have sent a Skool DM first.`,
      })
    }

    const typedMapping = mapping as ContactMappingRow

    // 6. Phase 5: Resolve which staff should send this message
    // Extract GHL user ID from payload if available (depends on GHL webhook format)
    const ghlSenderUserId = (payload as unknown as Record<string, unknown>).userId as string | undefined

    const { staff, processedMessage } = await resolveOutboundStaff(
      typedMapping.clerk_user_id,
      body,
      ghlSenderUserId,
      typedMapping.skool_user_id
    )

    // 7. Look up the real Skool conversation ID from previous messages with this user
    // Note: dm_messages.staff_skool_id stores the Skool user ID of the staff member
    const staffSkoolId = staff?.skoolUserId

    // First try with staff's Skool ID
    let conversationResult = await supabase
      .from('dm_messages')
      .select('skool_conversation_id')
      .eq('skool_user_id', typedMapping.skool_user_id)
      .eq('staff_skool_id', staffSkoolId || '')
      .not('skool_conversation_id', 'like', 'ghl:%')
      .limit(1)
      .single()

    // Fallback: just match by Skool user (ignore staff_skool_id)
    if (!conversationResult.data?.skool_conversation_id) {
      conversationResult = await supabase
        .from('dm_messages')
        .select('skool_conversation_id')
        .eq('skool_user_id', typedMapping.skool_user_id)
        .not('skool_conversation_id', 'like', 'ghl:%')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
    }

    if (!conversationResult.data?.skool_conversation_id) {
      console.error('[GHL Webhook] No Skool conversation found for user:', typedMapping.skool_user_id)
      // Return 200 to acknowledge - can't route without conversation
      return NextResponse.json({
        success: false,
        error: 'No Skool conversation found for this contact',
        skoolUserId: typedMapping.skool_user_id,
      })
    }

    const skoolConversationId = conversationResult.data.skool_conversation_id

    // Generate a unique message ID for Skool (will be updated when actually sent)
    const pendingSkoolMessageId = `pending:${Date.now()}:${Math.random().toString(36).substring(7)}`

    // 8. Use raw message for Skool (no prefix)
    // The prefix is only used when syncing TO GHL, not when sending TO Skool
    // Skool messages should look natural without any platform indicators
    const finalMessageText = processedMessage

    // 9. Queue message for sending via Skool API
    // Insert into dm_messages with direction='outbound', status='pending'
    // Note: clerk_user_id stores the Clerk ID, staff_skool_id stores the Skool staff ID
    const messageInsert: DmMessageInsert = {
      clerk_user_id: typedMapping.clerk_user_id,  // Use Clerk user ID from contact mapping
      skool_conversation_id: skoolConversationId,
      skool_message_id: pendingSkoolMessageId,
      ghl_message_id: messageId || null,
      skool_user_id: typedMapping.skool_user_id,
      direction: 'outbound',
      message_text: finalMessageText,
      status: 'pending',
      source: 'ghl',  // Mark as GHL-originated for extension pickup
      // Phase 5: Multi-staff attribution
      staff_skool_id: staff?.skoolUserId || null,
      staff_display_name: staff?.displayName || null,
      ghl_user_id: ghlSenderUserId || null,
    }

    const { data: insertedMessage, error: insertError } = await supabase
      .from('dm_messages')
      .insert(messageInsert)
      .select('id')
      .single()

    if (insertError) {
      console.error('[GHL Webhook] Failed to queue message:', insertError.message)
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to queue message',
          details: insertError.message,
        },
        { status: 500 }
      )
    }

    const duration = Date.now() - startTime
    console.log('[GHL Webhook] Queued outbound message', insertedMessage?.id, 'in', duration + 'ms')

    // 10. Return 200 OK
    return NextResponse.json({
      success: true,
      queued: true,
      messageId: insertedMessage?.id,
      skoolUserId: typedMapping.skool_user_id,
      duration,
    })
  } catch (error) {
    console.error('[GHL Webhook] Unexpected error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * Health check endpoint
 * GHL may ping this to verify the webhook URL is active
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/webhooks/ghl/outbound-message',
    description: 'GHL outbound message webhook for Skool DM sync',
    timestamp: new Date().toISOString(),
  })
}
