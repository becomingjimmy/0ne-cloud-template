import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, desc, count as countFn } from '@0ne/db/server'
import { skoolPostExecutionLog, skoolScheduledPosts, skoolPostLibrary } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/skool/execution-log
 * List execution logs with pagination and optional filters
 *
 * Query params:
 * - limit: Number of records to return (default: 50, max: 100)
 * - offset: Number of records to skip (default: 0)
 * - status: Filter by status (success, failed, skipped)
 * - scheduler_id: Filter by scheduler UUID
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse pagination params with defaults and limits
    let limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Cap limit at 100 to prevent excessive queries
    if (limit > 100) limit = 100
    if (limit < 1) limit = 50

    // Optional filters
    const status = searchParams.get('status')
    const schedulerId = searchParams.get('schedulerId') || searchParams.get('scheduler_id')

    // Apply filters
    const conditions: ReturnType<typeof eq>[] = []

    if (status) {
      // Validate status value
      const validStatuses = ['success', 'failed', 'skipped']
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        )
      }
      conditions.push(eq(skoolPostExecutionLog.status, status))
    }

    if (schedulerId) {
      conditions.push(eq(skoolPostExecutionLog.schedulerId, schedulerId))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Get total count for pagination
    const [countResult] = await db
      .select({ value: countFn() })
      .from(skoolPostExecutionLog)
      .where(whereClause)

    const total = countResult?.value ?? 0

    // Build query with joins to get scheduler and post details
    const data = await db
      .select({
        log: skoolPostExecutionLog,
        scheduler: {
          category: skoolScheduledPosts.category,
          dayOfWeek: skoolScheduledPosts.dayOfWeek,
          time: skoolScheduledPosts.time,
        },
        post: {
          title: skoolPostLibrary.title,
        },
      })
      .from(skoolPostExecutionLog)
      .leftJoin(skoolScheduledPosts, eq(skoolPostExecutionLog.schedulerId, skoolScheduledPosts.id))
      .leftJoin(skoolPostLibrary, eq(skoolPostExecutionLog.postLibraryId, skoolPostLibrary.id))
      .where(whereClause)
      .orderBy(desc(skoolPostExecutionLog.executedAt))
      .limit(limit)
      .offset(offset)

    const logs = data.map((row) => ({
      ...row.log,
      scheduler: row.scheduler?.category ? row.scheduler : null,
      post: row.post?.title ? row.post : null,
    }))

    return NextResponse.json({
      logs,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    })
  } catch (error) {
    console.error('[ExecutionLog API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch execution logs', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/skool/execution-log
 * Create a new execution log entry (typically called by the cron job)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate required fields
    if (!body.status) {
      return NextResponse.json(
        { error: 'Missing required field: status' },
        { status: 400 }
      )
    }

    // Validate status value
    const validStatuses = ['success', 'failed', 'skipped']
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const [inserted] = await db
      .insert(skoolPostExecutionLog)
      .values({
        schedulerId: body.scheduler_id || null,
        postLibraryId: body.post_library_id || null,
        status: body.status,
        skoolPostId: body.skool_post_id || null,
        skoolPostUrl: body.skool_post_url || null,
        errorMessage: body.error_message || null,
      })
      .returning()

    return NextResponse.json({ log: inserted }, { status: 201 })
  } catch (error) {
    console.error('[ExecutionLog API] POST exception:', error)
    return NextResponse.json(
      { error: 'Failed to create execution log', details: String(error) },
      { status: 500 }
    )
  }
}
