/**
 * GET /api/installs/[id]
 *
 * Single telemetry event with full details and status history.
 * Auth: Bearer token (TELEMETRY_API_KEY env var)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq, asc } from '@0ne/db/server'
import { telemetryEvents, telemetryStatusHistory } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Validate bearer token
  const authHeader = request.headers.get('authorization')
  const expectedKey = process.env.TELEMETRY_API_KEY

  if (!expectedKey) {
    console.error('[Installs Detail API] TELEMETRY_API_KEY environment variable not set')
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500, headers: corsHeaders }
    )
  }

  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i)
  if (!bearerMatch || bearerMatch[1] !== expectedKey) {
    return NextResponse.json(
      { error: 'Invalid or missing authorization' },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const { id } = await params

    // Fetch event and status history in parallel
    const [events, history] = await Promise.all([
      db.select().from(telemetryEvents)
        .where(eq(telemetryEvents.id, id)),

      db.select().from(telemetryStatusHistory)
        .where(eq(telemetryStatusHistory.eventId, id))
        .orderBy(asc(telemetryStatusHistory.createdAt)),
    ])

    if (events.length === 0) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    return NextResponse.json(
      {
        event: events[0],
        status_history: history,
      },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Installs Detail API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
