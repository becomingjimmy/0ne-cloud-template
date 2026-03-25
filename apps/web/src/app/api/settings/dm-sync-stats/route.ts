/**
 * DM Sync Stats API
 *
 * Returns DM sync metrics for the dashboard.
 *
 * GET /api/settings/dm-sync-stats
 *   - Returns inbound/outbound message counts (24h), total mappings, pending queue
 */

import { NextResponse } from 'next/server'
import { db, eq, and, gte, count } from '@0ne/db/server'
import { dmMessages, dmContactMappings } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

interface DMSyncStats {
  inbound24h: number
  outbound24h: number
  totalMappings: number
  pendingQueue: number
}

export async function GET() {
  try {
    // Calculate 24 hours ago
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    // Run all queries in parallel
    const [inboundResult, outboundResult, mappingsResult, pendingResult] = await Promise.all([
      // Inbound messages in last 24h
      db
        .select({ count: count() })
        .from(dmMessages)
        .where(
          and(
            eq(dmMessages.direction, 'inbound'),
            gte(dmMessages.createdAt, twentyFourHoursAgo)
          )
        ),

      // Outbound messages in last 24h
      db
        .select({ count: count() })
        .from(dmMessages)
        .where(
          and(
            eq(dmMessages.direction, 'outbound'),
            gte(dmMessages.createdAt, twentyFourHoursAgo)
          )
        ),

      // Total contact mappings
      db
        .select({ count: count() })
        .from(dmContactMappings),

      // Pending outbound messages (status = 'pending')
      db
        .select({ count: count() })
        .from(dmMessages)
        .where(
          and(
            eq(dmMessages.direction, 'outbound'),
            eq(dmMessages.status, 'pending')
          )
        ),
    ])

    const stats: DMSyncStats = {
      inbound24h: inboundResult[0]?.count ?? 0,
      outbound24h: outboundResult[0]?.count ?? 0,
      totalMappings: mappingsResult[0]?.count ?? 0,
      pendingQueue: pendingResult[0]?.count ?? 0,
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error('[dm-sync-stats API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
