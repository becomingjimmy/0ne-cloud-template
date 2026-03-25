import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, lt, count, and } from '@0ne/db/server'
import { personalExpenses, personalExpenseCategories } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

interface DateRangeResult {
  startDate: string
  endDate: string
}

function getDateRangeFromPeriod(period: string): DateRangeResult {
  const now = new Date()
  const endDate = now.toISOString().split('T')[0]
  let startDate: Date

  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      break
    case 'mtd': {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    }
    case 'lastMonth': {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      return {
        startDate: lastMonth.toISOString().split('T')[0],
        endDate: new Date(thisMonth.getTime() - 1).toISOString().split('T')[0],
      }
    }
    case 'ytd':
      startDate = new Date(now.getFullYear(), 0, 1)
      break
    case 'lifetime':
      startDate = new Date('2020-01-01')
      break
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate,
  }
}

/**
 * Parse date range from request params
 * Priority: explicit startDate/endDate > period preset
 */
function parseDateRange(searchParams: URLSearchParams): DateRangeResult {
  const startDateParam = searchParams.get('startDate')
  const endDateParam = searchParams.get('endDate')

  // If explicit dates provided, use them
  if (startDateParam && endDateParam) {
    return { startDate: startDateParam, endDate: endDateParam }
  }

  // Fall back to period preset
  const period = searchParams.get('period') || 'mtd'
  return getDateRangeFromPeriod(period)
}

function calculateChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

/**
 * GET /api/personal/expenses
 * Fetch personal expenses with summary, category breakdown, and monthly trends
 */
