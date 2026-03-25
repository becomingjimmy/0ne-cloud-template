import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, and } from '@0ne/db/server'
import { invites } from '@0ne/db/server'

export async function POST(request: NextRequest) {
  const { userId } = await auth.protect()
  const body = await request.json()
  const { invite_token } = body

  if (!invite_token) {
    return NextResponse.json({ error: 'invite_token required' }, { status: 400 })
  }

  try {
    await db
      .update(invites)
      .set({
        status: 'accepted',
        clerkUserId: userId,
        acceptedAt: new Date(),
      })
      .where(and(eq(invites.inviteToken, invite_token), eq(invites.status, 'pending')))

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
