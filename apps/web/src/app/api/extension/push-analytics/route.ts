import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServerClient } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-Id',
}

/**
 * OPTIONS /api/extension/push-analytics
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

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
// Auth Helper (Supports both Clerk and API key)
// =============================================

interface AuthResult {
  valid: boolean
  authType: 'clerk' | 'apiKey' | null
  userId?: string
  skoolUserId?: string
  error?: string
}

async function validateExtensionAuth(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return { valid: false, authType: null, error: 'Missing Authorization header' }
  }

  // Check for Clerk auth first (Clerk <token>)
  if (authHeader.startsWith('Clerk ')) {
    try {
      const { userId } = await auth()
      if (userId) {
        const client = await clerkClient()
        const user = await client.users.getUser(userId)
        const skoolUserId = (user.publicMetadata?.skoolUserId as string) || undefined

        return { valid: true, authType: 'clerk', userId, skoolUserId }
      }
      return { valid: false, authType: 'clerk', error: 'Invalid or expired Clerk session' }
    } catch {
      return { valid: false, authType: 'clerk', error: 'Failed to validate Clerk session' }
    }
  }

  // Check for Bearer token (API key)
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) {
    const expectedKey = process.env.EXTENSION_API_KEY
    if (!expectedKey) {
      console.error('[Extension API] EXTENSION_API_KEY environment variable not set')
      return { valid: false, authType: 'apiKey', error: 'Server configuration error' }
    }

    if (bearerMatch[1] === expectedKey) {
      return { valid: true, authType: 'apiKey' }
    }
    return { valid: false, authType: 'apiKey', error: 'Invalid API key' }
  }

  return { valid: false, authType: null, error: 'Invalid Authorization header format' }
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

    const supabase = createServerClient()
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

        const analyticsRow = {
          staff_skool_id: staffSkoolId,
          group_id: metric.groupId,
          post_id: metric.postId || null,
          metric_type: metric.metricType,
          metric_value: metric.metricValue,
          metric_date: metricDate,
          raw_data: metric.rawData || null,
        }

        // Insert first, handle duplicate via update fallback
        // (Can't use upsert because the unique index uses COALESCE(post_id, '') expression)
        const { error } = await supabase
          .from('skool_analytics')
          .insert(analyticsRow)

        if (error) {
          if (error.code === '23505') {
            // Duplicate - update existing record
            const updateQuery = supabase
              .from('skool_analytics')
              .update({
                metric_value: metric.metricValue,
                raw_data: metric.rawData || null,
                recorded_at: new Date().toISOString(),
              })
              .eq('staff_skool_id', staffSkoolId)
              .eq('group_id', metric.groupId)
              .eq('metric_type', metric.metricType)
              .eq('metric_date', metricDate)

            // Handle post_id NULL vs value
            if (metric.postId) {
              updateQuery.eq('post_id', metric.postId)
            } else {
              updateQuery.is('post_id', null)
            }

            const { error: updateError } = await updateQuery

            if (updateError) {
              console.error(`[Extension API] Error updating metric:`, updateError)
              errors.push(`Metric ${metric.metricType}: ${updateError.message}`)
            } else {
              updated++
            }
          } else {
            console.error(`[Extension API] Error inserting metric:`, error)
            errors.push(`Metric ${metric.metricType}: ${error.message}`)
          }
        } else {
          synced++
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
          const { error: dailyError } = await supabase
            .from('skool_members_daily')
            .upsert({
              group_slug: entry.groupId,
              date,
              total_members: entry.total,
              active_members: entry.active ?? null,
              new_members: newMembers != null && newMembers >= 0 ? newMembers : null,
              source: 'extension',
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'group_slug,date',
            })

          if (dailyError) {
            console.error(`[Extension API] Error upserting members_daily for ${date}:`, dailyError)
          } else {
            membersDaily++
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
        const { error: monthlyError } = await supabase
          .from('skool_members_monthly')
          .upsert({
            group_slug: entry.groupId,
            month: dateKey,
            new_members: entry.new_members,
            existing_members: entry.existing_members,
            churned_members: entry.churned_members,
            total_members: entry.total_members,
            source: 'extension',
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'group_slug,month',
          })

        if (monthlyError) {
          console.error(`[Extension API] Error upserting members_monthly for ${dateKey}:`, monthlyError)
        } else {
          monthlyUpserted++
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

        const { error: actError } = await supabase
          .from('skool_community_activity_daily')
          .upsert({
            group_slug: m.groupId,
            date: dateKey,
            activity_count: m.metricValue,
            daily_active_members: activeByDate.get(dateKey) ?? null,
            source: 'extension',
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'group_slug,date',
          })

        if (actError) {
          console.error(`[Extension API] Error upserting activity_daily for ${dateKey}:`, actError)
        } else {
          activityDaily++
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

        const { error: aboutError } = await supabase
          .from('skool_about_page_daily')
          .upsert({
            group_slug: m.groupId,
            date: dateKey,
            visitors: m.metricValue,
            conversion_rate: convRate != null ? Math.round(convRate * 10000) / 100 : null,
          }, {
            onConflict: 'group_slug,date',
          })

        if (aboutError) {
          console.error(`[Extension API] Error upserting about_page_daily for ${dateKey}:`, aboutError)
        } else {
          aboutDaily++
        }
      }
      if (aboutDaily > 0) {
        console.log(`[Extension API] Synced ${aboutDaily} days to skool_about_page_daily`)
      }
    }

    // Sync snapshot to skool_metrics (one row per day per group)
    // Collect today's aggregate metrics for the snapshot
    const today = new Date().toISOString().split('T')[0]
    const snapshotMetrics: Record<string, Record<string, number>> = {}
    for (const m of metrics) {
      if (m.metricDate !== today) continue
      // Only aggregate non-daily metrics for snapshot
      if (m.metricType.startsWith('daily_')) continue
      if (!snapshotMetrics[m.groupId]) snapshotMetrics[m.groupId] = {}
      snapshotMetrics[m.groupId][m.metricType] = m.metricValue
    }

    for (const [groupId, snap] of Object.entries(snapshotMetrics)) {
      const snapshotRow: Record<string, unknown> = {
        group_slug: groupId,
        snapshot_date: today,
      }
      if (snap.overview_num_members != null) snapshotRow.members_total = snap.overview_num_members
      if (snap.latest_active_members != null) snapshotRow.members_active = snap.latest_active_members
      if (snap.overview_mrr != null) snapshotRow.members_active // MRR not in schema, skip
      if (snap.overview_conversion != null) snapshotRow.conversion_rate = Math.round(snap.overview_conversion * 10000) / 100
      if (snap.overview_retention != null) snapshotRow.community_activity = Math.round(snap.overview_retention * 10000) / 100
      if (snap.discovery_category_rank != null) snapshotRow.category_rank = snap.discovery_category_rank

      // Only upsert if we have at least one meaningful field
      if (Object.keys(snapshotRow).length > 2) {
        const { error: snapError } = await supabase
          .from('skool_metrics')
          .upsert(snapshotRow, {
            onConflict: 'group_slug,snapshot_date',
          })

        if (snapError) {
          console.error(`[Extension API] Error upserting skool_metrics for ${groupId}:`, snapError)
        } else {
          console.log(`[Extension API] Synced skool_metrics snapshot for ${groupId} on ${today}`)
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
