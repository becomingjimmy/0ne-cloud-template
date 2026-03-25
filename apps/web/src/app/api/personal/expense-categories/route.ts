import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, asc, desc, ilike, or, ne, and } from '@0ne/db/server'
import { personalExpenseCategories, personalExpenses } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/personal/expense-categories
 * List all personal expense categories with expense counts
 */
export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get all categories
    const categories = await db.select()
      .from(personalExpenseCategories)
      .orderBy(asc(personalExpenseCategories.displayOrder))

    // Get expense counts per category
    const expenseCounts = await db.select({ category: personalExpenses.category })
      .from(personalExpenses)

    // Count expenses by category (case-insensitive matching)
    const countMap = new Map<string, number>()
    expenseCounts.forEach((exp) => {
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
    console.error('Personal expense categories GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch personal expense categories', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/personal/expense-categories
 * Create a new personal expense category
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
    const existing = await db.select({ id: personalExpenseCategories.id })
      .from(personalExpenseCategories)
      .where(or(
        ilike(personalExpenseCategories.name, name.trim()),
        eq(personalExpenseCategories.slug, slug),
      ))
      .limit(1)

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 }
      )
    }

    // Get max display_order
    const maxOrder = await db.select({ displayOrder: personalExpenseCategories.displayOrder })
      .from(personalExpenseCategories)
      .orderBy(desc(personalExpenseCategories.displayOrder))
      .limit(1)

    const displayOrder = (maxOrder[0]?.displayOrder || 0) + 1

    // Insert new category
    const [category] = await db.insert(personalExpenseCategories).values({
      name: name.trim(),
      slug,
      color: color || null,
      description: description || null,
      displayOrder,
    }).returning()

    return NextResponse.json({ success: true, category })
  } catch (error) {
    console.error('Personal expense categories POST error:', error)
    return NextResponse.json(
      { error: 'Failed to create personal expense category', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/personal/expense-categories
 * Update an existing personal expense category
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
    const [existing] = await db.select()
      .from(personalExpenseCategories)
      .where(eq(personalExpenseCategories.id, id))

    if (!existing) {
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
      const duplicate = await db.select({ id: personalExpenseCategories.id })
        .from(personalExpenseCategories)
        .where(and(
          ilike(personalExpenseCategories.name, name.trim()),
          ne(personalExpenseCategories.id, id),
        ))
        .limit(1)

      if (duplicate.length > 0) {
        return NextResponse.json(
          { error: 'A category with this name already exists' },
          { status: 409 }
        )
      }

      updates.name = name.trim()
      // Update slug when name changes
      updates.slug = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
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
    const [category] = await db.update(personalExpenseCategories)
      .set(updates)
      .where(eq(personalExpenseCategories.id, id))
      .returning()

    return NextResponse.json({ success: true, category })
  } catch (error) {
    console.error('Personal expense categories PUT error:', error)
    return NextResponse.json(
      { error: 'Failed to update personal expense category', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/personal/expense-categories
 * Delete a personal expense category (only if no expenses use it)
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
    const [category] = await db.select()
      .from(personalExpenseCategories)
      .where(eq(personalExpenseCategories.id, id))

    if (!category) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    // Check if any personal expenses use this category
    const expenses = await db.select({ id: personalExpenses.id })
      .from(personalExpenses)
      .where(or(
        ilike(personalExpenses.category, category.name),
        eq(personalExpenses.category, category.slug),
      ))
      .limit(1)

    if (expenses.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete category that has expenses. Reassign expenses first.' },
        { status: 409 }
      )
    }

    // Delete the category
    await db.delete(personalExpenseCategories)
      .where(eq(personalExpenseCategories.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Personal expense categories DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete personal expense category', details: String(error) },
      { status: 500 }
    )
  }
}
