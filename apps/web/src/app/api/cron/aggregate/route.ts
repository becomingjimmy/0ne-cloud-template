import { NextResponse } from 'next/server'
import { db, eq, gte, lte, and, isNull } from '@0ne/db/server'
import {
  contacts, events, adMetrics, revenue, expenses,
  dailyAggregates, dailyExpensesByCategory,
  dimensionSources, dimensionStages, weeklyTrends,
} from '@0ne/db/server'
import { rawSql } from '@0ne/db/server'
import { SyncLogger } from '@/lib/sync-log'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

// Stage mappings for aggregation
const FUNNEL_STAGES = [
  'member', 'hand_raiser', 'qualified_premium', 'qualified_vip',
  'offer_made_premium', 'offer_made_vip', 'offer_seen', 'premium', 'vip'
] as const

type FunnelStage = typeof FUNNEL_STAGES[number]

interface ContactRow {
  current_stage: string
  source: string | null
  campaign: string | null
}

interface EventRow {
  event_type: string
  event_data: Record<string, unknown> | null
  source: string | null
  campaign: string | null
}

interface AdMetricRow {
  spend: string | number | null
  campaign_id: string | null
}

interface RevenueRow {
  amount: string | number
  type: string | null
  campaign_id: string | null
}

interface ExpenseRow {
  category: string | null
  amount: string | number
  is_active: boolean | null
}

/**
 * Build aggregate object for a given set of contacts, events, revenue, and ad metrics
 */
