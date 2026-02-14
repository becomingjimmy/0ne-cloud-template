import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

export const dynamic = 'force-dynamic'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-Id',
}

/**
 * OPTIONS /api/extension/health
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

/**
 * Validate extension authentication
 * Supports both Clerk session and API key authentication
 */
async function validateAuth(
  request: NextRequest
): Promise<{ valid: boolean; authType: 'clerk' | 'apiKey' | null; userId?: string; error?: string }> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return { valid: false, authType: null, error: 'Missing Authorization header' }
  }

  // Check for Clerk auth first (Clerk <token>)
  if (authHeader.startsWith('Clerk ')) {
    try {
      const { userId } = await auth()
      if (userId) {
        return { valid: true, authType: 'clerk', userId }
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
      console.error('[Extension Health] EXTENSION_API_KEY not set')
      return { valid: false, authType: 'apiKey', error: 'Server configuration error' }
    }

    if (bearerMatch[1] === expectedKey) {
      return { valid: true, authType: 'apiKey' }
    }
    return { valid: false, authType: 'apiKey', error: 'Invalid API key' }
  }

  return { valid: false, authType: null, error: 'Invalid Authorization header format' }
}

/**
 * GET /api/extension/health
 * Health check endpoint for the Chrome extension
 * Supports both Clerk session and API key authentication
 */
export async function GET(request: NextRequest) {
  const authResult = await validateAuth(request)

  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'skool-extension-api',
      authType: authResult.authType,
    },
    { headers: corsHeaders }
  )
}
