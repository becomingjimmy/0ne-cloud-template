/**
 * GET /api/installs/dashboard
 *
 * Internal (Clerk-auth) paginated list of telemetry events for the dashboard UI.
 * Same data as the external /api/installs route but uses Clerk session auth
 * instead of Bearer token so the browser can call it directly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, ilike, desc, count, and } from '@0ne/db/server'
import { telemetryEvents } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = request.nextUrl
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('per_page') || '25', 10)))
    const eventType = searchParams.get('event_type')
    const platform = searchParams.get('platform')
    const status = searchParams.get('status')
    const principalName = searchParams.get('principal_name')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    // Build dynamic filter conditions
    const conditions = []
    if (eventType) {
      conditions.push(eq(telemetryEvents.eventType, eventType))
    }
    if (platform) {
      conditions.push(eq(telemetryEvents.platform, platform))
    }
    if (status) {
      conditions.push(eq(telemetryEvents.status, status))
    }
    if (principalName) {
      conditions.push(ilike(telemetryEvents.principalName, `%${principalName}%`))
    }
    if (dateFrom) {
      conditions.push(gte(telemetryEvents.createdAt, new Date(dateFrom)))
    }
    if (dateTo) {
      conditions.push(lte(telemetryEvents.createdAt, new Date(dateTo)))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Pagination
    const offset = (page - 1) * perPage

    const [data, countResult] = await Promise.all([
      db.select().from(telemetryEvents)
        .where(whereClause)
        .orderBy(desc(telemetryEvents.createdAt))
        .limit(perPage)
        .offset(offset),
      db.select({ count: count() }).from(telemetryEvents)
        .where(whereClause),
    ])

    return NextResponse.json({
      data,
      total: countResult[0]?.count ?? 0,
      page,
      per_page: perPage,
    })
  } catch (error) {
    console.error('[Installs Dashboard API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
