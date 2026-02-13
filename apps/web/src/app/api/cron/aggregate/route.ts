import { NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'

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
  spend: number
  campaign_id: string | null
}

interface RevenueRow {
  amount: number
  type: string | null
  campaign_id: string | null
}

interface ExpenseRow {
  category: string
  amount: number
  is_active: boolean
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

  try {
    const supabase = createServerClient()

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
    const startOfDay = `${dateStr}T00:00:00.000Z`
    const endOfDay = `${dateStr}T23:59:59.999Z`

    // Fetch all raw data for the day
    const [eventsResult, contactsResult, adMetricsResult, revenueResult, expensesResult] = await Promise.all([
      supabase
        .from('events')
        .select('event_type, event_data, source, campaign')
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay),
      supabase
        .from('contacts')
        .select('current_stage, source, campaign')
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay),
      supabase
        .from('ad_metrics')
        .select('spend, campaign_id')
        .eq('date', dateStr),
      supabase
        .from('revenue')
        .select('amount, type, campaign_id')
        .eq('transaction_date', dateStr),
      supabase
        .from('expenses')
        .select('category, amount, is_active')
        .or(`expense_date.eq.${dateStr},and(frequency.eq.monthly,start_date.lte.${dateStr},or(end_date.is.null,end_date.gte.${dateStr}))`)
    ])

    const events = (eventsResult.data || []) as EventRow[]
    const contacts = (contactsResult.data || []) as ContactRow[]
    const adMetrics = (adMetricsResult.data || []) as AdMetricRow[]
    const revenue = (revenueResult.data || []) as RevenueRow[]
    const expenses = (expensesResult.data || []) as ExpenseRow[]

    // Collect unique sources and campaigns
    const sources = [...new Set(contacts.map(c => c.source).filter(Boolean))] as string[]
    const campaignIds = [...new Set([
      ...contacts.map(c => c.campaign).filter(Boolean),
      ...adMetrics.map(m => m.campaign_id).filter(Boolean),
    ])] as string[]

    const aggregatesToUpsert: ReturnType<typeof buildAggregate>[] = []

    // 1. Overall aggregate (null campaign, null source)
    aggregatesToUpsert.push(buildAggregate(dateStr, null, null, contacts, events, revenue, adMetrics))

    // 2. Source-level aggregates (null campaign, specific source)
    for (const source of sources) {
      aggregatesToUpsert.push(buildAggregate(dateStr, null, source, contacts, events, revenue, adMetrics))
    }

    // 3. Campaign-level aggregates (specific campaign, null source)
    for (const campaignId of campaignIds) {
      aggregatesToUpsert.push(buildAggregate(dateStr, campaignId, null, contacts, events, revenue, adMetrics))
    }

    // 4. Campaign + Source aggregates (specific campaign, specific source)
    for (const campaignId of campaignIds) {
      const campaignSources = [...new Set(
        contacts.filter(c => c.campaign === campaignId).map(c => c.source).filter(Boolean)
      )] as string[]

      for (const source of campaignSources) {
        aggregatesToUpsert.push(buildAggregate(dateStr, campaignId, source, contacts, events, revenue, adMetrics))
      }
    }

    // Batch upsert all aggregates
    const { error: upsertError } = await supabase
      .from('daily_aggregates')
      .upsert(aggregatesToUpsert, {
        onConflict: 'date,campaign_id,source',
      })

    if (upsertError) {
      throw upsertError
    }

    // =============================================================================
    // EXPENSES BY CATEGORY
    // =============================================================================
    const expensesByCategory = new Map<string, { amount: number; count: number; isSystem: boolean }>()
    for (const expense of expenses) {
      const existing = expensesByCategory.get(expense.category) || { amount: 0, count: 0, isSystem: false }
      existing.amount += Number(expense.amount)
      existing.count += 1
      expensesByCategory.set(expense.category, existing)
    }

    // Add Facebook Ads as a system expense category
    const totalAdSpend = adMetrics.reduce((sum, m) => sum + Number(m.spend), 0)
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
      expense_count: data.count,
      is_system: data.isSystem,
    }))

    if (expenseCategoryRows.length > 0) {
      await supabase
        .from('daily_expenses_by_category')
        .upsert(expenseCategoryRows, { onConflict: 'date,category' })
    }

    // =============================================================================
    // UPDATE DIMENSION TABLES
    // =============================================================================

    // Update source dimensions
    for (const source of sources) {
      const count = contacts.filter(c => c.source === source).length
      await supabase
        .from('dimension_sources')
        .upsert({
          source,
          display_name: formatSourceName(source),
          contact_count: count,
          last_seen_date: dateStr,
          is_active: true,
        }, { onConflict: 'source' })
    }

    // Update stage dimensions with current counts
    const stageCounts = new Map<string, number>()
    for (const stage of FUNNEL_STAGES) {
      stageCounts.set(stage, contacts.filter(c => c.current_stage === stage).length)
    }

    for (const [stage, count] of stageCounts) {
      if (count > 0) {
        await supabase
          .from('dimension_stages')
          .update({ last_updated: dateStr })
          .eq('stage', stage)
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
      const { data: weekAggregates } = await supabase
        .from('daily_aggregates')
        .select('*')
        .gte('date', weekStartStr)
        .lte('date', dateStr)
        .is('campaign_id', null) // Overall aggregates

      if (weekAggregates && weekAggregates.length > 0) {
        // Group by source
        const bySource = new Map<string | null, typeof weekAggregates>()

        for (const agg of weekAggregates) {
          const source = agg.source as string | null
          if (!bySource.has(source)) {
            bySource.set(source, [])
          }
          bySource.get(source)!.push(agg)
        }

        const weeklyTrendsToUpsert = []

        for (const [source, aggs] of bySource) {
          const totals = aggs.reduce((acc, agg) => ({
            new_leads: acc.new_leads + (agg.new_members || 0),
            new_hand_raisers: acc.new_hand_raisers + (agg.new_hand_raisers || 0),
            new_qualified: acc.new_qualified + (agg.new_qualified_premium || 0) + (agg.new_qualified_vip || 0),
            new_clients: acc.new_clients + (agg.new_premium || 0) + (agg.new_vip || 0),
            total_revenue: acc.total_revenue + (agg.total_revenue || 0),
            ad_spend: acc.ad_spend + (agg.ad_spend || 0),
          }), {
            new_leads: 0,
            new_hand_raisers: 0,
            new_qualified: 0,
            new_clients: 0,
            total_revenue: 0,
            ad_spend: 0,
          })

          weeklyTrendsToUpsert.push({
            week_start: weekStartStr,
            week_number: weekLabel,
            source,
            campaign_id: null,
            ...totals,
            cost_per_lead: totals.new_leads > 0 ? totals.ad_spend / totals.new_leads : null,
            cost_per_client: totals.new_clients > 0 ? totals.ad_spend / totals.new_clients : null,
          })
        }

        await supabase
          .from('weekly_trends')
          .upsert(weeklyTrendsToUpsert, { onConflict: 'week_start,source,campaign_id' })
      }
    }

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
