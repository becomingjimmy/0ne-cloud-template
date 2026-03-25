import { NextRequest, NextResponse } from 'next/server'
import { db, eq } from '@0ne/db/server'
import { invites } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.json({ valid: false, error: 'Token required' }, { status: 400 })
  }

  try {
    const [data] = await db
      .select({
        id: invites.id,
        email: invites.email,
        name: invites.name,
        status: invites.status,
        expiresAt: invites.expiresAt,
      })
      .from(invites)
      .where(eq(invites.inviteToken, token))

    if (!data) {
      return NextResponse.json({ valid: false, error: 'Invalid invite' }, { status: 404 })
    }

    if (data.status !== 'pending') {
      return NextResponse.json({ valid: false, error: `Invite is ${data.status}` }, { status: 410 })
    }

    if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
      return NextResponse.json({ valid: false, error: 'Invite has expired' }, { status: 410 })
    }

    return NextResponse.json({
      valid: true,
      invite: { email: data.email, name: data.name },
    })
  } catch {
    return NextResponse.json({ valid: false, error: 'Invalid invite' }, { status: 404 })
  }
}
