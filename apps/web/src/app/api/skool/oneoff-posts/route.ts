import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
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
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaign_id')
    const status = searchParams.get('status')
    const upcoming = searchParams.get('upcoming') === 'true'
    const limit = parseInt(searchParams.get('limit') || '100', 10)

    let query = supabase
      .from('skool_oneoff_posts')
      .select('*, campaign:skool_campaigns(id, name)')
      .order('scheduled_at', { ascending: true })
      .limit(limit)

    if (campaignId) {
      query = query.eq('campaign_id', campaignId)
    }

    if (status) {
      query = query.eq('status', status)
    }

    if (upcoming) {
      query = query.gte('scheduled_at', new Date().toISOString())
    }

    const { data, error } = await query

    if (error) {
      console.error('[One-Off Posts API] GET error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ posts: data })
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
    const supabase = createServerClient()
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

    const { data, error } = await supabase
      .from('skool_oneoff_posts')
      .insert({
        group_slug: body.group_slug || 'fruitful',
        category: body.category,
        category_id: body.category_id || null,
        scheduled_at: scheduledAtUTC,
        timezone: body.timezone || 'America/New_York',
        title: body.title,
        body: body.body,
        image_url: body.image_url || null,
        video_url: body.video_url || null,
        campaign_id: body.campaign_id || null,
        send_email_blast: body.send_email_blast ?? false,
        status: body.status || 'pending',
      })
      .select('*, campaign:skool_campaigns(id, name)')
      .single()

    if (error) {
      console.error('[One-Off Posts API] POST error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ post: data }, { status: 201 })
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
    const supabase = createServerClient()
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

    const { data, error } = await supabase
      .from('skool_oneoff_posts')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, campaign:skool_campaigns(id, name)')
      .single()

    if (error) {
      console.error('[One-Off Posts API] PUT error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'One-off post not found' }, { status: 404 })
    }

    return NextResponse.json({ post: data })
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
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 })
    }

    const { error } = await supabase.from('skool_oneoff_posts').delete().eq('id', id)

    if (error) {
      console.error('[One-Off Posts API] DELETE error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[One-Off Posts API] DELETE exception:', error)
    return NextResponse.json(
      { error: 'Failed to delete one-off post', details: String(error) },
      { status: 500 }
    )
  }
}
