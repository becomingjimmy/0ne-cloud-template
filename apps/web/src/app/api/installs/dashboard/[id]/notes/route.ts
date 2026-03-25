/**
 * POST /api/installs/dashboard/[id]/notes
 *
 * Internal (Clerk-auth) note addition for telemetry events.
 * Browser-callable version of the external /api/installs/[id]/notes route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq } from '@0ne/db/server'
import { telemetryEvents, telemetryStatusHistory } from '@0ne/db/server'

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

    const { note } = body as { note?: string }

    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      return NextResponse.json(
        { error: 'note is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    // Fetch current status so we can record it in history
    const [currentEvent] = await db.select({ status: telemetryEvents.status })
      .from(telemetryEvents)
      .where(eq(telemetryEvents.id, id))

    if (!currentEvent) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const currentStatus = currentEvent.status || 'new'

    // Insert note as history entry (status unchanged)
    const [historyEntry] = await db.insert(telemetryStatusHistory).values({
      eventId: id,
      oldStatus: currentStatus,
      newStatus: currentStatus,
      note: note.trim(),
    }).returning({ id: telemetryStatusHistory.id })

    return NextResponse.json({ success: true, id: historyEntry.id })
  } catch (error) {
    console.error('[Installs Dashboard Notes API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
