'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

/**
 * Raw message data from dm_messages table
 */
export interface RawMessage {
  id: string
  skool_conversation_id: string
  skool_message_id: string
  skool_user_id: string
  sender_name: string | null
  skool_username: string | null
  direction: 'inbound' | 'outbound'
  message_text: string | null
  status: 'synced' | 'pending' | 'failed'
  ghl_message_id: string | null
  ghl_contact_id: string | null
  ghl_location_id: string | null
  skool_community_slug: string | null
  created_at: string
  synced_at: string | null
}

/**
 * Summary statistics for messages
 */
export interface RawMessagesSummary {
  total: number
  inbound: number
  outbound: number
  synced: number
  pending: number
  failed: number
}

/**
 * Pagination info
 */
export interface RawMessagesPagination {
  limit: number
  offset: number
  hasMore: boolean
}

/**
 * Options for the useRawMessages hook
 */
export interface UseRawMessagesOptions {
  search?: string
  direction?: 'inbound' | 'outbound' | 'all'
  status?: 'synced' | 'pending' | 'failed' | 'all'
  conversationId?: string
  limit?: number
  offset?: number
}

/**
 * Return type for the useRawMessages hook
 */
export interface UseRawMessagesReturn {
  messages: RawMessage[]
  summary: RawMessagesSummary
  pagination: RawMessagesPagination
  isLoading: boolean
  error: Error | undefined
  refresh: () => void
}

/**
 * Hook for fetching raw DM messages
 */
export function useRawMessages(options: UseRawMessagesOptions = {}): UseRawMessagesReturn {
  const params = new URLSearchParams()

  if (options.search) params.set('search', options.search)
  if (options.direction && options.direction !== 'all') {
    params.set('direction', options.direction)
  }
  if (options.status && options.status !== 'all') {
    params.set('status', options.status)
  }
  if (options.conversationId) params.set('conversation_id', options.conversationId)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.offset) params.set('offset', String(options.offset))

  const url = `/api/dm-sync/raw-messages${params.toString() ? '?' + params.toString() : ''}`

  const { data, error, mutate } = useSWR<{
    messages: RawMessage[]
    summary: RawMessagesSummary
    pagination: RawMessagesPagination
  }>(url, fetcher, {
    refreshInterval: 15000, // Auto-refresh every 15 seconds
  })

  return {
    messages: data?.messages || [],
    summary: data?.summary || {
      total: 0,
      inbound: 0,
      outbound: 0,
      synced: 0,
      pending: 0,
      failed: 0,
    },
    pagination: data?.pagination || {
      limit: 50,
      offset: 0,
      hasMore: false,
    },
    isLoading: !error && !data,
    error,
    refresh: mutate,
  }
}
