/**
 * Daily Snapshot Generator
 *
 * Fetches configured metrics and generates formatted content
 * for email and SMS notifications.
 */

import { db, eq, gte, lte, and, count, ilike } from '@0ne/db/server'
import { ghlTransactions, contacts, skoolMembers, adMetrics } from '@0ne/db/server'
import type { MetricsConfig } from '@0ne/db/types/notifications'
import {
  getLatestRevenueSnapshot,
  getMrrChange,
} from '@/features/skool/lib/revenue-sync'

// =============================================================================
// TYPES
// =============================================================================

export interface MetricValue {
  key: keyof MetricsConfig
  label: string
  value: number | string
  formattedValue: string
  change?: number
  changeFormatted?: string
}

export interface DailySnapshotData {
  date: string
  metrics: MetricValue[]
  summary: {
    totalRevenue?: number
    totalLeads?: number
    totalClients?: number
  }
}

export interface FormattedSnapshot {
  data: DailySnapshotData
  emailHtml: string
  emailText: string
  smsText: string
}

// =============================================================================
// FORMATTERS
// =============================================================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num)
}

function formatPercent(num: number): string {
  return `${num >= 0 ? '+' : ''}${num.toFixed(1)}%`
}

// =============================================================================
// METRIC FETCHERS
// =============================================================================

async function fetchRevenueMetrics(): Promise<{
  total: number
  recurring: number
  oneTime: number
  change: number
}> {
  // Get current month dates
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const today = now.toISOString().split('T')[0]

  // Get recurring from Skool
  const latestSnapshot = await getLatestRevenueSnapshot('fruitful')
  const recurringCurrent = latestSnapshot?.mrr || 0

  // Get previous month for comparison
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    .toISOString()
    .split('T')[0]
  const mrrChange = await getMrrChange(
    'fruitful',
    previousMonthEnd,
    today
  )

  // Get one-time from GHL transactions
  const currentTransactions = await db.select({ amount: ghlTransactions.amount })
    .from(ghlTransactions)
    .where(and(
      eq(ghlTransactions.status, 'succeeded'),
      gte(ghlTransactions.transactionDate, startOfMonth),
      lte(ghlTransactions.transactionDate, new Date(`${today}T23:59:59`))
    ))

  const oneTimeCurrent =
    currentTransactions.reduce((sum, t) => sum + (t.amount || 0), 0)

  return {
    total: recurringCurrent + oneTimeCurrent,
    recurring: recurringCurrent,
    oneTime: oneTimeCurrent,
    change: mrrChange.changePercent || 0,
  }
}

async function fetchLeadsMetrics(): Promise<{
  count: number
  change: number
}> {
  // Count contacts created this month
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [{ count: currentCount }] = await db.select({ count: count() }).from(contacts)
    .where(gte(contacts.createdAt, startOfMonth))

  // Previous month for comparison
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const endOfPrevMonth = new Date(`${new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]}T23:59:59`)

  const [{ count: prevCount }] = await db.select({ count: count() }).from(contacts)
    .where(and(
      gte(contacts.createdAt, startOfPrevMonth),
      lte(contacts.createdAt, endOfPrevMonth)
    ))

  const current = currentCount || 0
  const previous = prevCount || 0
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0

  return { count: current, change }
}

async function fetchClientsMetrics(): Promise<{
  count: number
  vip: number
  premium: number
}> {
  const [{ count: vipCount }] = await db.select({ count: count() }).from(contacts)
    .where(eq(contacts.currentStage, 'vip'))

  const [{ count: premiumCount }] = await db.select({ count: count() }).from(contacts)
    .where(eq(contacts.currentStage, 'premium'))

  return {
    count: (vipCount || 0) + (premiumCount || 0),
    vip: vipCount || 0,
    premium: premiumCount || 0,
  }
}

async function fetchSkoolMetrics(): Promise<{
  members: number
  payingMembers: number
  conversion: number
  retention: number
}> {
  const latestSnapshot = await getLatestRevenueSnapshot('fruitful')

  const [{ count: totalMembers }] = await db.select({ count: count() }).from(skoolMembers)
    .where(eq(skoolMembers.groupSlug, 'fruitful'))

  const payingMembers = latestSnapshot?.payingMembers || 0
  const members = totalMembers || 0

  return {
    members,
    payingMembers,
    conversion: members > 0 ? (payingMembers / members) * 100 : 0,
    retention: latestSnapshot?.retentionRate || 0,
  }
}

async function fetchFundedAmount(): Promise<{
  amount: number
  count: number
}> {
  // This would need to be implemented based on your funding tracking
  // For now, returning placeholder based on GHL transactions
  const fundingTransactions = await db.select({ amount: ghlTransactions.amount })
    .from(ghlTransactions)
    .where(and(
      eq(ghlTransactions.status, 'succeeded'),
      ilike(ghlTransactions.entitySourceName, '%funding%')
    ))

  const amount =
    fundingTransactions.reduce((sum, t) => sum + (t.amount || 0), 0)
  const txCount = fundingTransactions.length

  return { amount, count: txCount }
}

async function fetchAdSpend(): Promise<{
  spend: number
  costPerLead: number
}> {
  // Get current month dates
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split('T')[0]
  const today = now.toISOString().split('T')[0]

  // Aggregate ad spend from ad_metrics table (MTD)
  const adMetricsData = await db.select({ spend: adMetrics.spend })
    .from(adMetrics)
    .where(and(
      gte(adMetrics.date, startOfMonth),
      lte(adMetrics.date, today)
    ))

  const totalSpend =
    adMetricsData.reduce((sum, m) => sum + (m.spend || 0), 0)

  // Get leads count for cost per lead calculation
  const leads = await fetchLeadsMetrics()
  const costPerLead = leads.count > 0 ? totalSpend / leads.count : 0

  return { spend: totalSpend, costPerLead }
}

