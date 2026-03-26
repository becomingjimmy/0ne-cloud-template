'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SkoolMetricsSnapshot } from '@/features/skool/lib/types'

// =============================================================================
// TYPES
// =============================================================================

export interface MetricData {
  current: number
  previous: number
  change: number
  trend: 'up' | 'down' | 'neutral'
  sparkline?: number[]
}

export interface FunnelStage {
  id: string
  name: string
  count: number
  color: string
  conversionRate: number | null
}

export interface TrendDataPoint {
  date: string
  leads: number
  handRaisers: number
  qualified: number
  clients: number
  revenue: number
}

export interface SkoolMetrics {
  /** New members during the period (for funnel flow) */
  members: number
  /** Total members at end of period (for display cards) */
  totalMembers: number
  /** Previous period total members (for comparison) */
  previousTotalMembers?: number
  /** Total members change percentage vs previous period */
  totalMembersChange?: number
  newMembersInPeriod: number
  /** Previous period new members (for comparison) */
  previousNewMembers?: number
  /** New members change percentage vs previous period */
  newMembersChange?: number
  activeMembers: number
  aboutPageVisits: number
  /** Calculated conversion rate: newMembers / aboutVisits */
  conversionRate: number
  communityActivity: number
  categoryRank: number | null
  category: string | null
  snapshotDate: string
  /** Monthly Recurring Revenue from Skool subscriptions */
  mrr: number
  /** MRR retention rate (percentage, 0-100) */
  mrrRetention: number
  /** Number of paid subscribers */
  paidMembers: number
}

export interface KPIOverviewData {
  metrics: {
    revenue: MetricData
    leads: MetricData
    clients: MetricData
    fundedAmount: MetricData
    costPerLead: MetricData
    costPerClient: MetricData
  }
  funnel: {
    stages: FunnelStage[]
    overallConversion: number
  }
  trends: {
    weekly: TrendDataPoint[]
  }
  period: {
    startDate: string
    endDate: string
    label: string
  }
  skool: SkoolMetrics | null
}

export interface FunnelContact {
  id: string
  ghlContactId: string
  stage: string
  stageName: string
  source: string
  campaign: string | null
  creditStatus: string
  leadAge: number
  clientAge: number
  createdAt: string
  updatedAt: string
}

export interface ContactAtStage {
  id: string
  name: string
  email: string
  source: string
  daysInStage: number
  enteredAt: string
}

