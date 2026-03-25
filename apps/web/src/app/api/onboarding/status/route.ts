import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq } from '@0ne/db/server'
import { userInstalls } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId } = await auth.protect()

  try {
    const rows = await db
      .select({
        installToken: userInstalls.installToken,
        status: userInstalls.status,
        platform: userInstalls.platform,
        oneVersion: userInstalls.oneVersion,
        downloadedAt: userInstalls.downloadedAt,
        connectedAt: userInstalls.connectedAt,
        verifiedAt: userInstalls.verifiedAt,
      })
      .from(userInstalls)
      .where(eq(userInstalls.clerkUserId, userId))
      .limit(1)

    const data = rows[0]

    if (!data) {
      return NextResponse.json({
        hasInstallToken: false,
        hasDownloaded: false,
        isConnected: false,
        isVerified: false,
        installToken: null,
        platform: null,
      })
    }

    return NextResponse.json({
      hasInstallToken: true,
      hasDownloaded: data.status !== 'pending',
      isConnected: data.status === 'connected' || data.status === 'verified',
      isVerified: data.status === 'verified',
      installToken: data.installToken,
      platform: data.platform,
      oneVersion: data.oneVersion,
    })
  } catch (error) {
    console.error('[onboarding/status API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
