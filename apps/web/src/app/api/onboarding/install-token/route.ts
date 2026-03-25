import { NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { db, eq } from '@0ne/db/server'
import { userInstalls } from '@0ne/db/server'

export async function POST() {
  const { userId } = await auth.protect()

  try {
    // Check if user already has an install record
    const existingRows = await db
      .select({
        installToken: userInstalls.installToken,
        status: userInstalls.status,
      })
      .from(userInstalls)
      .where(eq(userInstalls.clerkUserId, userId))
      .limit(1)

    const existing = existingRows[0]

    if (existing) {
      return NextResponse.json({
        install_token: existing.installToken,
        status: existing.status,
      })
    }

    // Create new install record
    const [data] = await db
      .insert(userInstalls)
      .values({ clerkUserId: userId })
      .returning({ installToken: userInstalls.installToken })

    if (!data) {
      return NextResponse.json({ error: 'Failed to create install record' }, { status: 500 })
    }

    // Store token in Clerk metadata for quick access
    const client = await clerkClient()
    await client.users.updateUserMetadata(userId, {
      publicMetadata: { installToken: data.installToken },
    })

    return NextResponse.json({
      install_token: data.installToken,
      status: 'pending',
    })
  } catch (error) {
    console.error('[onboarding/install-token API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
