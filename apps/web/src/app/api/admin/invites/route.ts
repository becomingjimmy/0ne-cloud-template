import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, AuthError } from '@/lib/auth-helpers'
import { safeErrorResponse } from '@/lib/security'
import { sendEmail } from '@/lib/email'
import { db, eq, and, desc } from '@0ne/db/server'
import { invites } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireAdmin()
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  try {
    const data = await db
      .select()
      .from(invites)
      .orderBy(desc(invites.createdAt))

    return NextResponse.json({ invites: data })
  } catch (error) {
    return safeErrorResponse('Failed to fetch invites', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin()
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  const body = await request.json()
  const { email, name, source } = body

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  try {
    // Check for existing pending invite
    const [existing] = await db
      .select({ id: invites.id, status: invites.status })
      .from(invites)
      .where(and(eq(invites.email, email.toLowerCase()), eq(invites.status, 'pending')))

    if (existing) {
      return NextResponse.json({ error: 'Pending invite already exists for this email' }, { status: 409 })
    }

    const [data] = await db
      .insert(invites)
      .values({
        email: email.toLowerCase(),
        name: name || null,
        source: source || 'manual',
      })
      .returning()

    const origin = request.nextUrl.origin
    const signUpUrl = `${origin}/sign-up?invite=${data.inviteToken}`
    const greeting = data.name ? `Hi ${data.name},` : 'Hi,'

    try {
      await sendEmail({
        to: data.email,
        subject: "You're invited to 0ne",
        text: `${greeting}\n\nYou've been invited to join 0ne. Click the link below to create your account:\n\n${signUpUrl}\n\nIf you weren't expecting this invite, you can ignore this email.`,
        html: `<p>${greeting}</p><p>You've been invited to join 0ne. Click the link below to create your account:</p><p><a href="${signUpUrl}">${signUpUrl}</a></p><p>If you weren't expecting this invite, you can ignore this email.</p>`,
      })
    } catch (emailError) {
      console.error('[invites] Failed to send invite email:', emailError)
      return NextResponse.json({ invite: data, warning: 'Invite created but email failed to send' })
    }

    return NextResponse.json({ invite: data })
  } catch (error) {
    return safeErrorResponse('Failed to create invite', error)
  }
}