export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') || null

    // Parse date range from explicit params or period preset
    const { startDate, endDate } = parseDateRange(searchParams)
    const previousPeriodLength = new Date(endDate).getTime() - new Date(startDate).getTime()
    const previousStartDate = new Date(new Date(startDate).getTime() - previousPeriodLength)
      .toISOString()
      .split('T')[0]

    // Build queries
    const categoriesQuery = db.select({
      id: personalExpenseCategories.id,
      name: personalExpenseCategories.name,
      slug: personalExpenseCategories.slug,
      color: personalExpenseCategories.color,
    }).from(personalExpenseCategories)

    const currentFilters = [
      gte(personalExpenses.expenseDate, startDate),
      lte(personalExpenses.expenseDate, endDate),
      ...(category ? [eq(personalExpenses.category, category)] : []),
    ]

    const currentQuery = db.select({
      id: personalExpenses.id,
      name: personalExpenses.name,
      category: personalExpenses.category,
      amount: personalExpenses.amount,
      frequency: personalExpenses.frequency,
      expenseDate: personalExpenses.expenseDate,
      isActive: personalExpenses.isActive,
      notes: personalExpenses.notes,
    }).from(personalExpenses).where(and(...currentFilters))

    const prevFilters = [
      gte(personalExpenses.expenseDate, previousStartDate),
      lt(personalExpenses.expenseDate, startDate),
      ...(category ? [eq(personalExpenses.category, category)] : []),
    ]

    const prevQuery = db.select({
      category: personalExpenses.category,
      amount: personalExpenses.amount,
    }).from(personalExpenses).where(and(...prevFilters))

    const activeCountQuery = db.select({ count: count() })
      .from(personalExpenses)
      .where(eq(personalExpenses.isActive, true))

    // Run all 4 queries in parallel
    const [
      expenseCategories,
      currentExpenses,
      previousExpenses,
      activeCountResult,
    ] = await Promise.all([categoriesQuery, currentQuery, prevQuery, activeCountQuery])

    const activeExpenseCount = activeCountResult[0]?.count ?? 0

    // Build lookup map: lowercase category -> canonical display info
    const categoryCanonical = new Map<string, { id: string; name: string; color: string }>()
    expenseCategories.forEach((cat) => {
      categoryCanonical.set(cat.name.toLowerCase(), {
        id: cat.id,
        name: cat.name,
        color: cat.color || '#6b7280',
      })
    })

    // Group expenses by category
    const categoryMap = new Map<string, { current: number; previous: number; displayName: string; color: string; categoryId: string }>()

    const getCategoryKey = (cat: string) => cat.toLowerCase()
    const getCanonicalInfo = (catKey: string) => {
      const canonical = categoryCanonical.get(catKey)
      return canonical || {
        id: catKey.replace(/\s+/g, '_'),
        name: catKey.charAt(0).toUpperCase() + catKey.slice(1),
        color: '#6b7280',
      }
    }

    currentExpenses.forEach((exp) => {
      const rawCat = exp.category || 'Other'
      const catKey = getCategoryKey(rawCat)
      if (!categoryMap.has(catKey)) {
        const canonical = getCanonicalInfo(catKey)
        categoryMap.set(catKey, {
          current: 0,
          previous: 0,
          displayName: canonical.name,
          color: canonical.color,
          categoryId: canonical.id,
        })
      }
      const entry = categoryMap.get(catKey)!
      entry.current += Number(exp.amount) || 0
    })

    previousExpenses.forEach((exp) => {
      const rawCat = exp.category || 'Other'
      const catKey = getCategoryKey(rawCat)
      if (!categoryMap.has(catKey)) {
        const canonical = getCanonicalInfo(catKey)
        categoryMap.set(catKey, {
          current: 0,
          previous: 0,
          displayName: canonical.name,
          color: canonical.color,
          categoryId: canonical.id,
        })
      }
      const entry = categoryMap.get(catKey)!
      entry.previous += Number(exp.amount) || 0
    })

    const categories = Array.from(categoryMap.entries()).map(([_key, data]) => ({
      id: data.categoryId,
      name: data.displayName,
      amount: data.current,
      change: Number(calculateChange(data.current, data.previous).toFixed(1)),
      trend: (data.current > data.previous ? 'up' : data.current < data.previous ? 'down' : 'neutral') as 'up' | 'down' | 'neutral',
      color: data.color,
    })).sort((a, b) => b.amount - a.amount)

    // Monthly trends — group by YYYY-MM with per-category breakdown
    const monthlyMap = new Map<string, { total: number; byCategory: Record<string, number> }>()

    currentExpenses.forEach((exp) => {
      const month = (exp.expenseDate ?? '').substring(0, 7) // YYYY-MM
      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, { total: 0, byCategory: {} })
      }
      const entry = monthlyMap.get(month)!
      const amount = Number(exp.amount) || 0
      entry.total += amount

      const catName = getCanonicalInfo(getCategoryKey(exp.category || 'Other')).name
      entry.byCategory[catName] = (entry.byCategory[catName] || 0) + amount
    })

    const monthly = Array.from(monthlyMap.entries())
      .map(([month, data]) => ({ month, total: data.total, byCategory: data.byCategory }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // Calculate summary
    const totalExpenses = categories.reduce((sum, c) => sum + c.amount, 0)
    const monthCount = Math.max(monthly.length, 1)
    const monthlyBurnRate = Number((totalExpenses / monthCount).toFixed(2))

    // Format individual expenses for the list
    const expenses = currentExpenses.map((exp) => {
      const catKey = (exp.category || 'other').toLowerCase()
      const canonical = getCanonicalInfo(catKey)
      return {
        id: exp.id,
        name: exp.name || 'Unnamed',
        category: canonical.name,
        amount: Number(exp.amount) || 0,
        frequency: exp.frequency || 'one_time',
        isActive: exp.isActive !== false,
        expenseDate: exp.expenseDate,
        notes: exp.notes || null,
      }
    })

    const response = {
      summary: {
        totalExpenses,
        monthlyBurnRate,
        categoryCount: categories.length,
        activeExpenses: activeExpenseCount || 0,
      },
      categories,
      monthly,
      expenses,
      period: {
        startDate,
        endDate,
        label: searchParams.get('period') || 'custom',
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Personal Expenses GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch personal expense data', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/personal/expenses
 * Create a new personal expense
 */
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { description, amount, category, expense_date, frequency, notes } = body

    // Validate required fields
    if (!description || !amount || !category || !expense_date) {
      return NextResponse.json(
        { error: 'Missing required fields: description, amount, category, expense_date' },
        { status: 400 }
      )
    }

    const [expense] = await db.insert(personalExpenses).values({
      name: description, // Map description to name column
      amount: String(Number(amount)),
      category,
      expenseDate: expense_date,
      frequency: frequency || 'one_time',
      isActive: true,
      notes: notes || null,
    }).returning()

    return NextResponse.json({ success: true, expense })
  } catch (error) {
    console.error('Add personal expense error:', error)
    return NextResponse.json(
      { error: 'Failed to add expense', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/personal/expenses
 * Update an existing personal expense
 */
export async function PUT(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, description, amount, category, frequency, expense_date, notes } = body

    // Validate required fields
    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    if (!description || !amount || !category) {
      return NextResponse.json(
        { error: 'Missing required fields: description, amount, category' },
        { status: 400 }
      )
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {
      name: description, // Map description to name column
      amount: String(Number(amount)),
      category,
    }

    if (frequency) {
      updateData.frequency = frequency
    }
    if (expense_date) {
      updateData.expenseDate = expense_date
    }
    if (notes !== undefined) {
      updateData.notes = notes || null
    }

    // Update the expense directly — check result instead of pre-fetching
    const [expense] = await db.update(personalExpenses)
      .set(updateData)
      .where(eq(personalExpenses.id, id))
      .returning()

    if (!expense) {
      return NextResponse.json(
        { error: 'Expense not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, expense })
  } catch (error) {
    console.error('Update personal expense error:', error)
    return NextResponse.json(
      { error: 'Failed to update expense', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/personal/expenses
 * Toggle active status on a personal expense
 */
export async function PATCH(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, is_active } = body

    // Validate required fields
    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    if (typeof is_active !== 'boolean') {
      return NextResponse.json(
        { error: 'is_active must be a boolean' },
        { status: 400 }
      )
    }

    // Update directly — check result instead of pre-fetching
    const [expense] = await db.update(personalExpenses)
      .set({ isActive: is_active })
      .where(eq(personalExpenses.id, id))
      .returning()

    if (!expense) {
      return NextResponse.json(
        { error: 'Expense not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, expense })
  } catch (error) {
    console.error('Patch personal expense error:', error)
    return NextResponse.json(
      { error: 'Failed to update expense', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/personal/expenses
 * Delete a personal expense by ID
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
        { error: 'Missing required query parameter: id' },
        { status: 400 }
      )
    }

    // Delete directly — check result
    const [deleted] = await db.delete(personalExpenses)
      .where(eq(personalExpenses.id, id))
      .returning({ id: personalExpenses.id })

    if (!deleted) {
      return NextResponse.json(
        { error: 'Expense not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete personal expense error:', error)
    return NextResponse.json(
      { error: 'Failed to delete expense', details: String(error) },
      { status: 500 }
    )
  }
}
