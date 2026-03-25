/**
 * PATCH /api/installs/[id]/status
 *
 * Update event status (triage, fix, deploy) with history tracking.
 * Auth: Bearer token (TELEMETRY_API_KEY env var)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq } from '@0ne/db/server'
import { telemetryEvents, telemetryStatusHistory } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const VALID_STATUSES = ['triaged', 'fixed', 'deployed'] as const
type ValidStatus = (typeof VALID_STATUSES)[number]


export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Validate bearer token
  const authHeader = request.headers.get('authorization')
  const expectedKey = process.env.TELEMETRY_API_KEY

  if (!expectedKey) {
    console.error('[Installs Status API] TELEMETRY_API_KEY environment variable not set')
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
    const body = await request.json()

    const { status, note, fix_commit, fix_notes } = body as {
      status?: string
      note?: string
      fix_commit?: string
      fix_notes?: string
    }

    // Validate status
    if (!status || !VALID_STATUSES.includes(status as ValidStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400, headers: corsHeaders }
      )
    }

    // Fetch current event to get old status
    const [currentEvent] = await db.select({ status: telemetryEvents.status })
      .from(telemetryEvents)
      .where(eq(telemetryEvents.id, id))

    if (!currentEvent) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    const oldStatus = currentEvent.status || 'new'

    // Build update payload — map snake_case timestamp columns to camelCase schema
    const TIMESTAMP_CAMEL_MAP: Record<ValidStatus, string> = {
      triaged: 'triagedAt',
      fixed: 'fixedAt',
      deployed: 'deployedAt',
    }
    const timestampKey = TIMESTAMP_CAMEL_MAP[status as ValidStatus]
    const updatePayload: Record<string, unknown> = {
      status,
      [timestampKey]: new Date(),
    }

    if (fix_commit !== undefined) {
      updatePayload.fixCommit = fix_commit
    }
    if (fix_notes !== undefined) {
      updatePayload.fixNotes = fix_notes
    }

    // Update event and insert history in parallel
    const [updateResult, _historyResult] = await Promise.all([
      db.update(telemetryEvents)
        .set(updatePayload)
        .where(eq(telemetryEvents.id, id))
        .returning(),

      db.insert(telemetryStatusHistory).values({
        eventId: id,
        oldStatus: oldStatus,
        newStatus: status,
        note: note || null,
      }).catch((err) => {
        console.error('[Installs Status API] History insert error (non-fatal):', err)
      }),
    ])

    if (!updateResult || updateResult.length === 0) {
      return NextResponse.json(
        { error: 'Failed to update event' },
        { status: 500, headers: corsHeaders }
      )
    }

    return NextResponse.json(
      { success: true, event: updateResult[0] },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Installs Status API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
