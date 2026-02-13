/**
 * KPI Dataset Types
 *
 * Types for the unified /api/kpi/dataset endpoint response
 * Used for client-side filtering and caching
 */

import type { FunnelStage } from './config'

// =============================================================================
// AGGREGATE TYPES
// =============================================================================

export interface DailyAggregate {
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

export interface AggregatedTotals {
  newMembers: number
  newHandRaisers: number
  newQualifiedPremium: number
  newQualifiedVip: number
  newOfferMade: number
  newOfferSeen: number
  newVip: number
  newPremium: number
  newClients: number
  totalRevenue: number
  vipRevenue: number
  premiumRevenue: number
  successFeeRevenue: number
  adSpend: number
  expenses: number
  totalFundedAmount: number
  fundedCount: number
}

// =============================================================================
// DIMENSION TYPES
// =============================================================================

export interface DimensionSource {
  source: string
  display_name: string
  contact_count: number
  last_seen_date: string | null
  is_active: boolean
}

export interface DimensionStage {
  stage: string
  display_name: string
  color: string
  sort_order: number
  contact_count: number
}

export interface DimensionCampaign {
  campaign_id: string
  campaign_name: string
  contact_count: number
  is_active: boolean
}

export interface DimensionExpenseCategory {
  category: string
  display_name: string | null
  color: string | null
  expense_count: number
  total_amount: number
  is_system: boolean
}

// =============================================================================
// TREND TYPES
// =============================================================================

export interface WeeklyTrend {
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

export interface DailyExpenseByCategory {
  date: string
  category: string
  amount: number
  is_system: boolean
  expense_count: number
}

// =============================================================================
// FUNNEL TYPES
// =============================================================================

export interface FunnelStageData {
  id: FunnelStage
  name: string
  color: string
  count: number
  conversionRate?: number | null
}

// =============================================================================
// SKOOL TYPES
// =============================================================================

export interface SkoolDataset {
  totalMembers: number
  activeMembers: number
  communityActivity: number
  categoryRank: number | null
  category: string | null
  aboutPageVisits: number
  conversionRate: number
  snapshotDate: string
  mrr: number
  mrrRetention: number
  paidMembers: number
}

// =============================================================================
// DATASET RESPONSE TYPE
// =============================================================================

export interface KPIDataset {
  aggregates: {
    daily: DailyAggregate[]
    bySource: Record<string, DailyAggregate[]>
    byCampaign: Record<string, DailyAggregate[]>
    all: DailyAggregate[]
  }
  dimensions: {
    sources: DimensionSource[]
    stages: DimensionStage[]
    campaigns: DimensionCampaign[]
    expenseCategories: DimensionExpenseCategory[]
  }
  funnel: {
    stages: FunnelStageData[]
    totalContacts: number
    overallConversion: number
  }
  weeklyTrends: {
    overall: WeeklyTrend[]
    bySource: Record<string, WeeklyTrend[]>
  }
  expenses: {
    byCategory: Record<string, DailyExpenseByCategory[]>
    dailyTotal: { date: string; amount: number }[]
    categories: DimensionExpenseCategory[]
  }
  skool: SkoolDataset | null
  meta: {
    generatedAt: string
    periodStart: string
    periodEnd: string
    daysIncluded: number
    aggregateCount: number
    contactCount: number
  }
}

// =============================================================================
// FILTER TYPES
// =============================================================================

export interface KPIFilters {
  dateRange: {
    startDate: string
    endDate: string
  }
  sources: string[]
  campaigns: string[]
  expenseCategories: string[]
}

// =============================================================================
// DERIVED METRICS TYPES
// =============================================================================

export interface DerivedMetrics {
  current: AggregatedTotals
  previous: AggregatedTotals
  changes: {
    revenue: { value: number; change: number; trend: 'up' | 'down' | 'neutral' }
    leads: { value: number; change: number; trend: 'up' | 'down' | 'neutral' }
    clients: { value: number; change: number; trend: 'up' | 'down' | 'neutral' }
    fundedAmount: { value: number; change: number; trend: 'up' | 'down' | 'neutral' }
    costPerLead: { value: number; change: number; trend: 'up' | 'down' | 'neutral' }
    costPerClient: { value: number; change: number; trend: 'up' | 'down' | 'neutral' }
  }
  sparklines: {
    revenue: number[]
    leads: number[]
    clients: number[]
    fundedAmount: number[]
    costPerLead: number[]
    costPerClient: number[]
  }
}
