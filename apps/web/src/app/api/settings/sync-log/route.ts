/**
 * Sync Log API
 *
 * Provides access to the unified sync activity log for monitoring
 * all data sync jobs in the system.
 *
 * GET /api/settings/sync-log
 *   - Returns recent sync activity (default: last 100 entries)
 *   - Query params:
 *     - type: Filter by sync_type (e.g., 'ghl_contacts', 'skool', 'meta')
 *     - limit: Number of entries to return (default: 100, max: 500)
 *     - status: Filter by status ('running', 'completed', 'failed')
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq, desc, and, lt } from '@0ne/db/server'
import { syncActivityLog } from '@0ne/db/server'
import type { SyncType, SyncStatus } from '@/lib/sync-log'

export const dynamic = 'force-dynamic'

// Valid sync types for filtering
const VALID_SYNC_TYPES: SyncType[] = [
  'ghl_contacts',
  'ghl_payments',
  'skool',
  'skool_analytics',
  'skool_member_history',
  'skool_posts',
  'skool_dms',
  'skool_dms_outbound',
  'hand_raiser',
  'aggregate',
  'daily_snapshot',
  'meta',
]

// Valid statuses for filtering
const VALID_STATUSES: SyncStatus[] = ['running', 'completed', 'failed']

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const typeFilter = searchParams.get('type')
    const statusFilter = searchParams.get('status')
    const limitParam = parseInt(searchParams.get('limit') || '100', 10)

    // Validate and cap limit
    const limit = Math.min(Math.max(1, limitParam), 500)

    // Validate type filter if provided
    if (typeFilter && !VALID_SYNC_TYPES.includes(typeFilter as SyncType)) {
      return NextResponse.json(
        {
          error: 'Invalid sync type',
          validTypes: VALID_SYNC_TYPES,
        },
        { status: 400 }
      )
    }

    // Validate status filter if provided
    if (statusFilter && !VALID_STATUSES.includes(statusFilter as SyncStatus)) {
      return NextResponse.json(
        {
          error: 'Invalid status',
          validStatuses: VALID_STATUSES,
        },
        { status: 400 }
      )
    }

    // Build where conditions
    const conditions = []
    if (typeFilter) {
      conditions.push(eq(syncActivityLog.syncType, typeFilter))
    }
    if (statusFilter) {
      conditions.push(eq(syncActivityLog.status, statusFilter))
    }

    // Build query
    const data = await db
      .select()
      .from(syncActivityLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(syncActivityLog.startedAt))
      .limit(limit)

    // Transform data for response
    const logs = (data || []).map((log) => ({
      id: log.id,
      syncType: log.syncType,
      startedAt: log.startedAt,
      completedAt: log.completedAt,
      recordsSynced: log.recordsSynced,
      status: log.status,
      errorMessage: log.errorMessage,
      metadata: log.metadata,
      // Calculate duration if completed
      durationSeconds: log.completedAt && log.startedAt
        ? Math.round(
            (new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000
          )
        : null,
    }))

    // Get summary stats
    const summary = {
      total: logs.length,
      running: logs.filter((l) => l.status === 'running').length,
      completed: logs.filter((l) => l.status === 'completed').length,
      failed: logs.filter((l) => l.status === 'failed').length,
    }

    return NextResponse.json({
      logs,
      summary,
      filters: {
        type: typeFilter,
        status: statusFilter,
        limit,
      },
    })
  } catch (error) {
    console.error('[sync-log API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/settings/sync-log
 * Cleanup stuck running jobs
 *
 * Body: { action: 'cleanup-stuck', olderThanMinutes?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (body.action !== 'cleanup-stuck') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    // Default to jobs running for more than 10 minutes
    const olderThanMinutes = body.olderThanMinutes || 10
    const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000)

    // Update all stuck running jobs to failed
    const data = await db
      .update(syncActivityLog)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage: `Timed out after ${olderThanMinutes} minutes (cleanup)`,
      })
      .where(
        and(
          eq(syncActivityLog.status, 'running'),
          lt(syncActivityLog.startedAt, cutoffTime)
        )
      )
      .returning({ id: syncActivityLog.id })

    const cleanedUp = data?.length || 0
    console.log(`[sync-log API] Cleaned up ${cleanedUp} stuck jobs`)

    return NextResponse.json({
      success: true,
      cleanedUp,
      cutoffTime,
    })
  } catch (error) {
    console.error('[sync-log API] POST Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
