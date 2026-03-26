import { NextRequest, NextResponse } from 'next/server'
import { db } from '@0ne/db/server'
import { extensionCookies } from '@0ne/db/server'
import {
  encryptCookies,
  isEncryptionConfigured,
} from '@/lib/cookie-encryption'
import { corsHeaders, validateExtensionApiKey } from '@/lib/extension-auth'
import { safeErrorResponse } from '@/lib/security'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

// ============================================
// Types
// ============================================

interface PushCookiesRequest {
  staffSkoolId: string
  cookies: string // Full cookie string
  authTokenExpiresAt: string | null // ISO string
  hasSession: boolean
}

interface PushCookiesResponse {
  success: boolean
  stored: boolean
  expiresAt: string | null
  error?: string
}

// ============================================
// POST /api/extension/push-cookies
// ============================================

export async function POST(request: NextRequest) {
  // Validate API key
  const authError = validateExtensionApiKey(request)
  if (authError) return authError

  // Check encryption is configured
  if (!isEncryptionConfigured()) {
    console.error('[Extension API] COOKIE_ENCRYPTION_KEY not configured')
    return NextResponse.json(
      {
        success: false,
        stored: false,
        expiresAt: null,
        error: 'Server encryption not configured',
      } as PushCookiesResponse,
      { status: 500, headers: corsHeaders }
    )
  }

  try {
    const body: PushCookiesRequest = await request.json()

    // Validate request
    if (!body.staffSkoolId?.trim()) {
      return NextResponse.json(
        {
          success: false,
          stored: false,
          expiresAt: null,
          error: 'Missing required field: staffSkoolId',
        } as PushCookiesResponse,
        { status: 400, headers: corsHeaders }
      )
    }

    if (!body.cookies?.trim()) {
      return NextResponse.json(
        {
          success: false,
          stored: false,
          expiresAt: null,
          error: 'Missing required field: cookies',
        } as PushCookiesResponse,
        { status: 400, headers: corsHeaders }
      )
    }

    console.log(
      `[Extension API] Storing cookies for staff ${body.staffSkoolId}`,
      body.authTokenExpiresAt ? `(expires: ${body.authTokenExpiresAt})` : '(no expiry)'
    )

    // Encrypt cookies
    const encryptedCookies = encryptCookies(body.cookies)

    // Parse expiry date
    const expiresAt = body.authTokenExpiresAt ? new Date(body.authTokenExpiresAt) : null

    // Upsert into database
    try {
      await db.insert(extensionCookies).values({
        staffSkoolId: body.staffSkoolId,
        cookiesEncrypted: encryptedCookies,
        authTokenExpiresAt: expiresAt,
        sessionCookiePresent: body.hasSession,
        lastUpdated: new Date(),
      }).onConflictDoUpdate({
        target: extensionCookies.staffSkoolId,
        set: {
          cookiesEncrypted: encryptedCookies,
          authTokenExpiresAt: expiresAt,
          sessionCookiePresent: body.hasSession,
          lastUpdated: new Date(),
        },
      })
    } catch (dbError) {
      console.error('[Extension API] Error storing cookies:', dbError)
      return NextResponse.json(
        {
          success: false,
          stored: false,
          expiresAt: null,
          error: `Database error: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`,
        } as PushCookiesResponse,
        { status: 500, headers: corsHeaders }
      )
    }

    console.log(`[Extension API] Cookies stored successfully for ${body.staffSkoolId}`)

    const response: PushCookiesResponse = {
      success: true,
      stored: true,
      expiresAt: expiresAt?.toISOString() ?? null,
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST exception:', error)
    return safeErrorResponse('Failed to store cookies', error, 500, corsHeaders)
  }
}
