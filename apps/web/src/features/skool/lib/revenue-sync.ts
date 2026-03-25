/**
 * Skool Revenue — DB Read Functions
 *
 * Reads MRR and revenue snapshots from skool_revenue_daily table.
 * Revenue data is now written by the Chrome extension via /api/extension/* endpoints.
 */

import { db, eq, gte, lte, and, desc, asc } from '@0ne/db/server'
import { skoolRevenueDaily } from '@0ne/db/server'

/**
 * Get the latest revenue snapshot for a group
 */
export async function getLatestRevenueSnapshot(groupSlug: string = 'fruitful') {
  try {
    const [data] = await db
      .select()
      .from(skoolRevenueDaily)
      .where(eq(skoolRevenueDaily.groupSlug, groupSlug))
      .orderBy(desc(skoolRevenueDaily.snapshotDate))
      .limit(1)

    return data || null
  } catch (error) {
    console.error('[revenue-sync] Error fetching latest snapshot:', error)
    return null
  }
}

/**
 * Get revenue history for a date range
 */
export async function getRevenueHistory(
  groupSlug: string = 'fruitful',
  startDate: string,
  endDate: string
) {
  try {
    const data = await db
      .select()
      .from(skoolRevenueDaily)
      .where(
        and(
          eq(skoolRevenueDaily.groupSlug, groupSlug),
          gte(skoolRevenueDaily.snapshotDate, startDate),
          lte(skoolRevenueDaily.snapshotDate, endDate)
        )
      )
      .orderBy(asc(skoolRevenueDaily.snapshotDate))

    return data || []
  } catch (error) {
    console.error('[revenue-sync] Error fetching revenue history:', error)
    return []
  }
}

/**
 * Get MRR change between two dates
 */
export async function getMrrChange(
  groupSlug: string = 'fruitful',
  startDate: string,
  endDate: string
): Promise<{
  startMrr: number
  endMrr: number
  change: number
  changePercent: number | null
}> {
  // Get MRR at start
  const [startData] = await db
    .select({ mrr: skoolRevenueDaily.mrr })
    .from(skoolRevenueDaily)
    .where(
      and(
        eq(skoolRevenueDaily.groupSlug, groupSlug),
        lte(skoolRevenueDaily.snapshotDate, startDate)
      )
    )
    .orderBy(desc(skoolRevenueDaily.snapshotDate))
    .limit(1)

  // Get MRR at end
  const [endData] = await db
    .select({ mrr: skoolRevenueDaily.mrr })
    .from(skoolRevenueDaily)
    .where(
      and(
        eq(skoolRevenueDaily.groupSlug, groupSlug),
        lte(skoolRevenueDaily.snapshotDate, endDate)
      )
    )
    .orderBy(desc(skoolRevenueDaily.snapshotDate))
    .limit(1)

  const startMrr = startData?.mrr || 0
  const endMrr = endData?.mrr || 0
  const change = endMrr - startMrr
  const changePercent = startMrr > 0 ? ((change / startMrr) * 100) : null

  return { startMrr, endMrr, change, changePercent }
}
