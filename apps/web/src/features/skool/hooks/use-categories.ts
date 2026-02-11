'use client'

import useSWR from 'swr'
import { useCallback, useState } from 'react'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export interface SchedulerCategory {
  id: string | null
  name: string
}

export interface UseCategoriesReturn {
  categories: SchedulerCategory[]
  isLoading: boolean
  error: Error | undefined
  source: 'skool_api' | 'database' | 'fallback' | undefined
  lastFetched: string | undefined
  isRefreshing: boolean
  refresh: () => Promise<void>
}

/**
 * Hook for fetching Skool community categories
 *
 * Categories are cached in the database. Use refresh() to force-fetch from Skool.
 */
export function useCategories(groupSlug?: string): UseCategoriesReturn {
  const url = groupSlug ? `/api/skool/categories?group=${groupSlug}` : '/api/skool/categories'

  const { data, error, mutate } = useSWR<{
    categories: SchedulerCategory[]
    source: 'skool_api' | 'database' | 'fallback'
    lastFetched?: string
  }>(url, fetcher)

  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/skool/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: groupSlug || 'fruitful' }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to refresh categories')
      }

      // Revalidate the SWR cache
      await mutate()
    } finally {
      setIsRefreshing(false)
    }
  }, [groupSlug, mutate])

  return {
    categories: data?.categories || [],
    isLoading: !error && !data,
    error,
    source: data?.source,
    lastFetched: data?.lastFetched,
    isRefreshing,
    refresh,
  }
}