export interface FunnelData {
  funnel: {
    stages: FunnelStage[]
    totalContacts: number
    overallConversion: number
  }
  contacts: FunnelContact[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
  filters: {
    sources: { name: string; count: number }[]
    campaigns: { name: string; count: number }[]
    stages: { id: string; name: string }[]
  }
  contactsByStage?: ContactAtStage[]
}

export interface CohortProgression {
  leads: number
  epl: number
  ltv: number
}

export interface CohortRow {
  cohort: string
  startDate: string
  initialLeads: number
  progression: Record<number, CohortProgression>
}

export interface CohortsData {
  cohorts: CohortRow[]
  overallMetrics: {
    totalLeads: number
    averageEpl: number
    averageLtv: number
    cohortDays: readonly number[]
  }
  filters: {
    sources: { name: string }[]
    weeksOptions: number[]
  }
  meta: {
    weeksIncluded: number
    startDate: string
    endDate: string
  }
}

export interface ExpenseCategory {
  id: string
  name: string
  amount: number
  change: number
  trend: 'up' | 'down' | 'neutral'
  /** True for auto-synced categories (e.g., Facebook Ads from Meta API) */
  isSystem?: boolean
  /** Color from expense_categories table */
  color?: string
}

export interface ChannelMetrics {
  channel: string
  spend: number
  leads: number
  cpl: number
  clients: number
  cpc: number
}

export interface MonthlyExpense {
  month: string
  ads: number
  tools: number
  content: number
  team: number
  total: number
}

export interface ExpenseItem {
  id: string
  name: string
  category: string
  amount: number
  frequency: 'monthly' | 'annual' | 'one_time'
  isActive: boolean
  isSystem?: boolean
  startDate?: string
}

export interface ExpensesData {
  summary: {
    totalExpenses: number
    totalAdSpend: number
    totalLeads: number
    totalClients: number
    costPerLead: number
    costPerClient: number
  }
  categories: ExpenseCategory[]
  byChannel: ChannelMetrics[]
  monthly: MonthlyExpense[]
  expenses: ExpenseItem[]
  period: {
    startDate: string
    endDate: string
    label: string
  }
  filters: {
    categories: string[]
  }
}

// About Page Analytics types
export interface AboutPageDailyData {
  date: string
  visitors: number
  conversionRate: number
}

export interface AboutPageMonthlyData {
  month: string
  visitors: number
  conversionRate: number
}

export interface AboutPageAnalyticsData {
  daily: AboutPageDailyData[]
  monthly: AboutPageMonthlyData[]
  totals: {
    totalVisitors: number
    avgConversionRate: number
    avgDailyVisitors: number
  }
  period: {
    range: '30d' | '1y'
    startDate: string
    endDate: string
  }
}

// Discovery Rank Analytics types
export interface DiscoveryRankDataPoint {
  date: string
  rank: number
  category?: string
}

export interface DiscoveryRankData {
  current: {
    rank: number
    category: string
  } | null
  history: DiscoveryRankDataPoint[]
}

// Community Activity Analytics types
export interface CommunityActivityDailyData {
  date: string
  activityCount: number
  dailyActiveMembers: number | null
}

export interface CommunityActivityMonthlyData {
  date: string // YYYY-MM-01 format for chart compatibility
  month: string // YYYY-MM format for display
  activityCount: number
  avgDailyActiveMembers: number | null
}

export interface CommunityActivityAnalyticsData {
  daily: CommunityActivityDailyData[]
  monthly: CommunityActivityMonthlyData[]
  totals: {
    totalActivity: number
    avgDailyActivity: number
    avgDailyActiveMembers: number | null
    peakDay: { date: string; count: number } | null
  }
  period: {
    range: string
    startDate: string
    endDate: string
  }
}

// Members Analytics types
export interface MembersDailyData {
  date: string
  totalMembers: number
  activeMembers: number | null
  newMembers: number
  source: string | null
}

export interface MembersMonthlyData {
  date: string // YYYY-MM-01 format for chart compatibility
  month: string // YYYY-MM format for display
  totalMembers: number
  newMembers: number
}

export interface MembersAnalyticsData {
  daily: MembersDailyData[]
  monthly: MembersMonthlyData[]
  totals: {
    currentMembers: number
    startMembers: number
    newMembersInPeriod: number
    avgDailyMembers: number
    growth: number
  }
  period: {
    range: string
    startDate: string
    endDate: string
  }
}

// Revenue KPI types
export interface RevenueMetric {
  current: number
  previous: number
  change: number
  note?: string
}

export interface RecurringRevenue extends RevenueMetric {
  retention: number
  payingMembers: number
}

export interface RevenueMonthly {
  month: string
  total: number
  oneTime: number
  recurring: number
}

export interface RevenueData {
  total: RevenueMetric
  oneTime: RevenueMetric & { note?: string }
  recurring: RecurringRevenue
  monthly: RevenueMonthly[]
  period: {
    startDate: string
    endDate: string
    label: string
  }
  lastSync: string | null
}

// Unit Economics types
export interface CohortDataPoint {
  day: number
  value: number
}

export interface UnitEconomicsData {
  // Core metrics
  arpu: number
  ltv: number
  epl: number

  // Unit economics
  cac: number
  paybackPeriod: number
  ltvCacRatio: number

  // Supporting data
  currentMrr: number
  payingMembers: number
  totalMembers: number
  totalRevenue: number
  oneTimeRevenue: number
  recurringRevenue: number
  retentionRate: number
  avgLifetimeMonths: number

  // Cohort data
  eplByCohort: CohortDataPoint[]
  ltvByCohort: CohortDataPoint[]

  // Period info
  period: {
    startDate: string
    endDate: string
  }
}

// Facebook Ads KPI types
export interface FacebookAdsDailyData {
  date: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  cpm: number
  frequency: number
  reach: number
  uniqueClicks: number
  linkClicks: number
  landingPageViews: number
  completedRegistrations: number
  costPerCompletedRegistration: number
  conversions: number
  costPerConversion: number
  roas: number
  // Index signature for TrendChart compatibility
  [key: string]: string | number | undefined
}

export interface FacebookAdsKpiData {
  summary: {
    amountSpent: number
    landingPageViews: number
    completedRegistrations: number
    costPerCompletedRegistration: number
    cpc: number
    ctr: number
    cpm: number
    frequency: number
    impressions: number
    clicks: number
    linkClicks: number
    reach: number
    uniqueClicks: number
    conversions: number
    costPerConversion: number
    roas: number
  }
  daily: FacebookAdsDailyData[]
  filters: {
    campaigns: Array<{ id: string; name: string }>
    adSets: Array<{ id: string; name: string }>
    ads: Array<{ id: string; name: string }>
  }
  period: {
    startDate: string
    endDate: string
    label: string
  }
}

// =============================================================================
// HOOKS
// =============================================================================

interface DateRange {
  from: Date
  to: Date
}

interface UseKPIDataOptions {
  /** Date range for filtering (takes precedence over period) */
  dateRange?: DateRange
  /** Legacy: period preset string (used if dateRange not provided) */
  period?: string
  /** Source filter (single source or null for all) */
  source?: string | null
  /** Sources filter (multiple sources, empty = all) */
  sources?: string[]
  campaign?: string | null
  useSampleData?: boolean
}

interface UseKPIDataReturn<T> {
  data: T | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

// Helper to format date as YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

// Generic fetcher
async function fetchKPIData<T>(
  endpoint: string,
  params: Record<string, string | number | string[] | null | undefined>
): Promise<T> {
  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      // Handle arrays (e.g., sources)
      if (Array.isArray(value)) {
        if (value.length > 0) {
          searchParams.set(key, value.join(','))
        }
      } else {
        searchParams.set(key, String(value))
      }
    }
  })

  const url = `/api/kpi/${endpoint}?${searchParams.toString()}`
  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to fetch data')
  }

  return response.json()
}

