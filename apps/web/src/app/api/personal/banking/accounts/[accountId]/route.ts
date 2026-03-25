import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq } from '@0ne/db/server'
import { plaidAccounts } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { accountId } = await params
    const body = await request.json()

    // Build update object from allowed fields only
    const update: Record<string, unknown> = {}
    if (typeof body.is_hidden === 'boolean') {
      update.isHidden = body.is_hidden
    }
    if (body.scope === 'personal' || body.scope === 'business' || body.scope === null) {
      update.scope = body.scope
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    update.updatedAt = new Date()

    await db.update(plaidAccounts)
      .set(update)
      .where(eq(plaidAccounts.id, accountId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Account PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update account', details: String(error) },
      { status: 500 }
    )
  }
}
