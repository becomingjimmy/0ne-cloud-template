/**
 * GET /api/installs/dashboard/stats
 *
 * Internal (Clerk-auth) aggregate statistics for telemetry events.
 * Same data as the external /api/installs/stats route but uses Clerk session auth.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, count, isNotNull } from '@0ne/db/server'
import { telemetryEvents } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Run all aggregate queries in parallel
    const [installsCount, doctorCount, allEvents, fixEvents] = await Promise.all([
      // Count installs
      db.select({ count: count() }).from(telemetryEvents)
        .where(eq(telemetryEvents.eventType, 'install')),

      // Count doctor runs
      db.select({ count: count() }).from(telemetryEvents)
        .where(eq(telemetryEvents.eventType, 'doctor')),

      // Fetch all events with summary for success rate + avg issues calculation
      db.select({ summary: telemetryEvents.summary }).from(telemetryEvents),

      // Fetch events with fix_summary for total fixes count
      db.select({ fixSummary: telemetryEvents.fixSummary }).from(telemetryEvents)
        .where(isNotNull(telemetryEvents.fixSummary)),
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

    // Sum total successful fixes from fix_summary JSONB
    let totalFixes = 0
    for (const event of fixEvents) {
      if (event.fixSummary && typeof event.fixSummary === 'object') {
        const fs = event.fixSummary as Record<string, unknown>
        const succeeded = parseInt(String(fs.fixes_succeeded || '0'), 10)
        if (!isNaN(succeeded)) {
          totalFixes += succeeded
        }
      }
    }

    return NextResponse.json({
      total_installs: totalInstalls,
      total_doctor_runs: totalDoctorRuns,
      success_rate: successRate,
      avg_issues: avgIssues,
      total_fixes: totalFixes,
    })
  } catch (error) {
    console.error('[Installs Dashboard Stats API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
