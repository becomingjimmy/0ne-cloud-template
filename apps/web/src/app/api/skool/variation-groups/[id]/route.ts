import { NextRequest, NextResponse } from 'next/server'
import { db, eq, count } from '@0ne/db/server'
import { skoolVariationGroups, skoolPostLibrary, skoolScheduledPosts } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/skool/variation-groups/[id]
 * Get a single variation group by ID with stats
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const [data] = await db
      .select()
      .from(skoolVariationGroups)
      .where(eq(skoolVariationGroups.id, id))

    if (!data) {
      return NextResponse.json({ error: 'Variation group not found' }, { status: 404 })
    }

    // Get post count
    const [postResult] = await db
      .select({ value: count() })
      .from(skoolPostLibrary)
      .where(eq(skoolPostLibrary.variationGroupId, id))

    // Get scheduler count
    const [schedulerResult] = await db
      .select({ value: count() })
      .from(skoolScheduledPosts)
      .where(eq(skoolScheduledPosts.variationGroupId, id))

    const groupWithStats = {
      ...data,
      post_count: Number(postResult?.value ?? 0),
      scheduler_count: Number(schedulerResult?.value ?? 0),
    }

    return NextResponse.json({ group: groupWithStats })
  } catch (error) {
    console.error('[Variation Groups API] GET by ID exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch variation group', details: String(error) },
      { status: 500 }
    )
  }
}
