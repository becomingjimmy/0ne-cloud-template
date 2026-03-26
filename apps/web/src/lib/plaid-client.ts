import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode, type Transaction, type RemovedTransaction } from 'plaid'

let _plaidClient: PlaidApi | null = null

function getPlaidClient(): PlaidApi {
  if (!_plaidClient) {
    const clientId = process.env.PLAID_CLIENT_ID
    const secret = process.env.PLAID_SECRET
    if (!clientId || !secret) {
      throw new Error('Plaid not configured: PLAID_CLIENT_ID and PLAID_SECRET are required')
    }
    const configuration = new Configuration({
      basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    })
    _plaidClient = new PlaidApi(configuration)
  }
  return _plaidClient
}

export async function createLinkToken(userId: string): Promise<string> {
  const response = await getPlaidClient().linkTokenCreate({
    user: { client_user_id: userId },
    client_name: '0ne Cloud',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  })
  return response.data.link_token
}

export async function exchangePublicToken(publicToken: string) {
  const response = await getPlaidClient().itemPublicTokenExchange({
    public_token: publicToken,
  })
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  }
}

export async function syncTransactions(accessToken: string, cursor?: string | null) {
  const allAdded: Transaction[] = []
  const allModified: Transaction[] = []
  const allRemoved: RemovedTransaction[] = []
  let hasMore = true
  let nextCursor = cursor || undefined

  const MAX_PAGES = 100
  let pageCount = 0

  while (hasMore && pageCount < MAX_PAGES) {
    pageCount++
    const response = await getPlaidClient().transactionsSync({
      access_token: accessToken,
      cursor: nextCursor,
    })

    allAdded.push(...response.data.added)
    allModified.push(...response.data.modified)
    allRemoved.push(...response.data.removed)
    hasMore = response.data.has_more
    nextCursor = response.data.next_cursor
  }

  if (pageCount >= MAX_PAGES) {
    console.warn('[Plaid] syncTransactions hit max page limit')
  }

  return {
    added: allAdded,
    modified: allModified,
    removed: allRemoved,
    cursor: nextCursor!,
  }
}

export async function getBalances(accessToken: string) {
  const response = await getPlaidClient().accountsBalanceGet({
    access_token: accessToken,
  })
  return response.data.accounts
}

export async function getItemInfo(accessToken: string) {
  const response = await getPlaidClient().itemGet({
    access_token: accessToken,
  })
  return response.data.item
}

export async function getInstitution(institutionId: string) {
  const response = await getPlaidClient().institutionsGetById({
    institution_id: institutionId,
    country_codes: [CountryCode.Us],
  })
  return response.data.institution
}

export async function removeItem(accessToken: string) {
  await getPlaidClient().itemRemove({
    access_token: accessToken,
  })
}
