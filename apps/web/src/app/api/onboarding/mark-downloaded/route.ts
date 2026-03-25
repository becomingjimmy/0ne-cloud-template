import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, and } from '@0ne/db/server'
import { userInstalls } from '@0ne/db/server'

export async function POST() {
  const { userId } = await auth.protect()

  try {
    await db
      .update(userInstalls)
      .set({
        status: 'downloaded',
        downloadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userInstalls.clerkUserId, userId),
          eq(userInstalls.status, 'pending')
        )
      )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[onboarding/mark-downloaded API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
