import { NextResponse } from 'next/server'
import { db, eq, and } from '@0ne/db/server'
import { adMetrics, campaigns, metaAccountDaily, expenses } from '@0ne/db/server'
import { SyncLogger } from '@/lib/sync-log'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

interface MetaInsightsResponse {
  data: Array<{
    date_start: string
    date_stop: string
    spend: string
    impressions: string
    clicks: string
    cpm: string
    cpc: string
    ctr: string
    reach?: string
    frequency?: string
    unique_clicks?: string
    inline_link_clicks?: string
    actions?: Array<{ action_type?: string; value?: string }>
    cost_per_action_type?: Array<{ action_type?: string; value?: string }>
    purchase_roas?: Array<{ action_type?: string; value?: string }>
    campaign_id?: string
    campaign_name?: string
    adset_id?: string
    adset_name?: string
    ad_id?: string
    ad_name?: string
  }>
  paging?: {
    cursors: {
      before: string
      after: string
    }
    next?: string
  }
}

async function fetchPagedInsights(startUrl: string, maxPages: number) {
  const all: MetaInsightsResponse['data'] = []
  let nextUrl: string | undefined = startUrl
  let pageCount = 0

  while (nextUrl && pageCount < maxPages) {
    const response = await fetch(nextUrl)

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Meta API error: ${response.status} - ${error}`)
    }

    const insights: MetaInsightsResponse = await response.json()
    pageCount += 1
    all.push(...insights.data)
    nextUrl = insights.paging?.next
  }

  if (pageCount >= maxPages) {
    console.warn('Meta sync stopped early due to page limit.')
  }

  return all
}

function sumActionValues(
  items: Array<{ action_type?: string; value?: string }> | undefined,
  actionTypes: string[]
) {
  if (!items || items.length === 0) return 0
  return items.reduce((sum, item) => {
    if (item.action_type && actionTypes.includes(item.action_type)) {
      return sum + (parseFloat(item.value || '0') || 0)
    }
    return sum
  }, 0)
}

function getActionValue(
  items: Array<{ action_type?: string; value?: string }> | undefined,
  actionTypes: string[]
) {
  if (!items || items.length === 0) return 0
  const match = items.find((item) => item.action_type && actionTypes.includes(item.action_type))
  return match ? (parseFloat(match.value || '0') || 0) : 0
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accessToken = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID

  if (!accessToken || !adAccountId) {
    return NextResponse.json(
      { error: 'Meta credentials not configured' },
      { status: 400 }
    )
  }

  const { searchParams } = new URL(request.url)
  const backfill = searchParams.get('backfill') === 'true'
  const startDateParam = searchParams.get('startDate')
  const endDateParam = searchParams.get('endDate')
  const daysParam = searchParams.get('days')

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const defaultDateStr = yesterday.toISOString().split('T')[0]

  let startDate = startDateParam
  let endDate = endDateParam || defaultDateStr

  if (backfill && !startDate) {
    const days = Math.max(1, parseInt(daysParam || '90', 10))
    const start = new Date()
    start.setDate(start.getDate() - days)
    startDate = start.toISOString().split('T')[0]
  }

  if (!startDate) {
    startDate = defaultDateStr
  }

  // Start sync logging
  const syncLog = new SyncLogger('meta')
  await syncLog.start({ backfill, startDate, endDate })

  try {

    const insightsUrl = new URL(
      `https://graph.facebook.com/v18.0/${adAccountId}/insights`
    )
    insightsUrl.searchParams.set('access_token', accessToken)
    insightsUrl.searchParams.set('level', 'ad')
    insightsUrl.searchParams.set('time_range', JSON.stringify({
      since: startDate,
      until: endDate,
    }))
    insightsUrl.searchParams.set('time_increment', '1')
    insightsUrl.searchParams.set('limit', '500')
    // Match Ads Manager defaults: 7-day click / 1-day view attribution
    insightsUrl.searchParams.set('action_attribution_windows', '["7d_click","1d_view"]')
    insightsUrl.searchParams.set('action_report_time', 'conversion')
    insightsUrl.searchParams.set(
      'fields',
      [
        'campaign_id',
        'campaign_name',
        'adset_id',
        'adset_name',
        'ad_id',
        'ad_name',
        'spend',
        'impressions',
        'clicks',
        'cpm',
        'cpc',
        'ctr',
        'reach',
        'frequency',
        'unique_clicks',
        'inline_link_clicks',
        'actions',
        'cost_per_action_type',
        'purchase_roas',
      ].join(',')
    )

    let synced = 0
    let errors = 0

    const adInsights = await fetchPagedInsights(insightsUrl.toString(), 200)

    for (const insight of adInsights) {
      try {
        let campaignId = null

        if (insight.campaign_name) {
          const [campaign] = await db
            .select({ id: campaigns.id })
            .from(campaigns)
            .where(eq(campaigns.name, insight.campaign_name))
            .limit(1)

          if (campaign) {
            campaignId = campaign.id
          }
        }

        const landingPageViews = sumActionValues(insight.actions, ['landing_page_view'])
        // Match Ads Manager "Results" for complete_registration
        const completedRegistrations = sumActionValues(insight.actions, [
          'complete_registration',
        ])
        const conversions = completedRegistrations
        const costPerConversion = getActionValue(insight.cost_per_action_type, [
          'complete_registration',
        ])
        const roas = getActionValue(insight.purchase_roas, [
          'omni_purchase',
          'purchase',
          'offsite_conversion.fb_pixel_purchase',
        ])

        const record = {
          date: insight.date_start,
          platform: 'meta',
          campaignId: campaignId,
          campaignMetaId: insight.campaign_id || null,
          campaignName: insight.campaign_name || null,
          adsetId: insight.adset_id || null,
          adsetName: insight.adset_name || null,
          adId: insight.ad_id || null,
          adName: insight.ad_name || null,
          spend: parseFloat(insight.spend) || 0,
          impressions: parseInt(insight.impressions) || 0,
          clicks: parseInt(insight.clicks) || 0,
          reach: parseInt(insight.reach || '0') || 0,
          frequency: parseFloat(insight.frequency || '0') || 0,
          uniqueClicks: parseInt(insight.unique_clicks || '0') || 0,
          linkClicks: parseInt(insight.inline_link_clicks || '0') || 0,
          landingPageViews,
          completedRegistrations,
          conversions,
          costPerConversion,
          roas,
          cpm: parseFloat(insight.cpm) || 0,
          cpc: parseFloat(insight.cpc) || 0,
          ctr: parseFloat(insight.ctr) || 0,
        }

        await db
          .insert(adMetrics)
          .values(record)
          .onConflictDoUpdate({
            target: [adMetrics.date, adMetrics.platform, adMetrics.adsetId, adMetrics.adId],
            set: {
              campaignId: record.campaignId,
              campaignMetaId: record.campaignMetaId,
              campaignName: record.campaignName,
              adsetName: record.adsetName,
              adName: record.adName,
              spend: record.spend,
              impressions: record.impressions,
              clicks: record.clicks,
              reach: record.reach,
              frequency: record.frequency,
              uniqueClicks: record.uniqueClicks,
              linkClicks: record.linkClicks,
              landingPageViews: record.landingPageViews,
              completedRegistrations: record.completedRegistrations,
              conversions: record.conversions,
              costPerConversion: record.costPerConversion,
              roas: record.roas,
              cpm: record.cpm,
              cpc: record.cpc,
              ctr: record.ctr,
            },
          })

        synced++
      } catch (insightError) {
        console.error('Error processing insight:', insightError)
        errors++
      }
    }

    const accountUrl = new URL(
      `https://graph.facebook.com/v18.0/${adAccountId}/insights`
    )
    accountUrl.searchParams.set('access_token', accessToken)
    accountUrl.searchParams.set('time_range', JSON.stringify({
      since: startDate,
      until: endDate,
    }))
    accountUrl.searchParams.set('level', 'account')
    accountUrl.searchParams.set('time_increment', '1')
    accountUrl.searchParams.set('limit', '500')
    accountUrl.searchParams.set('action_attribution_windows', '["7d_click","1d_view"]')
    accountUrl.searchParams.set('action_report_time', 'conversion')
    accountUrl.searchParams.set(
      'fields',
      [
        'spend',
        'impressions',
        'clicks',
        'reach',
        'frequency',
        'unique_clicks',
      ].join(',')
    )

    const accountInsights = await fetchPagedInsights(accountUrl.toString(), 50)

    for (const insight of accountInsights) {
      try {
        const accountRecord = {
          date: insight.date_start,
          platform: 'meta',
          reach: parseInt(insight.reach || '0') || 0,
          frequency: parseFloat(insight.frequency || '0') || 0,
          uniqueClicks: parseInt(insight.unique_clicks || '0') || 0,
          impressions: parseInt(insight.impressions) || 0,
          clicks: parseInt(insight.clicks) || 0,
          spend: parseFloat(insight.spend) || 0,
        }

        await db
          .insert(metaAccountDaily)
          .values(accountRecord)
          .onConflictDoUpdate({
            target: [metaAccountDaily.date, metaAccountDaily.platform],
            set: {
              reach: accountRecord.reach,
              frequency: accountRecord.frequency,
              uniqueClicks: accountRecord.uniqueClicks,
              impressions: accountRecord.impressions,
              clicks: accountRecord.clicks,
              spend: accountRecord.spend,
            },
          })
      } catch (accountUpsertError) {
        console.error('Meta account daily upsert error:', accountUpsertError)
        errors++
      }
    }

    // ============================================
    // Sync Facebook Ads expenses (daily entries)
    // Creates expense entries for each day's ad spend
    // ============================================
    let expensesSynced = 0
    let expensesErrors = 0

    for (const insight of accountInsights) {
      const dailySpend = parseFloat(insight.spend) || 0
      const syncDate = insight.date_start

      // Skip days with no spend
      if (dailySpend <= 0) continue

      try {
        // Check if expense already exists for this date
        const [existing] = await db
          .select({ id: expenses.id })
          .from(expenses)
          .where(and(
            eq(expenses.category, 'Facebook Ads'),
            eq(expenses.metaSyncDate, syncDate),
            eq(expenses.isSystem, true),
          ))
          .limit(1)

        if (existing) {
          // Update existing expense
          await db
            .update(expenses)
            .set({
              amount: dailySpend,
              name: `Facebook Ads - ${syncDate}`,
            })
            .where(eq(expenses.id, existing.id))

          expensesSynced++
        } else {
          // Insert new expense
          await db
            .insert(expenses)
            .values({
              name: `Facebook Ads - ${syncDate}`,
              category: 'Facebook Ads',
              amount: dailySpend,
              frequency: 'one_time',
              expenseDate: syncDate,
              isActive: true,
              isSystem: true,
              metaSyncDate: syncDate,
            })

          expensesSynced++
        }
      } catch (expError) {
        console.error('Error syncing Facebook Ads expense:', expError)
        expensesErrors++
      }
    }

    // Complete sync logging
    await syncLog.complete(synced, {
      errors,
      expenses: { synced: expensesSynced, errors: expensesErrors },
    })

    return NextResponse.json({
      success: true,
      synced,
      errors,
      expenses: {
        synced: expensesSynced,
        errors: expensesErrors,
      },
      startDate,
      endDate,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Meta sync error:', error)
    await syncLog.fail(String(error))
    return NextResponse.json(
      { error: 'Meta sync failed', details: String(error) },
      { status: 500 }
    )
  }
}
