'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  KPIDataset,
  KPIFilters,
  DailyAggregate,
  AggregatedTotals,
  DerivedMetrics,
  FunnelStageData,
  WeeklyTrend,
} from '../lib/dataset-types'

// =============================================================================
// STORE STATE
// =============================================================================

interface KPIDatasetState {
  // Core data
  dataset: KPIDataset | null
  isLoading: boolean
  error: Error | null
  lastFetched: Date | null

  // Filters
  filters: KPIFilters

  // Actions
  fetchDataset: (daysBack?: number) => Promise<void>
  setFilters: (filters: Partial<KPIFilters>) => void
  resetFilters: () => void
  clearDataset: () => void
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

const getDefaultFilters = (): KPIFilters => {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  return {
    dateRange: {
      startDate: thirtyDaysAgo.toISOString().split('T')[0],
      endDate: now.toISOString().split('T')[0],
    },
    sources: [],
    campaigns: [],
    expenseCategories: [],
  }
}

// =============================================================================
// STORE
// =============================================================================

export const useKPIDatasetStore = create<KPIDatasetState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    dataset: null,
    isLoading: false,
    error: null,
    lastFetched: null,
    filters: getDefaultFilters(),

    // Actions
    fetchDataset: async (daysBack = 365) => {
      set({ isLoading: true, error: null })

      try {
        const response = await fetch(`/api/kpi/dataset?days=${daysBack}`)

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to fetch KPI dataset')
        }

        const dataset: KPIDataset = await response.json()

        set({
          dataset,
          isLoading: false,
          lastFetched: new Date(),
        })
      } catch (error) {
        set({
          error: error instanceof Error ? error : new Error('Unknown error'),
          isLoading: false,
        })
      }
    },

    setFilters: (newFilters) => {
      set((state) => ({
        filters: { ...state.filters, ...newFilters },
      }))
    },

    resetFilters: () => {
      set({ filters: getDefaultFilters() })
    },

    clearDataset: () => {
      set({
        dataset: null,
        error: null,
        lastFetched: null,
      })
    },
  }))
)

// =============================================================================
// SELECTOR HELPERS
// =============================================================================

/**
 * Filter aggregates by date range
 */
function filterByDateRange(
  aggregates: DailyAggregate[],
  startDate: string,
  endDate: string
): DailyAggregate[] {
  return aggregates.filter((agg) => agg.date >= startDate && agg.date <= endDate)
}

/**
 * Sum aggregates into totals
 */
function sumAggregates(aggregates: DailyAggregate[]): AggregatedTotals {
  return aggregates.reduce(
    (acc, agg) => ({
      newMembers: acc.newMembers + (agg.new_members || 0),
      newHandRaisers: acc.newHandRaisers + (agg.new_hand_raisers || 0),
      newQualifiedPremium: acc.newQualifiedPremium + (agg.new_qualified_premium || 0),
      newQualifiedVip: acc.newQualifiedVip + (agg.new_qualified_vip || 0),
      newOfferMade: acc.newOfferMade + (agg.new_offer_made || 0),
      newOfferSeen: acc.newOfferSeen + (agg.new_offer_seen || 0),
      newVip: acc.newVip + (agg.new_vip || 0),
      newPremium: acc.newPremium + (agg.new_premium || 0),
      newClients: acc.newClients + (agg.new_vip || 0) + (agg.new_premium || 0),
      totalRevenue: acc.totalRevenue + (agg.total_revenue || 0),
      vipRevenue: acc.vipRevenue + (agg.vip_revenue || 0),
      premiumRevenue: acc.premiumRevenue + (agg.premium_revenue || 0),
      successFeeRevenue: acc.successFeeRevenue + (agg.success_fee_revenue || 0),
      adSpend: acc.adSpend + (agg.ad_spend || 0),
      expenses: acc.expenses + (agg.expenses || 0),
      totalFundedAmount: acc.totalFundedAmount + (agg.total_funded_amount || 0),
      fundedCount: acc.fundedCount + (agg.funded_count || 0),
    }),
    {
      newMembers: 0,
      newHandRaisers: 0,
      newQualifiedPremium: 0,
      newQualifiedVip: 0,
      newOfferMade: 0,
      newOfferSeen: 0,
      newVip: 0,
      newPremium: 0,
      newClients: 0,
      totalRevenue: 0,
      vipRevenue: 0,
      premiumRevenue: 0,
      successFeeRevenue: 0,
      adSpend: 0,
      expenses: 0,
      totalFundedAmount: 0,
      fundedCount: 0,
    }
  )
}

