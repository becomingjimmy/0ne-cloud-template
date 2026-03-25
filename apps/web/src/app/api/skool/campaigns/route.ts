import { NextRequest, NextResponse } from 'next/server'
import { db, eq, desc, inArray } from '@0ne/db/server'
import { skoolCampaigns, skoolOneoffPosts } from '@0ne/db/server'
import type { SkoolCampaignInput } from '@0ne/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/skool/campaigns
 * List all campaigns with optional post stats
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const includeStats = searchParams.get('include_stats') === 'true'
    const activeOnly = searchParams.get('active_only') === 'true'

    const data = await db
      .select()
      .from(skoolCampaigns)
      .where(activeOnly ? eq(skoolCampaigns.isActive, true) : undefined)
      .orderBy(desc(skoolCampaigns.createdAt))

    // Optionally include post stats for each campaign
    let campaignsWithStats: unknown[] = data
    if (includeStats && data.length > 0) {
      const campaignIds = data.map((c) => c.id)

      // Get posts for each campaign
      const posts = await db
        .select({ campaignId: skoolOneoffPosts.campaignId, status: skoolOneoffPosts.status })
        .from(skoolOneoffPosts)
        .where(inArray(skoolOneoffPosts.campaignId, campaignIds))

      // Aggregate stats
      const statsMap = new Map<
        string,
        { total: number; pending: number; published: number; failed: number }
      >()

      posts.forEach((p) => {
        if (!p.campaignId) return
        const existing = statsMap.get(p.campaignId) || {
          total: 0,
          pending: 0,
          published: 0,
          failed: 0,
        }
        existing.total++
        if (p.status === 'pending' || p.status === 'draft') existing.pending++
        if (p.status === 'published' || p.status === 'posted_manually') existing.published++
        if (p.status === 'failed') existing.failed++
        statsMap.set(p.campaignId, existing)
      })

      campaignsWithStats = data.map((campaign) => ({
        ...campaign,
        stats: statsMap.get(campaign.id) || { total: 0, pending: 0, published: 0, failed: 0 },
      }))
    }

    return NextResponse.json({ campaigns: campaignsWithStats })
  } catch (error) {
    console.error('[Campaigns API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch campaigns', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/skool/campaigns
 * Create a new campaign
 */
export async function POST(request: NextRequest) {
  try {
    const body: SkoolCampaignInput = await request.json()

    // Validate required fields
    if (!body.name) {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 })
    }

    const [inserted] = await db
      .insert(skoolCampaigns)
      .values({
        name: body.name,
        description: body.description || null,
        startDate: body.start_date || null,
        endDate: body.end_date || null,
        isActive: body.is_active ?? true,
      })
      .returning()

    return NextResponse.json({ campaign: inserted }, { status: 201 })
  } catch (error) {
    console.error('[Campaigns API] POST exception:', error)
    return NextResponse.json(
      { error: 'Failed to create campaign', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/skool/campaigns
 * Update an existing campaign
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
    if (updates.start_date !== undefined) setData.startDate = updates.start_date
    if (updates.end_date !== undefined) setData.endDate = updates.end_date
    if (updates.is_active !== undefined) setData.isActive = updates.is_active

    const [updated] = await db
      .update(skoolCampaigns)
      .set(setData)
      .where(eq(skoolCampaigns.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json({ campaign: updated })
  } catch (error) {
    console.error('[Campaigns API] PUT exception:', error)
    return NextResponse.json(
      { error: 'Failed to update campaign', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/skool/campaigns?id=xxx
 * Delete a campaign (posts will have campaign_id set to null)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 })
    }

    await db.delete(skoolCampaigns).where(eq(skoolCampaigns.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Campaigns API] DELETE exception:', error)
    return NextResponse.json(
      { error: 'Failed to delete campaign', details: String(error) },
      { status: 500 }
    )
  }
}
