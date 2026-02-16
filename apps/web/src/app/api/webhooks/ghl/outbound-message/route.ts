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
 * 3. We verify signature and parse payload
 * 4. Look up Skool user from dm_contact_mappings
 * 5. Queue message for sending via Skool API
 *
 * POST /api/webhooks/ghl/outbound-message
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import {
  verifyGhlWebhookSignature,
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
  user_id: string
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
  user_id: string
  skool_user_id: string
  skool_username: string | null
  skool_display_name: string | null
  ghl_contact_id: string
}

export async function POST(request: Request) {
  const startTime = Date.now()

  // Log immediately to confirm webhook is being called
  console.log('[GHL Webhook] ========== WEBHOOK HIT ==========')
  console.log('[GHL Webhook] Timestamp:', new Date().toISOString())
  console.log('[GHL Webhook] Headers:', Object.fromEntries(request.headers.entries()))

  try {
    // 1. Get raw body for signature verification
    const rawBody = await request.text()
    console.log('[GHL Webhook] Raw body length:', rawBody.length)
    console.log('[GHL Webhook] Raw body preview:', rawBody.slice(0, 200))

    // 2. Verify webhook signature (if both signature and secret are present)
    const signature = request.headers.get('x-ghl-signature') || ''
    const webhookSecret = process.env.GHL_MARKETPLACE_WEBHOOK_SECRET

    // Log for debugging
    console.log('[GHL Webhook] Signature check:', {
      hasSignature: !!signature,
      hasSecret: !!webhookSecret,
      signatureLength: signature?.length || 0,
    })

    // Only verify if BOTH signature and secret are present
    // GHL Conversation Provider webhooks may not include signatures
    if (signature && webhookSecret) {
      if (!verifyGhlWebhookSignature(rawBody, signature)) {
        console.error('[GHL Webhook] Invalid signature')
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        )
      }
      console.log('[GHL Webhook] Signature verified successfully')
    } else {
      console.log('[GHL Webhook] Signature verification skipped (no signature from GHL)')
    }

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

    console.log('[GHL Webhook] Payload fields:', Object.keys(rawPayload))
    console.log('[GHL Webhook] Full payload:', JSON.stringify(rawPayload).slice(0, 500))

    if (!contactId || !messageText || !conversationId || !locationId) {
      console.error('[GHL Webhook] Missing required fields:', {
        hasContactId: !!contactId,
        hasMessageText: !!messageText,
        hasConversationId: !!conversationId,
        hasLocationId: !!locationId,
        availableFields: Object.keys(rawPayload),
      })
      return NextResponse.json(
        { error: 'Missing required fields', availableFields: Object.keys(rawPayload) },
        { status: 400 }
      )
    }

    // Use messageText instead of body from here on
    const body = messageText

    console.log('[GHL Webhook] Processing outbound message:', {
      contactId,
      conversationId,
      locationId,
      messageLength: body.length,
      messageId,
      replyToAltId: payload.replyToAltId,
    })

    // 5. Look up Skool user from dm_contact_mappings (by ghl_contact_id)
    const supabase = createServerClient()

    // Debug: Check total mapping count first
    const { count: mappingCount } = await supabase
      .from('dm_contact_mappings')
      .select('*', { count: 'exact', head: true })

    console.log('[GHL Webhook] Total contact mappings in DB:', mappingCount)

    const { data: mapping, error: mappingError } = await supabase
      .from('dm_contact_mappings')
      .select('*')
      .eq('ghl_contact_id', contactId)
      .single()

    if (mappingError || !mapping) {
      // Debug: Show sample mappings to help identify issue
      const { data: sampleMappings } = await supabase
        .from('dm_contact_mappings')
        .select('ghl_contact_id, skool_user_id, skool_username')
        .limit(3)

      console.error('[GHL Webhook] Contact mapping not found:', {
        contactId,
        error: mappingError?.message,
        totalMappings: mappingCount,
        sampleMappings: sampleMappings?.map(m => ({
          ghlContactId: m.ghl_contact_id?.slice(0, 8) + '...',
          skoolUsername: m.skool_username,
        })),
      })
      // Return 200 to acknowledge receipt - we can't process but shouldn't retry
      return NextResponse.json({
        success: false,
        error: 'Contact mapping not found',
        contactId,
        hint: `No mapping exists for GHL contact ${contactId}. This contact needs to have sent a Skool DM first.`,
      })
    }

    const typedMapping = mapping as ContactMappingRow

    console.log('[GHL Webhook] Found Skool mapping:', {
      skoolUserId: typedMapping.skool_user_id,
      skoolUsername: typedMapping.skool_username,
      userId: typedMapping.user_id,
    })

    // 6. Phase 5: Resolve which staff should send this message
    // Extract GHL user ID from payload if available (depends on GHL webhook format)
    // GHL webhook may include userId field for the sender
    const ghlSenderUserId = (payload as unknown as Record<string, unknown>).userId as string | undefined

    const { staff, processedMessage } = await resolveOutboundStaff(
      typedMapping.user_id,
      body,
      ghlSenderUserId,
      typedMapping.skool_user_id
    )

    console.log('[GHL Webhook] Resolved staff for outbound:', {
      staffSkoolId: staff?.skoolUserId,
      staffDisplayName: staff?.displayName,
      matchMethod: staff?.matchMethod,
      hasOverride: processedMessage !== body,
    })

    // 7. Look up the real Skool conversation ID from previous messages with this user
    // Note: dm_messages.user_id stores Skool user ID (staff), not Clerk user ID
    const staffSkoolId = staff?.skoolUserId

    console.log('[GHL Webhook] Looking up conversation with:', {
      skool_user_id: typedMapping.skool_user_id,
      staffSkoolId,
    })

    // First try with staff's Skool ID
    let conversationResult = await supabase
      .from('dm_messages')
      .select('skool_conversation_id')
      .eq('skool_user_id', typedMapping.skool_user_id)
      .eq('user_id', staffSkoolId || '')
      .not('skool_conversation_id', 'like', 'ghl:%')
      .limit(1)
      .single()

    // Fallback: just match by Skool user (ignore user_id)
    if (!conversationResult.data?.skool_conversation_id) {
      console.log('[GHL Webhook] Primary lookup failed, trying fallback without user_id filter')
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
      console.error('[GHL Webhook] No Skool conversation found for user:', {
        skoolUserId: typedMapping.skool_user_id,
        staffSkoolId,
        contactId,
      })
      // Return 200 to acknowledge - can't route without conversation
      return NextResponse.json({
        success: false,
        error: 'No Skool conversation found for this contact',
        skoolUserId: typedMapping.skool_user_id,
      })
    }

    const skoolConversationId = conversationResult.data.skool_conversation_id
    console.log('[GHL Webhook] Found Skool conversation:', skoolConversationId)

    // Generate a unique message ID for Skool (will be updated when actually sent)
    const pendingSkoolMessageId = `pending:${Date.now()}:${Math.random().toString(36).substring(7)}`

    // 8. Use raw message for Skool (no prefix)
    // The prefix is only used when syncing TO GHL, not when sending TO Skool
    // Skool messages should look natural without any platform indicators
    const finalMessageText = processedMessage

    // 9. Queue message for sending via Skool API
    // Insert into dm_messages with direction='outbound', status='pending'
    // Note: user_id should be Skool ID (staff), not Clerk ID
    const messageInsert: DmMessageInsert = {
      user_id: staffSkoolId || typedMapping.skool_user_id,  // Use staff's Skool ID
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
      console.error('[GHL Webhook] Failed to queue message:', insertError)
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

    console.log('[GHL Webhook] Message queued successfully:', {
      queuedMessageId: insertedMessage?.id,
      skoolUserId: typedMapping.skool_user_id,
      skoolUsername: typedMapping.skool_username,
      duration,
    })

    // 8. Return 200 OK
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
