/**
 * GHL Payments Sync Cron Job
 *
 * Syncs payment transactions from GoHighLevel to our database.
 * Used for tracking one-time revenue (setup fees, success fees, etc.)
 *
 * Usage:
 * - Daily sync: curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/sync-ghl-payments"
 * - Full sync: curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/sync-ghl-payments?full=true"
 * - Stats only: curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/sync-ghl-payments?stats=true"
 */

import { NextResponse } from 'next/server'
import { db, eq, desc, gte, and, count } from '@0ne/db/server'
import { ghlTransactions, syncActivityLog } from '@0ne/db/server'
import { GHLClient, type GHLTransaction } from '@/features/kpi/lib/ghl-client'
import { SyncLogger } from '@/lib/sync-log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for full sync

// Verify cron secret
function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get('Authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.warn('[sync-ghl-payments] CRON_SECRET not set')
    return false
  }

  return authHeader === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  // Verify authorization
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fullSync = searchParams.get('full') === 'true'
  const statsOnly = searchParams.get('stats') === 'true'

  try {
    // If stats only, return current data summary
    if (statsOnly) {
      const stats = await getTransactionStats()
      return NextResponse.json({
        message: 'GHL payment sync stats',
        stats,
      })
    }

    // Initialize GHL client
    const ghl = new GHLClient()

    // Determine date range
    let startDate: string | undefined
    let endDate: string | undefined

    if (fullSync) {
      // Full sync: get all transactions from 2024 onwards
      startDate = '2024-01-01'
      console.log('[sync-ghl-payments] Starting FULL sync from 2024-01-01')
    } else {
      // Incremental sync: last 7 days
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      startDate = weekAgo.toISOString().split('T')[0]
      console.log(`[sync-ghl-payments] Starting incremental sync from ${startDate}`)
    }

    // Start sync logging (unified sync_activity_log)
    const syncLogger = new SyncLogger('ghl_payments')
    await syncLogger.start({ mode: fullSync ? 'full' : 'incremental', startDate })

    // Fetch transactions from GHL
    console.log('[sync-ghl-payments] Fetching transactions from GHL...')
    const transactions = await ghl.getAllTransactions({
      startDate,
      endDate,
      status: 'succeeded', // Only sync successful payments
    })

    console.log(`[sync-ghl-payments] Found ${transactions.length} transactions`)

    // Upsert transactions to database
    let synced = 0
    let skipped = 0
    const errors: string[] = []

    for (const txn of transactions) {
      try {
        const record = mapTransactionToRecord(txn)

        await db
          .insert(ghlTransactions)
          .values(record)
          .onConflictDoUpdate({
            target: [ghlTransactions.ghlTransactionId],
            set: {
              ghlContactId: record.ghlContactId,
              ghlInvoiceId: record.ghlInvoiceId,
              ghlSubscriptionId: record.ghlSubscriptionId,
              contactName: record.contactName,
              contactEmail: record.contactEmail,
              amount: record.amount,
              currency: record.currency,
              status: record.status,
              entityType: record.entityType,
              entitySourceType: record.entitySourceType,
              entitySourceName: record.entitySourceName,
              paymentMethod: record.paymentMethod,
              invoiceNumber: record.invoiceNumber,
              isLiveMode: record.isLiveMode,
              transactionDate: record.transactionDate,
              updatedAt: new Date(),
              syncedAt: new Date(),
            },
          })

        synced++
      } catch (err) {
        console.error(`[sync-ghl-payments] Error processing ${txn._id}:`, err)
        errors.push(`${txn._id}: ${String(err)}`)
        skipped++
      }
    }

    console.log(`[sync-ghl-payments] Synced ${synced} transactions, skipped ${skipped}`)

    // Complete sync logging
    await syncLogger.complete(synced, { skipped, errors: errors.length })

    // Get updated stats
    const stats = await getTransactionStats()

    return NextResponse.json({
      message: 'GHL payment sync completed',
      synced,
      skipped,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      stats,
    })
  } catch (error) {
    console.error('[sync-ghl-payments] Sync failed:', error)
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * Map GHL transaction to database record
 */
function mapTransactionToRecord(txn: GHLTransaction) {
  return {
    ghlTransactionId: txn._id,
    ghlContactId: txn.contactId || null,
    ghlInvoiceId: txn.meta?.invoiceId || null,
    ghlSubscriptionId: txn.subscriptionId || null,
    contactName: txn.contactName || null,
    contactEmail: txn.contactEmail || null,
    amount: Number(txn.amount),
    currency: txn.currency || 'USD',
    status: txn.status,
    entityType: txn.entityType || null,
    entitySourceType: txn.entitySourceType || null,
    entitySourceName: txn.entitySourceName || null,
    paymentMethod: txn.meta?.paymentMethod || null,
    invoiceNumber: txn.meta?.invoiceNumber || null,
    isLiveMode: txn.liveMode,
    transactionDate: new Date(txn.createdAt),
    updatedAt: new Date(),
    syncedAt: new Date(),
  }
}

/**
 * Get transaction stats from database
 */
async function getTransactionStats() {
  // Total transactions
  const [totalResult] = await db
    .select({ count: count() })
    .from(ghlTransactions)

  // Total revenue (succeeded only)
  const revenueData = await db
    .select({ amount: ghlTransactions.amount })
    .from(ghlTransactions)
    .where(eq(ghlTransactions.status, 'succeeded'))

  const totalRevenue = revenueData.reduce((sum, r) => sum + Number(r.amount), 0)

  // This month
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const thisMonthData = await db
    .select({ amount: ghlTransactions.amount })
    .from(ghlTransactions)
    .where(and(
      eq(ghlTransactions.status, 'succeeded'),
      gte(ghlTransactions.transactionDate, startOfMonth),
    ))

  const thisMonthRevenue = thisMonthData.reduce((sum, r) => sum + Number(r.amount), 0)

  // Last sync (from unified sync_activity_log)
  const [lastSync] = await db
    .select({
      completedAt: syncActivityLog.completedAt,
      recordsSynced: syncActivityLog.recordsSynced,
    })
    .from(syncActivityLog)
    .where(and(
      eq(syncActivityLog.syncType, 'ghl_payments'),
      eq(syncActivityLog.status, 'completed'),
    ))
    .orderBy(desc(syncActivityLog.completedAt))
    .limit(1)

  return {
    totalTransactions: totalResult?.count || 0,
    totalRevenue,
    thisMonthRevenue,
    lastSync: lastSync?.completedAt || null,
    lastSyncRecords: lastSync?.recordsSynced || 0,
  }
}
