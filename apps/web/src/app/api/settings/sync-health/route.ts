/**
 * Sync Health API
 *
 * Provides overall sync health status for the dashboard indicator.
 *
 * GET /api/settings/sync-health
 *   - Returns overall sync health status
 *   - Checks sync_activity_log for the last 24 hours
 *   - Status logic:
 *     - healthy: Has syncs in last 24h, no failures
 *     - stale: No syncs in last 24h
 *     - failing: Has failures in last 24h
 */

import { NextResponse } from 'next/server'
import { db, desc, gte } from '@0ne/db/server'
import { syncActivityLog } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export type SyncHealthStatus = 'healthy' | 'stale' | 'failing'

export interface SyncHealthResponse {
  status: SyncHealthStatus
  lastSync: string | null
  failureCount: number
}

export async function GET() {
  try {
    // Get timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date()
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

    // Get all syncs from last 24 hours
    const recentSyncs = await db
      .select({
        id: syncActivityLog.id,
        status: syncActivityLog.status,
        startedAt: syncActivityLog.startedAt,
        completedAt: syncActivityLog.completedAt,
      })
      .from(syncActivityLog)
      .where(gte(syncActivityLog.startedAt, twentyFourHoursAgo))
      .orderBy(desc(syncActivityLog.startedAt))

    // Get the most recent sync (regardless of time window)
    const lastSyncRows = await db
      .select({ startedAt: syncActivityLog.startedAt })
      .from(syncActivityLog)
      .orderBy(desc(syncActivityLog.startedAt))
      .limit(1)

    const lastSync = lastSyncRows[0]?.startedAt?.toISOString() ?? null

    // Count failures in last 24h
    const failureCount = (recentSyncs || []).filter(
      (sync) => sync.status === 'failed'
    ).length

    // Determine health status
    let status: SyncHealthStatus

    if (!recentSyncs || recentSyncs.length === 0) {
      // No syncs in last 24h = stale
      status = 'stale'
    } else if (failureCount > 0) {
      // Has failures = failing
      status = 'failing'
    } else {
      // Has syncs, no failures = healthy
      status = 'healthy'
    }

    const response: SyncHealthResponse = {
      status,
      lastSync,
      failureCount,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[sync-health API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
