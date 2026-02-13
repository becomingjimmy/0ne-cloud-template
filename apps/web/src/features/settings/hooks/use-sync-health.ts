'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { SyncHealthStatus, SyncHealthResponse } from '@/app/api/settings/sync-health/route'

// =============================================================================
// TYPES
// =============================================================================

export interface UseSyncHealthOptions {
  /** Auto-refresh interval in milliseconds (default: 60000 = 60s, 0 = disabled) */
  refreshInterval?: number
}

export interface UseSyncHealthReturn {
  status: SyncHealthStatus | null
  lastSync: string | null
  failureCount: number
  isLoading: boolean
  error: Error | null
  /** Manually trigger a refresh */
  mutate: () => Promise<void>
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for fetching sync health status
 *
 * @example
 * // Basic usage with auto-refresh every 60s
 * const { status, lastSync, failureCount, isLoading } = useSyncHealth()
 *
 * @example
 * // Custom refresh interval
 * const { status } = useSyncHealth({ refreshInterval: 30000 })
 *
 * @example
 * // Disable auto-refresh
 * const { status } = useSyncHealth({ refreshInterval: 0 })
 */
export function useSyncHealth(options: UseSyncHealthOptions = {}): UseSyncHealthReturn {
  const { refreshInterval = 60000 } = options

  const [data, setData] = useState<SyncHealthResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Use ref to track mounted state for cleanup
  const isMountedRef = useRef(true)

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/sync-health')

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch sync health')
      }

      const result: SyncHealthResponse = await response.json()

      if (isMountedRef.current) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Unknown error'))
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true
    setIsLoading(true)
    fetchData()

    return () => {
      isMountedRef.current = false
    }
  }, [fetchData])

  // Auto-refresh interval
  useEffect(() => {
    if (refreshInterval <= 0) return

    const intervalId = setInterval(() => {
      fetchData()
    }, refreshInterval)

    return () => {
      clearInterval(intervalId)
    }
  }, [fetchData, refreshInterval])

  // Manual refresh function
  const mutate = useCallback(async () => {
    setIsLoading(true)
    await fetchData()
  }, [fetchData])

  return {
    status: data?.status ?? null,
    lastSync: data?.lastSync ?? null,
    failureCount: data?.failureCount ?? 0,
    isLoading,
    error,
    mutate,
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Format last sync time for display
 */
export function formatLastSync(isoString: string | null): string {
  if (!isoString) return 'Never'

  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays}d ago`
}

/**
 * Get status label for display
 */
export function getStatusLabel(status: SyncHealthStatus | null): string {
  switch (status) {
    case 'healthy':
      return 'Healthy'
    case 'stale':
      return 'Stale'
    case 'failing':
      return 'Failing'
    default:
      return 'Unknown'
  }
}

// Re-export the type for convenience
export type { SyncHealthStatus }