/**
 * Calculate percentage change
 */
function calculateChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

/**
 * Get aggregates for the selected filters
 */
function getFilteredAggregates(
  dataset: KPIDataset,
  filters: KPIFilters
): DailyAggregate[] {
  const { dateRange, sources, campaigns } = filters

  // Start with the appropriate base
  let aggregates: DailyAggregate[]

  if (sources.length === 0 && campaigns.length === 0) {
    // No filters - use overall daily aggregates
    aggregates = dataset.aggregates.daily
  } else if (sources.length > 0 && campaigns.length === 0) {
    // Source filter only - combine source-specific aggregates
    aggregates = sources.flatMap((source) => dataset.aggregates.bySource[source] || [])
  } else if (campaigns.length > 0 && sources.length === 0) {
    // Campaign filter only - combine campaign-specific aggregates
    aggregates = campaigns.flatMap((campaign) => dataset.aggregates.byCampaign[campaign] || [])
  } else {
    // Both filters - use the all array and filter
    aggregates = dataset.aggregates.all.filter((agg) => {
      if (agg.source && sources.length > 0 && !sources.includes(agg.source)) return false
      if (agg.campaign_id && campaigns.length > 0 && !campaigns.includes(agg.campaign_id)) return false
      return true
    })
  }

  // Apply date range filter
  return filterByDateRange(aggregates, dateRange.startDate, dateRange.endDate)
}

// =============================================================================
// MEMOIZED SELECTORS
// =============================================================================

/**
 * Get filtered aggregated totals for current period
 */
export function useFilteredTotals(): AggregatedTotals | null {
  return useKPIDatasetStore((state) => {
    if (!state.dataset) return null
    const aggregates = getFilteredAggregates(state.dataset, state.filters)
    return sumAggregates(aggregates)
  })
}

/**
 * Get derived metrics with changes and sparklines
 */
