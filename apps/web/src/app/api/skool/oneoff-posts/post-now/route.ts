/**
 * POST /api/skool/oneoff-posts/post-now
 *
 * Queues a one-off post for immediate publishing by the Chrome extension.
 * Instead of calling Skool API server-side (blocked by AWS WAF), this sets
 * `status = 'approved'` and `scheduled_at = NOW()` so the extension's
 * get-scheduled-posts poll (every 60s) picks it up and publishes it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq } from '@0ne/db/server'
import { skoolOneoffPosts } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Missing post id' }, { status: 400 })
    }

    // Get the post
    const [post] = await db
      .select()
      .from(skoolOneoffPosts)
      .where(eq(skoolOneoffPosts.id, id))

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Check if post is in an editable status
    const editableStatuses = ['draft', 'approved', 'pending']
    if (!post.status || !editableStatuses.includes(post.status)) {
      return NextResponse.json(
        { error: `Cannot post: status is "${post.status}". Only draft, approved, or scheduled posts can be posted.` },
        { status: 400 }
      )
    }

    console.log(`[Post Now] Queuing "${post.title}" for extension publishing`)

    // Queue for extension: set status to 'approved' and scheduled_at to NOW
    // The extension polls get-scheduled-posts every 60s and will pick this up
    const now = new Date()
    await db
      .update(skoolOneoffPosts)
      .set({
        status: 'approved',
        scheduledAt: now,
        updatedAt: now,
      })
      .where(eq(skoolOneoffPosts.id, id))

    console.log(`[Post Now] Post queued successfully — extension will publish within ~60s`)

    return NextResponse.json({
      success: true,
      queued: true,
      message: 'Post queued for extension publishing. It will be published within ~60 seconds.',
    })
  } catch (error) {
    console.error('[Post Now] Exception:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
