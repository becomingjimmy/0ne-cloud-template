import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, asc, and } from '@0ne/db/server'
import { plaidItems, plaidAccounts } from '@0ne/db/server'
import { getBalances } from '@/lib/plaid-client'
import { decryptAccessToken } from '@/lib/plaid-encryption'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const refresh = searchParams.get('refresh') === 'true'
    const scope = searchParams.get('scope') // 'personal', 'business', or null (all)

    if (refresh) {
      // Live-fetch from Plaid and update cache
      const items = await db.select({
        id: plaidItems.id,
        accessToken: plaidItems.accessToken,
      }).from(plaidItems)
        .where(eq(plaidItems.status, 'active'))

      for (const item of items) {
        try {
          const accessToken = decryptAccessToken(item.accessToken)
          const plaidAccountsList = await getBalances(accessToken)

          for (const account of plaidAccountsList) {
            await db.update(plaidAccounts)
              .set({
                currentBalance: account.balances.current ?? null,
                availableBalance: account.balances.available ?? null,
                creditLimit: account.balances.limit ?? null,
              })
              .where(eq(plaidAccounts.accountId, account.account_id))
          }
        } catch (error) {
          console.error(`Error refreshing balances for item ${item.id}:`, error)
        }
      }
    }

    // Return cached balances from DB — join with plaid_items for institution_name
    const filters = [
      eq(plaidAccounts.isHidden, false),
      ...(scope === 'personal' || scope === 'business' ? [eq(plaidAccounts.scope, scope)] : []),
    ]

    const accounts = await db.select({
      id: plaidAccounts.id,
      accountId: plaidAccounts.accountId,
      name: plaidAccounts.name,
      officialName: plaidAccounts.officialName,
      type: plaidAccounts.type,
      subtype: plaidAccounts.subtype,
      mask: plaidAccounts.mask,
      currentBalance: plaidAccounts.currentBalance,
      availableBalance: plaidAccounts.availableBalance,
      creditLimit: plaidAccounts.creditLimit,
      isoCurrencyCode: plaidAccounts.isoCurrencyCode,
      isHidden: plaidAccounts.isHidden,
      scope: plaidAccounts.scope,
      itemId: plaidAccounts.itemId,
      institutionName: plaidItems.institutionName,
    }).from(plaidAccounts)
      .leftJoin(plaidItems, eq(plaidAccounts.itemId, plaidItems.id))
      .where(and(...filters))
      .orderBy(asc(plaidAccounts.type))

    // Calculate summary
    const depository = accounts.filter((a) => a.type === 'depository')
    const credit = accounts.filter((a) => a.type === 'credit')

    const totalAssets = depository.reduce((sum, a) => sum + (a.currentBalance || 0), 0)
    const totalLiabilities = credit.reduce((sum, a) => sum + Math.abs(a.currentBalance || 0), 0)
    const netWorth = totalAssets - totalLiabilities

    // Group by type
    const grouped = {
      checking: depository.filter((a) => a.subtype === 'checking'),
      savings: depository.filter((a) => a.subtype === 'savings'),
      credit: credit,
      other: accounts.filter((a) => !['depository', 'credit'].includes(a.type ?? '')),
    }

    return NextResponse.json({
      accounts,
      grouped,
      summary: {
        totalAssets,
        totalLiabilities,
        netWorth,
        totalChecking: grouped.checking.reduce((sum, a) => sum + (a.availableBalance || a.currentBalance || 0), 0),
        totalSavings: grouped.savings.reduce((sum, a) => sum + (a.availableBalance || a.currentBalance || 0), 0),
      },
    })
  } catch (error) {
    console.error('Balances GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch balances', details: String(error) },
      { status: 500 }
    )
  }
}