export function useDerivedMetrics(): DerivedMetrics | null {
  return useKPIDatasetStore((state) => {
    if (!state.dataset) return null

    const { dataset, filters } = state
    const { dateRange } = filters

    // Calculate previous period
    const currentStart = new Date(dateRange.startDate)
    const currentEnd = new Date(dateRange.endDate)
    const periodLength = currentEnd.getTime() - currentStart.getTime()
    const previousEnd = new Date(currentStart.getTime() - 1) // Day before current start
    const previousStart = new Date(previousEnd.getTime() - periodLength)

    const previousFilters: KPIFilters = {
      ...filters,
      dateRange: {
        startDate: previousStart.toISOString().split('T')[0],
        endDate: previousEnd.toISOString().split('T')[0],
      },
    }

    // Get current and previous totals
    const currentAggregates = getFilteredAggregates(dataset, filters)
    const previousAggregates = getFilteredAggregates(dataset, previousFilters)

    const current = sumAggregates(currentAggregates)
    const previous = sumAggregates(previousAggregates)

    // Build sparklines (last 7 data points)
    const sortedAggregates = [...currentAggregates].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    )
    const sparklineData = sortedAggregates.slice(-7)

    // Calculate changes
    const revenueChange = calculateChange(current.totalRevenue, previous.totalRevenue)
    const leadsChange = calculateChange(current.newMembers, previous.newMembers)
    const clientsChange = calculateChange(current.newClients, previous.newClients)
    const fundedChange = calculateChange(current.totalFundedAmount, previous.totalFundedAmount)

    const currentCPL = current.newMembers > 0 ? current.adSpend / current.newMembers : 0
    const previousCPL = previous.newMembers > 0 ? previous.adSpend / previous.newMembers : 0
    const cplChange = calculateChange(currentCPL, previousCPL)

    const currentCPC = current.newClients > 0 ? current.adSpend / current.newClients : 0
    const previousCPC = previous.newClients > 0 ? previous.adSpend / previous.newClients : 0
    const cpcChange = calculateChange(currentCPC, previousCPC)

    return {
      current,
      previous,
      changes: {
        revenue: {
          value: current.totalRevenue,
          change: Number(revenueChange.toFixed(1)),
          trend: revenueChange >= 0 ? 'up' : 'down',
        },
        leads: {
          value: current.newMembers,
          change: Number(leadsChange.toFixed(1)),
          trend: leadsChange >= 0 ? 'up' : 'down',
        },
        clients: {
          value: current.newClients,
          change: Number(clientsChange.toFixed(1)),
          trend: clientsChange >= 0 ? 'up' : 'down',
        },
        fundedAmount: {
          value: current.totalFundedAmount,
          change: Number(fundedChange.toFixed(1)),
          trend: fundedChange >= 0 ? 'up' : 'down',
        },
        costPerLead: {
          value: Number(currentCPL.toFixed(2)),
          change: Number(cplChange.toFixed(1)),
          // For costs, down is good (up trend)
          trend: cplChange <= 0 ? 'up' : 'down',
        },
        costPerClient: {
          value: Number(currentCPC.toFixed(2)),
          change: Number(cpcChange.toFixed(1)),
          trend: cpcChange <= 0 ? 'up' : 'down',
        },
      },
      sparklines: {
        revenue: sparklineData.map((d) => d.total_revenue || 0),
        leads: sparklineData.map((d) => d.new_members || 0),
        clients: sparklineData.map((d) => (d.new_vip || 0) + (d.new_premium || 0)),
        fundedAmount: sparklineData.map((d) => d.total_funded_amount || 0),
        costPerLead: sparklineData.map((d) =>
          d.new_members > 0 ? Number(((d.ad_spend || 0) / d.new_members).toFixed(2)) : 0
        ),
        costPerClient: sparklineData.map((d) => {
          const clients = (d.new_vip || 0) + (d.new_premium || 0)
          return clients > 0 ? Number(((d.ad_spend || 0) / clients).toFixed(2)) : 0
        }),
      },
    }
  })
}

/**
 * Get funnel stages with counts
 */
export function useFunnelStages(): FunnelStageData[] | null {
  return useKPIDatasetStore((state) => {
    if (!state.dataset) return null
    return state.dataset.funnel.stages
  })
}

/**
 * Get weekly trends for the selected filters
 */
export function useWeeklyTrends(): WeeklyTrend[] | null {
  return useKPIDatasetStore((state) => {
    if (!state.dataset) return null

    const { dataset, filters } = state
    const { sources, dateRange } = filters

    // Get appropriate trends
    let trends: WeeklyTrend[]

    if (sources.length === 0) {
      trends = dataset.weeklyTrends.overall
    } else {
      // Combine trends from selected sources
      trends = sources.flatMap((source) => dataset.weeklyTrends.bySource[source] || [])
    }

    // Filter by date range
    return trends.filter(
      (trend) => trend.week_start >= dateRange.startDate && trend.week_start <= dateRange.endDate
    )
  })
}

/**
 * Get available filter dimensions
 */
export function useFilterDimensions() {
  return useKPIDatasetStore((state) => {
    if (!state.dataset) return null
    return state.dataset.dimensions
  })
}

/**
 * Get Skool metrics
 */
export function useSkoolMetrics() {
  return useKPIDatasetStore((state) => {
    if (!state.dataset) return null
    return state.dataset.skool
  })
}

/**
 * Get dataset loading state
 */
export function useDatasetLoading() {
  return useKPIDatasetStore((state) => ({
    isLoading: state.isLoading,
    error: state.error,
    lastFetched: state.lastFetched,
  }))
}

/**
 * Get current filters
 */
export function useKPIFilters() {
  return useKPIDatasetStore((state) => state.filters)
}

/**
 * Get filter actions
 */
export function useKPIFilterActions() {
  return useKPIDatasetStore((state) => ({
    setFilters: state.setFilters,
    resetFilters: state.resetFilters,
  }))
}

/**
 * Get dataset actions
 */
export function useKPIDatasetActions() {
  return useKPIDatasetStore((state) => ({
    fetchDataset: state.fetchDataset,
    clearDataset: state.clearDataset,
  }))
}
