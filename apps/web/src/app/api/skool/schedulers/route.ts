import { NextRequest, NextResponse } from 'next/server'
import { db, eq, asc } from '@0ne/db/server'
import { skoolScheduledPosts, skoolVariationGroups } from '@0ne/db/server'
import type { SkoolScheduledPostInput } from '@0ne/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/skool/schedulers
 * List all scheduler slots, ordered by day and time
 * Includes variation group data if available
 */
export async function GET() {
  try {
    const data = await db
      .select({
        scheduler: skoolScheduledPosts,
        variationGroup: {
          id: skoolVariationGroups.id,
          name: skoolVariationGroups.name,
          isActive: skoolVariationGroups.isActive,
        },
      })
      .from(skoolScheduledPosts)
      .leftJoin(skoolVariationGroups, eq(skoolScheduledPosts.variationGroupId, skoolVariationGroups.id))
      .orderBy(asc(skoolScheduledPosts.dayOfWeek), asc(skoolScheduledPosts.time))

    const schedulers = data.map((row) => ({
      ...row.scheduler,
      variation_group: row.variationGroup?.id ? row.variationGroup : null,
    }))

    return NextResponse.json({ schedulers })
  } catch (error) {
    console.error('[Schedulers API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch schedulers', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/skool/schedulers
 * Create a new scheduler slot
 */
export async function POST(request: NextRequest) {
  try {
    const body: SkoolScheduledPostInput = await request.json()

    // Validate required fields
    if (!body.category || body.day_of_week === undefined || !body.time) {
      return NextResponse.json(
        { error: 'Missing required fields: category, day_of_week, time' },
        { status: 400 }
      )
    }

    // Validate day_of_week range (0-6)
    if (body.day_of_week < 0 || body.day_of_week > 6) {
      return NextResponse.json(
        { error: 'day_of_week must be between 0 (Sunday) and 6 (Saturday)' },
        { status: 400 }
      )
    }

    // Validate time format (HH:MM)
    if (!/^\d{2}:\d{2}$/.test(body.time)) {
      return NextResponse.json(
        { error: 'time must be in HH:MM format (e.g., "09:00")' },
        { status: 400 }
      )
    }

    const [inserted] = await db
      .insert(skoolScheduledPosts)
      .values({
        groupSlug: body.group_slug || 'fruitful',
        category: body.category,
        categoryId: body.category_id || null,
        dayOfWeek: body.day_of_week,
        time: body.time,
        variationGroupId: body.variation_group_id || null,
        isActive: body.is_active ?? true,
        note: body.note || null,
      })
      .returning()

    // Fetch the variation group if linked
    let variationGroup = null
    if (inserted.variationGroupId) {
      const [vg] = await db
        .select({ id: skoolVariationGroups.id, name: skoolVariationGroups.name, isActive: skoolVariationGroups.isActive })
        .from(skoolVariationGroups)
        .where(eq(skoolVariationGroups.id, inserted.variationGroupId))
      variationGroup = vg || null
    }

    return NextResponse.json({ scheduler: { ...inserted, variation_group: variationGroup } }, { status: 201 })
  } catch (error) {
    console.error('[Schedulers API] POST exception:', error)
    return NextResponse.json(
      { error: 'Failed to create scheduler', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/skool/schedulers
 * Update an existing scheduler slot
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    // Validate day_of_week if provided
    if (updates.day_of_week !== undefined) {
      if (updates.day_of_week < 0 || updates.day_of_week > 6) {
        return NextResponse.json(
          { error: 'day_of_week must be between 0 (Sunday) and 6 (Saturday)' },
          { status: 400 }
        )
      }
    }

    // Validate time format if provided
    if (updates.time && !/^\d{2}:\d{2}$/.test(updates.time)) {
      return NextResponse.json(
        { error: 'time must be in HH:MM format (e.g., "09:00")' },
        { status: 400 }
      )
    }

    // Map snake_case input to camelCase schema columns
    const setData: Record<string, unknown> = { updatedAt: new Date() }
    if (updates.group_slug !== undefined) setData.groupSlug = updates.group_slug
    if (updates.category !== undefined) setData.category = updates.category
    if (updates.category_id !== undefined) setData.categoryId = updates.category_id
    if (updates.day_of_week !== undefined) setData.dayOfWeek = updates.day_of_week
    if (updates.time !== undefined) setData.time = updates.time
    if (updates.variation_group_id !== undefined) setData.variationGroupId = updates.variation_group_id
    if (updates.is_active !== undefined) setData.isActive = updates.is_active
    if (updates.note !== undefined) setData.note = updates.note

    const [updated] = await db
      .update(skoolScheduledPosts)
      .set(setData)
      .where(eq(skoolScheduledPosts.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Scheduler not found' }, { status: 404 })
    }

    // Fetch the variation group if linked
    let variationGroup = null
    if (updated.variationGroupId) {
      const [vg] = await db
        .select({ id: skoolVariationGroups.id, name: skoolVariationGroups.name, isActive: skoolVariationGroups.isActive })
        .from(skoolVariationGroups)
        .where(eq(skoolVariationGroups.id, updated.variationGroupId))
      variationGroup = vg || null
    }

    return NextResponse.json({ scheduler: { ...updated, variation_group: variationGroup } })
  } catch (error) {
    console.error('[Schedulers API] PUT exception:', error)
    return NextResponse.json(
      { error: 'Failed to update scheduler', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/skool/schedulers?id=xxx
 * Delete a scheduler slot
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 })
    }

    await db.delete(skoolScheduledPosts).where(eq(skoolScheduledPosts.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Schedulers API] DELETE exception:', error)
    return NextResponse.json(
      { error: 'Failed to delete scheduler', details: String(error) },
      { status: 500 }
    )
  }
}
