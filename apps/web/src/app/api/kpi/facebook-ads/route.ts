import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, and, or, inArray } from '@0ne/db/server'
import { adMetrics, metaAccountDaily, campaigns } from '@0ne/db/server'
import { parseDateRange, sumField } from '@/features/kpi/lib'

export const dynamic = 'force-dynamic'

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
    const { startDate, endDate } = parseDateRange(searchParams, '30d')

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

    rows.forEach((row) => {
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

      const spend = row.spend || 0
      const impressions = row.impressions || 0
      const reach = row.reach || 0
      const roas = row.roas || 0

      existing.spend += spend
      existing.impressions += impressions
      existing.clicks += row.clicks || 0
      existing.reach += reach
      existing.linkClicks += row.linkClicks || 0
      existing.uniqueClicks += row.uniqueClicks || 0
      existing.landingPageViews += row.landingPageViews || 0
      existing.completedRegistrations += row.completedRegistrations || 0
      existing.conversions += row.conversions || 0
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
      spend: sumField(rows, 'spend'),
      impressions: sumField(rows, 'impressions'),
      clicks: sumField(rows, 'clicks'),
      reach: sumField(rows, 'reach'),
      uniqueClicks: sumField(rows, 'uniqueClicks'),
      linkClicks: sumField(rows, 'linkClicks'),
      landingPageViews: sumField(rows, 'landingPageViews'),
      completedRegistrations: sumField(rows, 'completedRegistrations'),
      conversions: sumField(rows, 'conversions'),
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

    const roasWeightedSum = rows.reduce((sum, row) => {
      const spend = row.spend || 0
      const roas = row.roas || 0
      return sum + (spend > 0 ? spend * roas : 0)
    }, 0)
    const avgEarningsPerMember = parseFloat(process.env.EARNINGS_PER_MEMBER || '73.77')
    const roas = costPerCompletedRegistration > 0
      ? avgEarningsPerMember / costPerCompletedRegistration
      : 0

    const campaignMap = new Map<string, { id: string; name: string }>()

    rows.forEach((row) => {
      if (row.campaignMetaId) {
        campaignMap.set(row.campaignMetaId, {
          id: row.campaignMetaId,
          name: row.campaignName || row.campaignMetaId,
        })
      }
    })

    const campaignIdsFromRows = [...new Set(rows.map((row) => row.campaignId).filter(Boolean))] as string[]
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

    rows.forEach((row) => {
      if (row.adsetId) {
        adSetsMap.set(row.adsetId, {
          id: row.adsetId,
          name: row.adsetName || row.adsetId,
        })
      }
      if (row.adId) {
        adsMap.set(row.adId, {
          id: row.adId,
          name: row.adName || row.adId,
        })
      }
    })

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
        adSets: Array.from(adSetsMap.values()),
        ads: Array.from(adsMap.values()),
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
