import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, asc, isNull } from '@0ne/db/server'
import { skoolPostLibrary, skoolVariationGroups } from '@0ne/db/server'
import type { SkoolPostLibraryItemInput } from '@0ne/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/skool/posts
 * List posts from the library with optional filters
 *
 * Query params:
 * - day_of_week: Filter by day (0-6) (legacy)
 * - time: Filter by time slot (HH:MM) (legacy)
 * - variation_group_id: Filter by variation group (use 'none' for posts with no group)
 * - is_active: Filter by active status (true/false)
 * - status: Filter by status (draft, approved, active)
 * - source: Filter by source (manual, api, import)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const dayOfWeek = searchParams.get('dayOfWeek') || searchParams.get('day_of_week')
    const time = searchParams.get('time')
    const variationGroupId = searchParams.get('variationGroupId') || searchParams.get('variation_group_id')
    const isActive = searchParams.get('isActive') || searchParams.get('is_active')
    const status = searchParams.get('status')
    const source = searchParams.get('source')

    const conditions: ReturnType<typeof eq>[] = []

    if (dayOfWeek !== null && dayOfWeek !== '') {
      conditions.push(eq(skoolPostLibrary.dayOfWeek, parseInt(dayOfWeek, 10)))
    }
    if (time) {
      conditions.push(eq(skoolPostLibrary.time, time))
    }
    if (variationGroupId) {
      if (variationGroupId === 'none') {
        conditions.push(isNull(skoolPostLibrary.variationGroupId))
      } else {
        conditions.push(eq(skoolPostLibrary.variationGroupId, variationGroupId))
      }
    }
    if (isActive !== null && isActive !== '') {
      conditions.push(eq(skoolPostLibrary.isActive, isActive === 'true'))
    }
    if (status) {
      conditions.push(eq(skoolPostLibrary.status, status))
    }
    if (source) {
      conditions.push(eq(skoolPostLibrary.source, source))
    }

    const data = await db
      .select({
        post: skoolPostLibrary,
        variationGroup: {
          id: skoolVariationGroups.id,
          name: skoolVariationGroups.name,
          isActive: skoolVariationGroups.isActive,
        },
      })
      .from(skoolPostLibrary)
      .leftJoin(skoolVariationGroups, eq(skoolPostLibrary.variationGroupId, skoolVariationGroups.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(skoolPostLibrary.status), asc(skoolPostLibrary.lastUsedAt))

    const posts = data.map((row) => ({
      ...row.post,
      variationGroup: row.variationGroup?.id ? row.variationGroup : null,
    }))

    return NextResponse.json({ posts })
  } catch (error) {
    console.error('[Posts API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch posts', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/skool/posts
 * Create a new post in the library
 */
export async function POST(request: NextRequest) {
  try {
    const body: SkoolPostLibraryItemInput = await request.json()

    // Validate required fields (only title and body are truly required now)
    if (!body.title || !body.body) {
      return NextResponse.json(
        { error: 'Missing required fields: title, body' },
        { status: 400 }
      )
    }

    // Validate dayOfWeek range (0-6) if provided
    if (body.dayOfWeek !== undefined && body.dayOfWeek !== null) {
      if (body.dayOfWeek < 0 || body.dayOfWeek > 6) {
        return NextResponse.json(
          { error: 'dayOfWeek must be between 0 (Sunday) and 6 (Saturday)' },
          { status: 400 }
        )
      }
    }

    // Validate time format (HH:MM) if provided
    if (body.time && !/^\d{2}:\d{2}$/.test(body.time)) {
      return NextResponse.json(
        { error: 'time must be in HH:MM format (e.g., "09:00")' },
        { status: 400 }
      )
    }

    const [inserted] = await db
      .insert(skoolPostLibrary)
      .values({
        category: body.category || '',
        dayOfWeek: body.dayOfWeek ?? null,
        time: body.time || null,
        variationGroupId: body.variationGroupId || null,
        title: body.title,
        body: body.body,
        imageUrl: body.imageUrl || null,
        videoUrl: body.videoUrl || null,
        isActive: body.isActive ?? true,
        status: body.status || 'active',
        source: body.source || 'manual',
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

    return NextResponse.json({ post: { ...inserted, variationGroup } }, { status: 201 })
  } catch (error) {
    console.error('[Posts API] POST exception:', error)
    return NextResponse.json(
      { error: 'Failed to create post', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/skool/posts
 * Update an existing post in the library
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    // Validate dayOfWeek if provided
    if (updates.dayOfWeek !== undefined) {
      if (updates.dayOfWeek < 0 || updates.dayOfWeek > 6) {
        return NextResponse.json(
          { error: 'dayOfWeek must be between 0 (Sunday) and 6 (Saturday)' },
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

    // Map input to schema columns
    const setData: Record<string, unknown> = { updatedAt: new Date() }
    if (updates.category !== undefined) setData.category = updates.category
    if (updates.dayOfWeek !== undefined) setData.dayOfWeek = updates.dayOfWeek
    if (updates.time !== undefined) setData.time = updates.time
    if (updates.variationGroupId !== undefined) setData.variationGroupId = updates.variationGroupId
    if (updates.title !== undefined) setData.title = updates.title
    if (updates.body !== undefined) setData.body = updates.body
    if (updates.imageUrl !== undefined) setData.imageUrl = updates.imageUrl
    if (updates.videoUrl !== undefined) setData.videoUrl = updates.videoUrl
    if (updates.isActive !== undefined) setData.isActive = updates.isActive
    if (updates.status !== undefined) setData.status = updates.status
    if (updates.source !== undefined) setData.source = updates.source

    // Set approved_at when transitioning to approved status
    if (updates.status === 'approved' || updates.status === 'active') {
      setData.approvedAt = new Date()
    }

    const [updated] = await db
      .update(skoolPostLibrary)
      .set(setData)
      .where(eq(skoolPostLibrary.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
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

    return NextResponse.json({ post: { ...updated, variationGroup } })
  } catch (error) {
    console.error('[Posts API] PUT exception:', error)
    return NextResponse.json(
      { error: 'Failed to update post', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/skool/posts?id=xxx
 * Delete a post from the library
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 })
    }

    await db.delete(skoolPostLibrary).where(eq(skoolPostLibrary.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Posts API] DELETE exception:', error)
    return NextResponse.json(
      { error: 'Failed to delete post', details: String(error) },
      { status: 500 }
    )
  }
}
