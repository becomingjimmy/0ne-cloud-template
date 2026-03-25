import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { corsHeaders } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/extension/validate-session
 * Validates the Clerk session from the Chrome extension
 * Returns user info including linked Skool user ID
 */
export async function GET(request: NextRequest) {
  try {
    // Get the auth info from Clerk
    const { userId } = await auth()

    if (!userId) {
      // Check for Authorization header with Clerk token
      const authHeader = request.headers.get('authorization')
      if (authHeader?.startsWith('Clerk ')) {
        // The extension sent a session token, but we couldn't validate it
        // This could mean the session has expired
        return NextResponse.json(
          { error: 'Session expired or invalid', authenticated: false },
          { status: 401, headers: corsHeaders }
        )
      }

      return NextResponse.json(
        { error: 'Not authenticated', authenticated: false },
        { status: 401, headers: corsHeaders }
      )
    }

    // Get user details from Clerk
    const client = await clerkClient()
    const user = await client.users.getUser(userId)

    // Check if user has a linked Skool user ID in metadata
    const skoolUserId = (user.publicMetadata?.skoolUserId as string) || null

    return NextResponse.json(
      {
        userId,
        authenticated: true,
        skoolUserId,
        email: user.emailAddresses?.[0]?.emailAddress || null,
        name: user.firstName || user.username || null,
      },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Extension Validate Session] Error:', error)
    return NextResponse.json(
      { error: 'Session validation failed', authenticated: false },
      { status: 500, headers: corsHeaders }
    )
  }
}
