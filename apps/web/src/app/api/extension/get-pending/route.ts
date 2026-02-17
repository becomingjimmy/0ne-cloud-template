import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { auth, clerkClient } from '@clerk/nextjs/server'

export const dynamic = 'force-dynamic'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-Id',
}

/**
 * OPTIONS /api/extension/get-pending
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

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
}

interface GetPendingResponse {
  success: boolean
  messages: PendingMessage[]
  count: number
}

// =============================================
// Auth Helper (Supports both Clerk and API key)
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

// =============================================
// GET /api/extension/get-pending
// =============================================

/**
 * Get Pending Outbound Messages
 *
 * Returns messages that need to be sent via the Chrome extension.
 * These are messages created from GHL that need to be delivered to Skool.
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

    const supabase = createServerClient()

    // Debug: First check how many pending outbound messages exist at all
    const { count: totalPending, data: samplePending } = await supabase
      .from('dm_messages')
      .select('id, clerk_user_id, staff_skool_id, source', { count: 'exact' })
      .eq('direction', 'outbound')
      .eq('status', 'pending')
      .limit(3)

    console.log(`[Extension API] Total pending outbound messages in DB: ${totalPending}`)
    console.log(`[Extension API] Sample pending messages:`, JSON.stringify(samplePending))
    console.log(`[Extension API] Looking for staffSkoolId: ${staffSkoolId}`)

    // Query for pending outbound messages
    // These are messages that:
    // 1. Belong to this staff member (staff_skool_id = staffSkoolId)
    // 2. Are outbound (direction = 'outbound')
    // 3. Are pending (status = 'pending')
    // 4. Have a valid source: GHL (ghl_message_id), hand-raiser, or manual (inbox)
    //
    // Phase 5: Also filter by staff_skool_id for multi-staff routing
    // Messages can be routed to specific staff via staff_skool_id field
    // Get current time minus 24 hours for GHL message filter
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: pendingMessages, error } = await supabase
      .from('dm_messages')
      .select('id, skool_conversation_id, skool_user_id, message_text, created_at, staff_skool_id, staff_display_name, source')
      .eq('staff_skool_id', staffSkoolId)
      .eq('direction', 'outbound')
      .eq('status', 'pending')
      // Allow both manual (inbox) and ghl messages
      // GHL messages are filtered to last 24 hours to avoid sending old backfill data
      .or(`source.eq.manual,and(source.eq.ghl,created_at.gte.${oneDayAgo})`)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) {
      console.error('[Extension API] Database error:', error)
      return NextResponse.json(
        { error: 'Database query failed', details: error.message },
        { status: 500, headers: corsHeaders }
      )
    }

    const messages = pendingMessages || []

    console.log(`[Extension API] Found ${messages.length} pending outbound messages`)

    const response: GetPendingResponse = {
      success: true,
      messages,
      count: messages.length,
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] GET pending exception:', error)
    return NextResponse.json(
      {
        success: false,
        messages: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    )
  }
}