function buildAggregate(
  dateStr: string,
  campaignId: string | null,
  source: string | null,
  contacts: ContactRow[],
  events: EventRow[],
  revenue: RevenueRow[],
  adMetrics: AdMetricRow[]
) {
  // Filter by campaign and source if specified
  const filteredContacts = contacts.filter(c => {
    if (campaignId && c.campaign !== campaignId) return false
    if (source && c.source !== source) return false
    return true
  })

  const filteredRevenue = revenue.filter(r => {
    if (campaignId && r.campaign_id !== campaignId) return false
    return true
  })

  const filteredAdMetrics = adMetrics.filter(m => {
    if (campaignId && m.campaign_id !== campaignId) return false
    return true
  })

  const filteredEvents = events.filter(e => {
    if (campaignId && e.campaign !== campaignId) return false
    if (source && e.source !== source) return false
    return true
  })

  return {
    date: dateStr,
    campaign_id: campaignId,
    source: source,
    new_members: filteredContacts.filter(c => c.current_stage === 'member').length,
    new_hand_raisers: filteredContacts.filter(c => c.current_stage === 'hand_raiser').length,
    new_qualified_premium: filteredContacts.filter(c => c.current_stage === 'qualified_premium').length,
    new_qualified_vip: filteredContacts.filter(c => c.current_stage === 'qualified_vip').length,
    new_offer_made: filteredContacts.filter(c =>
      c.current_stage === 'offer_made_premium' || c.current_stage === 'offer_made_vip'
    ).length,
    new_offer_seen: filteredContacts.filter(c => c.current_stage === 'offer_seen').length,
    new_vip: filteredContacts.filter(c => c.current_stage === 'vip').length,
    new_premium: filteredContacts.filter(c => c.current_stage === 'premium').length,
    total_revenue: filteredRevenue.reduce((sum, r) => sum + Number(r.amount), 0),
    vip_revenue: filteredRevenue.filter(r => r.type === 'vip_setup').reduce((sum, r) => sum + Number(r.amount), 0),
    premium_revenue: filteredRevenue.filter(r => r.type === 'premium').reduce((sum, r) => sum + Number(r.amount), 0),
    success_fee_revenue: filteredRevenue.filter(r => r.type === 'success_fee').reduce((sum, r) => sum + Number(r.amount), 0),
    ad_spend: filteredAdMetrics.reduce((sum, m) => sum + Number(m.spend), 0),
    expenses: 0, // Expenses aggregated separately
    total_funded_amount: filteredEvents.filter(e => e.event_type === 'funded')
      .reduce((sum, e) => sum + (Number((e.event_data as Record<string, number>)?.amount) || 0), 0),
    funded_count: filteredEvents.filter(e => e.event_type === 'funded').length,
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const syncLogger = new SyncLogger('aggregate')
  await syncLogger.start({ source: 'cron' })

  try {
    // Support ?date=YYYY-MM-DD for backfilling, otherwise use yesterday
    const url = new URL(request.url)
    const dateParam = url.searchParams.get('date')

    let dateStr: string
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      dateStr = dateParam
    } else {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      dateStr = yesterday.toISOString().split('T')[0]
    }
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`)
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`)

    // Fetch all raw data for the day
    const [eventsData, contactsData, adMetricsData, revenueData, expensesData] = await Promise.all([
      db
        .select({
          event_type: events.eventType,
          event_data: events.eventData,
          source: events.source,
          campaign: events.campaign,
        })
        .from(events)
        .where(and(gte(events.createdAt, startOfDay), lte(events.createdAt, endOfDay))),
      db
        .select({
          current_stage: contacts.currentStage,
          source: contacts.source,
          campaign: contacts.campaign,
        })
        .from(contacts)
        .where(and(gte(contacts.createdAt, startOfDay), lte(contacts.createdAt, endOfDay))),
      db
        .select({
          spend: adMetrics.spend,
          campaign_id: adMetrics.campaignId,
        })
        .from(adMetrics)
        .where(eq(adMetrics.date, dateStr)),
      db
        .select({
          amount: revenue.amount,
          type: revenue.type,
          campaign_id: revenue.campaignId,
        })
        .from(revenue)
        .where(eq(revenue.transactionDate, dateStr)),
      db
        .select({
          category: expenses.category,
          amount: expenses.amount,
          is_active: expenses.isActive,
        })
        .from(expenses)
        .where(
          rawSql`(${expenses.expenseDate} = ${dateStr} OR (${expenses.frequency} = 'monthly' AND ${expenses.startDate} <= ${dateStr} AND (${expenses.endDate} IS NULL OR ${expenses.endDate} >= ${dateStr})))`
        ),
    ])

    const eventsRows = eventsData as EventRow[]
    const contactsRows = contactsData as ContactRow[]
    const adMetricsRows = adMetricsData as AdMetricRow[]
    const revenueRows = revenueData as RevenueRow[]
    const expensesRows = expensesData as ExpenseRow[]

    // Collect unique sources and campaigns
    const sources = [...new Set(contactsRows.map(c => c.source).filter(Boolean))] as string[]
    const campaignIds = [...new Set([
      ...contactsRows.map(c => c.campaign).filter(Boolean),
      ...adMetricsRows.map(m => m.campaign_id).filter(Boolean),
    ])] as string[]

    const aggregatesToUpsert: ReturnType<typeof buildAggregate>[] = []

    // 1. Overall aggregate (null campaign, null source)
    aggregatesToUpsert.push(buildAggregate(dateStr, null, null, contactsRows, eventsRows, revenueRows, adMetricsRows))

    // 2. Source-level aggregates (null campaign, specific source)
    for (const source of sources) {
      aggregatesToUpsert.push(buildAggregate(dateStr, null, source, contactsRows, eventsRows, revenueRows, adMetricsRows))
    }

    // 3. Campaign-level aggregates (specific campaign, null source)
    for (const campaignId of campaignIds) {
      aggregatesToUpsert.push(buildAggregate(dateStr, campaignId, null, contactsRows, eventsRows, revenueRows, adMetricsRows))
    }

    // 4. Campaign + Source aggregates (specific campaign, specific source)
    for (const campaignId of campaignIds) {
      const campaignSources = [...new Set(
        contactsRows.filter(c => c.campaign === campaignId).map(c => c.source).filter(Boolean)
      )] as string[]

      for (const source of campaignSources) {
        aggregatesToUpsert.push(buildAggregate(dateStr, campaignId, source, contactsRows, eventsRows, revenueRows, adMetricsRows))
      }
    }

    // Batch upsert all aggregates
    for (const agg of aggregatesToUpsert) {
      const record = {
        date: agg.date,
        campaignId: agg.campaign_id,
        source: agg.source,
        newLeads: agg.new_members,
        newHandRaisers: agg.new_hand_raisers,
        newQualified: agg.new_qualified_premium + agg.new_qualified_vip,
        newVip: agg.new_vip,
        newPremium: agg.new_premium,
        newFunded: 0,
        totalRevenue: agg.total_revenue,
        vipRevenue: agg.vip_revenue,
        premiumRevenue: agg.premium_revenue,
        successFeeRevenue: agg.success_fee_revenue,
        adSpend: agg.ad_spend,
        expenses: 0,
        totalFundedAmount: agg.total_funded_amount,
        fundedCount: agg.funded_count,
      }

      await db
        .insert(dailyAggregates)
        .values(record)
        .onConflictDoUpdate({
          target: [dailyAggregates.date, dailyAggregates.campaignId, dailyAggregates.source],
          set: {
            newLeads: record.newLeads,
            newHandRaisers: record.newHandRaisers,
            newQualified: record.newQualified,
            newVip: record.newVip,
            newPremium: record.newPremium,
            totalRevenue: record.totalRevenue,
            vipRevenue: record.vipRevenue,
            premiumRevenue: record.premiumRevenue,
            successFeeRevenue: record.successFeeRevenue,
            adSpend: record.adSpend,
            totalFundedAmount: record.totalFundedAmount,
            fundedCount: record.fundedCount,
          },
        })
    }

    // =============================================================================
    // EXPENSES BY CATEGORY
    // =============================================================================
    const expensesByCategory = new Map<string, { amount: number; count: number; isSystem: boolean }>()
    for (const expense of expensesRows) {
      const cat = expense.category || 'Uncategorized'
      const existing = expensesByCategory.get(cat) || { amount: 0, count: 0, isSystem: false }
      existing.amount += Number(expense.amount)
      existing.count += 1
      expensesByCategory.set(cat, existing)
    }

    // Add Facebook Ads as a system expense category
    const totalAdSpend = adMetricsRows.reduce((sum, m) => sum + Number(m.spend), 0)
    if (totalAdSpend > 0) {
      expensesByCategory.set('Facebook Ads', {
        amount: totalAdSpend,
        count: 1,
        isSystem: true
      })
    }

    // Upsert expenses by category
    const expenseCategoryRows = Array.from(expensesByCategory.entries()).map(([category, data]) => ({
      date: dateStr,
      category,
      amount: data.amount,
      expenseCount: data.count,
      isSystem: data.isSystem,
    }))

    for (const row of expenseCategoryRows) {
      await db
        .insert(dailyExpensesByCategory)
        .values(row)
        .onConflictDoUpdate({
          target: [dailyExpensesByCategory.date, dailyExpensesByCategory.category],
          set: {
            amount: row.amount,
            expenseCount: row.expenseCount,
            isSystem: row.isSystem,
          },
        })
    }

    // =============================================================================
    // UPDATE DIMENSION TABLES
    // =============================================================================

    // Update source dimensions
    for (const source of sources) {
      const cnt = contactsRows.filter(c => c.source === source).length
      await db
        .insert(dimensionSources)
        .values({
          source,
          displayName: formatSourceName(source),
          contactCount: cnt,
          lastSeenDate: dateStr,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [dimensionSources.source],
          set: {
            displayName: formatSourceName(source),
            contactCount: cnt,
            lastSeenDate: dateStr,
            isActive: true,
          },
        })
    }

    // Update stage dimensions with current counts
    const stageCounts = new Map<string, number>()
    for (const stage of FUNNEL_STAGES) {
      stageCounts.set(stage, contactsRows.filter(c => c.current_stage === stage).length)
    }

    for (const [stage, cnt] of stageCounts) {
      if (cnt > 0) {
        await db
          .update(dimensionStages)
          .set({ lastUpdated: dateStr })
          .where(eq(dimensionStages.stage, stage))
      }
    }

    // =============================================================================
    // WEEKLY TRENDS (if it's end of week or backfilling)
    // =============================================================================
    const dateObj = new Date(dateStr)
    const dayOfWeek = dateObj.getDay()

    // If it's Sunday (end of week), compute weekly trends
    if (dayOfWeek === 0) {
      const weekStart = new Date(dateObj)
      weekStart.setDate(weekStart.getDate() - 6) // Go back to Monday
      const weekStartStr = weekStart.toISOString().split('T')[0]

      // Get ISO week number
      const firstThursday = new Date(dateObj.getFullYear(), 0, 4)
      const weekNumber = Math.ceil(((dateObj.getTime() - firstThursday.getTime()) / 86400000 + firstThursday.getDay() + 1) / 7)
      const weekLabel = `${dateObj.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`

      // Fetch week's aggregates
      const weekAggregatesData = await db
        .select()
        .from(dailyAggregates)
        .where(and(
          gte(dailyAggregates.date, weekStartStr),
          lte(dailyAggregates.date, dateStr),
          isNull(dailyAggregates.campaignId),
        ))

      if (weekAggregatesData.length > 0) {
        // Group by source
        const bySource = new Map<string | null, typeof weekAggregatesData>()

        for (const agg of weekAggregatesData) {
          const src = agg.source as string | null
          if (!bySource.has(src)) {
            bySource.set(src, [])
          }
          bySource.get(src)!.push(agg)
        }

        for (const [src, aggs] of bySource) {
          const totals = aggs.reduce((acc, agg) => ({
            newLeads: acc.newLeads + (agg.newLeads || 0),
            newHandRaisers: acc.newHandRaisers + (agg.newHandRaisers || 0),
            newQualified: acc.newQualified + (agg.newQualified || 0),
            newClients: acc.newClients + (agg.newPremium || 0) + (agg.newVip || 0),
            totalRevenue: acc.totalRevenue + Number(agg.totalRevenue || 0),
            adSpend: acc.adSpend + Number(agg.adSpend || 0),
          }), {
            newLeads: 0,
            newHandRaisers: 0,
            newQualified: 0,
            newClients: 0,
            totalRevenue: 0,
            adSpend: 0,
          })

          const record = {
            weekStart: weekStartStr,
            weekNumber: weekLabel,
            source: src,
            campaignId: null,
            newLeads: totals.newLeads,
            newHandRaisers: totals.newHandRaisers,
            newQualified: totals.newQualified,
            newClients: totals.newClients,
            totalRevenue: totals.totalRevenue,
            adSpend: totals.adSpend,
            costPerLead: totals.newLeads > 0 ? totals.adSpend / totals.newLeads : null,
            costPerClient: totals.newClients > 0 ? totals.adSpend / totals.newClients : null,
          }

          await db
            .insert(weeklyTrends)
            .values(record)
            .onConflictDoUpdate({
              target: [weeklyTrends.weekStart, weeklyTrends.source, weeklyTrends.campaignId],
              set: {
                weekNumber: record.weekNumber,
                newLeads: record.newLeads,
                newHandRaisers: record.newHandRaisers,
                newQualified: record.newQualified,
                newClients: record.newClients,
                totalRevenue: record.totalRevenue,
                adSpend: record.adSpend,
                costPerLead: record.costPerLead,
                costPerClient: record.costPerClient,
              },
            })
        }
      }
    }

    await syncLogger.complete(aggregatesToUpsert.length, {
      sourcesProcessed: sources.length,
      campaignsProcessed: campaignIds.length,
      expenseCategoriesProcessed: expenseCategoryRows.length,
    })

    return NextResponse.json({
      success: true,
      date: dateStr,
      stats: {
        totalAggregates: aggregatesToUpsert.length,
        sourcesProcessed: sources.length,
        campaignsProcessed: campaignIds.length,
        expenseCategoriesProcessed: expenseCategoryRows.length,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Aggregate error:', error)
    await syncLogger.fail(String(error))
    return NextResponse.json(
      { error: 'Aggregation failed', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * Format source name for display
 */
function formatSourceName(source: string): string {
  const mapping: Record<string, string> = {
    'meta_ads': 'Meta Ads',
    'youtube': 'YouTube',
    'organic': 'Organic',
    'referral': 'Referral',
    'google_ads': 'Google Ads',
    'tiktok_ads': 'TikTok Ads',
  }
  return mapping[source] || source.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
