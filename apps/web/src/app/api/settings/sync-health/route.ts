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
import { createServerClient } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export type SyncHealthStatus = 'healthy' | 'stale' | 'failing'

export interface SyncHealthResponse {
  status: SyncHealthStatus
  lastSync: string | null
  failureCount: number
}

export async function GET() {
  try {
    const supabase = createServerClient()

    // Get timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date()
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

    // Get all syncs from last 24 hours
    const { data: recentSyncs, error: syncsError } = await supabase
      .from('sync_activity_log')
      .select('id, status, started_at, completed_at')
      .gte('started_at', twentyFourHoursAgo.toISOString())
      .order('started_at', { ascending: false })

    if (syncsError) {
      console.error('[sync-health API] Query error:', syncsError)
      return NextResponse.json(
        { error: 'Failed to fetch sync health', details: syncsError.message },
        { status: 500 }
      )
    }

    // Get the most recent sync (regardless of time window)
    const { data: lastSyncData, error: lastSyncError } = await supabase
      .from('sync_activity_log')
      .select('started_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    if (lastSyncError && lastSyncError.code !== 'PGRST116') {
      // PGRST116 is "no rows returned" - that's OK
      console.error('[sync-health API] Last sync query error:', lastSyncError)
    }

    const lastSync = lastSyncData?.started_at ?? null

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
