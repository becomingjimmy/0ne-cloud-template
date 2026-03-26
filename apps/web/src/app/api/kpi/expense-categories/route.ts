import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, ne, or, and, ilike, asc, desc } from '@0ne/db/server'
import { expenseCategories, expenses } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export interface ExpenseCategoryRecord {
  id: string
  name: string
  slug: string
  color: string | null
  description: string | null
  isSystem: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
  expenseCount?: number
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
    // Get all categories
    const categories = await db
      .select()
      .from(expenseCategories)
      .orderBy(asc(expenseCategories.displayOrder))

    // Get expense counts per category
    const expenseCounts = await db
      .select({ category: expenses.category })
      .from(expenses)

    // Count expenses by category (case-insensitive matching)
    const countMap = new Map<string, number>()
    expenseCounts.forEach((exp) => {
      const cat = (exp.category || '').toLowerCase()
      countMap.set(cat, (countMap.get(cat) || 0) + 1)
    })

    // Attach counts to categories
    const categoriesWithCounts = categories.map((cat) => ({
      ...cat,
      expenseCount: countMap.get(cat.name.toLowerCase()) || countMap.get(cat.slug) || 0,
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

    // Check for duplicate name or slug
    const existing = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(
        or(
          ilike(expenseCategories.name, name.trim()),
          eq(expenseCategories.slug, slug),
        )
      )
      .limit(1)

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 }
      )
    }

    // Get max display_order
    const maxOrder = await db
      .select({ displayOrder: expenseCategories.displayOrder })
      .from(expenseCategories)
      .orderBy(desc(expenseCategories.displayOrder))
      .limit(1)

    const displayOrder = (maxOrder[0]?.displayOrder || 0) + 1

    // Insert new category
    const [data] = await db
      .insert(expenseCategories)
      .values({
        name: name.trim(),
        slug,
        color: color || null,
        description: description || null,
        isSystem: false,
        displayOrder,
      })
      .returning()

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

    // Get existing category
    const [existing] = await db
      .select()
      .from(expenseCategories)
      .where(eq(expenseCategories.id, id))
      .limit(1)

    if (!existing) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    // Prepare update object
    const updates: Partial<{ name: string; slug: string; color: string | null; description: string | null }> = {}

    if (name !== undefined && name !== existing.name) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        )
      }

      // Check for duplicate name
      const duplicate = await db
        .select({ id: expenseCategories.id })
        .from(expenseCategories)
        .where(
          and(
            ilike(expenseCategories.name, name.trim()),
            ne(expenseCategories.id, id),
          )
        )
        .limit(1)

      if (duplicate.length > 0) {
        return NextResponse.json(
          { error: 'A category with this name already exists' },
          { status: 409 }
        )
      }

      updates.name = name.trim()
      // Update slug only if name changed (and not a system category)
      if (!existing.isSystem) {
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
    const [data] = await db
      .update(expenseCategories)
      .set(updates)
      .where(eq(expenseCategories.id, id))
      .returning()

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

    // Get the category
    const [category] = await db
      .select()
      .from(expenseCategories)
      .where(eq(expenseCategories.id, id))
      .limit(1)

    if (!category) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    // Cannot delete system categories
    if (category.isSystem) {
      return NextResponse.json(
        { error: 'System categories cannot be deleted' },
        { status: 403 }
      )
    }

    // Check if any expenses use this category
    const matchingExpenses = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(
        or(
          ilike(expenses.category, category.name),
          eq(expenses.category, category.slug),
        )
      )
      .limit(1)

    if (matchingExpenses.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete category that has expenses. Reassign expenses first.' },
        { status: 409 }
      )
    }

    // Delete the category
    await db
      .delete(expenseCategories)
      .where(eq(expenseCategories.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Expense categories DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete expense category', details: String(error) },
      { status: 500 }
    )
  }
}
