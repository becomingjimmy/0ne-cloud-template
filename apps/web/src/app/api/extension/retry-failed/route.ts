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

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

// =============================================
// Auth Helper (Supports both Clerk and API key)
// =============================================

interface AuthResult {
  valid: boolean
  authType: 'clerk' | 'apiKey' | null
  error?: string
}

async function validateExtensionAuth(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return { valid: false, authType: null, error: 'Missing Authorization header' }
  }

  if (authHeader.startsWith('Clerk ')) {
    try {
      const { userId } = await auth()
      if (userId) {
        return { valid: true, authType: 'clerk' }
      }
      return { valid: false, authType: 'clerk', error: 'Invalid or expired Clerk session' }
    } catch {
      return { valid: false, authType: 'clerk', error: 'Failed to validate Clerk session' }
    }
  }

  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) {
    const expectedKey = process.env.EXTENSION_API_KEY
    if (!expectedKey) {
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
// POST /api/extension/retry-failed
// =============================================

/**
 * Retry Failed Messages
 *
 * Resets failed outbound messages back to pending status
 * so they can be picked up and retried by the extension.
 */
export async function POST(request: NextRequest) {
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body = await request.json()
    const { staffSkoolId, messageIds } = body

    if (!staffSkoolId) {
      return NextResponse.json(
        { error: 'Missing required field: staffSkoolId' },
        { status: 400, headers: corsHeaders }
      )
    }

    const supabase = createServerClient()

    // Build query for failed messages
    let query = supabase
      .from('dm_messages')
      .update({ status: 'pending' })
      .eq('direction', 'outbound')
      .eq('status', 'failed')
      .eq('staff_skool_id', staffSkoolId)

    // If specific message IDs provided, filter to those
    if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
      query = query.in('id', messageIds)
    }

    const { data, error, count } = await query.select('id')

    if (error) {
      console.error('[Extension API] Retry failed error:', error)
      return NextResponse.json(
        { error: 'Database update failed', details: error.message },
        { status: 500, headers: corsHeaders }
      )
    }

    const resetCount = data?.length || 0
    console.log(`[Extension API] Reset ${resetCount} failed messages to pending`)

    return NextResponse.json({
      success: true,
      reset: resetCount,
    }, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST retry-failed exception:', error)
    return NextResponse.json(
      {
        success: false,
        reset: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    )
  }
}
