import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, asc, gte } from '@0ne/db/server'
import { skoolOneoffPosts, skoolCampaigns } from '@0ne/db/server'
import type { SkoolOneOffPostInput } from '@0ne/db'

export const dynamic = 'force-dynamic'

/**
 * Convert a local datetime string to UTC ISO string
 * Assumes input is in America/New_York timezone
 *
 * @param localDatetime - e.g., "2026-02-12T12:00:00" (interpreted as ET)
 * @param timezone - timezone to interpret the input as (default: America/New_York)
 * @returns UTC ISO string
 */
function convertToUTC(localDatetime: string, timezone: string = 'America/New_York'): string {
  // If already has timezone offset (ends with Z or +/-HH:MM), return as-is
  if (/[Z+\-]\d{2}:\d{2}$/.test(localDatetime) || localDatetime.endsWith('Z')) {
    return new Date(localDatetime).toISOString()
  }

  // Parse the local datetime components
  const [datePart, timePart] = localDatetime.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second = 0] = (timePart || '00:00:00').split(':').map(Number)

  // Create a date in the target timezone using Intl.DateTimeFormat
  // We need to find the UTC time that corresponds to this local time
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  // Start with a guess (the naive interpretation as UTC)
  let testDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

  // Get what this UTC time would be in the target timezone
  const parts = formatter.formatToParts(testDate)
  const localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
  const localDay = parseInt(parts.find(p => p.type === 'day')?.value || '0')

  // Calculate the offset and adjust
  // This is a simplified approach that handles most cases
  let hourDiff = hour - localHour
  let dayDiff = day - localDay

  // Handle day boundary crossings
  if (dayDiff > 0) hourDiff += 24
  if (dayDiff < 0) hourDiff -= 24

  // Adjust the date by the difference
  testDate = new Date(testDate.getTime() + hourDiff * 60 * 60 * 1000)

  return testDate.toISOString()
}

/**
 * GET /api/skool/oneoff-posts
 * List one-off posts with optional filters
 *
 * Query params:
 * - campaign_id: Filter by campaign
 * - status: Filter by status (pending, draft, published, posted_manually, failed, cancelled)
 * - upcoming: If 'true', only show future scheduled posts
 * - limit: Max number of posts to return
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaign_id')
    const status = searchParams.get('status')
    const upcoming = searchParams.get('upcoming') === 'true'
    const limit = parseInt(searchParams.get('limit') || '100', 10)

    const conditions: ReturnType<typeof eq>[] = []

    if (campaignId) {
      conditions.push(eq(skoolOneoffPosts.campaignId, campaignId))
    }
    if (status) {
      conditions.push(eq(skoolOneoffPosts.status, status))
    }
    if (upcoming) {
      conditions.push(gte(skoolOneoffPosts.scheduledAt, new Date()))
    }

    const data = await db
      .select({
        post: skoolOneoffPosts,
        campaign: {
          id: skoolCampaigns.id,
          name: skoolCampaigns.name,
        },
      })
      .from(skoolOneoffPosts)
      .leftJoin(skoolCampaigns, eq(skoolOneoffPosts.campaignId, skoolCampaigns.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(skoolOneoffPosts.scheduledAt))
      .limit(limit)

    const posts = data.map((row) => ({
      ...row.post,
      campaign: row.campaign?.id ? row.campaign : null,
    }))

    return NextResponse.json({ posts })
  } catch (error) {
    console.error('[One-Off Posts API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch one-off posts', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/skool/oneoff-posts
 * Create a new one-off scheduled post
 */
