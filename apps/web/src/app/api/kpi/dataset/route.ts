import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@0ne/db/server'
import {
  FUNNEL_STAGE_ORDER,
  STAGE_LABELS,
  STAGE_COLORS,
  type FunnelStage,
} from '@/features/kpi/lib/config'
import { getLatestMetrics } from '@/features/skool/lib/metrics-sync'
import { getLatestRevenueSnapshot } from '@/features/skool/lib/revenue-sync'

export const dynamic = 'force-dynamic'

/**
 * KPI Dataset Endpoint
 *
 * Returns all pre-aggregated data needed for instant client-side filtering.
 * Load once per session, then filter in-memory on the client.
 *
 * Response shape:
 * {
 *   aggregates: { daily, bySource, byCampaign, bySourceAndCampaign }
 *   dimensions: { sources, campaigns, stages, expenseCategories }
 *   weeklyTrends: [...]
 *   skool: { latest metrics }
 *   expenses: { byCategory, byDate }
 *   meta: { generatedAt, periodStart, periodEnd }
 * }
 */

interface DailyAggregate {
  id: string
  date: string
  campaign_id: string | null
  source: string | null
  new_members: number
  new_hand_raisers: number
  new_qualified_premium: number
  new_qualified_vip: number
  new_offer_made: number
  new_offer_seen: number
  new_vip: number
  new_premium: number
  total_revenue: number
  vip_revenue: number
  premium_revenue: number
  success_fee_revenue: number
  ad_spend: number
  expenses: number
  total_funded_amount: number
  funded_count: number
}

interface DimensionSource {
  source: string
  display_name: string
  contact_count: number
  last_seen_date: string | null
  is_active: boolean
}

interface DimensionStage {
  stage: string
  display_name: string
  color: string
  sort_order: number
  contact_count: number
}

interface DimensionCampaign {
  campaign_id: string
  campaign_name: string
  contact_count: number
  is_active: boolean
}

interface DimensionExpenseCategory {
  category: string
  display_name: string | null
  color: string | null
  expense_count: number
  total_amount: number
  is_system: boolean
}

interface WeeklyTrend {
  week_start: string
  week_number: string
  source: string | null
  campaign_id: string | null
  new_leads: number
  new_hand_raisers: number
  new_qualified: number
  new_clients: number
  total_revenue: number
  ad_spend: number
  cost_per_lead: number | null
  cost_per_client: number | null
}

