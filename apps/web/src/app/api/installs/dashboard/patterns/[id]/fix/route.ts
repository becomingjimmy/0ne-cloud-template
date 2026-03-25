/**
 * POST /api/installs/dashboard/patterns/[id]/fix
 *
 * Internal (Clerk-auth) endpoint to document a known fix for a failure pattern.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq } from '@0ne/db/server'
import { telemetryFailurePatterns } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const { known_fix, auto_fixable } = body as {
      known_fix?: string
      auto_fixable?: boolean
    }

    if (!known_fix || typeof known_fix !== 'string' || known_fix.trim().length === 0) {
      return NextResponse.json(
        { error: 'known_fix is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    const updatePayload: Record<string, unknown> = {
      knownFix: known_fix.trim(),
      updatedAt: new Date(),
    }

    if (typeof auto_fixable === 'boolean') {
      updatePayload.autoFixable = auto_fixable
    }

    const [pattern] = await db.update(telemetryFailurePatterns)
      .set(updatePayload)
      .where(eq(telemetryFailurePatterns.id, id))
      .returning()

    if (!pattern) {
      return NextResponse.json(
        { error: 'Pattern not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, pattern })
  } catch (error) {
    console.error('[Installs Dashboard Pattern Fix API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
