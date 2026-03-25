/**
 * GET /api/skool/categories
 * POST /api/skool/categories
 *
 * Returns Skool community categories from DB cache only.
 * No server-side Skool API calls (blocked by AWS WAF).
 * Categories are pushed by the Chrome extension via /api/extension/push-categories.
 *
 * Query params (GET):
 * - group: Group slug (default: 'fruitful')
 *
 * Body (POST):
 * - group: Group slug (default: 'fruitful')
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq, asc } from '@0ne/db/server'
import { skoolCategories } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

// Fallback categories for the Fruitful community (used when DB cache is empty)
const FRUITFUL_FALLBACK_CATEGORIES = [
  { id: null, name: 'The Money Room' },
  { id: null, name: 'Funding Club' },
  { id: null, name: 'Funding Hot Seat' },
  { id: null, name: 'General' },
  { id: null, name: 'Wins' },
]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const groupSlug = searchParams.get('group') || 'fruitful'

    // Get categories from database cache
    const cachedCategories = await db
      .select({
        skoolId: skoolCategories.skoolId,
        name: skoolCategories.name,
        position: skoolCategories.position,
        fetchedAt: skoolCategories.fetchedAt,
      })
      .from(skoolCategories)
      .where(eq(skoolCategories.groupSlug, groupSlug))
      .orderBy(asc(skoolCategories.position))

    // If we have cached categories, return them
    if (cachedCategories.length > 0) {
      const lastFetched = cachedCategories[0]?.fetchedAt

      return NextResponse.json({
        categories: cachedCategories.map((c) => ({
          id: c.skoolId,
          name: c.name,
        })),
        source: 'database',
        lastFetched,
        count: cachedCategories.length,
      })
    }

    // No DB data — return static fallback
    console.log(`[Categories API] No cached categories for "${groupSlug}", returning fallback`)
    return NextResponse.json({
      categories: FRUITFUL_FALLBACK_CATEGORIES,
      source: 'fallback',
      note: 'No cached categories. The Chrome extension will sync them automatically.',
      count: FRUITFUL_FALLBACK_CATEGORIES.length,
    })
  } catch (error) {
    console.error('[Categories API] GET exception:', error)
    return NextResponse.json({
      categories: FRUITFUL_FALLBACK_CATEGORIES,
      source: 'fallback',
      note: 'API error — using fallback categories.',
      error: String(error),
    })
  }
}

/**
 * POST /api/skool/categories
 * Previously triggered a server-side refresh from Skool.
 * Now returns DB cache (refresh happens via extension push).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const groupSlug = body.group || 'fruitful'

    console.log(`[Categories API] Refresh requested for group: ${groupSlug} (DB-only, no server-side fetch)`)

    // Return what we have in the database
    const cachedCategories = await db
      .select({
        skoolId: skoolCategories.skoolId,
        name: skoolCategories.name,
        position: skoolCategories.position,
        fetchedAt: skoolCategories.fetchedAt,
      })
      .from(skoolCategories)
      .where(eq(skoolCategories.groupSlug, groupSlug))
      .orderBy(asc(skoolCategories.position))

    if (cachedCategories.length > 0) {
      return NextResponse.json({
        success: true,
        categories: cachedCategories.map((c) => ({
          id: c.skoolId,
          name: c.name,
        })),
        source: 'database',
        lastFetched: cachedCategories[0]?.fetchedAt,
        count: cachedCategories.length,
        note: 'Categories come from extension sync. Ensure the Chrome extension is running.',
      })
    }

    // No data — return fallback
    return NextResponse.json({
      success: true,
      categories: FRUITFUL_FALLBACK_CATEGORIES,
      source: 'fallback',
      note: 'No cached categories. The Chrome extension will sync them automatically.',
      count: FRUITFUL_FALLBACK_CATEGORIES.length,
    })
  } catch (error) {
    console.error('[Categories API] POST exception:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve categories', details: String(error) },
      { status: 500 }
    )
  }
}