/**
 * Hook for fetching KPI Overview data
 */
export function useKPIOverview(options: UseKPIDataOptions = {}): UseKPIDataReturn<KPIOverviewData> {
  const { dateRange, period = '30d', source = null, sources = [], campaign = null, useSampleData = false } = options
  const [data, setData] = useState<KPIOverviewData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Memoize date strings to avoid unnecessary re-renders
  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      // Return sample data immediately
      setData(SAMPLE_OVERVIEW_DATA)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<KPIOverviewData>('overview', {
        // Use explicit dates if provided, otherwise fall back to period preset
        startDate,
        endDate,
        period: startDate ? undefined : period,
        source,
        sources,
        campaign,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [startDate, endDate, period, source, sources, campaign, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching Funnel data
 */
export function useFunnelData(options: UseKPIDataOptions & {
  stage?: string | null
  limit?: number
  offset?: number
} = {}): UseKPIDataReturn<FunnelData> {
  const {
    dateRange,
    source = null,
    sources = [],
    campaign = null,
    stage = null,
    limit = 100,
    offset = 0,
    useSampleData = false,
  } = options
  const [data, setData] = useState<FunnelData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Memoize date strings
  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      setData(SAMPLE_FUNNEL_DATA)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<FunnelData>('funnel', {
        startDate,
        endDate,
        source,
        sources,
        campaign,
        stage,
        limit,
        offset,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [startDate, endDate, source, sources, campaign, stage, limit, offset, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching contacts at a specific funnel stage
 * Returns top N contacts with name, email, source, days in stage
 */
export function useContactsByStage(options: {
  stage: string | null
  sources?: string[]
  contactsLimit?: number
  dateRange?: DateRange
  enabled?: boolean
} = { stage: null }): UseKPIDataReturn<ContactAtStage[]> {
  const { stage, sources = [], contactsLimit = 50, dateRange, enabled = true } = options
  const [data, setData] = useState<ContactAtStage[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Memoize date strings
  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    // Don't fetch if no stage is selected or disabled
    if (!stage || !enabled) {
      setData([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<FunnelData>('funnel', {
        stage,
        sources,
        contactsLimit,
        startDate,
        endDate,
      })
      setData(result.contactsByStage || [])
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
      setData([])
    } finally {
      setIsLoading(false)
    }
  }, [stage, sources, contactsLimit, startDate, endDate, enabled])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching Cohorts data
 */
export function useCohortsData(options: UseKPIDataOptions & {
  weeks?: number
} = {}): UseKPIDataReturn<CohortsData> {
  const { source = null, sources = [], weeks = 8, useSampleData = false } = options
  const [data, setData] = useState<CohortsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      setData(SAMPLE_COHORTS_DATA)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<CohortsData>('cohorts', {
        source,
        sources,
        weeks,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [source, sources, weeks, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

// Stable empty array to avoid infinite re-renders
const EMPTY_CATEGORIES: string[] = []

/**
 * Hook for fetching Expenses data
 */
export function useExpensesData(options: UseKPIDataOptions & {
  category?: string | null
  categories?: string[]
} = {}): UseKPIDataReturn<ExpensesData> {
  const { dateRange, period = '30d', category = null, categories, useSampleData = false } = options
  // Use stable reference for empty array
  const categoriesArray = categories || EMPTY_CATEGORIES
  const [data, setData] = useState<ExpensesData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Memoize date strings
  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      setData(SAMPLE_EXPENSES_DATA)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<ExpensesData>('expenses', {
        startDate,
        endDate,
        period: startDate ? undefined : period,
        category,
        categories: categoriesArray,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [startDate, endDate, period, category, categoriesArray, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Add a new expense
 */
export async function addExpense(expense: {
  description: string
  amount: number
  category: string
  expense_date: string
  vendor?: string
  notes?: string
}): Promise<{ success: boolean; expense?: Record<string, unknown>; error?: string }> {
  const response = await fetch('/api/kpi/expenses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(expense),
  })

  return response.json()
}

/**
 * Update an existing expense via API
 */
export async function updateExpense(expense: {
  id: string
  description: string
  amount: number
  category: string
  frequency?: 'monthly' | 'annual' | 'one_time'
  expense_date?: string
  vendor?: string
  notes?: string
}): Promise<{ success: boolean; expense?: Record<string, unknown>; error?: string }> {
  const response = await fetch('/api/kpi/expenses', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(expense),
  })

  return response.json()
}

/**
 * Delete an expense by ID
 */
export async function deleteExpense(id: string): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/kpi/expenses?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

  return response.json()
}

/**
 * Hook for fetching Skool metrics snapshot
 */
export function useSkoolMetrics(options: {
  useSampleData?: boolean
} = {}): UseKPIDataReturn<SkoolMetricsSnapshot> {
  const { useSampleData = false } = options
  const [data, setData] = useState<SkoolMetricsSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      setData(SAMPLE_SKOOL_METRICS)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<SkoolMetricsSnapshot>('skool', {})
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching About Page Analytics data
 * Returns daily and monthly visitor data with conversion rates
 */
export function useAboutPageAnalytics(options: {
  range?: '30d' | '1y'
  /** Date range for filtering (takes precedence over range preset) */
  dateRange?: DateRange
  useSampleData?: boolean
} = {}): UseKPIDataReturn<AboutPageAnalyticsData> {
  const { range = '30d', dateRange, useSampleData = false } = options
  const [data, setData] = useState<AboutPageAnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Memoize date strings
  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      setData(SAMPLE_ABOUT_PAGE_DATA)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<AboutPageAnalyticsData>('about-analytics', {
        range: startDate ? undefined : range, // Use range preset only if no explicit dates
        startDate,
        endDate,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [range, startDate, endDate, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching Discovery Rank data
 * Returns historical rank data filtered by date range
 */
export function useDiscoveryRank(options: {
  /** Date range for filtering */
  dateRange?: DateRange
  useSampleData?: boolean
} = {}): UseKPIDataReturn<DiscoveryRankData> {
  const { dateRange, useSampleData = false } = options
  const [data, setData] = useState<DiscoveryRankData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Memoize date strings
  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      setData(SAMPLE_DISCOVERY_RANK_DATA)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<DiscoveryRankData>('discovery-rank', {
        startDate,
        endDate,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [startDate, endDate, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching Members Analytics data
 * Returns member count history filtered by date range and attribution sources
 */
export function useMembersAnalytics(options: {
  range?: '30d' | '1y'
  /** Date range for filtering (takes precedence over range preset) */
  dateRange?: DateRange
  /** Attribution sources to filter by (empty = all sources) */
  sources?: string[]
  useSampleData?: boolean
} = {}): UseKPIDataReturn<MembersAnalyticsData> {
  const { range = '30d', dateRange, sources = [], useSampleData = false } = options
  const [data, setData] = useState<MembersAnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Memoize date strings
  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      // No sample data for now - just use real API
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<MembersAnalyticsData>('members-analytics', {
        range: startDate ? undefined : range,
        startDate,
        endDate,
        sources,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [range, startDate, endDate, sources, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching Community Activity Analytics data
 * Returns daily and monthly community activity (engagement + active members)
 */
export function useCommunityActivityAnalytics(options: {
  range?: '30d' | '1y'
  /** Date range for filtering (takes precedence over range preset) */
  dateRange?: DateRange
  useSampleData?: boolean
} = {}): UseKPIDataReturn<CommunityActivityAnalyticsData> {
  const { range = '30d', dateRange, useSampleData = false } = options
  const [data, setData] = useState<CommunityActivityAnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Memoize date strings
  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      // No sample data for now - just use real API
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<CommunityActivityAnalyticsData>('community-activity', {
        range: startDate ? undefined : range,
        startDate,
        endDate,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [range, startDate, endDate, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching Facebook Ads KPI data
 */
export function useFacebookAdsKpi(options: {
  /** Date range for filtering (takes precedence over period preset) */
  dateRange?: DateRange
  /** Legacy: period preset string (used if dateRange not provided) */
  period?: string
  campaign?: string | null
  adset?: string | null
  ad?: string | null
  campaigns?: string[]
  adsets?: string[]
  ads?: string[]
  useSampleData?: boolean
} = {}): UseKPIDataReturn<FacebookAdsKpiData> {
  const {
    dateRange,
    period = '30d',
    campaign = null,
    adset = null,
    ad = null,
    campaigns = [],
    adsets = [],
    ads = [],
    useSampleData = false,
  } = options
  const [data, setData] = useState<FacebookAdsKpiData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      setData(SAMPLE_FACEBOOK_ADS_DATA)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<FacebookAdsKpiData>('facebook-ads', {
        startDate,
        endDate,
        period: startDate ? undefined : period,
        campaign,
        adset,
        ad,
        campaigns,
        adsets,
        ads,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [startDate, endDate, period, campaign, adset, ad, campaigns, adsets, ads, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching Revenue KPI data
 * Returns total, one-time, and recurring revenue metrics
 */
export function useRevenueData(options: {
  /** Date range for filtering (takes precedence over period preset) */
  dateRange?: DateRange
  /** Period preset (used if dateRange not provided) */
  period?: string
  useSampleData?: boolean
} = {}): UseKPIDataReturn<RevenueData> {
  const { dateRange, period = 'mtd', useSampleData = false } = options
  const [data, setData] = useState<RevenueData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      setData(SAMPLE_REVENUE_DATA)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<RevenueData>('revenue', {
        startDate,
        endDate,
        period: startDate ? undefined : period,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [startDate, endDate, period, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching Unit Economics data
 * Returns ARPU, LTV, EPL, CAC, payback period, and cohort data
 */
export function useUnitEconomics(options: {
  /** Date range for filtering (takes precedence over period preset) */
  dateRange?: DateRange
  /** Period preset (used if dateRange not provided) */
  period?: string
  useSampleData?: boolean
} = {}): UseKPIDataReturn<UnitEconomicsData> {
  const { dateRange, period = 'lifetime', useSampleData = false } = options
  const [data, setData] = useState<UnitEconomicsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    if (useSampleData) {
      setData(SAMPLE_UNIT_ECONOMICS_DATA)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<UnitEconomicsData>('unit-economics', {
        startDate,
        endDate,
        period: startDate ? undefined : period,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [startDate, endDate, period, useSampleData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

// =============================================================================
// RECENT ACTIVITY
// =============================================================================

export interface RecentActivityItem {
  id: string
  name: string
  action: string
  stage: string
  source: string | null
  timestamp: string
  timeAgo: string
}

export interface RecentActivityData {
  activity: RecentActivityItem[]
}

/**
 * Hook for fetching recent funnel activity
 * Returns last N stage changes with contact details
 */
export function useRecentActivity(options: {
  limit?: number
  enabled?: boolean
} = {}): UseKPIDataReturn<RecentActivityItem[]> {
  const { limit = 10, enabled = true } = options
  const [data, setData] = useState<RecentActivityItem[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    if (!enabled) {
      setData([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchKPIData<RecentActivityData>('recent-activity', {
        limit,
      })
      setData(result.activity || [])
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
      setData([])
    } finally {
      setIsLoading(false)
    }
  }, [limit, enabled])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

// =============================================================================
// SAMPLE DATA (for development)
// =============================================================================

const SAMPLE_UNIT_ECONOMICS_DATA: UnitEconomicsData = {
  arpu: 100.65,
  ltv: 1161.74,
  epl: 73.77,
  cac: 143.00,
  paybackPeriod: 2.8,
  ltvCacRatio: 8.1,
  currentMrr: 503.25,
  payingMembers: 5,
  totalMembers: 2871,
  totalRevenue: 211737.67,
  oneTimeRevenue: 0,
  recurringRevenue: 503.25,
  retentionRate: 100,
  avgLifetimeMonths: 24,
  eplByCohort: [
    { day: 1, value: 4.66 },
    { day: 7, value: 7.50 },
    { day: 14, value: 8.50 },
    { day: 35, value: 11.12 },
    { day: 65, value: 15.25 },
    { day: 95, value: 18.26 },
    { day: 185, value: 74.43 },
    { day: 370, value: 93.22 },
  ],
  ltvByCohort: [
    { day: 1, value: 642.87 },
    { day: 7, value: 652.35 },
    { day: 14, value: 655.25 },
    { day: 35, value: 718.81 },
    { day: 65, value: 935.11 },
    { day: 95, value: 1045.52 },
    { day: 185, value: 1112.86 },
    { day: 370, value: 665.33 },
  ],
  period: {
    startDate: '2020-01-01',
    endDate: '2026-02-08',
  },
}

const SAMPLE_OVERVIEW_DATA: KPIOverviewData = {
  metrics: {
    revenue: {
      current: 47250,
      previous: 42000,
      change: 12.5,
      trend: 'up',
      sparkline: [38000, 41000, 39500, 42000, 44000, 43500, 47250],
    },
    leads: {
      current: 342,
      previous: 316,
      change: 8.2,
      trend: 'up',
      sparkline: [280, 295, 310, 316, 325, 338, 342],
    },
    clients: {
      current: 28,
      previous: 31,
      change: -9.7,
      trend: 'down',
      sparkline: [25, 27, 29, 31, 30, 29, 28],
    },
    fundedAmount: {
      current: 1250000,
      previous: 1080000,
      change: 15.7,
      trend: 'up',
      sparkline: [920000, 980000, 1020000, 1080000, 1150000, 1200000, 1250000],
    },
    costPerLead: {
      current: 12.45,
      previous: 14.20,
      change: -12.3,
      trend: 'up',
      sparkline: [15.50, 14.80, 14.20, 13.90, 13.10, 12.80, 12.45],
    },
    costPerClient: {
      current: 152.30,
      previous: 145.00,
      change: 5.0,
      trend: 'down',
      sparkline: [140, 142, 145, 148, 150, 151, 152.30],
    },
  },
  funnel: {
    stages: [
      { id: 'lead', name: 'Lead', count: 1250, color: '#94a3b8', conversionRate: null },
      { id: 'hand_raiser', name: 'Hand Raiser', count: 450, color: '#60a5fa', conversionRate: 36.0 },
      { id: 'qualified', name: 'Qualified', count: 180, color: '#a78bfa', conversionRate: 40.0 },
      { id: 'vip', name: 'VIP', count: 45, color: '#f59e0b', conversionRate: 25.0 },
      { id: 'premium', name: 'Premium', count: 28, color: '#22c55e', conversionRate: 62.2 },
      { id: 'funded', name: 'Funded', count: 12, color: '#FF692D', conversionRate: 42.9 },
    ],
    overallConversion: 0.96,
  },
  trends: {
    weekly: [
      { date: '2026-01-06', leads: 45, handRaisers: 12, qualified: 5, clients: 2, revenue: 5200 },
      { date: '2026-01-13', leads: 52, handRaisers: 15, qualified: 6, clients: 3, revenue: 6800 },
      { date: '2026-01-20', leads: 48, handRaisers: 18, qualified: 7, clients: 4, revenue: 7200 },
      { date: '2026-01-27', leads: 65, handRaisers: 22, qualified: 9, clients: 5, revenue: 8500 },
      { date: '2026-02-03', leads: 72, handRaisers: 28, qualified: 11, clients: 6, revenue: 9800 },
    ],
  },
  period: {
    startDate: '2026-01-05',
    endDate: '2026-02-05',
    label: '30d',
  },
  skool: {
    members: 150, // New members in period (for funnel)
    totalMembers: 2595, // Total members at end of period (for cards)
    newMembersInPeriod: 150,
    activeMembers: 2589,
    aboutPageVisits: 8500,
    conversionRate: 1.8, // 150 / 8500 * 100
    communityActivity: 75,
    categoryRank: 42,
    category: 'Real Estate',
    snapshotDate: '2026-02-05',
    mrr: 503.25,
    mrrRetention: 100,
    paidMembers: 6,
  },
}

const SAMPLE_FUNNEL_DATA: FunnelData = {
  funnel: {
    stages: SAMPLE_OVERVIEW_DATA.funnel.stages,
    totalContacts: 1965,
    overallConversion: 0.96,
  },
  contacts: [],
  pagination: {
    total: 0,
    limit: 100,
    offset: 0,
    hasMore: false,
  },
  filters: {
    sources: [
      { name: 'Facebook Ad', count: 650 },
      { name: 'Google Ad', count: 280 },
      { name: 'Organic', count: 200 },
      { name: 'Referral', count: 120 },
    ],
    campaigns: [],
    stages: [
      { id: 'lead', name: 'Lead' },
      { id: 'hand_raiser', name: 'Hand Raiser' },
      { id: 'qualified', name: 'Qualified' },
      { id: 'vip', name: 'VIP' },
      { id: 'premium', name: 'Premium' },
      { id: 'funded', name: 'Funded' },
    ],
  },
}

const SAMPLE_COHORTS_DATA: CohortsData = {
  cohorts: [
    {
      cohort: '2026-W04',
      startDate: '2026-01-27',
      initialLeads: 65,
      progression: {
        1: { leads: 65, epl: 4.67, ltv: 0 },
        7: { leads: 58, epl: 7.51, ltv: 0 },
      },
    },
    {
      cohort: '2026-W03',
      startDate: '2026-01-20',
      initialLeads: 48,
      progression: {
        1: { leads: 48, epl: 4.67, ltv: 0 },
        7: { leads: 45, epl: 7.51, ltv: 0 },
        14: { leads: 42, epl: 8.51, ltv: 0 },
      },
    },
    {
      cohort: '2026-W02',
      startDate: '2026-01-13',
      initialLeads: 52,
      progression: {
        1: { leads: 52, epl: 4.67, ltv: 0 },
        7: { leads: 48, epl: 7.51, ltv: 0 },
        14: { leads: 46, epl: 8.51, ltv: 0 },
        35: { leads: 40, epl: 11.13, ltv: 0 },
      },
    },
  ],
  overallMetrics: {
    totalLeads: 165,
    averageEpl: 73.77,
    averageLtv: 1161.74,
    cohortDays: [1, 7, 14, 35, 65, 95, 185, 370],
  },
  filters: {
    sources: [{ name: 'Facebook Ad' }, { name: 'Google Ad' }],
    weeksOptions: [4, 8, 12, 16, 24],
  },
  meta: {
    weeksIncluded: 8,
    startDate: '2025-12-11',
    endDate: '2026-02-05',
  },
}

const SAMPLE_EXPENSES_DATA: ExpensesData = {
  summary: {
    totalExpenses: 9850,
    totalAdSpend: 4260,
    totalLeads: 342,
    totalClients: 28,
    costPerLead: 12.45,
    costPerClient: 152.14,
  },
  categories: [
    { id: 'ads', name: 'Advertising', amount: 4260, change: 18.3, trend: 'up' },
    { id: 'tools', name: 'Software/Tools', amount: 890, change: 2.1, trend: 'neutral' },
    { id: 'content', name: 'Content Creation', amount: 1200, change: -5.0, trend: 'down' },
    { id: 'team', name: 'Team/Contractors', amount: 3500, change: 0, trend: 'neutral' },
  ],
  byChannel: [
    { channel: 'Facebook Ads', spend: 2800, leads: 180, cpl: 15.56, clients: 8, cpc: 350 },
    { channel: 'Google Ads', spend: 960, leads: 85, cpl: 11.29, clients: 4, cpc: 240 },
    { channel: 'YouTube Ads', spend: 500, leads: 42, cpl: 11.90, clients: 2, cpc: 250 },
    { channel: 'Organic/SEO', spend: 0, leads: 35, cpl: 0, clients: 14, cpc: 0 },
  ],
  monthly: [
    { month: '2025-09', ads: 2400, tools: 850, content: 1100, team: 3500, total: 7850 },
    { month: '2025-10', ads: 2800, tools: 860, content: 1150, team: 3500, total: 8310 },
    { month: '2025-11', ads: 3200, tools: 870, content: 1200, team: 3500, total: 8770 },
    { month: '2025-12', ads: 3600, tools: 880, content: 1250, team: 3500, total: 9230 },
    { month: '2026-01', ads: 4260, tools: 890, content: 1200, team: 3500, total: 9850 },
  ],
  expenses: [],
  period: {
    startDate: '2026-01-05',
    endDate: '2026-02-05',
    label: '30d',
  },
  filters: {
    categories: ['Advertising', 'Software/Tools', 'Content Creation', 'Team/Contractors'],
  },
}

// Generate sample daily data for last 30 days
function generateSampleDailyData(): AboutPageDailyData[] {
  const data: AboutPageDailyData[] = []
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    data.push({
      date: date.toISOString().split('T')[0],
      visitors: Math.floor(Math.random() * 80) + 80, // 80-160 visitors
      conversionRate: Math.random() * 15 + 20, // 20-35%
    })
  }
  return data
}

// Generate sample monthly data for last 12 months
function generateSampleMonthlyData(): AboutPageMonthlyData[] {
  const data: AboutPageMonthlyData[] = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const month = date.toISOString().substring(0, 7)
    // Simulate growth over time
    const baseVisitors = 500 + (11 - i) * 300
    data.push({
      month,
      visitors: Math.floor(baseVisitors + Math.random() * 500),
      conversionRate: Math.random() * 15 + 25, // 25-40%
    })
  }
  return data
}

const SAMPLE_ABOUT_PAGE_DATA: AboutPageAnalyticsData = {
  daily: generateSampleDailyData(),
  monthly: generateSampleMonthlyData(),
  totals: {
    totalVisitors: 3847,
    avgConversionRate: 28.5,
    avgDailyVisitors: 128,
  },
  period: {
    range: '30d',
    startDate: '2026-01-07',
    endDate: '2026-02-05',
  },
}

const SAMPLE_SKOOL_METRICS: SkoolMetricsSnapshot = {
  groupSlug: 'fruitful',
  snapshotDate: '2026-02-05',
  membersTotal: 2595,
  membersActive: 2589,
  communityActivity: 75,
  category: 'Real Estate',
  categoryRank: 42,
  aboutPageVisits: 8500,
  conversionRate: 30.5,
}

// Generate sample discovery rank data for last 30 days
function generateSampleDiscoveryRankData(): DiscoveryRankDataPoint[] {
  const data: DiscoveryRankDataPoint[] = []
  const now = new Date()
  let rank = 620 // Starting rank
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    // Simulate gradual improvement with some noise
    rank = Math.max(1, rank + Math.floor(Math.random() * 10) - 6)
    data.push({
      date: date.toISOString().split('T')[0],
      rank,
      category: '💰 Money',
    })
  }
  return data
}

const sampleDiscoveryHistory = generateSampleDiscoveryRankData()

const SAMPLE_DISCOVERY_RANK_DATA: DiscoveryRankData = {
  current: {
    rank: sampleDiscoveryHistory[sampleDiscoveryHistory.length - 1].rank,
    category: '💰 Money',
  },
  history: sampleDiscoveryHistory,
}

const SAMPLE_REVENUE_DATA: RevenueData = {
  total: {
    current: 503.25,
    previous: 404,
    change: 24.6,
  },
  oneTime: {
    current: 0,
    previous: 0,
    change: 0,
    note: 'GHL Payments API integration pending',
  },
  recurring: {
    current: 503.25,
    previous: 404,
    change: 24.6,
    retention: 100,
    payingMembers: 6,
  },
  monthly: [
    { month: '2026-01', total: 404, oneTime: 0, recurring: 404 },
    { month: '2026-02', total: 503.25, oneTime: 0, recurring: 503.25 },
  ],
  period: {
    startDate: '2026-02-01',
    endDate: '2026-02-06',
    label: 'mtd',
  },
  lastSync: '2026-02-06T21:00:00Z',
}

const SAMPLE_FACEBOOK_ADS_DATA: FacebookAdsKpiData = {
  summary: {
    amountSpent: 4825,
    landingPageViews: 960,
    completedRegistrations: 142,
    costPerCompletedRegistration: 34.0,
    cpc: 2.85,
    ctr: 1.9,
    cpm: 18.4,
    frequency: 1.6,
    impressions: 262000,
    clicks: 1695,
    linkClicks: 1210,
    reach: 165000,
    uniqueClicks: 1040,
    conversions: 142,
    costPerConversion: 34.0,
    roas: 2.8,
  },
  daily: [
    { date: '2026-01-28', spend: 145, impressions: 7400, clicks: 48, ctr: 0.65, cpc: 3.02, cpm: 19.6, frequency: 1.4, reach: 5300, uniqueClicks: 31, linkClicks: 22, landingPageViews: 18, completedRegistrations: 2, costPerCompletedRegistration: 72.5, conversions: 2, costPerConversion: 72.5, roas: 2.1 },
    { date: '2026-01-29', spend: 172, impressions: 8100, clicks: 56, ctr: 0.69, cpc: 3.07, cpm: 21.2, frequency: 1.5, reach: 5400, uniqueClicks: 34, linkClicks: 28, landingPageViews: 21, completedRegistrations: 3, costPerCompletedRegistration: 57.3, conversions: 3, costPerConversion: 57.3, roas: 2.3 },
    { date: '2026-01-30', spend: 188, impressions: 9200, clicks: 61, ctr: 0.66, cpc: 3.08, cpm: 20.4, frequency: 1.6, reach: 5800, uniqueClicks: 36, linkClicks: 29, landingPageViews: 24, completedRegistrations: 4, costPerCompletedRegistration: 47.0, conversions: 4, costPerConversion: 47.0, roas: 2.7 },
    { date: '2026-01-31', spend: 205, impressions: 9900, clicks: 66, ctr: 0.67, cpc: 3.11, cpm: 20.7, frequency: 1.6, reach: 6100, uniqueClicks: 39, linkClicks: 33, landingPageViews: 27, completedRegistrations: 5, costPerCompletedRegistration: 41.0, conversions: 5, costPerConversion: 41.0, roas: 2.9 },
    { date: '2026-02-01', spend: 225, impressions: 10800, clicks: 72, ctr: 0.67, cpc: 3.13, cpm: 20.8, frequency: 1.6, reach: 6600, uniqueClicks: 41, linkClicks: 36, landingPageViews: 30, completedRegistrations: 6, costPerCompletedRegistration: 37.5, conversions: 6, costPerConversion: 37.5, roas: 3.0 },
    { date: '2026-02-02', spend: 236, impressions: 11700, clicks: 78, ctr: 0.67, cpc: 3.03, cpm: 20.2, frequency: 1.6, reach: 7000, uniqueClicks: 44, linkClicks: 39, landingPageViews: 33, completedRegistrations: 7, costPerCompletedRegistration: 33.7, conversions: 7, costPerConversion: 33.7, roas: 3.1 },
  ],
  filters: {
    campaigns: [
      { id: 'campaign_1', name: 'FY Workshop - Jan' },
      { id: 'campaign_2', name: 'Evergreen Nurture' },
    ],
    adSets: [
      { id: 'adset_1', name: 'Homeowners - 30-55' },
      { id: 'adset_2', name: 'Investors - Lookalike' },
    ],
    ads: [
      { id: 'ad_1', name: 'Testimonial Video' },
      { id: 'ad_2', name: 'Funding Case Study' },
    ],
  },
  period: {
    startDate: '2026-01-28',
    endDate: '2026-02-02',
    label: 'mtd',
  },
}
