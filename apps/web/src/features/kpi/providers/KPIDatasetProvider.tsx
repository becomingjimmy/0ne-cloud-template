'use client'

import { useEffect, type ReactNode } from 'react'
import { useKPIDatasetStore } from '../store'

interface KPIDatasetProviderProps {
  children: ReactNode
  /**
   * Number of days of historical data to load
   * Default: 365 (1 year)
   */
  daysBack?: number
  /**
   * Whether to automatically fetch on mount
   * Default: true
   */
  autoFetch?: boolean
}

/**
 * Provider component that initializes the KPI dataset store on mount.
 *
 * Wrap your KPI pages or layout with this provider to ensure the dataset
 * is loaded and available for instant filtering.
 *
 * Usage:
 * ```tsx
 * <KPIDatasetProvider>
 *   <KPIDashboardPage />
 * </KPIDatasetProvider>
 * ```
 */
export function KPIDatasetProvider({
  children,
  daysBack = 365,
  autoFetch = true,
}: KPIDatasetProviderProps) {
  const { fetchDataset, dataset, lastFetched } = useKPIDatasetStore()

  useEffect(() => {
    if (!autoFetch) return

    // Only fetch if we don't have data or it's stale (older than 5 minutes)
    const isStale = lastFetched
      ? Date.now() - lastFetched.getTime() > 5 * 60 * 1000
      : true

    if (!dataset || isStale) {
      fetchDataset(daysBack)
    }
  }, [autoFetch, daysBack, dataset, lastFetched, fetchDataset])

  return <>{children}</>
}

/**
 * Hook to use KPI dataset data with loading states.
 *
 * This is a convenience hook that combines the store state
 * with loading indicators for use in components.
 */
export function useKPIDataset() {
  const { dataset, isLoading, error, lastFetched, fetchDataset } = useKPIDatasetStore()

  return {
    dataset,
    isLoading,
    error,
    lastFetched,
    refetch: fetchDataset,
    hasData: !!dataset,
  }
}
