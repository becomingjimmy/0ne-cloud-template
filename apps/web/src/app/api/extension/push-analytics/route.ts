import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, isNull } from '@0ne/db/server'
import { skoolAnalytics, skoolMembersDaily, skoolMembersMonthly, skoolCommunityActivityDaily, skoolAboutPageDaily, skoolMetrics } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * Chrome Extension Push Analytics API
 *
 * Receives analytics data captured from Skool admin dashboard
 * and stores them in the skool_analytics table.
 */

// =============================================
// Types
// =============================================

interface AnalyticsMetric {
  groupId: string
  postId?: string | null  // null for group-level metrics
  metricType: string      // 'views', 'engagement', 'comments', 'likes', 'shares', etc.
  metricValue: number
  metricDate: string      // ISO date string (YYYY-MM-DD)
  rawData?: Record<string, unknown>  // Original API response
}

interface PushAnalyticsRequest {
  staffSkoolId: string
  metrics: AnalyticsMetric[]
}

interface PushAnalyticsResponse {
  success: boolean
  synced: number   // New metrics inserted
  updated: number  // Metrics updated (on conflict)
  skipped: number  // Metrics skipped (invalid data)
  errors?: string[]
}

// =============================================
// POST /api/extension/push-analytics
// =============================================

export async function POST(request: NextRequest) {
  // Validate auth (supports both Clerk and API key)
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: PushAnalyticsRequest = await request.json()

    // If using Clerk auth and staffSkoolId not provided, use linked Skool ID
    if (authResult.authType === 'clerk' && !body.staffSkoolId && authResult.skoolUserId) {
      body.staffSkoolId = authResult.skoolUserId
    }

    // Validate request structure
    const validationError = validateRequest(body)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400, headers: corsHeaders })
    }

    const { staffSkoolId, metrics } = body

    console.log(
      `[Extension API] Received ${metrics.length} analytics metrics from user ${staffSkoolId}`
    )

    let synced = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []

    // Process each metric
    for (const metric of metrics) {
      try {
        // Validate metric data
        if (!metric.groupId?.trim()) {
          skipped++
          continue
        }

        if (!metric.metricType?.trim()) {
          skipped++
          continue
        }

        if (typeof metric.metricValue !== 'number' || isNaN(metric.metricValue)) {
          skipped++
          continue
        }

        // Parse the date - expect YYYY-MM-DD format
        let metricDate: string | null = null
        if (metric.metricDate) {
          const dateMatch = metric.metricDate.match(/^\d{4}-\d{2}-\d{2}/)
          if (dateMatch) {
            metricDate = dateMatch[0]
          }
        }

        // Default to today if no date provided
        if (!metricDate) {
          metricDate = new Date().toISOString().split('T')[0]
        }

        // Insert first, handle duplicate via update fallback
        // (Can't use upsert because the unique index uses COALESCE(post_id, '') expression)
        try {
          await db.insert(skoolAnalytics).values({
            staffSkoolId,
            groupId: metric.groupId,
            postId: metric.postId || null,
            metricType: metric.metricType,
            metricValue: metric.metricValue,
            metricDate,
            rawData: metric.rawData || null,
          })
          synced++
        } catch (insertError: unknown) {
          const errCode = (insertError as { code?: string })?.code
          if (errCode === '23505') {
            // Duplicate - update existing record
            try {
              const conditions = [
                eq(skoolAnalytics.staffSkoolId, staffSkoolId),
                eq(skoolAnalytics.groupId, metric.groupId),
                eq(skoolAnalytics.metricType, metric.metricType),
                eq(skoolAnalytics.metricDate, metricDate),
              ]

              // Handle post_id NULL vs value
              if (metric.postId) {
                conditions.push(eq(skoolAnalytics.postId, metric.postId))
              } else {
                conditions.push(isNull(skoolAnalytics.postId))
              }

              await db.update(skoolAnalytics).set({
                metricValue: metric.metricValue,
                rawData: metric.rawData || null,
                recordedAt: new Date(),
              }).where(and(...conditions))

              updated++
            } catch (updateError) {
              console.error(`[Extension API] Error updating metric:`, updateError)
              errors.push(`Metric ${metric.metricType}: ${updateError instanceof Error ? updateError.message : 'Unknown error'}`)
            }
          } else {
            console.error(`[Extension API] Error inserting metric:`, insertError)
            errors.push(`Metric ${metric.metricType}: ${insertError instanceof Error ? insertError.message : 'Unknown error'}`)
          }
        }
      } catch (metricError) {
        console.error(`[Extension API] Exception processing metric:`, metricError)
        errors.push(
          `Metric: ${metricError instanceof Error ? metricError.message : 'Unknown error'}`
        )
      }
    }

    // Sync daily member metrics to skool_members_daily table
    const dailyMemberMetrics = metrics.filter(
      (m) => m.metricType === 'daily_total_members' || m.metricType === 'daily_active_members'
    )

    if (dailyMemberMetrics.length > 0) {
      // Group by date
      const byDate = new Map<string, { total?: number; active?: number; groupId: string }>()
      for (const m of dailyMemberMetrics) {
        const dateKey = m.metricDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
        if (!dateKey) continue
        const existing = byDate.get(dateKey) || { groupId: m.groupId }
        if (m.metricType === 'daily_total_members') existing.total = m.metricValue
        if (m.metricType === 'daily_active_members') existing.active = m.metricValue
        byDate.set(dateKey, existing)
      }

      // Sort dates to calculate new_members (delta from previous day)
      const sortedDates = [...byDate.keys()].sort()
      let membersDaily = 0

      for (let i = 0; i < sortedDates.length; i++) {
        const date = sortedDates[i]
        const entry = byDate.get(date)!
        const prevDate = i > 0 ? sortedDates[i - 1] : null
        const prevEntry = prevDate ? byDate.get(prevDate) : null
        const newMembers = (entry.total != null && prevEntry?.total != null)
          ? entry.total - prevEntry.total
          : null

        if (entry.total != null) {
          try {
            await db.insert(skoolMembersDaily).values({
              groupSlug: entry.groupId,
              date,
              totalMembers: entry.total,
              activeMembers: entry.active ?? null,
              newMembers: newMembers != null && newMembers >= 0 ? newMembers : null,
              source: 'extension',
              updatedAt: new Date(),
            }).onConflictDoUpdate({
              target: [skoolMembersDaily.groupSlug, skoolMembersDaily.date],
              set: {
                totalMembers: entry.total,
                activeMembers: entry.active ?? null,
                newMembers: newMembers != null && newMembers >= 0 ? newMembers : null,
                source: 'extension',
                updatedAt: new Date(),
              },
            })
            membersDaily++
          } catch (dailyError) {
            console.error(`[Extension API] Error upserting members_daily for ${date}:`, dailyError)
          }
        }
      }

      if (membersDaily > 0) {
        console.log(`[Extension API] Synced ${membersDaily} days to skool_members_daily`)
      }
    }

    // Sync monthly member breakdown to skool_members_monthly table
    const monthlyNewMetrics = metrics.filter(
      (m) => m.metricType === 'monthly_new_members'
    )
    const monthlyExistingMetrics = metrics.filter(
      (m) => m.metricType === 'monthly_existing_members'
    )
    const monthlyChurnedMetrics = metrics.filter(
      (m) => m.metricType === 'monthly_churned_members'
    )
    const monthlyTotalMetrics = metrics.filter(
      (m) => m.metricType === 'monthly_total_members'
    )

    // Only process if we have at least total members data
    if (monthlyTotalMetrics.length > 0) {
      // Group all monthly metrics by date
      const monthlyByDate = new Map<string, { new_members: number; existing_members: number; churned_members: number; total_members: number; groupId: string }>()

      for (const m of monthlyTotalMetrics) {
        const dateKey = m.metricDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
        if (!dateKey) continue
        monthlyByDate.set(dateKey, {
          new_members: 0,
          existing_members: 0,
          churned_members: 0,
          total_members: m.metricValue,
          groupId: m.groupId,
        })
      }

      for (const m of monthlyNewMetrics) {
        const dateKey = m.metricDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
        if (!dateKey) continue
        const entry = monthlyByDate.get(dateKey)
        if (entry) entry.new_members = m.metricValue
      }

      for (const m of monthlyExistingMetrics) {
        const dateKey = m.metricDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
        if (!dateKey) continue
        const entry = monthlyByDate.get(dateKey)
        if (entry) entry.existing_members = m.metricValue
      }

      for (const m of monthlyChurnedMetrics) {
        const dateKey = m.metricDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
        if (!dateKey) continue
        const entry = monthlyByDate.get(dateKey)
        if (entry) entry.churned_members = m.metricValue
      }

      let monthlyUpserted = 0
      for (const [dateKey, entry] of monthlyByDate) {
        try {
          await db.insert(skoolMembersMonthly).values({
            groupSlug: entry.groupId,
            month: dateKey,
            newMembers: entry.new_members,
            existingMembers: entry.existing_members,
            churnedMembers: entry.churned_members,
            totalMembers: entry.total_members,
            source: 'extension',
            updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: [skoolMembersMonthly.groupSlug, skoolMembersMonthly.month],
            set: {
              newMembers: entry.new_members,
              existingMembers: entry.existing_members,
              churnedMembers: entry.churned_members,
              totalMembers: entry.total_members,
              source: 'extension',
              updatedAt: new Date(),
            },
          })
          monthlyUpserted++
        } catch (monthlyError) {
          console.error(`[Extension API] Error upserting members_monthly for ${dateKey}:`, monthlyError)
        }
      }

      if (monthlyUpserted > 0) {
        console.log(`[Extension API] Synced ${monthlyUpserted} months to skool_members_monthly`)
      }
    }

    // Sync community activity daily metrics to skool_community_activity_daily
    const activityMetrics = metrics.filter(
      (m) => m.metricType === 'daily_activity_count'
    )
    // Also grab daily_active_members for the active column
    const activeMemberMetrics = metrics.filter(
      (m) => m.metricType === 'daily_active_members'
    )
    const activeByDate = new Map<string, number>()
    for (const m of activeMemberMetrics) {
      const d = m.metricDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
      if (d) activeByDate.set(d, m.metricValue)
    }

    if (activityMetrics.length > 0) {
      let activityDaily = 0
      for (const m of activityMetrics) {
        const dateKey = m.metricDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
        if (!dateKey) continue

        try {
          await db.insert(skoolCommunityActivityDaily).values({
            groupSlug: m.groupId,
            date: dateKey,
            activityCount: m.metricValue,
            dailyActiveMembers: activeByDate.get(dateKey) ?? null,
            source: 'extension',
            updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: [skoolCommunityActivityDaily.groupSlug, skoolCommunityActivityDaily.date],
            set: {
              activityCount: m.metricValue,
              dailyActiveMembers: activeByDate.get(dateKey) ?? null,
              source: 'extension',
              updatedAt: new Date(),
            },
          })
          activityDaily++
        } catch (actError) {
          console.error(`[Extension API] Error upserting activity_daily for ${dateKey}:`, actError)
        }
      }
      if (activityDaily > 0) {
        console.log(`[Extension API] Synced ${activityDaily} days to skool_community_activity_daily`)
      }
    }

    // Sync about page daily metrics to skool_about_page_daily
    const aboutVisitorMetrics = metrics.filter(
      (m) => m.metricType === 'daily_about_visitors'
    )
    const aboutConversionMetrics = metrics.filter(
      (m) => m.metricType === 'daily_about_conversion'
    )
    const conversionByDate = new Map<string, number>()
    for (const m of aboutConversionMetrics) {
      const d = m.metricDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
      if (d) conversionByDate.set(d, m.metricValue)
    }

    if (aboutVisitorMetrics.length > 0) {
      let aboutDaily = 0
      for (const m of aboutVisitorMetrics) {
        const dateKey = m.metricDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
        if (!dateKey) continue

        const convRate = conversionByDate.get(dateKey)

        try {
          await db.insert(skoolAboutPageDaily).values({
            groupSlug: m.groupId,
            date: dateKey,
            visitors: m.metricValue,
            conversionRate: convRate != null ? Math.round(convRate * 10000) / 100 : null,
          }).onConflictDoUpdate({
            target: [skoolAboutPageDaily.groupSlug, skoolAboutPageDaily.date],
            set: {
              visitors: m.metricValue,
              conversionRate: convRate != null ? Math.round(convRate * 10000) / 100 : null,
            },
          })
          aboutDaily++
        } catch (aboutError) {
          console.error(`[Extension API] Error upserting about_page_daily for ${dateKey}:`, aboutError)
        }
      }
      if (aboutDaily > 0) {
        console.log(`[Extension API] Synced ${aboutDaily} days to skool_about_page_daily`)
      }
    }

    // Sync snapshot to skool_metrics (one row per day per group)
    // Collect today's aggregate metrics for the snapshot
    const today = new Date().toISOString().split('T')[0]
    const snapshotMetricsMap: Record<string, Record<string, number>> = {}
    for (const m of metrics) {
      if (m.metricDate !== today) continue
      // Only aggregate non-daily metrics for snapshot
      if (m.metricType.startsWith('daily_')) continue
      if (!snapshotMetricsMap[m.groupId]) snapshotMetricsMap[m.groupId] = {}
      snapshotMetricsMap[m.groupId][m.metricType] = m.metricValue
    }

    for (const [groupId, snap] of Object.entries(snapshotMetricsMap)) {
      const snapshotRow: Record<string, unknown> = {
        groupSlug: groupId,
        snapshotDate: today,
      }
      if (snap.overview_num_members != null) snapshotRow.membersTotal = snap.overview_num_members
      if (snap.latest_active_members != null) snapshotRow.membersActive = snap.latest_active_members
      if (snap.overview_conversion != null) snapshotRow.conversionRate = Math.round(snap.overview_conversion * 10000) / 100
      if (snap.overview_retention != null) snapshotRow.communityActivity = Math.round(snap.overview_retention * 10000) / 100
      if (snap.discovery_category_rank != null) snapshotRow.categoryRank = snap.discovery_category_rank

      // Only upsert if we have at least one meaningful field
      if (Object.keys(snapshotRow).length > 2) {
        try {
          await db.insert(skoolMetrics).values(snapshotRow as typeof skoolMetrics.$inferInsert)
            .onConflictDoUpdate({
              target: [skoolMetrics.groupSlug, skoolMetrics.snapshotDate],
              set: snapshotRow as Record<string, unknown>,
            })
          console.log(`[Extension API] Synced skool_metrics snapshot for ${groupId} on ${today}`)
        } catch (snapError) {
          console.error(`[Extension API] Error upserting skool_metrics for ${groupId}:`, snapError)
        }
      }
    }

    console.log(
      `[Extension API] Analytics complete: synced=${synced}, updated=${updated}, skipped=${skipped}, errors=${errors.length}`
    )

    const response: PushAnalyticsResponse = {
      success: errors.length === 0,
      synced,
      updated,
      skipped,
      ...(errors.length > 0 && { errors }),
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST analytics exception:', error)
    return NextResponse.json(
      {
        success: false,
        synced: 0,
        updated: 0,
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      } as PushAnalyticsResponse,
      { status: 500, headers: corsHeaders }
    )
  }
}

// =============================================
// Validation
// =============================================

function validateRequest(body: PushAnalyticsRequest): string | null {
  if (!body.staffSkoolId?.trim()) {
    return 'Missing required field: staffSkoolId'
  }

  if (!Array.isArray(body.metrics)) {
    return 'metrics must be an array'
  }

  if (body.metrics.length === 0) {
    return 'metrics array cannot be empty'
  }

  // Validate each metric has required fields
  for (let i = 0; i < body.metrics.length; i++) {
    const metric = body.metrics[i]
    if (!metric.groupId?.trim()) {
      return `Metric at index ${i}: missing required field "groupId"`
    }
    if (!metric.metricType?.trim()) {
      return `Metric at index ${i}: missing required field "metricType"`
    }
    if (typeof metric.metricValue !== 'number') {
      return `Metric at index ${i}: missing or invalid field "metricValue" (must be a number)`
    }
  }

  return null
}