// =============================================================================
// MAIN GENERATOR
// =============================================================================

/**
 * Generate a daily snapshot based on the user's metrics configuration
 */
export async function generateDailySnapshot(
  metricsConfig: MetricsConfig
): Promise<FormattedSnapshot> {
  const metrics: MetricValue[] = []
  const today = new Date().toISOString().split('T')[0]

  // Fetch only enabled metrics
  if (metricsConfig.revenue) {
    const revenue = await fetchRevenueMetrics()
    metrics.push({
      key: 'revenue',
      label: 'Total Revenue (MTD)',
      value: revenue.total,
      formattedValue: formatCurrency(revenue.total),
      change: revenue.change,
      changeFormatted: formatPercent(revenue.change),
    })
  }

  if (metricsConfig.leads) {
    const leads = await fetchLeadsMetrics()
    metrics.push({
      key: 'leads',
      label: 'New Leads (MTD)',
      value: leads.count,
      formattedValue: formatNumber(leads.count),
      change: leads.change,
      changeFormatted: formatPercent(leads.change),
    })
  }

  if (metricsConfig.clients) {
    const clients = await fetchClientsMetrics()
    metrics.push({
      key: 'clients',
      label: 'Active Clients',
      value: clients.count,
      formattedValue: `${formatNumber(clients.count)} (${clients.vip} VIP, ${clients.premium} Premium)`,
    })
  }

  if (metricsConfig.fundedAmount) {
    const funded = await fetchFundedAmount()
    metrics.push({
      key: 'fundedAmount',
      label: 'Total Funded',
      value: funded.amount,
      formattedValue: `${formatCurrency(funded.amount)} (${funded.count} deals)`,
    })
  }

  if (metricsConfig.skoolMembers) {
    const skool = await fetchSkoolMetrics()
    metrics.push({
      key: 'skoolMembers',
      label: 'Skool Members',
      value: skool.members,
      formattedValue: `${formatNumber(skool.members)} (${skool.payingMembers} paying)`,
    })
  }

  if (metricsConfig.skoolConversion) {
    const skool = await fetchSkoolMetrics()
    metrics.push({
      key: 'skoolConversion',
      label: 'Skool Conversion',
      value: skool.conversion,
      formattedValue: `${skool.conversion.toFixed(1)}%`,
    })
  }

  if (metricsConfig.adSpend) {
    const ads = await fetchAdSpend()
    metrics.push({
      key: 'adSpend',
      label: 'Ad Spend (MTD)',
      value: ads.spend,
      formattedValue: formatCurrency(ads.spend),
    })
  }

  if (metricsConfig.costPerLead) {
    const ads = await fetchAdSpend()
    metrics.push({
      key: 'costPerLead',
      label: 'Cost Per Lead',
      value: ads.costPerLead,
      formattedValue: formatCurrency(ads.costPerLead),
    })
  }

  const data: DailySnapshotData = {
    date: today,
    metrics,
    summary: {},
  }

  // Generate formatted outputs
  const emailHtml = generateEmailHtml(data)
  const emailText = generateEmailText(data)
  const smsText = generateSmsText(data)

  return {
    data,
    emailHtml,
    emailText,
    smsText,
  }
}

// =============================================================================
// OUTPUT FORMATTERS
// =============================================================================

function generateEmailHtml(data: DailySnapshotData): string {
  const metricsHtml = data.metrics
    .map(
      (m) => `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
          <strong>${m.label}</strong>
        </td>
        <td style="padding: 12px 0; border-bottom: 1px solid #eee; text-align: right;">
          ${m.formattedValue}
          ${m.changeFormatted ? `<span style="color: ${m.change && m.change >= 0 ? '#22c55e' : '#ef4444'}; font-size: 12px;"> (${m.changeFormatted})</span>` : ''}
        </td>
      </tr>
    `
    )
    .join('')

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f6f5f3; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
        <h1 style="color: #22201D; margin: 0 0 8px 0; font-size: 24px;">Daily KPI Snapshot</h1>
        <p style="color: #666; margin: 0 0 24px 0; font-size: 14px;">${new Date(data.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>

        <table style="width: 100%; border-collapse: collapse;">
          ${metricsHtml}
        </table>

        <p style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; color: #999; font-size: 12px;">
          Sent from your 0ne Dashboard
        </p>
      </div>
    </body>
    </html>
  `
}

function generateEmailText(data: DailySnapshotData): string {
  const dateStr = new Date(data.date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const metricsText = data.metrics
    .map((m) => {
      let line = `${m.label}: ${m.formattedValue}`
      if (m.changeFormatted) {
        line += ` (${m.changeFormatted})`
      }
      return line
    })
    .join('\n')

  return `Daily KPI Snapshot - ${dateStr}
=====================================

${metricsText}

--
Sent from your 0ne Dashboard`
}

function generateSmsText(data: DailySnapshotData): string {
  // SMS needs to be concise - prioritize key metrics
  const priorityMetrics = data.metrics.filter((m) =>
    ['revenue', 'leads', 'clients'].includes(m.key)
  )

  const lines = priorityMetrics.map((m) => {
    const shortLabel = m.label.replace(' (MTD)', '').replace('Total ', '')
    let line = `${shortLabel}: ${m.formattedValue}`
    if (m.changeFormatted) {
      line += ` ${m.changeFormatted}`
    }
    return line
  })

  const date = new Date(data.date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  return `0ne Daily (${date})\n${lines.join('\n')}`
}
