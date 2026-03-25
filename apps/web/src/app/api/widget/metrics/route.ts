import { NextResponse } from 'next/server'
import { db, eq, and, gte, lte } from '@0ne/db/server'
import { plaidAccounts, personalExpenses } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/widget/metrics
 * Returns personal finance KPIs for the Scriptable iOS widget.
 * Auth: Bearer token via WIDGET_API_KEY (not Clerk — widgets can't do browser sessions)
 */
export async function GET(request: Request) {
  // Validate bearer token
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token || token !== process.env.WIDGET_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 1. Cash on hand: personal-scoped, non-hidden depository accounts
    const accounts = await db
      .select({
        availableBalance: plaidAccounts.availableBalance,
        currentBalance: plaidAccounts.currentBalance,
        type: plaidAccounts.type,
        subtype: plaidAccounts.subtype,
      })
      .from(plaidAccounts)
      .where(
        and(
          eq(plaidAccounts.isHidden, false),
          eq(plaidAccounts.scope, 'personal'),
          eq(plaidAccounts.type, 'depository')
        )
      )

    const cashOnHand = accounts.reduce(
      (sum, a) => sum + (Number(a.availableBalance) || Number(a.currentBalance) || 0),
      0
    )

    // 2. Monthly burn rate — same calculation as the expenses page (MTD)
    //    Query current month expenses, sum amounts, divide by month count
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString().split('T')[0]!
    const today = now.toISOString().split('T')[0]!

    const expenses = await db
      .select({
        amount: personalExpenses.amount,
        category: personalExpenses.category,
        expenseDate: personalExpenses.expenseDate,
      })
      .from(personalExpenses)
      .where(
        and(
          gte(personalExpenses.expenseDate, startOfMonth),
          lte(personalExpenses.expenseDate, today)
        )
      )

    // Group by month to get month count (matches expenses API logic)
    const months = new Set<string>()
    let totalExpenses = 0
    for (const exp of expenses) {
      totalExpenses += Number(exp.amount) || 0
      if (exp.expenseDate) {
        months.add(exp.expenseDate.substring(0, 7))
      }
    }
    const monthCount = Math.max(months.size, 1)
    const monthlyBurnRate = totalExpenses / monthCount

    // 3. Runway calculations
    const dailyBurnRate = monthlyBurnRate / 30
    const runwayDays = dailyBurnRate > 0 ? cashOnHand / dailyBurnRate : 0
    const runwayMonths = monthlyBurnRate > 0 ? cashOnHand / monthlyBurnRate : 0

    return NextResponse.json({
      metrics: [
        { label: 'Cash On Hand', value: `$${Math.round(cashOnHand).toLocaleString('en-US')}` },
        { label: 'Burn Rate', value: `$${Math.round(monthlyBurnRate).toLocaleString('en-US')}/mo` },
        { label: 'Runway (Days)', value: runwayDays > 0 ? runwayDays.toFixed(1) : '—' },
        { label: 'Runway (Months)', value: runwayMonths > 0 ? runwayMonths.toFixed(1) : '—' },
      ],
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Widget metrics error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch metrics', details: String(error) },
      { status: 500 }
    )
  }
}
