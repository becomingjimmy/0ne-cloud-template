/**
 * GET /api/installs/stats
 *
 * Aggregate statistics for telemetry events.
 * Auth: Bearer token (TELEMETRY_API_KEY env var)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq, count } from '@0ne/db/server'
import { telemetryEvents } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

export async function GET(request: NextRequest) {
  // Validate bearer token
  const authHeader = request.headers.get('authorization')
  const expectedKey = process.env.TELEMETRY_API_KEY

  if (!expectedKey) {
    console.error('[Installs Stats API] TELEMETRY_API_KEY environment variable not set')
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
    // Run all aggregate queries in parallel
    const [installsCount, doctorCount, allEvents] = await Promise.all([
      // Count installs
      db.select({ count: count() }).from(telemetryEvents)
        .where(eq(telemetryEvents.eventType, 'install')),

      // Count doctor runs
      db.select({ count: count() }).from(telemetryEvents)
        .where(eq(telemetryEvents.eventType, 'doctor')),

      // Fetch all events with summary for success rate + avg issues calculation
      db.select({ summary: telemetryEvents.summary }).from(telemetryEvents),
    ])

    const totalInstalls = installsCount[0]?.count ?? 0
    const totalDoctorRuns = doctorCount[0]?.count ?? 0

    // Calculate success rate and average issues from summary data
    const events = allEvents
    let successCount = 0
    let totalFails = 0
    let eventsWithSummary = 0

    for (const event of events) {
      if (event.summary && typeof event.summary === 'object') {
        const summary = event.summary as Record<string, unknown>
        const failCount = parseInt(String(summary.fail || '0'), 10)
        if (!isNaN(failCount)) {
          eventsWithSummary++
          totalFails += failCount
          if (failCount === 0) {
            successCount++
          }
        }
      }
    }

    const successRate = eventsWithSummary > 0
      ? Math.round((successCount / eventsWithSummary) * 10000) / 100
      : 0
    const avgIssues = eventsWithSummary > 0
      ? Math.round((totalFails / eventsWithSummary) * 100) / 100
      : 0

    return NextResponse.json(
      {
        total_installs: totalInstalls,
        total_doctor_runs: totalDoctorRuns,
        success_rate: successRate,
        avg_issues: avgIssues,
      },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Installs Stats API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
