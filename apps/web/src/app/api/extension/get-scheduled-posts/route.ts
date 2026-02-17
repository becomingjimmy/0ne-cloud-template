import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { corsHeaders, validateExtensionApiKey } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/extension/get-scheduled-posts
 *
 * Returns posts due for publishing within the next N minutes.
 * The extension polls this endpoint to know when to publish.
 *
 * Query params:
 *   - minutes: How far ahead to look (default: 5, max: 30)
 *
 * Returns:
 *   - posts: Array of scheduled posts ready to publish
 */

// =============================================
// Types
// =============================================

interface ScheduledPostResponse {
  id: string
  groupSlug: string
  category: string
  categoryId: string | null
  title: string
  body: string
  imageUrl: string | null
  videoUrl: string | null
  scheduledAt: string
  sendEmailBlast: boolean
}

interface GetScheduledPostsResponse {
  success: boolean
  posts: ScheduledPostResponse[]
  error?: string
}

// =============================================
// GET Handler
// =============================================

export async function GET(request: NextRequest) {
  // Validate API key
  const authError = validateExtensionApiKey(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const minutesParam = searchParams.get('minutes')
    const minutes = Math.min(Math.max(parseInt(minutesParam || '5', 10), 1), 30)

    const supabase = createServerClient()

    // Calculate the time window
    // Look back 10 minutes to catch "Post Now" posts (status=approved, scheduled_at=NOW)
    // that were queued between poll cycles
    const now = new Date()
    const lookbackTime = new Date(now.getTime() - 10 * 60 * 1000)
    const futureTime = new Date(now.getTime() + minutes * 60 * 1000)

    console.log(
      `[Extension API] Fetching scheduled posts: lookback=${lookbackTime.toISOString()}, now=${now.toISOString()}, future=${futureTime.toISOString()}`
    )

    // Query for one-off posts that are due
    // Accept both 'pending' (normal scheduled) and 'approved' (Post Now) statuses
    const { data: oneoffPosts, error: oneoffError } = await supabase
      .from('skool_oneoff_posts')
      .select('*')
      .in('status', ['pending', 'approved'])
      .lte('scheduled_at', futureTime.toISOString())
      .gte('scheduled_at', lookbackTime.toISOString())
      .order('scheduled_at', { ascending: true })

    if (oneoffError) {
      console.error('[Extension API] Error fetching one-off posts:', oneoffError)
      return NextResponse.json(
        { success: false, posts: [], error: oneoffError.message } as GetScheduledPostsResponse,
        { status: 500, headers: corsHeaders }
      )
    }

    // Also check recurring schedules
    // Get current day and time for recurring schedule matching
    const dayOfWeek = now.getDay() // 0=Sunday, 1=Monday, etc.
    const currentTime = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    })
    const futureTimeStr = futureTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    })

    // Query for recurring schedules that are due
    const { data: recurringSchedules, error: recurringError } = await supabase
      .from('skool_scheduled_posts')
      .select('*')
      .eq('day_of_week', dayOfWeek)
      .eq('is_active', true)
      .gte('time', currentTime)
      .lte('time', futureTimeStr)

    if (recurringError) {
      console.error('[Extension API] Error fetching recurring schedules:', recurringError)
      // Continue with one-off posts only
    }

    // For recurring schedules, we need to get the post content from the library
    const recurringPosts: ScheduledPostResponse[] = []

    if (recurringSchedules && recurringSchedules.length > 0) {
      for (const schedule of recurringSchedules) {
        // Check if this schedule was already run recently (within 23 hours)
        if (schedule.last_run_at) {
          const lastRun = new Date(schedule.last_run_at)
          const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60)
          if (hoursSinceLastRun < 23) {
            continue // Skip, already ran
          }
        }

        // Get the next post content from the library
        const { data: postContent, error: postError } = await supabase
          .from('skool_post_library')
          .select('*')
          .eq('category', schedule.category)
          .eq('day_of_week', schedule.day_of_week)
          .eq('time', schedule.time)
          .eq('is_active', true)
          .order('last_used_at', { ascending: true, nullsFirst: true })
          .order('use_count', { ascending: true })
          .limit(1)
          .single()

        if (postError || !postContent) {
          console.warn(
            `[Extension API] No post content found for schedule ${schedule.id}:`,
            postError
          )
          continue
        }

        // Calculate the actual scheduled time for today
        const [hours, mins] = schedule.time.split(':').map(Number)
        const scheduledAt = new Date(now)
        scheduledAt.setHours(hours, mins, 0, 0)

        recurringPosts.push({
          id: `recurring:${schedule.id}:${postContent.id}`,
          groupSlug: schedule.group_slug,
          category: schedule.category,
          categoryId: schedule.category_id,
          title: postContent.title,
          body: postContent.body,
          imageUrl: postContent.image_url,
          videoUrl: postContent.video_url,
          scheduledAt: scheduledAt.toISOString(),
          sendEmailBlast: false, // Recurring posts don't send email blast
        })
      }
    }

    // Map one-off posts to response format
    const oneoffMapped: ScheduledPostResponse[] = (oneoffPosts || []).map((post) => ({
      id: post.id,
      groupSlug: post.group_slug,
      category: post.category,
      categoryId: post.category_id,
      title: post.title,
      body: post.body,
      imageUrl: post.image_url,
      videoUrl: post.video_url,
      scheduledAt: post.scheduled_at,
      sendEmailBlast: post.send_email_blast || false,
    }))

    // Combine and sort by scheduled time
    const allPosts = [...oneoffMapped, ...recurringPosts].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    )

    console.log(`[Extension API] Found ${allPosts.length} posts due for publishing`)

    const response: GetScheduledPostsResponse = {
      success: true,
      posts: allPosts,
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] GET exception:', error)
    return NextResponse.json(
      {
        success: false,
        posts: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      } as GetScheduledPostsResponse,
      { status: 500, headers: corsHeaders }
    )
  }
}
