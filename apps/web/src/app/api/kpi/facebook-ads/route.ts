import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, and, or, inArray } from '@0ne/db/server'
import { adMetrics, metaAccountDaily, campaigns } from '@0ne/db/server'

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

  const period = searchParams.get('period') || 'mtd'
  return getDateRangeFromPeriod(period)
}

function sumField(rows: Array<Record<string, unknown>>, field: string) {
  return rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaign')
    const adsetId = searchParams.get('adset')
    const adId = searchParams.get('ad')
    const campaignsParam = searchParams.get('campaigns')
    const adsetsParam = searchParams.get('adsets')
    const adsParam = searchParams.get('ads')
    const period = searchParams.get('period') || 'mtd'
    const { startDate, endDate } = parseDateRange(searchParams)

    const campaignIds = campaignsParam ? campaignsParam.split(',').filter(Boolean) : []
    const adsetIds = adsetsParam ? adsetsParam.split(',').filter(Boolean) : []
    const adIds = adsParam ? adsParam.split(',').filter(Boolean) : []

    // Build filter conditions
    const filters = [
      eq(adMetrics.platform, 'meta'),
      gte(adMetrics.date, startDate),
      lte(adMetrics.date, endDate),
    ]

    if (campaignIds.length > 0) {
      const campaignMetaIds = campaignIds.filter((id) => /^\d+$/.test(id))
      const campaignUuidIds = campaignIds.filter((id) => !/^\d+$/.test(id))

      if (campaignMetaIds.length > 0 && campaignUuidIds.length > 0) {
        filters.push(
          or(
            inArray(adMetrics.campaignMetaId, campaignMetaIds),
            inArray(adMetrics.campaignId, campaignUuidIds),
          )!
        )
      } else if (campaignMetaIds.length > 0) {
        filters.push(inArray(adMetrics.campaignMetaId, campaignMetaIds))
      } else if (campaignUuidIds.length > 0) {
        filters.push(inArray(adMetrics.campaignId, campaignUuidIds))
      }
    } else if (campaignId && campaignId !== 'all') {
      filters.push(eq(adMetrics.campaignId, campaignId))
    }
    if (adsetIds.length > 0) {
      filters.push(inArray(adMetrics.adsetId, adsetIds))
    } else if (adsetId && adsetId !== 'all') {
      filters.push(eq(adMetrics.adsetId, adsetId))
    }
    if (adIds.length > 0) {
      filters.push(inArray(adMetrics.adId, adIds))
    } else if (adId && adId !== 'all') {
      filters.push(eq(adMetrics.adId, adId))
    }

    const rows = await db
      .select()
      .from(adMetrics)
      .where(and(...filters))

    const usedLegacyColumns = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safeRows = rows as Record<string, unknown>[]

    const accountDaily = await db
      .select({
        date: metaAccountDaily.date,
        reach: metaAccountDaily.reach,
        frequency: metaAccountDaily.frequency,
        uniqueClicks: metaAccountDaily.uniqueClicks,
        impressions: metaAccountDaily.impressions,
        clicks: metaAccountDaily.clicks,
        spend: metaAccountDaily.spend,
      })
      .from(metaAccountDaily)
      .where(
        and(
          eq(metaAccountDaily.platform, 'meta'),
          gte(metaAccountDaily.date, startDate),
          lte(metaAccountDaily.date, endDate),
        )
      )

    const accountDailyMap = new Map(
      accountDaily.map((row) => [
        row.date as string,
        {
          reach: row.reach || 0,
          frequency: row.frequency || 0,
          uniqueClicks: row.uniqueClicks || 0,
          impressions: row.impressions || 0,
          clicks: row.clicks || 0,
          spend: row.spend || 0,
        },
      ])
    )

    const accountImpressionsTotal = accountDaily.reduce((sum, row) => sum + (row.impressions || 0), 0)

    const dailyMap = new Map<string, Record<string, number>>()

    safeRows.forEach((row) => {
      const date = row.date as string
      const existing = dailyMap.get(date) || {
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        linkClicks: 0,
        uniqueClicks: 0,
        landingPageViews: 0,
        completedRegistrations: 0,
        conversions: 0,
        roasSpendWeighted: 0,
      }

      const spend = Number(row.spend) || 0
      const impressions = Number(row.impressions) || 0
      const reach = Number(row.reach) || 0
      const roas = Number(row.roas) || 0

      existing.spend += spend
      existing.impressions += impressions
      existing.clicks += Number(row.clicks) || 0
      existing.reach += reach
      existing.linkClicks += Number(row.link_clicks) || 0
      existing.uniqueClicks += Number(row.unique_clicks) || 0
      existing.landingPageViews += Number(row.landing_page_views) || 0
      existing.completedRegistrations += Number(row.completed_registrations) || 0
      existing.conversions += Number(row.conversions) || 0
      existing.roasSpendWeighted += spend > 0 ? spend * roas : 0

      dailyMap.set(date, existing)
    })

    const daily = Array.from(dailyMap.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([date, values]) => {
        const accountDailyRow = accountDailyMap.get(date)
        const impressions = accountDailyRow?.impressions ?? values.impressions
        const clicks = accountDailyRow?.clicks ?? values.clicks
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
        const cpc = values.clicks > 0 ? values.spend / values.clicks : 0
        const cpm = impressions > 0 ? (values.spend / impressions) * 1000 : 0
        const frequency = accountDailyRow?.frequency ?? (values.reach > 0 ? values.impressions / values.reach : 0)
        const costPerCompletedRegistration = values.completedRegistrations > 0
          ? values.spend / values.completedRegistrations
          : 0
        const avgEarningsPerMember = parseFloat(process.env.EARNINGS_PER_MEMBER || '73.77')
        const roas = costPerCompletedRegistration > 0
          ? avgEarningsPerMember / costPerCompletedRegistration
          : 0

        return {
          date,
          spend: values.spend,
          impressions,
          clicks,
          ctr,
          cpc,
          cpm,
          frequency,
          reach: accountDailyRow?.reach ?? values.reach,
          uniqueClicks: accountDailyRow?.uniqueClicks ?? values.uniqueClicks,
          linkClicks: values.linkClicks,
          landingPageViews: values.landingPageViews,
          completedRegistrations: values.completedRegistrations,
          costPerCompletedRegistration,
          conversions: values.conversions,
          costPerConversion: values.conversions > 0 ? values.spend / values.conversions : 0,
          roas,
        }
      })

    const totals = {
      spend: sumField(safeRows, 'spend'),
      impressions: sumField(safeRows, 'impressions'),
      clicks: sumField(safeRows, 'clicks'),
      reach: sumField(safeRows, 'reach'),
      uniqueClicks: sumField(safeRows, 'unique_clicks'),
      linkClicks: sumField(safeRows, 'link_clicks'),
      landingPageViews: sumField(safeRows, 'landing_page_views'),
      completedRegistrations: sumField(safeRows, 'completed_registrations'),
      conversions: sumField(safeRows, 'conversions'),
    }

    let accountSummary: {
      reach: number
      frequency: number
      uniqueClicks: number
    } | null = null

    if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
      try {
        const summaryUrl = new URL(
          `https://graph.facebook.com/v18.0/${process.env.META_AD_ACCOUNT_ID}/insights`
        )
        summaryUrl.searchParams.set('access_token', process.env.META_ACCESS_TOKEN)
        summaryUrl.searchParams.set('time_range', JSON.stringify({
          since: startDate,
          until: endDate,
        }))
        summaryUrl.searchParams.set('level', 'account')
        summaryUrl.searchParams.set('action_attribution_windows', '["7d_click","1d_view"]')
        summaryUrl.searchParams.set('action_report_time', 'conversion')
        summaryUrl.searchParams.set('fields', ['reach', 'frequency', 'unique_clicks'].join(','))

        const response = await fetch(summaryUrl.toString())
        if (response.ok) {
          const payload = await response.json() as { data?: Array<Record<string, string>> }
          const row = payload.data?.[0]
          if (row) {
            accountSummary = {
              reach: parseInt(row.reach || '0', 10) || 0,
              frequency: parseFloat(row.frequency || '0') || 0,
              uniqueClicks: parseInt(row.unique_clicks || '0', 10) || 0,
            }
          }
        }
      } catch {
        // Ignore Meta summary failures and fall back to stored data.
      }
    }

    const summaryImpressions = accountImpressionsTotal > 0 ? accountImpressionsTotal : totals.impressions
    const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0
    const ctr = summaryImpressions > 0 ? (totals.clicks / summaryImpressions) * 100 : 0
    const cpm = summaryImpressions > 0 ? (totals.spend / summaryImpressions) * 1000 : 0
    const frequency = accountSummary?.frequency
      ?? (totals.reach > 0 ? totals.impressions / totals.reach : 0)
    const costPerCompletedRegistration = totals.completedRegistrations > 0
      ? totals.spend / totals.completedRegistrations
      : 0
    const costPerConversion = totals.conversions > 0 ? totals.spend / totals.conversions : 0

    const roasWeightedSum = safeRows.reduce((sum, row) => {
      const spend = Number(row.spend) || 0
      const roas = Number(row.roas) || 0
      return sum + (spend > 0 ? spend * roas : 0)
    }, 0)
    const avgEarningsPerMember = parseFloat(process.env.EARNINGS_PER_MEMBER || '73.77')
    const roas = costPerCompletedRegistration > 0
      ? avgEarningsPerMember / costPerCompletedRegistration
      : 0

    const campaignMap = new Map<string, { id: string; name: string }>()

    if (!usedLegacyColumns) {
      safeRows.forEach((row) => {
        if (row.campaign_meta_id) {
          campaignMap.set(row.campaign_meta_id as string, {
            id: row.campaign_meta_id as string,
            name: (row.campaign_name as string) || (row.campaign_meta_id as string),
          })
        }
      })
    }

    const campaignIdsFromRows = [...new Set(safeRows.map((row) => row.campaign_id).filter(Boolean))] as string[]
    const campaignsFromDb = campaignIdsFromRows.length > 0
      ? await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(inArray(campaigns.id, campaignIdsFromRows))
      : []

    campaignsFromDb.forEach((campaign) => {
      if (!campaignMap.has(campaign.id)) {
        campaignMap.set(campaign.id, campaign)
      }
    })

    const adSetsMap = new Map<string, { id: string; name: string }>()
    const adsMap = new Map<string, { id: string; name: string }>()

    if (!usedLegacyColumns) {
      safeRows.forEach((row) => {
        if (row.adset_id) {
          adSetsMap.set(row.adset_id as string, {
            id: row.adset_id as string,
            name: (row.adset_name as string) || row.adset_id as string,
          })
        }
        if (row.ad_id) {
          adsMap.set(row.ad_id as string, {
            id: row.ad_id as string,
            name: (row.ad_name as string) || row.ad_id as string,
          })
        }
      })
    }

    return NextResponse.json({
      summary: {
        amountSpent: totals.spend,
        landingPageViews: totals.landingPageViews,
        completedRegistrations: totals.completedRegistrations,
        costPerCompletedRegistration,
        cpc,
        ctr,
        cpm,
        frequency,
        impressions: summaryImpressions,
        clicks: totals.clicks,
        linkClicks: totals.linkClicks,
        reach: accountSummary?.reach ?? totals.reach,
        uniqueClicks: accountSummary?.uniqueClicks ?? totals.uniqueClicks,
        conversions: totals.conversions,
        costPerConversion,
        roas,
      },
      daily,
      filters: {
        campaigns: Array.from(campaignMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        adSets: usedLegacyColumns ? [] : Array.from(adSetsMap.values()),
        ads: usedLegacyColumns ? [] : Array.from(adsMap.values()),
      },
      period: {
        startDate,
        endDate,
        label: period,
      },
    })
  } catch (error) {
    console.error('Facebook Ads KPI error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch Facebook Ads KPI data', details: String(error) },
      { status: 500 }
    )
  }
}
