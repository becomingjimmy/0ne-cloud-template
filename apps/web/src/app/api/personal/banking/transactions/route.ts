import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, ilike, or, and, desc, count } from '@0ne/db/server'
import { plaidTransactions, plaidAccounts, plaidItems, personalExpenses } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('accountId')
    const scope = searchParams.get('scope')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const category = searchParams.get('category')
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    // Build dynamic filter conditions
    const conditions = []
    if (scope) {
      conditions.push(eq(plaidAccounts.scope, scope))
    }
    if (accountId) {
      conditions.push(eq(plaidTransactions.accountId, accountId))
    }
    if (startDate) {
      conditions.push(gte(plaidTransactions.date, startDate))
    }
    if (endDate) {
      conditions.push(lte(plaidTransactions.date, endDate))
    }
    if (category) {
      conditions.push(eq(plaidTransactions.mappedCategory, category))
    }
    if (search) {
      conditions.push(or(
        ilike(plaidTransactions.name, `%${search}%`),
        ilike(plaidTransactions.merchantName, `%${search}%`),
      ))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Run data query and count query in parallel
    const [transactions, countResult] = await Promise.all([
      db.select({
        id: plaidTransactions.id,
        transactionId: plaidTransactions.transactionId,
        accountId: plaidTransactions.accountId,
        amount: plaidTransactions.amount,
        date: plaidTransactions.date,
        name: plaidTransactions.name,
        merchantName: plaidTransactions.merchantName,
        category: plaidTransactions.category,
        personalFinanceCategoryPrimary: plaidTransactions.personalFinanceCategoryPrimary,
        personalFinanceCategoryDetailed: plaidTransactions.personalFinanceCategoryDetailed,
        mappedCategory: plaidTransactions.mappedCategory,
        personalExpenseId: plaidTransactions.personalExpenseId,
        isExcluded: plaidTransactions.isExcluded,
        isPending: plaidTransactions.isPending,
        createdAt: plaidTransactions.createdAt,
        updatedAt: plaidTransactions.updatedAt,
        accountName: plaidAccounts.name,
        accountMask: plaidAccounts.mask,
        accountType: plaidAccounts.type,
        accountScope: plaidAccounts.scope,
        accountItemId: plaidAccounts.itemId,
        institutionName: plaidItems.institutionName,
      })
        .from(plaidTransactions)
        .innerJoin(plaidAccounts, eq(plaidTransactions.accountId, plaidAccounts.id))
        .leftJoin(plaidItems, eq(plaidAccounts.itemId, plaidItems.id))
        .where(whereClause)
        .orderBy(desc(plaidTransactions.date))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() })
        .from(plaidTransactions)
        .innerJoin(plaidAccounts, eq(plaidTransactions.accountId, plaidAccounts.id))
        .where(whereClause),
    ])

    return NextResponse.json({
      transactions,
      total: countResult[0]?.count ?? 0,
      page,
      limit,
    })
  } catch (error) {
    console.error('Transactions GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transactions', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/personal/banking/transactions
 * Promote a bank transaction to a tracked personal expense
 */
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { transaction_id } = body

    if (!transaction_id) {
      return NextResponse.json(
        { error: 'Missing required field: transaction_id' },
        { status: 400 }
      )
    }

    // Fetch the transaction
    const [txn] = await db.select({
      id: plaidTransactions.id,
      transactionId: plaidTransactions.transactionId,
      amount: plaidTransactions.amount,
      date: plaidTransactions.date,
      name: plaidTransactions.name,
      merchantName: plaidTransactions.merchantName,
      mappedCategory: plaidTransactions.mappedCategory,
      personalExpenseId: plaidTransactions.personalExpenseId,
    }).from(plaidTransactions)
      .where(eq(plaidTransactions.id, transaction_id))

    if (!txn) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      )
    }

    // Already promoted
    if (txn.personalExpenseId) {
      return NextResponse.json(
        { error: 'Transaction already added to expenses' },
        { status: 409 }
      )
    }

    // Create the personal expense
    const [expense] = await db.insert(personalExpenses).values({
      name: txn.merchantName || txn.name || 'Unknown',
      category: txn.mappedCategory || 'other',
      amount: String(Math.abs(Number(txn.amount))),
      expenseDate: txn.date,
      frequency: 'one_time',
      isActive: true,
      notes: `From bank transaction (${txn.transactionId})`,
    }).returning({ id: personalExpenses.id })

    // Link transaction back to the expense
    await db.update(plaidTransactions)
      .set({ personalExpenseId: expense.id })
      .where(eq(plaidTransactions.id, txn.id))

    return NextResponse.json({ success: true, expense_id: expense.id })
  } catch (error) {
    console.error('Promote transaction error:', error)
    return NextResponse.json(
      { error: 'Failed to promote transaction', details: String(error) },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, is_excluded, mapped_category } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    const updateData: Record<string, unknown> = {}

    if (typeof is_excluded === 'boolean') {
      updateData.isExcluded = is_excluded
    }
    if (mapped_category !== undefined) {
      updateData.mappedCategory = mapped_category
    }

    const [transaction] = await db.update(plaidTransactions)
      .set(updateData)
      .where(eq(plaidTransactions.id, id))
      .returning()

    if (!transaction) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, transaction })
  } catch (error) {
    console.error('Transaction PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update transaction', details: String(error) },
      { status: 500 }
    )
  }
}
