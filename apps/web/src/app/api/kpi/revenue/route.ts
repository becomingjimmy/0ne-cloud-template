/**
 * Revenue API Endpoint
 *
 * Returns three revenue KPIs:
 * - Total = One Time + Recurring
 * - One Time = GHL invoice payments (funding fees, coaching packages)
 * - Recurring = Skool subscriptions (Premium/VIP)
 *
 * Data sources:
 * - Recurring: skool_revenue_daily table (synced from Skool analytics-overview)
 * - One Time: GHL Payments API (TODO - currently placeholder)
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, and, count } from '@0ne/db/server'
import { ghlTransactions } from '@0ne/db/server'
import { getLatestRevenueSnapshot, getRevenueHistory, getMrrChange } from '@/features/skool/lib/revenue-sync'

export const dynamic = 'force-dynamic'

interface DateRangeResult {
  startDate: string
  endDate: string
}

function getDateRangeFromPeriod(period: string): DateRangeResult {
  const now = new Date()
  const endDate = now.toISOString().split('T')[0]
  let startDate: Date

  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      break
    case 'mtd': {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    }
    case 'lastMonth': {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      return {
        startDate: lastMonth.toISOString().split('T')[0],
        endDate: new Date(thisMonth.getTime() - 1).toISOString().split('T')[0],
      }
    }
    case 'ytd':
      startDate = new Date(now.getFullYear(), 0, 1)
      break
    case 'lifetime':
      startDate = new Date('2020-01-01')
      break
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate,
  }
}

function parseDateRange(searchParams: URLSearchParams): DateRangeResult {
  const startDateParam = searchParams.get('startDate')
  const endDateParam = searchParams.get('endDate')

  if (startDateParam && endDateParam) {
    return { startDate: startDateParam, endDate: endDateParam }
  }

  const period = searchParams.get('period') || 'mtd'
  return getDateRangeFromPeriod(period)
}

function calculateChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const { startDate, endDate } = parseDateRange(searchParams)
    const period = searchParams.get('period') || 'mtd'

    // Calculate previous period for comparison
    const periodLength = new Date(endDate).getTime() - new Date(startDate).getTime()
    const previousStartDate = new Date(new Date(startDate).getTime() - periodLength)
      .toISOString()
      .split('T')[0]
    const previousEndDate = new Date(new Date(startDate).getTime() - 1)
      .toISOString()
      .split('T')[0]

    console.log(`[Revenue API] Fetching for ${startDate} to ${endDate}, prev: ${previousStartDate} to ${previousEndDate}`)

    // =============================================================================
    // RECURRING REVENUE (Skool Subscriptions)
    // =============================================================================
    // Get latest revenue snapshot (current MRR)
    const latestSnapshot = await getLatestRevenueSnapshot('fruitful')

    // Get MRR change between periods
    const mrrChange = await getMrrChange('fruitful', previousEndDate, endDate)

    // Get revenue history for trend chart
    const revenueHistory = await getRevenueHistory('fruitful', startDate, endDate)

    const recurringCurrent = latestSnapshot?.mrr || 0
    const recurringPrevious = mrrChange.startMrr || 0
    const recurringChange = mrrChange.change || 0
    const recurringChangePercent = mrrChange.changePercent || 0

    console.log(`[Revenue API] Recurring: $${recurringCurrent} (change: $${recurringChange})`)

    // =============================================================================
    // ONE-TIME REVENUE (GHL Invoice Payments)
    // =============================================================================
    // Query synced transactions from ghl_transactions table
    // Data synced via /api/cron/sync-ghl-payments

    // Get one-time revenue for current period
    const currentTransactions = await db
      .select({ amount: ghlTransactions.amount })
      .from(ghlTransactions)
      .where(
        and(
          eq(ghlTransactions.status, 'succeeded'),
          gte(ghlTransactions.transactionDate, new Date(`${startDate}T00:00:00Z`)),
          lte(ghlTransactions.transactionDate, new Date(`${endDate}T23:59:59Z`)),
        )
      )

    const oneTimeCurrent = currentTransactions.reduce((sum, t) => sum + (t.amount || 0), 0)

    // Get one-time revenue for previous period (for comparison)
    const previousTransactions = await db
      .select({ amount: ghlTransactions.amount })
      .from(ghlTransactions)
      .where(
        and(
          eq(ghlTransactions.status, 'succeeded'),
          gte(ghlTransactions.transactionDate, new Date(`${previousStartDate}T00:00:00Z`)),
          lte(ghlTransactions.transactionDate, new Date(`${previousEndDate}T23:59:59Z`)),
        )
      )

    const oneTimePrevious = previousTransactions.reduce((sum, t) => sum + (t.amount || 0), 0)

    const oneTimeChange = oneTimeCurrent - oneTimePrevious
    const oneTimeChangePercent = calculateChange(oneTimeCurrent, oneTimePrevious)

    // Check if we have any transactions (to show appropriate message)
    const [{ value: transactionCount }] = await db
      .select({ value: count() })
      .from(ghlTransactions)

    const hasTransactionData = (transactionCount || 0) > 0

    console.log(`[Revenue API] One-Time: $${oneTimeCurrent} (${currentTransactions?.length || 0} transactions)`)

    // =============================================================================
    // TOTAL REVENUE
    // =============================================================================
    const totalCurrent = oneTimeCurrent + recurringCurrent
    const totalPrevious = oneTimePrevious + recurringPrevious
    const totalChange = calculateChange(totalCurrent, totalPrevious)

    // =============================================================================
    // MONTHLY BREAKDOWN (for trend chart)
    // =============================================================================
    // Build monthly data from revenue history (recurring) + transactions (one-time)
    const monthlyMap = new Map<string, { total: number; oneTime: number; recurring: number }>()

    // Add recurring revenue from Skool snapshots
    for (const snapshot of revenueHistory) {
      const month = snapshot.snapshotDate!.substring(0, 7) // YYYY-MM
      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, { total: 0, oneTime: 0, recurring: 0 })
      }
      const data = monthlyMap.get(month)!
      // Use the last MRR value for each month as the monthly recurring
      data.recurring = snapshot.mrr || 0
    }

    // Add one-time revenue from GHL transactions
    const monthlyTransactions = await db
      .select({
        amount: ghlTransactions.amount,
        transactionDate: ghlTransactions.transactionDate,
      })
      .from(ghlTransactions)
      .where(
        and(
          eq(ghlTransactions.status, 'succeeded'),
          gte(ghlTransactions.transactionDate, new Date(`${startDate}T00:00:00Z`)),
          lte(ghlTransactions.transactionDate, new Date(`${endDate}T23:59:59Z`)),
        )
      )

    for (const txn of monthlyTransactions) {
      const month = txn.transactionDate!.toISOString().substring(0, 7) // YYYY-MM
      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, { total: 0, oneTime: 0, recurring: 0 })
      }
      const data = monthlyMap.get(month)!
      data.oneTime += txn.amount || 0
    }

    // Calculate totals
    for (const data of monthlyMap.values()) {
      data.total = data.oneTime + data.recurring
    }

    const monthly = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        total: data.total,
        oneTime: data.oneTime,
        recurring: data.recurring,
      }))

    // =============================================================================
    // BUILD RESPONSE
    // =============================================================================
    const response = {
      // Three revenue KPIs
      total: {
        current: totalCurrent,
        previous: totalPrevious,
        change: Number(totalChange.toFixed(1)),
      },
      oneTime: {
        current: oneTimeCurrent,
        previous: oneTimePrevious,
        change: Number(oneTimeChangePercent.toFixed(1)),
        note: hasTransactionData
          ? `${currentTransactions?.length || 0} transactions`
          : 'Run sync: /api/cron/sync-ghl-payments?full=true',
      },
      recurring: {
        current: recurringCurrent,
        previous: recurringPrevious,
        change: Number(recurringChangePercent.toFixed(1)),
        retention: latestSnapshot?.retentionRate || 0,
        payingMembers: latestSnapshot?.payingMembers || 0,
      },
      // Monthly breakdown for charts
      monthly,
      // Current period info
      period: {
        startDate,
        endDate,
        label: period,
      },
      // Metadata
      lastSync: latestSnapshot?.updatedAt || null,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Revenue API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch revenue data', details: String(error) },
      { status: 500 }
    )
  }
}
