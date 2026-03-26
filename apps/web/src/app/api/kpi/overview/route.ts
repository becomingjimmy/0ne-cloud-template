import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, lt, and, inArray, isNull, asc, count } from '@0ne/db/server'
import { dailyAggregates, contacts, skoolAboutPageDaily, skoolMembersDaily, skoolMembers } from '@0ne/db/server'
import {
  FUNNEL_STAGE_ORDER,
  STAGE_LABELS,
  STAGE_COLORS,
  type FunnelStage,
} from '@/features/kpi/lib/config'
import { parseDateRange, calculateChange, sumField, buildSourceFilter } from '@/features/kpi/lib'
import { getLatestMetrics } from '@/features/skool/lib/metrics-sync'
import { getLatestRevenueSnapshot } from '@/features/skool/lib/revenue-sync'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'mtd'
    const source = searchParams.get('source') || null
    // Support multiple sources via comma-separated string
    const sourcesParam = searchParams.get('sources')
    const sources = sourcesParam ? sourcesParam.split(',').filter(Boolean) : []
    const campaign = searchParams.get('campaign') || null

    const { startDate, endDate } = parseDateRange(searchParams)
    const previousPeriodLength = new Date(endDate).getTime() - new Date(startDate).getTime()
    const previousStartDate = new Date(new Date(startDate).getTime() - previousPeriodLength)
      .toISOString()
      .split('T')[0]

    // Get current period aggregates
    // Build filter conditions
    const currentFilters = [
      gte(dailyAggregates.date, startDate),
      lte(dailyAggregates.date, endDate),
    ]

    if (campaign) {
      currentFilters.push(eq(dailyAggregates.campaignId, campaign))
    } else {
      currentFilters.push(isNull(dailyAggregates.campaignId))
    }
    if (source) {
      currentFilters.push(eq(dailyAggregates.source, source))
    } else if (sources.length > 0) {
      currentFilters.push(inArray(dailyAggregates.source, sources))
    } else {
      currentFilters.push(isNull(dailyAggregates.source))
    }

    const currentAggregates = await db
      .select()
      .from(dailyAggregates)
      .where(and(...currentFilters))

    // Get previous period aggregates
    const previousFilters = [
      gte(dailyAggregates.date, previousStartDate),
      lt(dailyAggregates.date, startDate),
    ]

    if (campaign) {
      previousFilters.push(eq(dailyAggregates.campaignId, campaign))
    } else {
      previousFilters.push(isNull(dailyAggregates.campaignId))
    }
    if (source) {
      previousFilters.push(eq(dailyAggregates.source, source))
    } else if (sources.length > 0) {
      previousFilters.push(inArray(dailyAggregates.source, sources))
    } else {
      previousFilters.push(isNull(dailyAggregates.source))
    }

    const previousAggregates = await db
      .select()
      .from(dailyAggregates)
      .where(and(...previousFilters))

    // Get contact counts by stage - fetch all contacts' stages arrays
    const stageCountsMap: Record<string, number> = {}

    const allContactsStages = await db
      .select({ stages: contacts.stages })
      .from(contacts)

    // Count by stage - contacts can be in MULTIPLE stages (tags accumulate)
    allContactsStages.forEach((contact) => {
      const stages = contact.stages as string[] || []
      stages.forEach((stage) => {
        if (stage) {
          stageCountsMap[stage] = (stageCountsMap[stage] || 0) + 1
        }
      })
    })

    // Fetch Skool metrics (source of truth for members) and revenue snapshot
    const [skoolMetrics, revenueSnapshot] = await Promise.all([
      getLatestMetrics(),
      getLatestRevenueSnapshot(),
    ])
    // Fetch date-filtered about page visits from skool_about_page_daily
    const aboutPageDaily = await db
      .select({
        visitors: skoolAboutPageDaily.visitors,
        conversionRate: skoolAboutPageDaily.conversionRate,
      })
      .from(skoolAboutPageDaily)
      .where(
        and(
          gte(skoolAboutPageDaily.date, startDate),
          lte(skoolAboutPageDaily.date, endDate),
        )
      )

    const filteredAboutVisits = aboutPageDaily.reduce((sum, row) => sum + (row.visitors || 0), 0)
    const filteredConversionRate = aboutPageDaily.length > 0
      ? aboutPageDaily.reduce((sum, row) => sum + (row.conversionRate || 0), 0) / aboutPageDaily.length
      : skoolMetrics?.conversionRate || 0

    // Fetch date-filtered member counts for current and previous periods
    // When sources are provided, query skool_members directly
    // Otherwise use pre-aggregated skool_members_daily
    let filteredMemberCount = 0
    let newMembersInPeriod = 0
    let previousPeriodMemberCount = 0
    let previousPeriodNewMembers = 0

    if (sources.length > 0) {
      // Source filtering - query skool_members directly
      const sourceFilter = buildSourceFilter(sources)

      // Get new members in period with source filter
      const [{ value: newCount }] = await db
        .select({ value: count() })
        .from(skoolMembers)
        .where(
          and(
            eq(skoolMembers.groupSlug, 'fruitful'),
            gte(skoolMembers.memberSince, new Date(`${startDate}T00:00:00Z`)),
            lte(skoolMembers.memberSince, new Date(`${endDate}T23:59:59Z`)),
            sourceFilter,
          )
        )

      newMembersInPeriod = newCount || 0

      // Get total members with source filter (all time up to endDate)
      const [{ value: totalCount }] = await db
        .select({ value: count() })
        .from(skoolMembers)
        .where(
          and(
            eq(skoolMembers.groupSlug, 'fruitful'),
            lte(skoolMembers.memberSince, new Date(`${endDate}T23:59:59Z`)),
            sourceFilter,
          )
        )

      filteredMemberCount = totalCount || 0

      // Get previous period data for comparison
      const [{ value: prevNewCount }] = await db
        .select({ value: count() })
        .from(skoolMembers)
        .where(
          and(
            eq(skoolMembers.groupSlug, 'fruitful'),
            gte(skoolMembers.memberSince, new Date(`${previousStartDate}T00:00:00Z`)),
            lt(skoolMembers.memberSince, new Date(`${startDate}T00:00:00Z`)),
            sourceFilter,
          )
        )

      previousPeriodNewMembers = prevNewCount || 0

      // Get member count at start of current period (= end of previous period)
      const [{ value: prevTotalCount }] = await db
        .select({ value: count() })
        .from(skoolMembers)
        .where(
          and(
            eq(skoolMembers.groupSlug, 'fruitful'),
            lt(skoolMembers.memberSince, new Date(`${startDate}T00:00:00Z`)),
            sourceFilter,
          )
        )

      previousPeriodMemberCount = prevTotalCount || 0
    } else {
      // No source filter - use pre-aggregated skool_members_daily
      const membersDailyData = await db
        .select({
          date: skoolMembersDaily.date,
          totalMembers: skoolMembersDaily.totalMembers,
          newMembers: skoolMembersDaily.newMembers,
        })
        .from(skoolMembersDaily)
        .where(
          and(
            eq(skoolMembersDaily.groupSlug, 'fruitful'),
            gte(skoolMembersDaily.date, startDate),
            lte(skoolMembersDaily.date, endDate),
          )
        )
        .orderBy(asc(skoolMembersDaily.date))

      // Get member count at end of period (or latest available)
      filteredMemberCount = membersDailyData.length > 0
        ? (membersDailyData[membersDailyData.length - 1].totalMembers ?? 0)
        : skoolMetrics?.membersTotal || 0

      // Calculate new members in period
      newMembersInPeriod = membersDailyData.reduce((sum, row) => sum + (row.newMembers || 0), 0)

      // Get previous period member data from skool_members_daily
      const prevMembersDailyData = await db
        .select({
          date: skoolMembersDaily.date,
          totalMembers: skoolMembersDaily.totalMembers,
          newMembers: skoolMembersDaily.newMembers,
        })
        .from(skoolMembersDaily)
        .where(
          and(
            eq(skoolMembersDaily.groupSlug, 'fruitful'),
            gte(skoolMembersDaily.date, previousStartDate),
            lt(skoolMembersDaily.date, startDate),
          )
        )
        .orderBy(asc(skoolMembersDaily.date))

      // Previous period member count at end of period
      previousPeriodMemberCount = prevMembersDailyData.length > 0
        ? (prevMembersDailyData[prevMembersDailyData.length - 1].totalMembers ?? 0)
        : 0

      // New members in previous period
      previousPeriodNewMembers = prevMembersDailyData.reduce((sum, row) => sum + (row.newMembers || 0), 0)

    }

    // Calculate conversion rate from about visits to new members for this period
    const calculatedConversionRate = filteredAboutVisits > 0
      ? (newMembersInPeriod / filteredAboutVisits) * 100
      : 0
    // Calculate metrics
    const currentRevenue = sumField(currentAggregates, 'totalRevenue')
    const previousRevenue = sumField(previousAggregates, 'totalRevenue')
    const currentLeads = sumField(currentAggregates, 'newLeads')
    const previousLeads = sumField(previousAggregates, 'newLeads')
    const currentClients = sumField(currentAggregates, 'newVip') + sumField(currentAggregates, 'newPremium')
    const previousClients = sumField(previousAggregates, 'newVip') + sumField(previousAggregates, 'newPremium')
    const currentFunded = sumField(currentAggregates, 'totalFundedAmount')
    const previousFunded = sumField(previousAggregates, 'totalFundedAmount')
    const currentAdSpend = sumField(currentAggregates, 'adSpend')
    const previousAdSpend = sumField(previousAggregates, 'adSpend')

    // Build sparkline data (last 7 data points)
    const sparklineData = [...currentAggregates]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-7)

    // Build funnel stages - use the counts from our aggregate query
    const finalStageCounts: Record<FunnelStage, number> = Object.fromEntries(
      FUNNEL_STAGE_ORDER.map((stage) => [stage, stageCountsMap[stage] || 0])
    ) as Record<FunnelStage, number>

    const funnelStages = [...FUNNEL_STAGE_ORDER].reverse().map((stageId, index, arr) => {
      const count = finalStageCounts[stageId]
      const previousStageCount = index > 0 ? finalStageCounts[arr[index - 1]] : null
      const conversionRate = previousStageCount
        ? ((count / previousStageCount) * 100)
        : null

      return {
        id: stageId,
        name: STAGE_LABELS[stageId],
        count,
        color: STAGE_COLORS[stageId],
        conversionRate: conversionRate ? Number(conversionRate.toFixed(1)) : null,
      }
    })

    // Build weekly trends
    const weeklyTrends = [...currentAggregates]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((row) => ({
        date: row.date,
        leads: row.newLeads || 0,
        handRaisers: row.newHandRaisers || 0,
        qualified: row.newQualified || 0,
        clients: (row.newVip || 0) + (row.newPremium || 0),
        revenue: row.totalRevenue || 0,
      }))

    const response = {
      metrics: {
        revenue: {
          current: currentRevenue,
          previous: previousRevenue,
          change: Number(calculateChange(currentRevenue, previousRevenue).toFixed(1)),
          trend: currentRevenue >= previousRevenue ? 'up' : 'down',
          sparkline: sparklineData.map((d) => d.totalRevenue || 0),
        },
        leads: {
          current: currentLeads,
          previous: previousLeads,
          change: Number(calculateChange(currentLeads, previousLeads).toFixed(1)),
          trend: currentLeads >= previousLeads ? 'up' : 'down',
          sparkline: sparklineData.map((d) => d.newLeads || 0),
        },
        clients: {
          current: currentClients,
          previous: previousClients,
          change: Number(calculateChange(currentClients, previousClients).toFixed(1)),
          trend: currentClients >= previousClients ? 'up' : 'down',
          sparkline: sparklineData.map((d) => (d.newVip || 0) + (d.newPremium || 0)),
        },
        fundedAmount: {
          current: currentFunded,
          previous: previousFunded,
          change: Number(calculateChange(currentFunded, previousFunded).toFixed(1)),
          trend: currentFunded >= previousFunded ? 'up' : 'down',
          sparkline: sparklineData.map((d) => d.totalFundedAmount || 0),
        },
        costPerLead: {
          current: currentLeads > 0 ? Number((currentAdSpend / currentLeads).toFixed(2)) : 0,
          previous: previousLeads > 0 ? Number((previousAdSpend / previousLeads).toFixed(2)) : 0,
          change: currentLeads > 0 && previousLeads > 0
            ? Number(calculateChange(currentAdSpend / currentLeads, previousAdSpend / previousLeads).toFixed(1))
            : 0,
          trend: currentLeads > 0 && previousLeads > 0
            ? (currentAdSpend / currentLeads <= previousAdSpend / previousLeads ? 'up' : 'down')
            : 'neutral',
          sparkline: sparklineData.map((d) =>
            (d.newLeads || 0) > 0 ? Number(((d.adSpend || 0) / (d.newLeads ?? 0)).toFixed(2)) : 0
          ),
        },
        costPerClient: {
          current: currentClients > 0 ? Number((currentAdSpend / currentClients).toFixed(2)) : 0,
          previous: previousClients > 0 ? Number((previousAdSpend / previousClients).toFixed(2)) : 0,
          change: currentClients > 0 && previousClients > 0
            ? Number(calculateChange(currentAdSpend / currentClients, previousAdSpend / previousClients).toFixed(1))
            : 0,
          trend: currentClients > 0 && previousClients > 0
            ? (currentAdSpend / currentClients <= previousAdSpend / previousClients ? 'up' : 'down')
            : 'neutral',
          sparkline: sparklineData.map((d) => {
            const clients = (d.newVip || 0) + (d.newPremium || 0)
            return clients > 0 ? Number(((d.adSpend || 0) / clients).toFixed(2)) : 0
          }),
        },
      },
      funnel: {
        stages: funnelStages,
        overallConversion: finalStageCounts.member > 0
          ? Number((((finalStageCounts.vip + finalStageCounts.premium) / finalStageCounts.member) * 100).toFixed(2))
          : 0,
      },
      trends: {
        weekly: weeklyTrends,
      },
      period: {
        startDate,
        endDate,
        label: period,
      },
      // Skool metrics - source of truth for community stats
      // For funnel flow: use newMembersInPeriod (not cumulative total)
      // conversionRate calculated from aboutVisits -> newMembers for this period
      skool: skoolMetrics
        ? {
            // Total members at end of period (for display in cards)
            totalMembers: filteredMemberCount || skoolMetrics.membersTotal || 0,
            // Previous period member count for comparison
            previousTotalMembers: previousPeriodMemberCount,
            // Member change percentage (total members growth)
            totalMembersChange: Number(calculateChange(
              filteredMemberCount || skoolMetrics.membersTotal || 0,
              previousPeriodMemberCount
            ).toFixed(1)),
            // New members during the period (for funnel flow)
            members: newMembersInPeriod,
            newMembersInPeriod,
            // Previous period new members for comparison
            previousNewMembers: previousPeriodNewMembers,
            // New members change percentage
            newMembersChange: Number(calculateChange(newMembersInPeriod, previousPeriodNewMembers).toFixed(1)),
            activeMembers: skoolMetrics.membersActive || 0,
            aboutPageVisits: filteredAboutVisits || skoolMetrics.aboutPageVisits || 0,
            // Use calculated conversion rate (new members / about visits)
            conversionRate: Number(calculatedConversionRate.toFixed(1)),
            communityActivity: skoolMetrics.communityActivity || 0,
            categoryRank: skoolMetrics.categoryRank || null,
            category: skoolMetrics.category || null,
            snapshotDate: skoolMetrics.snapshotDate,
            // MRR data from analytics-overview API
            mrr: revenueSnapshot?.mrr || 0,
            mrrRetention: revenueSnapshot?.retentionRate || 0,
            paidMembers: revenueSnapshot?.payingMembers || 0,
          }
        : null,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('KPI Overview error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch KPI data', details: String(error) },
      { status: 500 }
    )
  }
}
