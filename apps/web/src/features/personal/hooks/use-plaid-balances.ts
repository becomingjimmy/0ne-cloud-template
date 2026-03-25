'use client'

import { useState, useEffect, useCallback } from 'react'

export interface PlaidBalanceAccount {
  id: string
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
  institutionName: string | null
}

export interface PlaidBalanceSummary {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  totalChecking: number
  totalSavings: number
}

interface UsePlaidBalancesReturn {
  accounts: PlaidBalanceAccount[]
  grouped: {
    checking: PlaidBalanceAccount[]
    savings: PlaidBalanceAccount[]
    credit: PlaidBalanceAccount[]
    other: PlaidBalanceAccount[]
  }
  summary: PlaidBalanceSummary | null
  isLoading: boolean
  error: Error | null
  refresh: () => Promise<void>
}

interface UsePlaidBalancesOptions {
  scope?: 'personal' | 'business'
}

export function usePlaidBalances(options?: UsePlaidBalancesOptions): UsePlaidBalancesReturn {
  const [accounts, setAccounts] = useState<PlaidBalanceAccount[]>([])
  const [grouped, setGrouped] = useState<UsePlaidBalancesReturn['grouped']>({
    checking: [],
    savings: [],
    credit: [],
    other: [],
  })
  const [summary, setSummary] = useState<PlaidBalanceSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async (refreshFromPlaid = false) => {
    setIsLoading(true)
    setError(null)

    try {
      const url = new URL('/api/personal/banking/balances', window.location.origin)
      if (refreshFromPlaid) url.searchParams.set('refresh', 'true')
      if (options?.scope) url.searchParams.set('scope', options.scope)

      const response = await fetch(url.toString())
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `API error: ${response.status}`)
      }

      const result = await response.json()
      setAccounts(result.accounts || [])
      setGrouped(result.grouped || { checking: [], savings: [], credit: [], other: [] })
      setSummary(result.summary || null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [options?.scope])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const refresh = useCallback(async () => {
    await fetchData(true)
  }, [fetchData])

  return { accounts, grouped, summary, isLoading, error, refresh }
}
