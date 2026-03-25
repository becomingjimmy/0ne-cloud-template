/**
 * Sync Skool DMs Cron Endpoint
 *
 * Processes extension-captured Skool DMs → GHL inbox.
 * Server-side Skool API calls removed (AWS WAF blocks them).
 * Runs every 5 minutes via Vercel Cron.
 *
 * Manual invocation:
 * curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/sync-skool-dms"
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  syncExtensionMessages,
  getEnabledSyncConfigs,
  type ExtensionSyncResult,
} from '@/features/dm-sync/server'
import { SyncLogger } from '@/lib/sync-log'

export const maxDuration = 300 // 5 minutes max for sync

/**
 * GET /api/cron/sync-skool-dms
 *
 * Processes extension-captured messages to GHL for all enabled users.
 * (Server-side Skool API sync removed - AWS WAF blocks all server→Skool calls)
 *
 * Query params:
 * - user_id: Optional - sync only for specific user
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (allow localhost bypass for development)
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const isLocalhost = request.headers.get('host')?.includes('localhost')
  const bypassAuth = isLocalhost && request.nextUrl.searchParams.get('dev') === 'true'

  if (!bypassAuth && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const specificUserId = new URL(request.url).searchParams.get('user_id')

  const startTime = Date.now()
  console.log('[sync-skool-dms] Starting extension message sync to GHL')

  const syncLogger = new SyncLogger('skool_dms')
  await syncLogger.start({ source: 'cron' })

  try {
    // Get enabled sync configs
    const configs = await getEnabledSyncConfigs()

    if (configs.length === 0) {
      console.log('[sync-skool-dms] No enabled sync configs found')
      await syncLogger.complete(0, { message: 'No enabled sync configs' })
      return NextResponse.json({
        success: true,
        message: 'No enabled sync configs',
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      })
    }

    // Filter to specific user if requested
    const targetConfigs = specificUserId
      ? configs.filter((c) => c.clerk_user_id === specificUserId)
      : configs

    if (targetConfigs.length === 0) {
      await syncLogger.complete(0, { message: 'No matching sync configs' })
      return NextResponse.json({
        success: true,
        message: 'No matching sync configs',
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      })
    }

    console.log(`[sync-skool-dms] Processing ${targetConfigs.length} users`)

    // Process each user's sync
    const results: Array<{
      userId: string
      result: ExtensionSyncResult
    }> = []

    // Initialize results for all users
    for (const config of targetConfigs) {
      results.push({
        userId: config.clerk_user_id,
        result: {
          synced: 0,
          skipped: 0,
          errors: 0,
          errorDetails: [],
        },
      })
    }

    // Extension message sync - processes messages captured by Chrome extension
    // This doesn't call Skool API - just pushes already-captured messages to GHL
    for (const config of targetConfigs) {
      try {
        const extResult = await syncExtensionMessages(config.clerk_user_id)
        console.log(`[sync-skool-dms] Extension sync for ${config.clerk_user_id}: synced=${extResult.synced}, skipped=${extResult.skipped}, errors=${extResult.errors}`)
        const userResult = results.find((r) => r.userId === config.clerk_user_id)
        if (userResult) {
          userResult.result.synced += extResult.synced
          userResult.result.skipped += extResult.skipped
          userResult.result.errors += extResult.errors
        }
      } catch (error) {
        console.error(`[sync-skool-dms] Extension sync error for ${config.clerk_user_id}:`, error)
      }
    }

    // Aggregate results
    const totals = results.reduce(
      (acc, r) => ({
        synced: acc.synced + r.result.synced,
        skipped: acc.skipped + r.result.skipped,
        errors: acc.errors + r.result.errors,
      }),
      { synced: 0, skipped: 0, errors: 0 }
    )

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(
      `[sync-skool-dms] Completed in ${duration}s: synced=${totals.synced}, skipped=${totals.skipped}, errors=${totals.errors}`
    )

    if (totals.errors === 0) {
      await syncLogger.complete(totals.synced, { skipped: totals.skipped })
    } else {
      await syncLogger.fail(`${totals.errors} user syncs failed`, totals.synced)
    }

    return NextResponse.json({
      success: totals.errors === 0,
      duration: `${duration}s`,
      totals,
      users: results.map((r) => ({
        userId: r.userId,
        synced: r.result.synced,
        skipped: r.result.skipped,
        errors: r.result.errors,
        errorDetails: r.result.errorDetails,
      })),
    })
  } catch (error) {
    console.error('[sync-skool-dms] Fatal error:', error)
    await syncLogger.fail(error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      },
      { status: 500 }
    )
  }
}
