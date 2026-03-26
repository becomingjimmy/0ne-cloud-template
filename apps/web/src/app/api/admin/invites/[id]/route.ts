import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getUserPermissions } from '@0ne/auth/permissions'
import { db, eq } from '@0ne/db/server'
import { invites } from '@0ne/db/server'
import { safeErrorResponse } from '@/lib/security'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth.protect()
  const permissions = await getUserPermissions(userId)
  if (!permissions.isAdmin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { id } = await params

  try {
    await db
      .update(invites)
      .set({ status: 'revoked' })
      .where(eq(invites.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    return safeErrorResponse('Failed to revoke invite', error)
  }
}
