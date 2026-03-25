import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq } from '@0ne/db/server'
import { plaidItems, plaidAccounts } from '@0ne/db/server'
import { exchangePublicToken, getBalances, getItemInfo, getInstitution } from '@/lib/plaid-client'
import { encryptAccessToken } from '@/lib/plaid-encryption'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { public_token } = await request.json()

    if (!public_token) {
      return NextResponse.json(
        { error: 'Missing required field: public_token' },
        { status: 400 }
      )
    }

    // Exchange public token for access token
    const { accessToken, itemId } = await exchangePublicToken(public_token)

    // Encrypt the access token before storing
    const encryptedToken = encryptAccessToken(accessToken)

    // Get item info for institution details
    const item = await getItemInfo(accessToken)
    let institutionName = 'Unknown Institution'
    if (item.institution_id) {
      try {
        const institution = await getInstitution(item.institution_id)
        institutionName = institution.name
      } catch {
        // Institution lookup can fail in sandbox, that's ok
      }
    }

    // Get initial account balances
    const accounts = await getBalances(accessToken)

    // Store the item
    const [plaidItem] = await db.insert(plaidItems).values({
      itemId: itemId,
      accessToken: encryptedToken,
      institutionId: item.institution_id,
      institutionName: institutionName,
      status: 'active',
    }).returning()

    // Store accounts with initial balances
    const accountRows = accounts.map((account) => ({
      itemId: plaidItem.id,
      accountId: account.account_id,
      name: account.name,
      officialName: account.official_name || null,
      type: account.type,
      subtype: account.subtype || null,
      mask: account.mask || null,
      currentBalance: Number(account.balances.current),
      availableBalance: Number(account.balances.available),
      creditLimit: account.balances.limit ? Number(account.balances.limit) : null,
      isoCurrencyCode: account.balances.iso_currency_code || 'USD',
    }))

    try {
      await db.insert(plaidAccounts).values(accountRows)
    } catch (accountsError) {
      console.error('Insert plaid accounts error:', accountsError)
      // Don't fail the whole request — item is saved, accounts can be re-fetched
    }

    return NextResponse.json({
      success: true,
      item: {
        id: plaidItem.id,
        institution_name: institutionName,
        account_count: accounts.length,
      },
    })
  } catch (error) {
    console.error('Exchange token error:', error)
    return NextResponse.json(
      { error: 'Failed to connect bank account', details: String(error) },
      { status: 500 }
    )
  }
}
