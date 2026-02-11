import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { getCategories as fetchCategoriesFromSkool } from '@/features/skool/lib/post-client'

export const dynamic = 'force-dynamic'

// Fallback categories for the Fruitful community (used when all else fails)
const FRUITFUL_FALLBACK_CATEGORIES = [
  { id: null, name: 'The Money Room' },
  { id: null, name: 'Funding Club' },
  { id: null, name: 'Funding Hot Seat' },
  { id: null, name: 'General' },
  { id: null, name: 'Wins' },
]

/**
 * GET /api/skool/categories
 * Fetch Skool community categories/labels for dropdown selection
 *
 * Returns categories from database cache. If cache is empty, triggers a refresh from Skool.
 *
 * Query params:
 * - group: Group slug (default: 'fruitful')
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const groupSlug = searchParams.get('group') || 'fruitful'

    const supabase = createServerClient()

    // Try to get cached categories from database
    const { data: cachedCategories, error: cacheError } = await supabase
      .from('skool_categories')
      .select('skool_id, name, position, fetched_at')
      .eq('group_slug', groupSlug)
      .order('position')

    if (cacheError) {
      console.warn('[Categories API] Cache fetch error:', cacheError.message)
    }

    // If we have cached categories, return them
    if (cachedCategories && cachedCategories.length > 0) {
      const lastFetched = cachedCategories[0]?.fetched_at

      return NextResponse.json({
        categories: cachedCategories.map((c) => ({
          id: c.skool_id,
          name: c.name,
        })),
        source: 'database',
        lastFetched,
        count: cachedCategories.length,
      })
    }

    // Cache is empty - try to fetch from Skool
    console.log('[Categories API] Cache empty, fetching from Skool...')
    const skoolResult = await fetchCategoriesFromSkool(groupSlug)

    if ('error' in skoolResult) {
      console.warn('[Categories API] Skool fetch error:', skoolResult.error)
      // Return fallback
      return NextResponse.json({
        categories: FRUITFUL_FALLBACK_CATEGORIES,
        source: 'fallback',
        note: 'Cache empty and could not fetch from Skool. Click "Refresh" to try again.',
        error: skoolResult.error,
      })
    }

    // Save to database
    await saveCategoriestoDatabase(supabase, groupSlug, skoolResult)

    return NextResponse.json({
      categories: skoolResult.map((c) => ({
        id: c.id,
        name: c.name,
      })),
      source: 'skool_api',
      lastFetched: new Date().toISOString(),
      count: skoolResult.length,
    })
  } catch (error) {
    console.error('[Categories API] GET exception:', error)
    return NextResponse.json({
      categories: FRUITFUL_FALLBACK_CATEGORIES,
      source: 'fallback',
      note: 'API error - using fallback categories.',
      error: String(error),
    })
  }
}

/**
 * POST /api/skool/categories
 * Force refresh categories from Skool
 *
 * Body:
 * - group: Group slug (default: 'fruitful')
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const groupSlug = body.group || 'fruitful'

    console.log(`[Categories API] Force refresh for group: ${groupSlug}`)

    // Fetch fresh from Skool
    const skoolResult = await fetchCategoriesFromSkool(groupSlug)

    if ('error' in skoolResult) {
      return NextResponse.json(
        {
          error: skoolResult.error,
          message: 'Failed to fetch categories from Skool',
        },
        { status: 502 }
      )
    }

    // Save to database
    const supabase = createServerClient()
    await saveCategoriestoDatabase(supabase, groupSlug, skoolResult)

    return NextResponse.json({
      success: true,
      categories: skoolResult.map((c) => ({
        id: c.id,
        name: c.name,
      })),
      source: 'skool_api',
      lastFetched: new Date().toISOString(),
      count: skoolResult.length,
    })
  } catch (error) {
    console.error('[Categories API] POST exception:', error)
    return NextResponse.json(
      { error: 'Failed to refresh categories', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * Save categories to database
 */
async function saveCategoriestoDatabase(
  supabase: ReturnType<typeof createServerClient>,
  groupSlug: string,
  categories: { id: string; name: string; position?: number }[]
) {
  // Delete existing categories for this group
  await supabase.from('skool_categories').delete().eq('group_slug', groupSlug)

  // Insert new categories
  const { error } = await supabase.from('skool_categories').insert(
    categories.map((c, index) => ({
      group_slug: groupSlug,
      skool_id: c.id,
      name: c.name,
      position: c.position ?? index,
      fetched_at: new Date().toISOString(),
    }))
  )

  if (error) {
    console.error('[Categories API] Failed to save to database:', error)
  } else {
    console.log(`[Categories API] Saved ${categories.length} categories to database`)
  }
}
