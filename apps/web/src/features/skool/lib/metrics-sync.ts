/**
 * Skool Metrics — DB Read Functions
 *
 * Reads Skool group KPI snapshots from the skool_metrics table.
 * Metrics are now written by the Chrome extension via /api/extension/* endpoints.
 */

import { db, eq, desc, asc, gte } from '@0ne/db/server'
import { skoolMetrics } from '@0ne/db/server'
import { DEFAULT_GROUP } from './config'
import type { SkoolMetricsSnapshot } from './types'

/**
 * Get latest metrics for a group
 */
export async function getLatestMetrics(
  groupSlug: string = DEFAULT_GROUP.slug
): Promise<SkoolMetricsSnapshot | null> {
  const [data] = await db.select().from(skoolMetrics)
    .where(eq(skoolMetrics.groupSlug, groupSlug))
    .orderBy(desc(skoolMetrics.snapshotDate))
    .limit(1)

  if (!data) {
    return null
  }

  return {
    groupSlug: data.groupSlug || '',
    snapshotDate: data.snapshotDate || '',
    membersTotal: data.membersTotal,
    membersActive: data.membersActive,
    communityActivity: data.communityActivity ?? null,
    category: data.category,
    categoryRank: data.categoryRank,
    aboutPageVisits: data.aboutPageVisits,
    conversionRate: data.conversionRate ?? null,
  }
}

/**
 * Get metrics history for a group
 */
export async function getMetricsHistory(
  groupSlug: string = DEFAULT_GROUP.slug,
  days: number = 30
): Promise<SkoolMetricsSnapshot[]> {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const startDateStr = startDate.toISOString().split('T')[0]

  const data = await db.select().from(skoolMetrics)
    .where(eq(skoolMetrics.groupSlug, groupSlug))
    .orderBy(asc(skoolMetrics.snapshotDate))

  // Filter by date in JS since snapshotDate is a date type
  const filtered = data.filter((d) => (d.snapshotDate || '') >= startDateStr)

  return filtered.map((d) => ({
    groupSlug: d.groupSlug || '',
    snapshotDate: d.snapshotDate || '',
    membersTotal: d.membersTotal,
    membersActive: d.membersActive,
    communityActivity: d.communityActivity ?? null,
    category: d.category,
    categoryRank: d.categoryRank,
    aboutPageVisits: d.aboutPageVisits,
    conversionRate: d.conversionRate ?? null,
  }))
}
