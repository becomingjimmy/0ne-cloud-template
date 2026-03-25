import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, inArray, isNull } from '@0ne/db/server'
import { dmMessages, staffUsers, dmContactMappings, skoolMembers } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * Chrome Extension Push Messages API
 *
 * Receives scraped DM messages from the Skool Chrome extension
 * and stores them in the dm_messages table for sync to GHL.
 */

// =============================================
// Types
// =============================================

interface MessageAttachment {
  type: 'image' | 'file' | 'link'
  url: string
  name?: string
}

interface IncomingMessage {
  id: string
  senderId: string
  senderName: string
  content: string
  timestamp: string | null // ISO string
  timestampRaw: string
  isOwnMessage: boolean
  attachments?: MessageAttachment[]
}

interface PushMessagesRequest {
  staffSkoolId: string
  staffDisplayName?: string  // Phase 5: Staff display name for attribution
  conversationId: string
  messages: IncomingMessage[]
}

interface PushMessagesResponse {
  success: boolean
  synced: number // New messages inserted
  skipped: number // Messages already in DB
  errors?: string[]
}

// =============================================
// POST /api/extension/push-messages
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
    const body: PushMessagesRequest = await request.json()

    // If using Clerk auth and staffSkoolId not provided, use linked Skool ID
    if (authResult.authType === 'clerk' && !body.staffSkoolId && authResult.skoolUserId) {
      body.staffSkoolId = authResult.skoolUserId
    }

    // Validate request structure
    const validationError = validateRequest(body)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400, headers: corsHeaders })
    }

    const { staffSkoolId, staffDisplayName, conversationId, messages } = body

    console.log(
      `[Extension API] Received ${messages.length} messages for conversation ${conversationId} (staff: ${staffSkoolId})`
    )

    let synced = 0
    let skipped = 0
    const errors: string[] = []

    // Resolve the Clerk user ID for the clerk_user_id column
    // Clerk auth provides it directly; API key auth requires a lookup
    let clerkUserId: string | null = authResult.userId || null
    if (!clerkUserId) {
      // Look up from staff_users table using Skool ID
      const staffUserRows = await db.select({ clerkUserId: staffUsers.clerkUserId })
        .from(staffUsers)
        .where(eq(staffUsers.skoolUserId, staffSkoolId))
      clerkUserId = staffUserRows[0]?.clerkUserId || null
    }

    // First, check which messages already exist to get accurate counts
    const messageIds = messages.map((m) => m.id)
    const existingMessages = await db.select({ skoolMessageId: dmMessages.skoolMessageId })
      .from(dmMessages)
      .where(and(
        eq(dmMessages.staffSkoolId, staffSkoolId),
        inArray(dmMessages.skoolMessageId, messageIds)
      ))

    const existingMessageIds = new Set(
      existingMessages.map((m) => m.skoolMessageId)
    )

    // Process messages - only insert new ones
    // The dm_messages table uses (clerk_user_id, skool_message_id) as unique constraint
    for (const msg of messages) {
      // Skip if already exists
      if (existingMessageIds.has(msg.id)) {
        skipped++
        continue
      }

      try {
        // Map to existing dm_messages schema
        // Extension-captured inbound messages need GHL sync → status='pending'
        // Extension-captured outbound messages are already sent in Skool → status='synced'
        const isOutbound = msg.isOwnMessage

        await db.insert(dmMessages).values({
          clerkUserId,
          skoolConversationId: conversationId,
          skoolMessageId: msg.id,
          skoolUserId: msg.senderId,
          senderName: msg.senderName || null,
          direction: isOutbound ? 'outbound' : 'inbound',
          messageText: msg.content,
          status: isOutbound ? 'synced' : 'pending',
          syncedAt: isOutbound ? new Date() : null,
          source: 'extension',
          createdAt: msg.timestamp ? new Date(msg.timestamp) : new Date(),
          staffSkoolId: isOutbound ? staffSkoolId : null,
          staffDisplayName: isOutbound ? (staffDisplayName || null) : null,
        })

        synced++
      } catch (msgError: unknown) {
        // Handle race condition - message was inserted between our check and insert
        const errCode = (msgError as { code?: string })?.code
        if (errCode === '23505') {
          skipped++
        } else {
          console.error(`[Extension API] Error inserting message ${msg.id}:`, msgError)
          errors.push(
            `Message ${msg.id}: ${msgError instanceof Error ? msgError.message : 'Unknown error'}`
          )
        }
      }
    }

    // =============================================
    // Contact Discovery: ensure all inbound contacts exist in dm_contact_mappings
    // =============================================
    if (clerkUserId) {
      // Collect unique non-staff inbound senders
      const inboundSenders = new Map<string, string>() // skool_user_id -> sender_name
      for (const msg of messages) {
        if (!msg.isOwnMessage && msg.senderId) {
          inboundSenders.set(msg.senderId, msg.senderName || '')
        }
      }

      if (inboundSenders.size > 0) {
        const senderIds = [...inboundSenders.keys()]

        // Filter out staff users
        const staffUserRows = await db.select({ skoolUserId: staffUsers.skoolUserId })
          .from(staffUsers)
          .where(inArray(staffUsers.skoolUserId, senderIds))
        const staffSet = new Set(staffUserRows.map(s => s.skoolUserId))

        // Check which already have mappings
        const existingMappings = await db.select({ skoolUserId: dmContactMappings.skoolUserId })
          .from(dmContactMappings)
          .where(and(
            eq(dmContactMappings.clerkUserId, clerkUserId),
            inArray(dmContactMappings.skoolUserId, senderIds)
          ))
        const mappedSet = new Set(existingMappings.map(m => m.skoolUserId))

        // Create entries for unmapped, non-staff contacts
        for (const [senderId, senderName] of inboundSenders) {
          if (staffSet.has(senderId) || mappedSet.has(senderId)) continue

          // Check if community member
          const memberRows = await db.select({
            skoolUserId: skoolMembers.skoolUserId,
            displayName: skoolMembers.displayName,
            email: skoolMembers.email,
            ghlContactId: skoolMembers.ghlContactId,
          })
            .from(skoolMembers)
            .where(eq(skoolMembers.skoolUserId, senderId))
          const member = memberRows[0]

          await db.insert(dmContactMappings).values({
            clerkUserId,
            skoolUserId: senderId,
            skoolDisplayName: member?.displayName || senderName || null,
            ghlContactId: member?.ghlContactId || null,
            matchMethod: member?.ghlContactId ? 'skool_members' : null,
            contactType: member ? 'community_member' : 'dm_contact',
            email: member?.email || null,
          }).onConflictDoUpdate({
            target: [dmContactMappings.clerkUserId, dmContactMappings.skoolUserId],
            set: {}, // ignoreDuplicates equivalent — no updates on conflict
          })
        }
      }
    }

    console.log(
      `[Extension API] Complete: synced=${synced}, skipped=${skipped}, errors=${errors.length}`
    )

    const response: PushMessagesResponse = {
      success: errors.length === 0,
      synced,
      skipped,
      ...(errors.length > 0 && { errors }),
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST exception:', error)
    return NextResponse.json(
      {
        success: false,
        synced: 0,
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      } as PushMessagesResponse,
      { status: 500, headers: corsHeaders }
    )
  }
}

// =============================================
// Validation
// =============================================

function validateRequest(body: PushMessagesRequest): string | null {
  if (!body.staffSkoolId?.trim()) {
    return 'Missing required field: staffSkoolId'
  }

  if (!body.conversationId?.trim()) {
    return 'Missing required field: conversationId'
  }

  if (!Array.isArray(body.messages)) {
    return 'messages must be an array'
  }

  if (body.messages.length === 0) {
    return 'messages array cannot be empty'
  }

  // Validate each message
  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i]
    if (!msg.id?.trim()) {
      return `Message at index ${i}: missing required field "id"`
    }
    if (!msg.senderId?.trim()) {
      return `Message at index ${i}: missing required field "senderId"`
    }
    // senderName is optional - we can lookup by senderId
    // if (!msg.senderName?.trim()) {
    //   return `Message at index ${i}: missing required field "senderName"`
    // }
    if (typeof msg.content !== 'string') {
      return `Message at index ${i}: missing required field "content"`
    }
    if (typeof msg.isOwnMessage !== 'boolean') {
      return `Message at index ${i}: missing required field "isOwnMessage"`
    }
  }

  return null
}
