/**
 * GET /api/installs
 *
 * Paginated list of telemetry events with filtering.
 * Auth: Bearer token (TELEMETRY_API_KEY env var)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq, gte, lte, ilike, desc, count, and } from '@0ne/db/server'
import { telemetryEvents } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

export async function GET(request: NextRequest) {
  // Validate bearer token
  const authHeader = request.headers.get('authorization')
  const expectedKey = process.env.TELEMETRY_API_KEY

  if (!expectedKey) {
    console.error('[Installs API] TELEMETRY_API_KEY environment variable not set')
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500, headers: corsHeaders }
    )
  }

  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i)
  if (!bearerMatch || bearerMatch[1] !== expectedKey) {
    return NextResponse.json(
      { error: 'Invalid or missing authorization' },
      { status: 401, headers: corsHeaders }
    )
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

    return NextResponse.json(
      {
        data,
        total: countResult[0]?.count ?? 0,
        page,
        per_page: perPage,
      },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Installs API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
