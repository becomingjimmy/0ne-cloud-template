/**
 * GHL KPI API Endpoint
 *
 * Returns GHL-specific metrics:
 * - Revenue: Total, Setup Fees (PREIFM), Funding Fees (New Invoice)
 * - Contacts: Total, New in period, Hand Raisers, Clients
 * - Funnel Stage Distribution
 * - Transactions list with pagination, filtering, and search
 *
 * Query params:
 * - startDate, endDate: Date range
 * - period: Preset period (7d, 30d, 90d, mtd, ytd, lifetime)
 * - include: Optional comma-separated list (e.g., "transactions")
 * - transactionType: Filter by type ("setup" = PREIFM, "funding" = New Invoice, "all")
 * - search: Search by contact name
 * - limit: Pagination limit (default 20)
 * - offset: Pagination offset (default 0)
 *
 * Data sources:
 * - ghl_transactions table (synced via /api/cron/sync-ghl-payments)
 * - contacts table (synced via /api/cron/sync-ghl)
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, and, desc, count, ilike, arrayOverlaps, arrayContains } from '@0ne/db/server'
import { ghlTransactions, contacts } from '@0ne/db/server'
import { FUNNEL_STAGE_ORDER, STAGE_LABELS, STAGE_COLORS, type FunnelStage } from '@/features/kpi/lib/config'

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

  const period = searchParams.get('period') || '30d'
  return getDateRangeFromPeriod(period)
}

function calculateChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

function determineTrend(change: number): 'up' | 'down' | 'neutral' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'neutral'
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const { startDate, endDate } = parseDateRange(searchParams)
    const period = searchParams.get('period') || '30d'

    // Calculate previous period for comparison
    const periodLength = new Date(endDate).getTime() - new Date(startDate).getTime()
    const previousStartDate = new Date(new Date(startDate).getTime() - periodLength)
      .toISOString()
      .split('T')[0]
    const previousEndDate = new Date(new Date(startDate).getTime() - 1)
      .toISOString()
      .split('T')[0]

    console.log(`[GHL API] Fetching for ${startDate} to ${endDate}, prev: ${previousStartDate} to ${previousEndDate}`)

    // =============================================================================
    // CURRENT PERIOD TRANSACTIONS
    // =============================================================================
    const currentTransactions = await db
      .select({
        id: ghlTransactions.id,
        amount: ghlTransactions.amount,
        entitySourceName: ghlTransactions.entitySourceName,
        transactionDate: ghlTransactions.transactionDate,
        contactName: ghlTransactions.contactName,
      })
      .from(ghlTransactions)
      .where(
        and(
          eq(ghlTransactions.status, 'succeeded'),
          gte(ghlTransactions.transactionDate, new Date(`${startDate}T00:00:00Z`)),
          lte(ghlTransactions.transactionDate, new Date(`${endDate}T23:59:59Z`)),
        )
      )
      .orderBy(desc(ghlTransactions.transactionDate))

    // =============================================================================
    // PREVIOUS PERIOD TRANSACTIONS (for comparison)
    // =============================================================================
    const previousTransactions = await db
      .select({
        amount: ghlTransactions.amount,
        entitySourceName: ghlTransactions.entitySourceName,
      })
      .from(ghlTransactions)
      .where(
        and(
          eq(ghlTransactions.status, 'succeeded'),
          gte(ghlTransactions.transactionDate, new Date(`${previousStartDate}T00:00:00Z`)),
          lte(ghlTransactions.transactionDate, new Date(`${previousEndDate}T23:59:59Z`)),
        )
      )

    // =============================================================================
    // CALCULATE METRICS
    // =============================================================================

    // Current period totals by source
    const currentTotalRevenue = currentTransactions.reduce((sum, t) => sum + (t.amount || 0), 0)
    const currentSetupFees = currentTransactions
      ?.filter((t) => t.entitySourceName === 'PREIFM')
      .reduce((sum, t) => sum + (t.amount || 0), 0) || 0
    const currentFundingFees = currentTransactions
      ?.filter((t) => t.entitySourceName === 'New Invoice')
      .reduce((sum, t) => sum + (t.amount || 0), 0) || 0
    const currentTransactionCount = currentTransactions.length
    const currentAvgTransaction = currentTransactionCount > 0
      ? currentTotalRevenue / currentTransactionCount
      : 0

    // Previous period totals by source
    const previousTotalRevenue = previousTransactions.reduce((sum, t) => sum + (t.amount || 0), 0)
    const previousSetupFees = previousTransactions
      ?.filter((t) => t.entitySourceName === 'PREIFM')
      .reduce((sum, t) => sum + (t.amount || 0), 0) || 0
    const previousFundingFees = previousTransactions
      ?.filter((t) => t.entitySourceName === 'New Invoice')
      .reduce((sum, t) => sum + (t.amount || 0), 0) || 0
    const previousTransactionCount = previousTransactions.length
    const previousAvgTransaction = previousTransactionCount > 0
      ? previousTotalRevenue / previousTransactionCount
      : 0

    // Calculate changes
    const totalRevenueChange = calculateChange(currentTotalRevenue, previousTotalRevenue)
    const setupFeesChange = calculateChange(currentSetupFees, previousSetupFees)
    const fundingFeesChange = calculateChange(currentFundingFees, previousFundingFees)
    const avgTransactionChange = calculateChange(currentAvgTransaction, previousAvgTransaction)

    console.log(`[GHL API] Total: $${currentTotalRevenue} (${currentTransactionCount} txns), Setup: $${currentSetupFees}, Funding: $${currentFundingFees}`)

    // =============================================================================
    // CONTACT METRICS
    // =============================================================================

    // Define which stages are funnel stages (contacts with these tags)
    const funnelStages = ['member', 'hand_raiser', 'qualified_premium', 'qualified_vip', 'offer_made_premium', 'offer_made_vip', 'offer_seen', 'premium', 'vip']
    const clientStages = ['premium', 'vip']

    // Total contacts with funnel tags (all time)
    const [{ value: totalContactsCount }] = await db
      .select({ value: count() })
      .from(contacts)
      .where(arrayOverlaps(contacts.stages, funnelStages))

    // New contacts in current period (by created_at)
    const [{ value: newContactsCurrentCount }] = await db
      .select({ value: count() })
      .from(contacts)
      .where(
        and(
          arrayOverlaps(contacts.stages, funnelStages),
          gte(contacts.createdAt, new Date(`${startDate}T00:00:00Z`)),
          lte(contacts.createdAt, new Date(`${endDate}T23:59:59Z`)),
        )
      )

    // New contacts in previous period
    const [{ value: newContactsPreviousCount }] = await db
      .select({ value: count() })
      .from(contacts)
      .where(
        and(
          arrayOverlaps(contacts.stages, funnelStages),
          gte(contacts.createdAt, new Date(`${previousStartDate}T00:00:00Z`)),
          lte(contacts.createdAt, new Date(`${previousEndDate}T23:59:59Z`)),
        )
      )

    // Hand raisers (contacts with hand_raiser in stages)
    const [{ value: handRaisersCount }] = await db
      .select({ value: count() })
      .from(contacts)
      .where(arrayContains(contacts.stages, ['hand_raiser']))

    // Clients (Premium + VIP)
    const [{ value: clientsCount }] = await db
      .select({ value: count() })
      .from(contacts)
      .where(arrayOverlaps(contacts.stages, clientStages))

    // Calculate contact changes
    const totalContacts = totalContactsCount || 0
    const newContactsCurrent = newContactsCurrentCount || 0
    const newContactsPrevious = newContactsPreviousCount || 0
    const handRaisers = handRaisersCount || 0
    const clients = clientsCount || 0

    const newContactsChange = calculateChange(newContactsCurrent, newContactsPrevious)

    console.log(`[GHL API] Contacts: Total=${totalContacts}, New=${newContactsCurrent}, HandRaisers=${handRaisers}, Clients=${clients}`)

    // =============================================================================
    // FUNNEL STAGE DISTRIBUTION
    // =============================================================================

    // Get counts for each funnel stage
    const stageDistribution: Array<{ stage: FunnelStage; count: number; label: string; color: string }> = []

    for (const stage of FUNNEL_STAGE_ORDER) {
      const [{ value: stageCount }] = await db
        .select({ value: count() })
        .from(contacts)
        .where(arrayContains(contacts.stages, [stage]))

      stageDistribution.push({
        stage,
        count: stageCount || 0,
        label: STAGE_LABELS[stage],
        color: STAGE_COLORS[stage],
      })
    }

    // Reverse to show from member to client (bottom to top of funnel)
    stageDistribution.reverse()

    console.log(`[GHL API] Stage distribution: ${stageDistribution.map(s => `${s.stage}=${s.count}`).join(', ')}`)

    // =============================================================================
    // TRANSACTIONS LIST (optional, when include=transactions)
    // =============================================================================
    const includeParam = searchParams.get('include') || ''
    const includeTransactions = includeParam.split(',').map(s => s.trim()).includes('transactions')

    let transactions: Array<{
      id: string
      contact_name: string | null
      transaction_type: string
      amount: number
      status: string
      transaction_date: string
    }> = []
    let transactionsTotal = 0

    if (includeTransactions) {
      const transactionType = searchParams.get('transactionType') || 'all'
      const searchTerm = searchParams.get('search') || ''
      const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100)
      const offset = parseInt(searchParams.get('offset') || '0', 10)

      // Build filter conditions
      const txnFilters = [
        gte(ghlTransactions.transactionDate, new Date(`${startDate}T00:00:00Z`)),
        lte(ghlTransactions.transactionDate, new Date(`${endDate}T23:59:59Z`)),
      ]

      if (transactionType === 'setup') {
        txnFilters.push(eq(ghlTransactions.entitySourceName, 'PREIFM'))
      } else if (transactionType === 'funding') {
        txnFilters.push(eq(ghlTransactions.entitySourceName, 'New Invoice'))
      }

      if (searchTerm) {
        txnFilters.push(ilike(ghlTransactions.contactName, `%${searchTerm}%`))
      }

      // Get count
      const [{ value: txnCount }] = await db
        .select({ value: count() })
        .from(ghlTransactions)
        .where(and(...txnFilters))

      // Get paginated data
      const txnData = await db
        .select({
          id: ghlTransactions.id,
          contactName: ghlTransactions.contactName,
          entitySourceName: ghlTransactions.entitySourceName,
          amount: ghlTransactions.amount,
          status: ghlTransactions.status,
          transactionDate: ghlTransactions.transactionDate,
        })
        .from(ghlTransactions)
        .where(and(...txnFilters))
        .orderBy(desc(ghlTransactions.transactionDate))
        .limit(limit)
        .offset(offset)

      transactions = txnData.map(t => ({
        id: t.id,
        contact_name: t.contactName,
        transaction_type: t.entitySourceName === 'PREIFM' ? 'Setup Fee' : t.entitySourceName === 'New Invoice' ? 'Funding Fee' : t.entitySourceName || 'Unknown',
        amount: t.amount || 0,
        status: t.status!,
        transaction_date: t.transactionDate!.toISOString(),
      }))
      transactionsTotal = txnCount || 0

      console.log(`[GHL API] Transactions: ${transactions.length} of ${transactionsTotal} (type=${transactionType}, search=${searchTerm})`)
    }

    // =============================================================================
    // REVENUE TREND (grouped by month or day depending on period length)
    // =============================================================================

    // Determine grouping: daily for periods <= 30 days, monthly otherwise
    const periodLengthDays = Math.ceil(periodLength / (24 * 60 * 60 * 1000))
    const useDaily = periodLengthDays <= 30

    interface RevenueTrendPoint {
      date: string
      setupFees: number
      fundingFees: number
      total: number
    }

    const revenueTrend: RevenueTrendPoint[] = []

    if (currentTransactions && currentTransactions.length > 0) {
      // Group transactions by date or month
      const grouped = new Map<string, { setupFees: number; fundingFees: number }>()

      for (const txn of currentTransactions) {
        const txnDate = new Date(txn.transactionDate!)
        // Use YYYY-MM-DD for daily, YYYY-MM for monthly
        const key = useDaily
          ? txnDate.toISOString().split('T')[0]
          : `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`

        if (!grouped.has(key)) {
          grouped.set(key, { setupFees: 0, fundingFees: 0 })
        }

        const entry = grouped.get(key)!
        const amount = txn.amount || 0

        if (txn.entitySourceName === 'PREIFM') {
          entry.setupFees += amount
        } else if (txn.entitySourceName === 'New Invoice') {
          entry.fundingFees += amount
        }
      }

      // Convert to sorted array
      const sortedKeys = Array.from(grouped.keys()).sort()
      for (const key of sortedKeys) {
        const entry = grouped.get(key)!
        revenueTrend.push({
          date: key,
          setupFees: entry.setupFees,
          fundingFees: entry.fundingFees,
          total: entry.setupFees + entry.fundingFees,
        })
      }
    }

    console.log(`[GHL API] Revenue trend: ${revenueTrend.length} ${useDaily ? 'days' : 'months'}, grouping=${useDaily ? 'daily' : 'monthly'}`)

    // =============================================================================
    // BUILD RESPONSE
    // =============================================================================
    const response: Record<string, unknown> = {
      // Revenue metrics
      totalRevenue: {
        current: currentTotalRevenue,
        previous: previousTotalRevenue,
        change: Number(totalRevenueChange.toFixed(1)),
        trend: determineTrend(totalRevenueChange),
      },
      setupFees: {
        current: currentSetupFees,
        previous: previousSetupFees,
        change: Number(setupFeesChange.toFixed(1)),
        trend: determineTrend(setupFeesChange),
        description: 'PREIFM transactions (initial client onboarding)',
      },
      fundingFees: {
        current: currentFundingFees,
        previous: previousFundingFees,
        change: Number(fundingFeesChange.toFixed(1)),
        trend: determineTrend(fundingFeesChange),
        description: 'New Invoice transactions (7% success fees)',
      },
      avgTransaction: {
        current: Number(currentAvgTransaction.toFixed(2)),
        previous: Number(previousAvgTransaction.toFixed(2)),
        change: Number(avgTransactionChange.toFixed(1)),
        trend: determineTrend(avgTransactionChange),
      },
      transactionCount: {
        current: currentTransactionCount,
        previous: previousTransactionCount,
        change: Number(calculateChange(currentTransactionCount, previousTransactionCount).toFixed(1)),
        trend: determineTrend(calculateChange(currentTransactionCount, previousTransactionCount)),
      },
      // Contact metrics
      totalContacts: {
        current: totalContacts,
        description: 'All contacts with funnel tags',
      },
      newContacts: {
        current: newContactsCurrent,
        previous: newContactsPrevious,
        change: Number(newContactsChange.toFixed(1)),
        trend: determineTrend(newContactsChange),
        description: 'Contacts created in selected period',
      },
      handRaisers: {
        current: handRaisers,
        description: 'Contacts in hand_raiser stage',
      },
      clients: {
        current: clients,
        description: 'Premium + VIP clients',
      },
      // Funnel stage distribution
      stageDistribution,
      // Revenue trend
      revenueTrend,
      // Current period info
      period: {
        startDate,
        endDate,
        label: period,
      },
    }

    // Add transactions if requested
    if (includeTransactions) {
      response.transactions = {
        data: transactions,
        total: transactionsTotal,
        limit: parseInt(searchParams.get('limit') || '20', 10),
        offset: parseInt(searchParams.get('offset') || '0', 10),
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('GHL API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch GHL data', details: String(error) },
      { status: 500 }
    )
  }
}
