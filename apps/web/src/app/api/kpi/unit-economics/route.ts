/**
 * Unit Economics API Endpoint
 *
 * Calculates advanced revenue metrics:
 * - ARPU (Average Revenue Per User) = MRR / Paying Members
 * - LTV (Lifetime Value) = ARPU × Average Customer Lifetime
 * - EPL (Earnings Per Lead) = Total Revenue / Total Members
 * - EPL by Cohort (Day 1, 7, 14, 35, 65, 95, 185, 370)
 * - LTV by Cohort
 * - Payback Period = CAC / Monthly Revenue Per Client
 *
 * Data sources:
 * - skool_revenue_daily: MRR, paying members, retention
 * - skool_members: Member join dates for cohort analysis
 * - ghl_transactions: One-time revenue
 * - expenses: Ad spend for CAC calculation
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, and, desc, count } from '@0ne/db/server'
import { skoolRevenueDaily, skoolMembers, ghlTransactions, expenses as expensesTable, contacts } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

// Cohort day intervals for EPL/LTV calculation
const COHORT_DAYS = [1, 7, 14, 35, 65, 95, 185, 370]

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

  const period = searchParams.get('period') || 'lifetime'
  return getDateRangeFromPeriod(period)
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const { startDate, endDate } = parseDateRange(searchParams)

    const now = new Date()

    console.log(`[Unit Economics] Calculating for ${startDate} to ${endDate}`)

    // =============================================================================
    // 1. GET CURRENT MRR AND PAYING MEMBERS
    // =============================================================================
    const [latestRevenue] = await db
      .select({
        mrr: skoolRevenueDaily.mrr,
        payingMembers: skoolRevenueDaily.payingMembers,
        retentionRate: skoolRevenueDaily.retentionRate,
      })
      .from(skoolRevenueDaily)
      .where(eq(skoolRevenueDaily.groupSlug, 'fruitful'))
      .orderBy(desc(skoolRevenueDaily.snapshotDate))
      .limit(1)

    const currentMrr = latestRevenue?.mrr || 0
    const payingMembers = latestRevenue?.payingMembers || 0
    const retentionRate = latestRevenue?.retentionRate || 100

    // =============================================================================
    // 2. CALCULATE ARPU
    // =============================================================================
    // ARPU = MRR / Paying Members
    const arpu = payingMembers > 0 ? currentMrr / payingMembers : 0

    // =============================================================================
    // 3. CALCULATE AVERAGE CUSTOMER LIFETIME
    // =============================================================================
    // Average Lifetime (months) = 1 / Churn Rate
    // If retention is 95%, churn is 5%, lifetime is 20 months
    const churnRate = (100 - retentionRate) / 100
    const avgLifetimeMonths = churnRate > 0 ? 1 / churnRate : 24 // Default to 24 months if 0% churn

    // =============================================================================
    // 4. CALCULATE LTV
    // =============================================================================
    // LTV = ARPU × Average Lifetime (in months)
    const ltv = arpu * avgLifetimeMonths

    // =============================================================================
    // 5. GET TOTAL MEMBERS FOR EPL
    // =============================================================================
    const [{ value: totalMembers }] = await db
      .select({ value: count() })
      .from(skoolMembers)
      .where(
        and(
          eq(skoolMembers.groupSlug, 'fruitful'),
          gte(skoolMembers.memberSince, new Date(startDate)),
          lte(skoolMembers.memberSince, new Date(`${endDate}T23:59:59Z`)),
        )
      )

    // =============================================================================
    // 6. GET TOTAL REVENUE FOR EPL
    // =============================================================================
    // One-time revenue from GHL
    const transactions = await db
      .select({ amount: ghlTransactions.amount })
      .from(ghlTransactions)
      .where(
        and(
          eq(ghlTransactions.status, 'succeeded'),
          gte(ghlTransactions.transactionDate, new Date(`${startDate}T00:00:00Z`)),
          lte(ghlTransactions.transactionDate, new Date(`${endDate}T23:59:59Z`)),
        )
      )

    const oneTimeRevenue = transactions.reduce((sum, t) => sum + (t.amount || 0), 0)

    // Get cumulative recurring revenue over period
    // For EPL, we calculate average MRR × months in period
    const periodStart = new Date(startDate)
    const periodEnd = new Date(endDate)
    const periodMonths = Math.max(1,
      (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 +
      (periodEnd.getMonth() - periodStart.getMonth()) + 1
    )
    const recurringRevenue = currentMrr * periodMonths
    const totalRevenue = oneTimeRevenue + recurringRevenue

    // =============================================================================
    // 7. CALCULATE EPL
    // =============================================================================
    // EPL = Total Revenue / Total Members
    const memberCount = totalMembers || 1
    const epl = totalRevenue / memberCount

    // =============================================================================
    // 8. CALCULATE EPL BY COHORT
    // =============================================================================
    // For each cohort day, calculate revenue earned from members who joined N days ago
    const eplByCohort: Array<{ day: number; value: number }> = []
    const ltvByCohort: Array<{ day: number; value: number }> = []

    for (const days of COHORT_DAYS) {
      const cohortDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      const cohortDateStr = cohortDate.toISOString().split('T')[0]

      // Get members who joined on or before this cohort date
      const [{ value: cohortMembers }] = await db
        .select({ value: count() })
        .from(skoolMembers)
        .where(
          and(
            eq(skoolMembers.groupSlug, 'fruitful'),
            lte(skoolMembers.memberSince, new Date(cohortDateStr)),
          )
        )

      // Get revenue from transactions up to that date
      const cohortTransactions = await db
        .select({ amount: ghlTransactions.amount })
        .from(ghlTransactions)
        .where(
          and(
            eq(ghlTransactions.status, 'succeeded'),
            lte(ghlTransactions.transactionDate, new Date(cohortDateStr)),
          )
        )

      const cohortOneTimeRevenue = cohortTransactions.reduce((sum, t) => sum + (t.amount || 0), 0)

      // For recurring, estimate based on MRR history
      const [cohortMrr] = await db
        .select({ mrr: skoolRevenueDaily.mrr })
        .from(skoolRevenueDaily)
        .where(
          and(
            eq(skoolRevenueDaily.groupSlug, 'fruitful'),
            lte(skoolRevenueDaily.snapshotDate, cohortDateStr),
          )
        )
        .orderBy(desc(skoolRevenueDaily.snapshotDate))
        .limit(1)

      // Approximate recurring revenue for cohort period
      const cohortMonths = Math.max(1, Math.ceil(days / 30))
      const cohortRecurringRevenue = (cohortMrr?.mrr || 0) * cohortMonths
      const cohortTotalRevenue = cohortOneTimeRevenue + cohortRecurringRevenue

      const cohortMemberCount = cohortMembers || 1
      const cohortEpl = cohortTotalRevenue / cohortMemberCount

      eplByCohort.push({ day: days, value: Number(cohortEpl.toFixed(2)) })

      // LTV at each cohort point = EPL × (remaining lifetime factor)
      // Simplified: assume members at day N have earned N/avgLifetime of their total LTV
      const lifetimeFactor = Math.min(1, days / (avgLifetimeMonths * 30))
      const cohortLtv = cohortEpl / lifetimeFactor
      ltvByCohort.push({ day: days, value: Number(cohortLtv.toFixed(2)) })
    }

    // =============================================================================
    // 9. GET AD SPEND FOR CAC
    // =============================================================================
    const adSpend = await db
      .select({ amount: expensesTable.amount })
      .from(expensesTable)
      .where(
        and(
          eq(expensesTable.category, 'Facebook Ads'),
          eq(expensesTable.isActive, true),
        )
      )

    const totalAdSpend = adSpend.reduce((sum, e) => sum + (e.amount || 0), 0)

    // Get client count (Premium + VIP) from contacts
    const [{ value: premiumCount }] = await db
      .select({ value: count() })
      .from(contacts)
      .where(eq(contacts.currentStage, 'premium'))

    const [{ value: vipCount }] = await db
      .select({ value: count() })
      .from(contacts)
      .where(eq(contacts.currentStage, 'vip'))

    const totalClients = (premiumCount || 0) + (vipCount || 0)

    // =============================================================================
    // 10. CALCULATE CAC AND PAYBACK
    // =============================================================================
    const cac = totalClients > 0 ? totalAdSpend / totalClients : 0
    const monthlyRevenuePerClient = payingMembers > 0 ? currentMrr / payingMembers : 0
    const paybackPeriod = monthlyRevenuePerClient > 0 ? cac / monthlyRevenuePerClient : 0

    // LTV:CAC Ratio
    const ltvCacRatio = cac > 0 ? ltv / cac : 0

    // =============================================================================
    // BUILD RESPONSE
    // =============================================================================
    const response = {
      // Core metrics
      arpu: Number(arpu.toFixed(2)),
      ltv: Number(ltv.toFixed(2)),
      epl: Number(epl.toFixed(2)),

      // Unit economics
      cac: Number(cac.toFixed(2)),
      paybackPeriod: Number(paybackPeriod.toFixed(1)),
      ltvCacRatio: Number(ltvCacRatio.toFixed(1)),

      // Supporting data
      currentMrr: Number(currentMrr.toFixed(2)),
      payingMembers,
      totalMembers: memberCount,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      oneTimeRevenue: Number(oneTimeRevenue.toFixed(2)),
      recurringRevenue: Number(recurringRevenue.toFixed(2)),
      retentionRate,
      avgLifetimeMonths: Number(avgLifetimeMonths.toFixed(1)),

      // Cohort data
      eplByCohort,
      ltvByCohort,

      // Period info
      period: {
        startDate,
        endDate,
      },
    }

    console.log(`[Unit Economics] ARPU=$${arpu.toFixed(2)}, LTV=$${ltv.toFixed(2)}, EPL=$${epl.toFixed(2)}`)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Unit Economics API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch unit economics', details: String(error) },
      { status: 500 }
    )
  }
}
