import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, desc, inArray, asc } from '@0ne/db/server'
import { plaidItems, plaidAccounts } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get all items with their accounts
    const items = await db.select({
      id: plaidItems.id,
      itemId: plaidItems.itemId,
      institutionId: plaidItems.institutionId,
      institutionName: plaidItems.institutionName,
      status: plaidItems.status,
      errorCode: plaidItems.errorCode,
      lastSyncedAt: plaidItems.lastSyncedAt,
      createdAt: plaidItems.createdAt,
    }).from(plaidItems)
      .orderBy(desc(plaidItems.createdAt))

    // Get accounts for all items
    const itemIds = items.map((item) => item.id)

    let accounts: (typeof plaidAccounts.$inferSelect)[] = []
    if (itemIds.length > 0) {
      accounts = await db.select()
        .from(plaidAccounts)
        .where(inArray(plaidAccounts.itemId, itemIds))
        .orderBy(asc(plaidAccounts.type))
    }

    // Group accounts by item
    const result = items.map((item) => ({
      ...item,
      accounts: accounts.filter((a) => a.itemId === item.id),
    }))

    return NextResponse.json({ items: result })
  } catch (error) {
    console.error('Plaid accounts GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch accounts', details: String(error) },
      { status: 500 }
    )
  }
}
