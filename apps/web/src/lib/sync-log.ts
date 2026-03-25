/**
 * Sync Activity Log Helper
 *
 * Provides utility functions for logging sync job executions
 * to the unified sync_activity_log table.
 */

import { db, eq } from '@0ne/db/server'
import { syncActivityLog } from '@0ne/db/server'

export type SyncType =
  | 'ghl_contacts'
  | 'ghl_payments'
  | 'skool'
  | 'skool_analytics'
  | 'skool_member_history'
  | 'skool_posts'
  | 'skool_dms'
  | 'skool_dms_outbound'
  | 'hand_raiser'
  | 'aggregate'
  | 'daily_snapshot'
  | 'meta'

export type SyncStatus = 'running' | 'completed' | 'failed'

export interface SyncLogEntry {
  id: string
  sync_type: SyncType
  started_at: string
  completed_at: string | null
  records_synced: number
  status: SyncStatus
  error_message: string | null
  metadata: Record<string, unknown> | null
}

export interface StartSyncResult {
  id: string
  startedAt: Date
}

/**
 * Start a sync job and create a log entry
 * Returns the log entry ID for later update
 */
export async function startSyncLog(
  syncType: SyncType,
  metadata?: Record<string, unknown>
): Promise<StartSyncResult | null> {
  try {
    const [row] = await db
      .insert(syncActivityLog)
      .values({
        syncType,
        startedAt: new Date(),
        status: 'running' as SyncStatus,
        metadata: metadata || null,
      })
      .returning({ id: syncActivityLog.id, startedAt: syncActivityLog.startedAt })

    if (!row) {
      console.error(`[sync-log] Failed to create sync log for ${syncType}: no row returned`)
      return null
    }

    return {
      id: row.id,
      startedAt: row.startedAt ? new Date(row.startedAt) : new Date(),
    }
  } catch (err) {
    console.error(`[sync-log] Error creating sync log for ${syncType}:`, err)
    return null
  }
}

/**
 * Complete a sync job successfully
 */
export async function completeSyncLog(
  logId: string,
  recordsSynced: number,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  try {
    const updateData: Record<string, unknown> = {
      completedAt: new Date(),
      status: 'completed' as SyncStatus,
      recordsSynced,
    }

    if (metadata) {
      updateData.metadata = metadata
    }

    await db
      .update(syncActivityLog)
      .set(updateData)
      .where(eq(syncActivityLog.id, logId))

    return true
  } catch (err) {
    console.error(`[sync-log] Error completing sync log ${logId}:`, err)
    return false
  }
}

/**
 * Mark a sync job as failed
 */
export async function failSyncLog(
  logId: string,
  errorMessage: string,
  recordsSynced?: number
): Promise<boolean> {
  try {
    await db
      .update(syncActivityLog)
      .set({
        completedAt: new Date(),
        status: 'failed' as SyncStatus,
        recordsSynced: recordsSynced ?? 0,
        errorMessage: errorMessage.slice(0, 1000), // Truncate long errors
      })
      .where(eq(syncActivityLog.id, logId))

    return true
  } catch (err) {
    console.error(`[sync-log] Error failing sync log ${logId}:`, err)
    return false
  }
}

/**
 * Helper class for managing sync log lifecycle
 * Usage:
 *
 * const syncLog = new SyncLogger('ghl_contacts')
 * await syncLog.start({ mode: 'full' })
 *
 * try {
 *   // ... do sync work ...
 *   await syncLog.complete(100)
 * } catch (error) {
 *   await syncLog.fail(String(error))
 * }
 */
export class SyncLogger {
  private syncType: SyncType
  private logId: string | null = null
  private startedAt: Date | null = null

  constructor(syncType: SyncType) {
    this.syncType = syncType
  }

  async start(metadata?: Record<string, unknown>): Promise<boolean> {
    const result = await startSyncLog(this.syncType, metadata)
    if (result) {
      this.logId = result.id
      this.startedAt = result.startedAt
      return true
    }
    return false
  }

  async complete(recordsSynced: number, metadata?: Record<string, unknown>): Promise<boolean> {
    if (!this.logId) {
      console.warn(`[sync-log] Cannot complete - no active sync log for ${this.syncType}`)
      return false
    }
    return completeSyncLog(this.logId, recordsSynced, metadata)
  }

  async fail(errorMessage: string, recordsSynced?: number): Promise<boolean> {
    if (!this.logId) {
      console.warn(`[sync-log] Cannot fail - no active sync log for ${this.syncType}`)
      return false
    }
    return failSyncLog(this.logId, errorMessage, recordsSynced)
  }

  get id(): string | null {
    return this.logId
  }

  get started(): Date | null {
    return this.startedAt
  }
}

/**
 * Wrap a sync function with automatic logging
 * Usage:
 *
 * export async function GET(request: Request) {
 *   return withSyncLog('ghl_contacts', { mode: 'incremental' }, async () => {
 *     // ... sync work ...
 *     return { synced: 100, data: {...} }
 *   })
 * }
 */
export async function withSyncLog<T extends { synced?: number; recordsSynced?: number }>(
  syncType: SyncType,
  metadata: Record<string, unknown> | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const logger = new SyncLogger(syncType)
  await logger.start(metadata)

  try {
    const result = await fn()
    const recordsSynced = result.synced ?? result.recordsSynced ?? 0
    await logger.complete(recordsSynced)
    return result
  } catch (error) {
    await logger.fail(String(error))
    throw error
  }
}
