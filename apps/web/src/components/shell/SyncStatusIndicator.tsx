'use client'

import { useRouter } from 'next/navigation'
import { cn } from '@0ne/ui'
import {
  useSyncHealth,
  formatLastSync,
  getStatusLabel,
  type SyncHealthStatus,
} from '@/features/settings/hooks'

// =============================================================================
// TYPES
// =============================================================================

interface SyncStatusIndicatorProps {
  /** Optional className for the container */
  className?: string
  /** Show the label next to the indicator (default: true) */
  showLabel?: boolean
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Sync status indicator for the sidebar
 *
 * Shows a colored dot indicating overall sync health:
 * - Green: healthy (syncs in last 24h, no failures)
 * - Yellow: stale (no syncs in last 24h)
 * - Red: failing (has failures in last 24h)
 *
 * Clickable to navigate to /settings/sync
 */
export function SyncStatusIndicator({
  className,
  showLabel = true,
}: SyncStatusIndicatorProps) {
  const router = useRouter()
  const { status, lastSync, failureCount, isLoading } = useSyncHealth()

  const handleClick = () => {
    router.push('/settings/sync')
  }

  const getDotColor = (status: SyncHealthStatus | null): string => {
    switch (status) {
      case 'healthy':
        return 'bg-green-500'
      case 'stale':
        return 'bg-yellow-500'
      case 'failing':
        return 'bg-red-500'
      default:
        return 'bg-gray-400'
    }
  }

  const getTooltipText = (): string => {
    if (isLoading) return 'Loading sync status...'

    const statusLabel = getStatusLabel(status)
    const lastSyncText = formatLastSync(lastSync)

    if (status === 'failing') {
      return `${statusLabel} - ${failureCount} failure${failureCount === 1 ? '' : 's'} in last 24h\nLast sync: ${lastSyncText}`
    }

    return `${statusLabel}\nLast sync: ${lastSyncText}`
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors w-full',
        'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
        className
      )}
      title={getTooltipText()}
      aria-label={`Sync status: ${getStatusLabel(status)}. Click to view details.`}
    >
      {/* Status dot */}
      <span className="relative flex h-2.5 w-2.5">
        {/* Pulse animation for loading or failing state */}
        {(isLoading || status === 'failing') && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              isLoading ? 'bg-gray-400' : getDotColor(status)
            )}
          />
        )}
        <span
          className={cn(
            'relative inline-flex h-2.5 w-2.5 rounded-full',
            isLoading ? 'bg-gray-400' : getDotColor(status)
          )}
        />
      </span>

      {/* Label */}
      {showLabel && (
        <span className="flex-1 text-left">Sync Status</span>
      )}
    </button>
  )
}
