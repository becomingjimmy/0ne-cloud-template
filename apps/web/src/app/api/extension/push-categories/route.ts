/**
 * POST /api/extension/push-categories
 *
 * Receives category data fetched by the Chrome extension from Skool
 * and upserts them into the skool_categories cache table.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq } from '@0ne/db/server'
import { skoolCategories } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'
import { safeErrorResponse } from '@/lib/security'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

// =============================================
// Types
// =============================================

interface PushCategoriesRequest {
  groupSlug: string
  categories: Array<{
    id: string
    name: string
    position: number
  }>
}

interface PushCategoriesResponse {
  success: boolean
  count: number
  error?: string
}

// =============================================
// POST /api/extension/push-categories
// =============================================

export async function POST(request: NextRequest) {
  // Validate auth (supports both Clerk and API key)
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: PushCategoriesRequest = await request.json()

    // Validate request
    if (!body.groupSlug?.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: groupSlug' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!Array.isArray(body.categories) || body.categories.length === 0) {
      return NextResponse.json(
        { error: 'categories must be a non-empty array' },
        { status: 400, headers: corsHeaders }
      )
    }

    console.log(
      `[Extension API] Received ${body.categories.length} categories for group "${body.groupSlug}"`
    )

    const now = new Date()

    // Delete existing categories for this group, then insert fresh (atomic)
    const rows = body.categories.map((c, index) => ({
      groupSlug: body.groupSlug,
      skoolId: c.id,
      name: c.name,
      position: c.position ?? index,
      fetchedAt: now,
    }))

    try {
      await db.transaction(async (tx) => {
        await tx.delete(skoolCategories).where(eq(skoolCategories.groupSlug, body.groupSlug))
        await tx.insert(skoolCategories).values(rows)
      })
    } catch (txError) {
      console.error('[Extension API] Failed to replace categories:', txError)
      return NextResponse.json(
        { success: false, count: 0, error: txError instanceof Error ? txError.message : 'Unknown error' } as PushCategoriesResponse,
        { status: 500, headers: corsHeaders }
      )
    }

    console.log(
      `[Extension API] Saved ${body.categories.length} categories for "${body.groupSlug}"`
    )

    const response: PushCategoriesResponse = {
      success: true,
      count: body.categories.length,
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST push-categories exception:', error)
    return safeErrorResponse('Failed to push categories', error, 500, corsHeaders)
  }
}