interface DailyExpenseByCategory {
  date: string
  category: string
  amount: number
  is_system: boolean
  expense_count: number
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('days') || '365', 10) // Default to 1 year of data

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000)
    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    const supabase = createServerClient()

    // Parallel fetch all data
    const [
      aggregatesResult,
      dimensionSourcesResult,
      dimensionStagesResult,
      dimensionCampaignsResult,
      dimensionExpenseCategoriesResult,
      weeklyTrendsResult,
      dailyExpensesResult,
      skoolMetrics,
      revenueSnapshot,
      contactStageCountsResult,
    ] = await Promise.all([
      // 1. Daily aggregates for the period
      supabase
        .from('daily_aggregates')
        .select('*')
        .gte('date', startDateStr)
        .lte('date', endDateStr)
        .order('date', { ascending: true }),

      // 2. Dimension tables
      supabase
        .from('dimension_sources')
        .select('source, display_name, contact_count, last_seen_date, is_active')
        .eq('is_active', true)
        .order('contact_count', { ascending: false }),

      supabase
        .from('dimension_stages')
        .select('stage, display_name, color, sort_order, contact_count')
        .order('sort_order', { ascending: true }),

      supabase
        .from('dimension_campaigns')
        .select('campaign_id, campaign_name, contact_count, is_active')
        .eq('is_active', true)
        .order('contact_count', { ascending: false }),

      supabase
        .from('dimension_expense_categories')
        .select('category, display_name, color, expense_count, total_amount, is_system')
        .order('total_amount', { ascending: false }),

      // 3. Weekly trends
      supabase
        .from('weekly_trends')
        .select('*')
        .gte('week_start', startDateStr)
        .lte('week_start', endDateStr)
        .order('week_start', { ascending: true }),

      // 4. Daily expenses by category
      supabase
        .from('daily_expenses_by_category')
        .select('date, category, amount, is_system, expense_count')
        .gte('date', startDateStr)
        .lte('date', endDateStr)
        .order('date', { ascending: true }),

      // 5. Skool metrics (latest snapshot)
      getLatestMetrics(),

      // 6. Revenue snapshot
      getLatestRevenueSnapshot(),

      // 7. Contact stage counts (for funnel - uses stages array)
      supabase
        .from('contacts')
        .select('stages'),
    ])

    const aggregates = (aggregatesResult.data || []) as DailyAggregate[]

    // Calculate stage counts from contacts' stages arrays (tags accumulate)
    const stageCountsMap: Record<string, number> = {}
    const contacts = contactStageCountsResult.data || []
    contacts.forEach((contact) => {
      const stages = (contact.stages as string[]) || []
      stages.forEach((stage) => {
        if (stage) {
          stageCountsMap[stage] = (stageCountsMap[stage] || 0) + 1
        }
      })
    })

    // Build dimension stages with live counts
    const dimensionStages = (dimensionStagesResult.data || []).map((stage: DimensionStage) => ({
      ...stage,
      contact_count: stageCountsMap[stage.stage] || stage.contact_count || 0,
    }))

    // Organize aggregates by dimension for easy client-side slicing
    const dailyAggregates: DailyAggregate[] = []
    const bySourceAggregates: Record<string, DailyAggregate[]> = {}
    const byCampaignAggregates: Record<string, DailyAggregate[]> = {}

    for (const agg of aggregates) {
      // Overall aggregates (no campaign, no source filter)
      if (!agg.campaign_id && !agg.source) {
        dailyAggregates.push(agg)
      }

      // By source aggregates
      if (agg.source && !agg.campaign_id) {
        if (!bySourceAggregates[agg.source]) {
          bySourceAggregates[agg.source] = []
        }
        bySourceAggregates[agg.source].push(agg)
      }

      // By campaign aggregates
      if (agg.campaign_id && !agg.source) {
        if (!byCampaignAggregates[agg.campaign_id]) {
          byCampaignAggregates[agg.campaign_id] = []
        }
        byCampaignAggregates[agg.campaign_id].push(agg)
      }
    }

    // Build funnel stages with colors and labels for immediate UI use
    const funnelStages = FUNNEL_STAGE_ORDER.map((stageId) => ({
      id: stageId,
      name: STAGE_LABELS[stageId],
      color: STAGE_COLORS[stageId],
      count: stageCountsMap[stageId] || 0,
    }))

    // Organize weekly trends
    const weeklyTrendsBySource: Record<string, WeeklyTrend[]> = {}
    const overallWeeklyTrends: WeeklyTrend[] = []

    for (const trend of (weeklyTrendsResult.data || []) as WeeklyTrend[]) {
      if (!trend.source && !trend.campaign_id) {
        overallWeeklyTrends.push(trend)
      } else if (trend.source && !trend.campaign_id) {
        if (!weeklyTrendsBySource[trend.source]) {
          weeklyTrendsBySource[trend.source] = []
        }
        weeklyTrendsBySource[trend.source].push(trend)
      }
    }

    // Organize expenses
    const expensesByCategory: Record<string, DailyExpenseByCategory[]> = {}
    const dailyExpensesTotal: { date: string; amount: number }[] = []
    const dailyExpensesMap = new Map<string, number>()

    for (const expense of (dailyExpensesResult.data || []) as DailyExpenseByCategory[]) {
      if (!expensesByCategory[expense.category]) {
        expensesByCategory[expense.category] = []
      }
      expensesByCategory[expense.category].push(expense)

      // Sum by date
      const current = dailyExpensesMap.get(expense.date) || 0
      dailyExpensesMap.set(expense.date, current + expense.amount)
    }

    // Convert to sorted array
    for (const [date, amount] of dailyExpensesMap) {
      dailyExpensesTotal.push({ date, amount })
    }
    dailyExpensesTotal.sort((a, b) => a.date.localeCompare(b.date))

    const response = {
      aggregates: {
        // Daily aggregates with no filters (overall)
        daily: dailyAggregates,
        // Aggregates pre-grouped by source
        bySource: bySourceAggregates,
        // Aggregates pre-grouped by campaign
        byCampaign: byCampaignAggregates,
        // All aggregates for complex multi-filter scenarios
        all: aggregates,
      },
      dimensions: {
        sources: (dimensionSourcesResult.data || []) as DimensionSource[],
        stages: dimensionStages as DimensionStage[],
        campaigns: (dimensionCampaignsResult.data || []) as DimensionCampaign[],
        expenseCategories: (dimensionExpenseCategoriesResult.data || []) as DimensionExpenseCategory[],
      },
      funnel: {
        stages: funnelStages,
        totalContacts: Object.values(stageCountsMap).reduce((a, b) => a + b, 0),
        overallConversion: stageCountsMap['member'] > 0
          ? ((stageCountsMap['vip'] || 0) + (stageCountsMap['premium'] || 0)) / stageCountsMap['member'] * 100
          : 0,
      },
      weeklyTrends: {
        overall: overallWeeklyTrends,
        bySource: weeklyTrendsBySource,
      },
      expenses: {
        byCategory: expensesByCategory,
        dailyTotal: dailyExpensesTotal,
        categories: (dimensionExpenseCategoriesResult.data || []) as DimensionExpenseCategory[],
      },
      skool: skoolMetrics
        ? {
            totalMembers: skoolMetrics.members_total || 0,
            activeMembers: skoolMetrics.members_active || 0,
            communityActivity: skoolMetrics.community_activity || 0,
            categoryRank: skoolMetrics.category_rank || null,
            category: skoolMetrics.category || null,
            aboutPageVisits: skoolMetrics.about_page_visits || 0,
            conversionRate: skoolMetrics.conversion_rate || 0,
            snapshotDate: skoolMetrics.snapshot_date,
            mrr: revenueSnapshot?.mrr || 0,
            mrrRetention: revenueSnapshot?.retention_rate || 0,
            paidMembers: revenueSnapshot?.paying_members || 0,
          }
        : null,
      meta: {
        generatedAt: new Date().toISOString(),
        periodStart: startDateStr,
        periodEnd: endDateStr,
        daysIncluded: daysBack,
        aggregateCount: aggregates.length,
        contactCount: contacts.length,
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('KPI Dataset error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch KPI dataset', details: String(error) },
      { status: 500 }
    )
  }
}
