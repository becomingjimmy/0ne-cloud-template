import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServerClient } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-Id',
}

/**
 * OPTIONS /api/extension/push-messages
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

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
// Auth Helper (Phase 7: Supports both Clerk and API key)
// =============================================

interface AuthResult {
  valid: boolean
  authType: 'clerk' | 'apiKey' | null
  userId?: string
  skoolUserId?: string
  error?: string
}

async function validateExtensionAuth(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return { valid: false, authType: null, error: 'Missing Authorization header' }
  }

  // Check for Clerk auth first (Clerk <token>)
  if (authHeader.startsWith('Clerk ')) {
    try {
      const { userId } = await auth()
      if (userId) {
        // Get the linked Skool user ID from Clerk metadata
        const client = await clerkClient()
        const user = await client.users.getUser(userId)
        const skoolUserId = (user.publicMetadata?.skoolUserId as string) || undefined

        return { valid: true, authType: 'clerk', userId, skoolUserId }
      }
      return { valid: false, authType: 'clerk', error: 'Invalid or expired Clerk session' }
    } catch {
      return { valid: false, authType: 'clerk', error: 'Failed to validate Clerk session' }
    }
  }

  // Check for Bearer token (API key)
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) {
    const expectedKey = process.env.EXTENSION_API_KEY
    if (!expectedKey) {
      console.error('[Extension API] EXTENSION_API_KEY environment variable not set')
      return { valid: false, authType: 'apiKey', error: 'Server configuration error' }
    }

    if (bearerMatch[1] === expectedKey) {
      return { valid: true, authType: 'apiKey' }
    }
    return { valid: false, authType: 'apiKey', error: 'Invalid API key' }
  }

  return { valid: false, authType: null, error: 'Invalid Authorization header format' }
}

// Legacy function for backward compatibility
function validateExtensionApiKey(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization')
  const expectedKey = process.env.EXTENSION_API_KEY

  if (!expectedKey) {
    console.error('[Extension API] EXTENSION_API_KEY environment variable not set')
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500, headers: corsHeaders }
    )
  }

  if (!authHeader) {
    return NextResponse.json(
      { error: 'Missing Authorization header' },
      { status: 401, headers: corsHeaders }
    )
  }

  // Extract Bearer token
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return NextResponse.json(
      { error: 'Invalid Authorization header format. Expected: Bearer {apiKey}' },
      { status: 401, headers: corsHeaders }
    )
  }

  const apiKey = match[1]
  if (apiKey !== expectedKey) {
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 401, headers: corsHeaders }
    )
  }

  return null // Valid
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

    const supabase = createServerClient()
    let synced = 0
    let skipped = 0
    const errors: string[] = []

    // Resolve the Clerk user ID for the clerk_user_id column
    // Clerk auth provides it directly; API key auth requires a lookup
    let clerkUserId: string | null = authResult.userId || null
    if (!clerkUserId) {
      // Look up from staff_users table using Skool ID
      const { data: staffUser } = await supabase
        .from('staff_users')
        .select('clerk_user_id')
        .eq('skool_user_id', staffSkoolId)
        .single()
      clerkUserId = staffUser?.clerk_user_id || null
    }

    // First, check which messages already exist to get accurate counts
    const messageIds = messages.map((m) => m.id)
    const { data: existingMessages } = await supabase
      .from('dm_messages')
      .select('skool_message_id')
      .eq('staff_skool_id', staffSkoolId)
      .in('skool_message_id', messageIds)

    const existingMessageIds = new Set(
      (existingMessages || []).map((m) => m.skool_message_id)
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
        // Extension-captured messages need GHL sync, so status='pending' and ghl_message_id=null
        const messageRow = {
          clerk_user_id: clerkUserId,
          skool_conversation_id: conversationId,
          skool_message_id: msg.id,
          skool_user_id: msg.senderId,
          sender_name: msg.senderName || null, // Store sender name for contact matching
          direction: msg.isOwnMessage ? 'outbound' : 'inbound',
          message_text: msg.content,
          status: 'pending', // Extension messages need GHL sync
          synced_at: null, // Will be set when pushed to GHL
          // Use original message timestamp, not insertion time
          created_at: msg.timestamp || new Date().toISOString(),
          // ghl_message_id will be null until synced to GHL
          // Phase 5: Multi-staff attribution
          staff_skool_id: msg.isOwnMessage ? staffSkoolId : null,
          staff_display_name: msg.isOwnMessage ? (staffDisplayName || null) : null,
        }

        const { error } = await supabase.from('dm_messages').insert(messageRow)

        if (error) {
          // Handle race condition - message was inserted between our check and insert
          if (error.code === '23505') {
            skipped++
          } else {
            console.error(`[Extension API] Error inserting message ${msg.id}:`, error)
            errors.push(`Message ${msg.id}: ${error.message}`)
          }
        } else {
          synced++
        }
      } catch (msgError) {
        console.error(`[Extension API] Exception processing message ${msg.id}:`, msgError)
        errors.push(
          `Message ${msg.id}: ${msgError instanceof Error ? msgError.message : 'Unknown error'}`
        )
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
