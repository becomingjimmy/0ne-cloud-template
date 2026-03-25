/**
 * GET /api/installs/dashboard/patterns
 *
 * Internal (Clerk-auth) list of failure patterns for the dashboard UI.
 * Same data as the external /api/installs/patterns route but uses Clerk session auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, desc } from '@0ne/db/server'
import { telemetryFailurePatterns } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = request.nextUrl
    const category = searchParams.get('category')

    const whereClause = category ? eq(telemetryFailurePatterns.category, category) : undefined

    const data = await db.select().from(telemetryFailurePatterns)
      .where(whereClause)
      .orderBy(desc(telemetryFailurePatterns.occurrenceCount))

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[Installs Dashboard Patterns API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
