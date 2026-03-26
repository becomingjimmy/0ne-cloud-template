import { NextRequest, NextResponse } from 'next/server'
import { db, eq, rawSql } from '@0ne/db/server'
import { skoolScheduledPosts, skoolPostLibrary, skoolPostExecutionLog, skoolOneoffPosts } from '@0ne/db/server'
import { corsHeaders, validateExtensionApiKey } from '@/lib/extension-auth'
import { safeErrorResponse } from '@/lib/security'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/extension/confirm-posted
 *
 * Called by the extension after successfully publishing a post to Skool.
 * Updates the database with the posted status and Skool post ID.
 *
 * Request body:
 *   - postId: The scheduled post ID (UUID or "recurring:scheduleId:libraryId")
 *   - skoolPostId: The Skool post ID returned after publishing
 *   - skoolPostUrl: The full URL to the published post
 *   - success: Whether the post was published successfully
 *   - error: Error message if failed
 */

// =============================================
// Types
// =============================================

interface ConfirmPostedRequest {
  postId: string
  skoolPostId?: string
  skoolPostUrl?: string
  success: boolean
  error?: string
  emailBlastSent?: boolean
}

interface ConfirmPostedResponse {
  success: boolean
  message: string
  error?: string
}

// =============================================
// POST Handler
// =============================================

export async function POST(request: NextRequest) {
  // Validate API key
  const authError = validateExtensionApiKey(request)
  if (authError) return authError

  try {
    const body: ConfirmPostedRequest = await request.json()

    // Validate request
    if (!body.postId) {
      return NextResponse.json(
        { success: false, message: '', error: 'Missing required field: postId' },
        { status: 400, headers: corsHeaders }
      )
    }

    const now = new Date()

    console.log(
      `[Extension API] Confirm posted: postId=${body.postId}, success=${body.success}, skoolPostId=${body.skoolPostId || 'N/A'}`
    )

    // Check if this is a recurring post
    if (body.postId.startsWith('recurring:')) {
      // Parse recurring post ID format: "recurring:scheduleId:libraryId"
      const parts = body.postId.split(':')
      if (parts.length !== 3) {
        return NextResponse.json(
          { success: false, message: '', error: 'Invalid recurring post ID format' },
          { status: 400, headers: corsHeaders }
        )
      }

      const [, scheduleId, libraryId] = parts

      if (body.success) {
        // Update the schedule's last_run_at
        try {
          await db.update(skoolScheduledPosts)
            .set({ lastRunAt: now, updatedAt: now })
            .where(eq(skoolScheduledPosts.id, scheduleId))
        } catch (scheduleError) {
          console.error('[Extension API] Error updating schedule:', scheduleError)
        }

        // Update the library post's usage stats (increment use_count via SQL)
        try {
          await db.update(skoolPostLibrary)
            .set({
              lastUsedAt: now,
              useCount: rawSql`COALESCE(use_count, 0) + 1`,
              updatedAt: now,
            })
            .where(eq(skoolPostLibrary.id, libraryId))
        } catch (libraryError) {
          console.error('[Extension API] Error updating library post:', libraryError)
        }

        // Log the execution
        try {
          await db.insert(skoolPostExecutionLog).values({
            schedulerId: scheduleId,
            postLibraryId: libraryId,
            executedAt: now,
            status: 'success',
            skoolPostId: body.skoolPostId || null,
            skoolPostUrl: body.skoolPostUrl || null,
            emailBlastSent: body.emailBlastSent || false,
          })
        } catch (logError) {
          console.error('[Extension API] Error logging execution:', logError)
        }

        return NextResponse.json(
          { success: true, message: 'Recurring post confirmed' } as ConfirmPostedResponse,
          { headers: corsHeaders }
        )
      } else {
        // Log the failure
        try {
          await db.insert(skoolPostExecutionLog).values({
            schedulerId: scheduleId,
            postLibraryId: libraryId,
            executedAt: now,
            status: 'failed',
            errorMessage: body.error || 'Unknown error',
          })
        } catch (logError) {
          console.error('[Extension API] Error logging failure:', logError)
        }

        return NextResponse.json(
          { success: true, message: 'Failure logged for recurring post' } as ConfirmPostedResponse,
          { headers: corsHeaders }
        )
      }
    }

    // Handle one-off posts
    if (body.success) {
      // Update the one-off post as published
      try {
        await db.update(skoolOneoffPosts).set({
          status: 'published',
          publishedAt: now,
          skoolPostId: body.skoolPostId || null,
          skoolPostUrl: body.skoolPostUrl || null,
          updatedAt: now,
        }).where(eq(skoolOneoffPosts.id, body.postId))
      } catch (updateError) {
        console.error('[Extension API] Error updating one-off post:', updateError)
        return NextResponse.json(
          { success: false, message: '', error: updateError instanceof Error ? updateError.message : 'Unknown error' },
          { status: 500, headers: corsHeaders }
        )
      }

      // If email blast was sent, record it via raw SQL (RPC equivalent)
      if (body.emailBlastSent) {
        const postRows = await db.select({ groupSlug: skoolOneoffPosts.groupSlug })
          .from(skoolOneoffPosts)
          .where(eq(skoolOneoffPosts.id, body.postId))
        const post = postRows[0]

        if (post?.groupSlug) {
          try {
            await db.execute(rawSql`SELECT record_email_blast(${post.groupSlug})`)
          } catch (rpcError) {
            console.error('[Extension API] Error recording email blast:', rpcError)
          }
        }
      }

      console.log(`[Extension API] One-off post ${body.postId} marked as published`)

      return NextResponse.json(
        { success: true, message: 'Post confirmed as published' } as ConfirmPostedResponse,
        { headers: corsHeaders }
      )
    } else {
      // Mark as failed
      try {
        await db.update(skoolOneoffPosts).set({
          status: 'failed',
          errorMessage: body.error || 'Unknown error',
          updatedAt: now,
        }).where(eq(skoolOneoffPosts.id, body.postId))
      } catch (updateError) {
        console.error('[Extension API] Error marking post as failed:', updateError)
      }

      console.log(`[Extension API] One-off post ${body.postId} marked as failed: ${body.error}`)

      return NextResponse.json(
        { success: true, message: 'Post failure recorded' } as ConfirmPostedResponse,
        { headers: corsHeaders }
      )
    }
  } catch (error) {
    console.error('[Extension API] POST exception:', error)
    return safeErrorResponse('Failed to confirm post', error, 500, corsHeaders)
  }
}
