/**
 * GET /api/installs/dashboard/[id]
 *
 * Internal (Clerk-auth) single telemetry event with full details and status history.
 * Browser-callable version of the external /api/installs/[id] route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, desc } from '@0ne/db/server'
import { telemetryEvents, telemetryStatusHistory } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Fetch event and status history in parallel
    const [events, history] = await Promise.all([
      db.select().from(telemetryEvents)
        .where(eq(telemetryEvents.id, id)),

      db.select().from(telemetryStatusHistory)
        .where(eq(telemetryStatusHistory.eventId, id))
        .orderBy(desc(telemetryStatusHistory.createdAt)),
    ])

    if (events.length === 0) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    return NextResponse.json({
      event: events[0],
      status_history: history,
    })
  } catch (error) {
    console.error('[Installs Dashboard Detail API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
