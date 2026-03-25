import { NextResponse } from 'next/server'
import { db, eq } from '@0ne/db/server'
import { plaidItems, plaidAccounts, plaidTransactions, plaidCategoryMappings } from '@0ne/db/server'
import { syncTransactions } from '@/lib/plaid-client'
import { decryptAccessToken } from '@/lib/plaid-encryption'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get all active items
    const items = await db
      .select({
        id: plaidItems.id,
        itemId: plaidItems.itemId,
        accessToken: plaidItems.accessToken,
        transactionCursor: plaidItems.transactionCursor,
      })
      .from(plaidItems)
      .where(eq(plaidItems.status, 'active'))

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active items to sync',
        synced: 0,
        timestamp: new Date().toISOString(),
      })
    }

    // Get category mappings
    const mappings = await db
      .select({
        plaidPrimary: plaidCategoryMappings.plaidPrimary,
        plaidDetailed: plaidCategoryMappings.plaidDetailed,
        expenseCategorySlug: plaidCategoryMappings.expenseCategorySlug,
      })
      .from(plaidCategoryMappings)

    const mappingLookup = new Map<string, string>()
    mappings.forEach((m) => {
      if (m.plaidDetailed && m.expenseCategorySlug) {
        mappingLookup.set(`${m.plaidPrimary}:${m.plaidDetailed}`, m.expenseCategorySlug)
      }
      if (!mappingLookup.has(m.plaidPrimary) && m.expenseCategorySlug) {
        mappingLookup.set(m.plaidPrimary, m.expenseCategorySlug)
      }
    })

    let totalSynced = 0
    let errors = 0

    for (const item of items) {
      try {
        const decryptedToken = decryptAccessToken(item.accessToken)
        const { added, modified, removed, cursor } = await syncTransactions(
          decryptedToken,
          item.transactionCursor
        )

        // Get account mapping
        const accounts = await db
          .select({ id: plaidAccounts.id, accountId: plaidAccounts.accountId })
          .from(plaidAccounts)
          .where(eq(plaidAccounts.itemId, item.id))

        const accountMap = new Map<string, string>()
        accounts.forEach((a) => accountMap.set(a.accountId, a.id))

        // Process added
        for (const txn of added) {
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

          try {
            const record = {
              transactionId: txn.transaction_id,
              accountId: ourAccountId,
              amount: Number(txn.amount),
              date: txn.date,
              name: txn.name || null,
              merchantName: txn.merchant_name || null,
              category: txn.category || [],
              personalFinanceCategoryPrimary: primary,
              personalFinanceCategoryDetailed: detailed,
              mappedCategory: mappedCategory,
              isPending: txn.pending || false,
            }

            await db
              .insert(plaidTransactions)
              .values(record)
              .onConflictDoUpdate({
                target: [plaidTransactions.transactionId],
                set: {
                  accountId: record.accountId,
                  amount: record.amount,
                  date: record.date,
                  name: record.name,
                  merchantName: record.merchantName,
                  category: record.category,
                  personalFinanceCategoryPrimary: record.personalFinanceCategoryPrimary,
                  personalFinanceCategoryDetailed: record.personalFinanceCategoryDetailed,
                  mappedCategory: record.mappedCategory,
                  isPending: record.isPending,
                },
              })

            totalSynced++
          } catch {
            continue
          }
        }

        // Process modified
        for (const txn of modified) {
          const ourAccountId = accountMap.get(txn.account_id)
          if (!ourAccountId) continue

          const primary = txn.personal_finance_category?.primary || null
          const detailed = txn.personal_finance_category?.detailed || null
          let mappedCategory: string | null = null
          if (primary && detailed) mappedCategory = mappingLookup.get(`${primary}:${detailed}`) || null
          if (!mappedCategory && primary) mappedCategory = mappingLookup.get(primary) || null

          await db
            .update(plaidTransactions)
            .set({
              amount: Number(txn.amount),
              date: txn.date,
              name: txn.name || null,
              merchantName: txn.merchant_name || null,
              mappedCategory: mappedCategory,
              isPending: txn.pending || false,
            })
            .where(eq(plaidTransactions.transactionId, txn.transaction_id))
        }

        // Process removed
        for (const txn of removed) {
          await db
            .delete(plaidTransactions)
            .where(eq(plaidTransactions.transactionId, txn.transaction_id))
        }

        // Update cursor
        await db
          .update(plaidItems)
          .set({
            transactionCursor: cursor,
            lastSyncedAt: new Date(),
          })
          .where(eq(plaidItems.id, item.id))

      } catch (itemError) {
        console.error(`Cron: Error syncing item ${item.id}:`, itemError)
        errors++
      }
    }

    return NextResponse.json({
      success: true,
      synced: totalSynced,
      errors,
      items_processed: items.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Plaid cron sync error:', error)
    return NextResponse.json(
      { error: 'Cron sync failed', details: String(error) },
      { status: 500 }
    )
  }
}
