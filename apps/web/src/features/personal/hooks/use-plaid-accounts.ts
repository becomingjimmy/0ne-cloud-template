'use client'

import { useState, useEffect, useCallback } from 'react'

export interface PlaidAccount {
  id: string
  itemId: string
  accountId: string
  name: string
  officialName: string | null
  type: string
  subtype: string | null
  mask: string | null
  currentBalance: number | null
  availableBalance: number | null
  creditLimit: number | null
  isoCurrencyCode: string
  isHidden: boolean
  scope: 'personal' | 'business' | null
}

export interface PlaidItem {
  id: string
  itemId: string
  institutionId: string | null
  institutionName: string | null
  status: string
  errorCode: string | null
  lastSyncedAt: string | null
  createdAt: string
  accounts: PlaidAccount[]
}

interface UsePlaidAccountsReturn {
  items: PlaidItem[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
  hasAccounts: boolean
}

export function usePlaidAccounts(): UsePlaidAccountsReturn {
  const [items, setItems] = useState<PlaidItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/personal/banking/accounts')
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `API error: ${response.status}`)
      }

      const result = await response.json()
      setItems(result.items || [])
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const hasAccounts = items.some((item) => item.accounts.length > 0)

  return { items, isLoading, error, refetch: fetchData, hasAccounts }
}

export async function unlinkItem(itemId: string): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/personal/banking/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  })
  return response.json()
}