export async function POST(request: NextRequest) {
  try {
    const body: SkoolOneOffPostInput = await request.json()

    // Validate required fields
    if (!body.category || !body.scheduled_at || !body.title || !body.body) {
      return NextResponse.json(
        { error: 'Missing required fields: category, scheduled_at, title, body' },
        { status: 400 }
      )
    }

    // Convert scheduled_at from local timezone to UTC
    const timezone = body.timezone || 'America/New_York'
    const scheduledAtUTC = convertToUTC(body.scheduled_at, timezone)

    // Validate the converted date
    const scheduledDate = new Date(scheduledAtUTC)
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduled_at date format' }, { status: 400 })
    }

    const [inserted] = await db
      .insert(skoolOneoffPosts)
      .values({
        groupSlug: body.group_slug || 'fruitful',
        category: body.category,
        categoryId: body.category_id || null,
        scheduledAt: scheduledDate,
        timezone: body.timezone || 'America/New_York',
        title: body.title,
        body: body.body,
        imageUrl: body.image_url || null,
        videoUrl: body.video_url || null,
        campaignId: body.campaign_id || null,
        sendEmailBlast: body.send_email_blast ?? false,
        status: body.status || 'pending',
      })
      .returning()

    // Fetch the campaign if linked
    let campaign = null
    if (inserted.campaignId) {
      const [c] = await db
        .select({ id: skoolCampaigns.id, name: skoolCampaigns.name })
        .from(skoolCampaigns)
        .where(eq(skoolCampaigns.id, inserted.campaignId))
      campaign = c || null
    }

    return NextResponse.json({ post: { ...inserted, campaign } }, { status: 201 })
  } catch (error) {
    console.error('[One-Off Posts API] POST exception:', error)
    return NextResponse.json(
      { error: 'Failed to create one-off post', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/skool/oneoff-posts
 * Update an existing one-off post
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    // Convert scheduled_at from local timezone to UTC if provided
    if (updates.scheduled_at) {
      const timezone = updates.timezone || 'America/New_York'
      updates.scheduled_at = convertToUTC(updates.scheduled_at, timezone)

      const scheduledDate = new Date(updates.scheduled_at)
      if (isNaN(scheduledDate.getTime())) {
        return NextResponse.json({ error: 'Invalid scheduled_at date format' }, { status: 400 })
      }
    }

    // Map snake_case input to camelCase schema columns
    const setData: Record<string, unknown> = { updatedAt: new Date() }
    if (updates.group_slug !== undefined) setData.groupSlug = updates.group_slug
    if (updates.category !== undefined) setData.category = updates.category
    if (updates.category_id !== undefined) setData.categoryId = updates.category_id
    if (updates.scheduled_at !== undefined) setData.scheduledAt = new Date(updates.scheduled_at)
    if (updates.timezone !== undefined) setData.timezone = updates.timezone
    if (updates.title !== undefined) setData.title = updates.title
    if (updates.body !== undefined) setData.body = updates.body
    if (updates.image_url !== undefined) setData.imageUrl = updates.image_url
    if (updates.video_url !== undefined) setData.videoUrl = updates.video_url
    if (updates.campaign_id !== undefined) setData.campaignId = updates.campaign_id
    if (updates.send_email_blast !== undefined) setData.sendEmailBlast = updates.send_email_blast
    if (updates.status !== undefined) setData.status = updates.status

    const [updated] = await db
      .update(skoolOneoffPosts)
      .set(setData)
      .where(eq(skoolOneoffPosts.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'One-off post not found' }, { status: 404 })
    }

    // Fetch the campaign if linked
    let campaign = null
    if (updated.campaignId) {
      const [c] = await db
        .select({ id: skoolCampaigns.id, name: skoolCampaigns.name })
        .from(skoolCampaigns)
        .where(eq(skoolCampaigns.id, updated.campaignId))
      campaign = c || null
    }

    return NextResponse.json({ post: { ...updated, campaign } })
  } catch (error) {
    console.error('[One-Off Posts API] PUT exception:', error)
    return NextResponse.json(
      { error: 'Failed to update one-off post', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/skool/oneoff-posts?id=xxx
 * Delete a one-off post
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 })
    }

    await db.delete(skoolOneoffPosts).where(eq(skoolOneoffPosts.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[One-Off Posts API] DELETE exception:', error)
    return NextResponse.json(
      { error: 'Failed to delete one-off post', details: String(error) },
      { status: 500 }
    )
  }
}
