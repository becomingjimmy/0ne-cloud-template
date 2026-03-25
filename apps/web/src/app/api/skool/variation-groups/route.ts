import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, asc, inArray } from '@0ne/db/server'
import { skoolVariationGroups, skoolPostLibrary, skoolScheduledPosts } from '@0ne/db/server'
import type { SkoolVariationGroupInput } from '@0ne/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/skool/variation-groups
 * List all variation groups with optional post counts
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const includeStats = searchParams.get('include_stats') === 'true'

    const data = await db
      .select()
      .from(skoolVariationGroups)
      .orderBy(asc(skoolVariationGroups.name))

    // Optionally include post counts for each group
    let groupsWithStats: unknown[] = data
    if (includeStats && data.length > 0) {
      const groupIds = data.map((g) => g.id)

      // Get post counts
      const postCounts = await db
        .select({ variationGroupId: skoolPostLibrary.variationGroupId })
        .from(skoolPostLibrary)
        .where(and(
          inArray(skoolPostLibrary.variationGroupId, groupIds),
          eq(skoolPostLibrary.isActive, true)
        ))

      // Get scheduler counts
      const schedulerCounts = await db
        .select({ variationGroupId: skoolScheduledPosts.variationGroupId })
        .from(skoolScheduledPosts)
        .where(and(
          inArray(skoolScheduledPosts.variationGroupId, groupIds),
          eq(skoolScheduledPosts.isActive, true)
        ))

      // Aggregate counts
      const postCountMap = new Map<string, number>()
      const schedulerCountMap = new Map<string, number>()

      postCounts.forEach((p) => {
        if (p.variationGroupId) {
          postCountMap.set(p.variationGroupId, (postCountMap.get(p.variationGroupId) || 0) + 1)
        }
      })

      schedulerCounts.forEach((s) => {
        if (s.variationGroupId) {
          schedulerCountMap.set(
            s.variationGroupId,
            (schedulerCountMap.get(s.variationGroupId) || 0) + 1
          )
        }
      })

      groupsWithStats = data.map((group) => ({
        ...group,
        post_count: postCountMap.get(group.id) || 0,
        scheduler_count: schedulerCountMap.get(group.id) || 0,
      }))
    }

    return NextResponse.json({ groups: groupsWithStats })
  } catch (error) {
    console.error('[Variation Groups API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch variation groups', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/skool/variation-groups
 * Create a new variation group
 */
export async function POST(request: NextRequest) {
  try {
    const body: SkoolVariationGroupInput = await request.json()

    // Validate required fields
    if (!body.name) {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 })
    }

    const [inserted] = await db
      .insert(skoolVariationGroups)
      .values({
        name: body.name,
        description: body.description || null,
        isActive: body.is_active ?? true,
      })
      .returning()

    return NextResponse.json({ group: inserted }, { status: 201 })
  } catch (error) {
    console.error('[Variation Groups API] POST exception:', error)
    return NextResponse.json(
      { error: 'Failed to create variation group', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/skool/variation-groups
 * Update an existing variation group
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    // Map snake_case input to camelCase schema columns
    const setData: Record<string, unknown> = { updatedAt: new Date() }
    if (updates.name !== undefined) setData.name = updates.name
    if (updates.description !== undefined) setData.description = updates.description
    if (updates.is_active !== undefined) setData.isActive = updates.is_active

    const [updated] = await db
      .update(skoolVariationGroups)
      .set(setData)
      .where(eq(skoolVariationGroups.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Variation group not found' }, { status: 404 })
    }

    return NextResponse.json({ group: updated })
  } catch (error) {
    console.error('[Variation Groups API] PUT exception:', error)
    return NextResponse.json(
      { error: 'Failed to update variation group', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/skool/variation-groups?id=xxx
 * Delete a variation group (will unlink posts and schedulers)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 })
    }

    // Note: Posts and schedulers will have their variation_group_id set to null
    // due to the ON DELETE SET NULL behavior (if configured) or we handle it here
    await db.delete(skoolVariationGroups).where(eq(skoolVariationGroups.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Variation Groups API] DELETE exception:', error)
    return NextResponse.json(
      { error: 'Failed to delete variation group', details: String(error) },
      { status: 500 }
    )
  }
}
