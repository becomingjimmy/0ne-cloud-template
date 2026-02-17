import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@0ne/db/server'
import { sanitizeForPostgrestFilter } from '@/lib/postgrest-utils'

export const dynamic = 'force-dynamic'

export interface ExpenseCategoryRecord {
  id: string
  name: string
  slug: string
  color: string | null
  description: string | null
  is_system: boolean
  display_order: number
  created_at: string
  updated_at: string
  expense_count?: number
}

/**
 * GET /api/kpi/expense-categories
 * List all expense categories with expense counts
 */
export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServerClient()

    // Get all categories
    const { data: categories, error: categoriesError } = await supabase
      .from('expense_categories')
      .select('*')
      .order('display_order', { ascending: true })

    if (categoriesError) {
      console.error('Fetch categories error:', categoriesError)
      return NextResponse.json(
        { error: 'Failed to fetch categories', details: categoriesError.message },
        { status: 500 }
      )
    }

    // Get expense counts per category
    const { data: expenseCounts, error: countsError } = await supabase
      .from('expenses')
      .select('category')

    if (countsError) {
      console.error('Fetch expense counts error:', countsError)
    }

    // Count expenses by category (case-insensitive matching)
    const countMap = new Map<string, number>()
    expenseCounts?.forEach((exp) => {
      const cat = (exp.category || '').toLowerCase()
      countMap.set(cat, (countMap.get(cat) || 0) + 1)
    })

    // Attach counts to categories
    const categoriesWithCounts = categories.map((cat) => ({
      ...cat,
      expense_count: countMap.get(cat.name.toLowerCase()) || countMap.get(cat.slug) || 0,
    }))

    return NextResponse.json({
      categories: categoriesWithCounts,
      total: categoriesWithCounts.length,
    })
  } catch (error) {
    console.error('Expense categories GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch expense categories', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/kpi/expense-categories
 * Create a new expense category
 */
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, color, description } = body

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')

    const supabase = createServerClient()

    // Check for duplicate name or slug
    const safeName = sanitizeForPostgrestFilter(name.trim())
    const safeSlug = sanitizeForPostgrestFilter(slug)
    const { data: existing } = await supabase
      .from('expense_categories')
      .select('id')
      .or(`name.ilike.${safeName},slug.eq.${safeSlug}`)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 }
      )
    }

    // Get max display_order
    const { data: maxOrder } = await supabase
      .from('expense_categories')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1)

    const displayOrder = (maxOrder?.[0]?.display_order || 0) + 1

    // Insert new category
    const { data, error } = await supabase
      .from('expense_categories')
      .insert({
        name: name.trim(),
        slug,
        color: color || null,
        description: description || null,
        is_system: false,
        display_order: displayOrder,
      })
      .select()
      .single()

    if (error) {
      console.error('Insert category error:', error)
      return NextResponse.json(
        { error: 'Failed to create category', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, category: data })
  } catch (error) {
    console.error('Expense categories POST error:', error)
    return NextResponse.json(
      { error: 'Failed to create expense category', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/kpi/expense-categories
 * Update an existing expense category
 */
export async function PUT(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, name, color, description } = body

    // Validate required fields
    if (!id) {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      )
    }

    const supabase = createServerClient()

    // Get existing category
    const { data: existing, error: fetchError } = await supabase
      .from('expense_categories')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    // Prepare update object
    const updates: Record<string, unknown> = {}

    if (name !== undefined && name !== existing.name) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        )
      }

      // Check for duplicate name
      const { data: duplicate } = await supabase
        .from('expense_categories')
        .select('id')
        .ilike('name', name.trim())
        .neq('id', id)
        .limit(1)

      if (duplicate && duplicate.length > 0) {
        return NextResponse.json(
          { error: 'A category with this name already exists' },
          { status: 409 }
        )
      }

      updates.name = name.trim()
      // Update slug only if name changed (and not a system category)
      if (!existing.is_system) {
        updates.slug = name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
      }
    }

    if (color !== undefined) {
      updates.color = color || null
    }

    if (description !== undefined) {
      updates.description = description || null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: true, category: existing })
    }

    // Update category
    const { data, error } = await supabase
      .from('expense_categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update category error:', error)
      return NextResponse.json(
        { error: 'Failed to update category', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, category: data })
  } catch (error) {
    console.error('Expense categories PUT error:', error)
    return NextResponse.json(
      { error: 'Failed to update expense category', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/kpi/expense-categories
 * Delete an expense category (only if no expenses use it)
 */
export async function DELETE(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      )
    }

    const supabase = createServerClient()

    // Get the category
    const { data: category, error: fetchError } = await supabase
      .from('expense_categories')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !category) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    // Cannot delete system categories
    if (category.is_system) {
      return NextResponse.json(
        { error: 'System categories cannot be deleted' },
        { status: 403 }
      )
    }

    // Check if any expenses use this category
    // Note: category.name and category.slug come from the database (not user input),
    // so no sanitization needed — values are trusted
    const { data: expenses } = await supabase
      .from('expenses')
      .select('id')
      .or(`category.ilike.${category.name},category.eq.${category.slug}`)
      .limit(1)

    if (expenses && expenses.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete category that has expenses. Reassign expenses first.' },
        { status: 409 }
      )
    }

    // Delete the category
    const { error } = await supabase
      .from('expense_categories')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete category error:', error)
      return NextResponse.json(
        { error: 'Failed to delete category', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Expense categories DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete expense category', details: String(error) },
      { status: 500 }
    )
  }
}
