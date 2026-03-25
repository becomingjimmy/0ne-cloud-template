import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, and } from '@0ne/db/server'
import { plaidItems, plaidAccounts, plaidTransactions, plaidCategoryMappings } from '@0ne/db/server'
import { syncTransactions } from '@/lib/plaid-client'
import { decryptAccessToken } from '@/lib/plaid-encryption'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const targetItemId = body.item_id || null

    // Get items to sync
    const whereClause = targetItemId
      ? and(eq(plaidItems.status, 'active'), eq(plaidItems.id, targetItemId))
      : eq(plaidItems.status, 'active')

    const filteredItems = await db.select({
      id: plaidItems.id,
      itemId: plaidItems.itemId,
      accessToken: plaidItems.accessToken,
      transactionCursor: plaidItems.transactionCursor,
    }).from(plaidItems)
      .where(whereClause)

    if (filteredItems.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active items to sync',
        synced: 0,
      })
    }

    // Get category mappings (used to tag transactions with mapped_category for display)
    const mappings = await db.select({
      plaidPrimary: plaidCategoryMappings.plaidPrimary,
      plaidDetailed: plaidCategoryMappings.plaidDetailed,
      expenseCategorySlug: plaidCategoryMappings.expenseCategorySlug,
    }).from(plaidCategoryMappings)

    const mappingLookup = new Map<string, string>()
    mappings.forEach((m) => {
      // Detailed mapping takes priority (key: "PRIMARY:DETAILED")
      if (m.plaidDetailed) {
        mappingLookup.set(`${m.plaidPrimary}:${m.plaidDetailed}`, m.expenseCategorySlug ?? '')
      }
      // Primary-only mapping (key: "PRIMARY")
      if (!mappingLookup.has(m.plaidPrimary)) {
        mappingLookup.set(m.plaidPrimary, m.expenseCategorySlug ?? '')
      }
    })

    let totalSynced = 0
    const errors: string[] = []

    for (const item of filteredItems) {
      try {
        const accessToken = decryptAccessToken(item.accessToken)

        // Sync transactions from Plaid
        const { added, modified, removed, cursor } = await syncTransactions(
          accessToken,
          item.transactionCursor
        )

        // Get account ID mapping (plaid account_id -> our UUID)
        const accountRows = await db.select({
          id: plaidAccounts.id,
          accountId: plaidAccounts.accountId,
        }).from(plaidAccounts)
          .where(eq(plaidAccounts.itemId, item.id))

        const accountMap = new Map<string, string>()
        accountRows.forEach((a) => accountMap.set(a.accountId, a.id))

        // Process added transactions
        for (const txn of added) {
          const ourAccountId = accountMap.get(txn.account_id)
          if (!ourAccountId) continue

          // Determine mapped category
          const primary = txn.personal_finance_category?.primary || null
          const detailed = txn.personal_finance_category?.detailed || null
          let mappedCategory: string | null = null

          if (primary && detailed) {
            mappedCategory = mappingLookup.get(`${primary}:${detailed}`) || null
          }
          if (!mappedCategory && primary) {
            mappedCategory = mappingLookup.get(primary) || null
          }

          // Upsert transaction
          try {
            await db.insert(plaidTransactions).values({
              transactionId: txn.transaction_id,
              accountId: ourAccountId,
              amount: txn.amount != null ? Number(txn.amount) : null,
              date: txn.date,
              name: txn.name || null,
              merchantName: txn.merchant_name || null,
              category: txn.category || [],
              personalFinanceCategoryPrimary: primary,
              personalFinanceCategoryDetailed: detailed,
              mappedCategory,
              isPending: txn.pending || false,
            }).onConflictDoUpdate({
              target: plaidTransactions.transactionId,
              set: {
                accountId: ourAccountId,
                amount: txn.amount != null ? Number(txn.amount) : null,
                date: txn.date,
                name: txn.name || null,
                merchantName: txn.merchant_name || null,
                category: txn.category || [],
                personalFinanceCategoryPrimary: primary,
                personalFinanceCategoryDetailed: detailed,
                mappedCategory,
                isPending: txn.pending || false,
              },
            })

            totalSynced++
          } catch (txnError) {
            console.error('Upsert transaction error:', txnError)
            continue
          }
        }

        // Process modified transactions
        for (const txn of modified) {
          const ourAccountId = accountMap.get(txn.account_id)
          if (!ourAccountId) continue

          const primary = txn.personal_finance_category?.primary || null
          const detailed = txn.personal_finance_category?.detailed || null
          let mappedCategory: string | null = null

          if (primary && detailed) {
            mappedCategory = mappingLookup.get(`${primary}:${detailed}`) || null
          }
          if (!mappedCategory && primary) {
            mappedCategory = mappingLookup.get(primary) || null
          }

          await db.update(plaidTransactions)
            .set({
              amount: txn.amount != null ? Number(txn.amount) : null,
              date: txn.date,
              name: txn.name || null,
              merchantName: txn.merchant_name || null,
              category: txn.category || [],
              personalFinanceCategoryPrimary: primary,
              personalFinanceCategoryDetailed: detailed,
              mappedCategory,
              isPending: txn.pending || false,
            })
            .where(eq(plaidTransactions.transactionId, txn.transaction_id))
        }

        // Process removed transactions
        for (const txn of removed) {
          await db.delete(plaidTransactions)
            .where(eq(plaidTransactions.transactionId, txn.transaction_id))
        }

        // Update cursor and last_synced_at on item
        await db.update(plaidItems)
          .set({
            transactionCursor: cursor,
            lastSyncedAt: new Date(),
          })
          .where(eq(plaidItems.id, item.id))

      } catch (itemError) {
        console.error(`Error syncing item ${item.id}:`, itemError)
        errors.push(`Item ${item.id}: ${String(itemError)}`)
      }
    }

    return NextResponse.json({
      success: true,
      synced: totalSynced,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Sync error:', error)
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    )
  }
}
