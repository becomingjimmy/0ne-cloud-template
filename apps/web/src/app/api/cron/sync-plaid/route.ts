import { NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { syncTransactions } from '@/lib/plaid-client'
import { decryptAccessToken } from '@/lib/plaid-encryption'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServerClient()

    // Get all active items
    const { data: items, error: itemsError } = await supabase
      .from('plaid_items')
      .select('id, item_id, access_token, transaction_cursor')
      .eq('status', 'active')

    if (itemsError || !items || items.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active items to sync',
        synced: 0,
        timestamp: new Date().toISOString(),
      })
    }

    // Get category mappings
    const { data: mappings } = await supabase
      .from('plaid_category_mappings')
      .select('plaid_primary, plaid_detailed, expense_category_slug')

    const mappingLookup = new Map<string, string>()
    mappings?.forEach((m) => {
      if (m.plaid_detailed) {
        mappingLookup.set(`${m.plaid_primary}:${m.plaid_detailed}`, m.expense_category_slug)
      }
      if (!mappingLookup.has(m.plaid_primary)) {
        mappingLookup.set(m.plaid_primary, m.expense_category_slug)
      }
    })

    let totalSynced = 0
    let errors = 0

    for (const item of items) {
      try {
        const accessToken = decryptAccessToken(item.access_token)
        const { added, modified, removed, cursor } = await syncTransactions(
          accessToken,
          item.transaction_cursor
        )

        // Get account mapping
        const { data: accounts } = await supabase
          .from('plaid_accounts')
          .select('id, account_id')
          .eq('item_id', item.id)

        const accountMap = new Map<string, string>()
        accounts?.forEach((a) => accountMap.set(a.account_id, a.id))

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

          const { error: txnError } = await supabase
            .from('plaid_transactions')
            .upsert({
              transaction_id: txn.transaction_id,
              account_id: ourAccountId,
              amount: txn.amount,
              date: txn.date,
              name: txn.name || null,
              merchant_name: txn.merchant_name || null,
              category: txn.category || [],
              personal_finance_category_primary: primary,
              personal_finance_category_detailed: detailed,
              mapped_category: mappedCategory,
              is_pending: txn.pending || false,
            }, { onConflict: 'transaction_id' })

          if (txnError) continue
          totalSynced++
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

          await supabase
            .from('plaid_transactions')
            .update({
              amount: txn.amount,
              date: txn.date,
              name: txn.name || null,
              merchant_name: txn.merchant_name || null,
              mapped_category: mappedCategory,
              is_pending: txn.pending || false,
            })
            .eq('transaction_id', txn.transaction_id)
        }

        // Process removed
        for (const txn of removed) {
          await supabase
            .from('plaid_transactions')
            .delete()
            .eq('transaction_id', txn.transaction_id)
        }

        // Update cursor
        await supabase
          .from('plaid_items')
          .update({
            transaction_cursor: cursor,
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', item.id)

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
