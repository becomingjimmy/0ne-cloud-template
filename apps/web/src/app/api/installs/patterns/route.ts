/**
 * GET /api/installs/patterns
 *
 * List all failure patterns sorted by occurrence count.
 * Auth: Bearer token (TELEMETRY_API_KEY env var)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq, desc } from '@0ne/db/server'
import { telemetryFailurePatterns } from '@0ne/db/server'

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
    console.error('[Installs Patterns API] TELEMETRY_API_KEY environment variable not set')
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
    const category = searchParams.get('category')

    const whereClause = category ? eq(telemetryFailurePatterns.category, category) : undefined

    const data = await db.select().from(telemetryFailurePatterns)
      .where(whereClause)
      .orderBy(desc(telemetryFailurePatterns.occurrenceCount))

    return NextResponse.json(
      { data },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Installs Patterns API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
