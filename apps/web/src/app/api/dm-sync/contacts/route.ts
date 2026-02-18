import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { sanitizeForPostgrestFilter } from '@/lib/postgrest-utils'

export const dynamic = 'force-dynamic'

interface ContactActivity {
  id: string
  skool_user_id: string
  skool_username: string | null
  skool_display_name: string | null
  ghl_contact_id: string | null
  match_method: 'skool_id' | 'email' | 'name' | 'synthetic' | 'manual' | 'no_email' | null
  email: string | null
  phone: string | null
  contact_type: 'community_member' | 'dm_contact' | 'unknown' | null
  created_at: string
  skool_conversation_id: string | null
  stats: {
    inbound_count: number
    outbound_count: number
    synced_count: number
    pending_count: number
    failed_count: number
    last_activity_at: string | null
  }
  ghl_location_id: string
  skool_community_slug: string
}

interface ContactActivityResponse {
  contacts: ContactActivity[]
  summary: {
    total_contacts: number
    matched_contacts: number
    unmatched_contacts: number
    total_messages: number
    contacts_with_pending: number
    contacts_with_failed: number
  }
  debug?: {
    total_messages_in_db: number
    sample_message_user_ids: string[]
    sample_mapping_user_ids: string[]
  }
}

/**
 * GET /api/dm-sync/contacts
 * List all contacts with sync activity stats
 * Query params: search, match_method, status, limit, offset
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)

    const search = searchParams.get('search')?.trim() || ''
    const matchMethod = searchParams.get('match_method')
    const status = searchParams.get('status') // 'pending' | 'failed' | 'synced' | 'all'
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)
    const matchStatus = searchParams.get('match_status') || 'all' // 'matched' | 'unmatched' | 'all'
    const contactType = searchParams.get('contact_type') || 'all' // 'community_member' | 'dm_contact' | 'all'
    const debug = searchParams.get('debug') === 'true'

    // Get all contact mappings
    let mappingsQuery = supabase
      .from('dm_contact_mappings')
      .select('*')
      .order('created_at', { ascending: false })

    // Apply search filter
    if (search) {
      const safeSearch = sanitizeForPostgrestFilter(search)
      mappingsQuery = mappingsQuery.or(
        `skool_username.ilike.%${safeSearch}%,skool_display_name.ilike.%${safeSearch}%`
      )
    }

    // Apply match method filter
    if (matchMethod && matchMethod !== 'all') {
      mappingsQuery = mappingsQuery.eq('match_method', matchMethod)
    }

    // Apply match status filter
    if (matchStatus === 'matched') {
      mappingsQuery = mappingsQuery.not('ghl_contact_id', 'is', null)
    } else if (matchStatus === 'unmatched') {
      mappingsQuery = mappingsQuery.is('ghl_contact_id', null)
    }

    // Apply contact type filter
    if (contactType && contactType !== 'all') {
      mappingsQuery = mappingsQuery.eq('contact_type', contactType)
    }

    const { data: mappings, error: mappingsError } = await mappingsQuery

    if (mappingsError) {
      console.error('[Contacts API] GET mappings error:', mappingsError)
      return NextResponse.json({ error: mappingsError.message }, { status: 500 })
    }

    if (!mappings || mappings.length === 0) {
      return NextResponse.json({
        contacts: [],
        summary: {
          total_contacts: 0,
          matched_contacts: 0,
          unmatched_contacts: 0,
          total_messages: 0,
          contacts_with_pending: 0,
          contacts_with_failed: 0,
        },
      } as ContactActivityResponse)
    }

    // Get sync config for ghl_location_id and skool_community_slug
    const userIds = [...new Set(mappings.map((m) => m.clerk_user_id))]
    const { data: syncConfigs } = await supabase
      .from('dm_sync_config')
      .select('clerk_user_id, ghl_location_id, skool_community_slug')
      .in('clerk_user_id', userIds)

    // Build user_id -> config map
    const configMap = new Map<string, { ghl_location_id: string; skool_community_slug: string }>()
    syncConfigs?.forEach((config) => {
      configMap.set(config.clerk_user_id, {
        ghl_location_id: config.ghl_location_id,
        skool_community_slug: config.skool_community_slug,
      })
    })

    // Get all skool_user_ids for message aggregation
    const skoolUserIds = mappings.map((m) => m.skool_user_id)

    // Get all messages for these users
    const { data: messages, error: messagesError } = await supabase
      .from('dm_messages')
      .select('skool_user_id, direction, status, created_at')
      .in('skool_user_id', skoolUserIds)

    if (messagesError) {
      console.error('[Contacts API] GET messages error:', messagesError)
      return NextResponse.json({ error: messagesError.message }, { status: 500 })
    }

    // Get most recent conversation ID for each contact (for inbox deep links)
    const conversationMap = new Map<string, string>()
    const { data: conversations } = await supabase
      .from('dm_messages')
      .select('skool_user_id, skool_conversation_id, created_at')
      .in('skool_user_id', skoolUserIds)
      .order('created_at', { ascending: false })

    if (conversations) {
      for (const conv of conversations) {
        if (!conversationMap.has(conv.skool_user_id)) {
          conversationMap.set(conv.skool_user_id, conv.skool_conversation_id)
        }
      }
    }

    // Aggregate message stats per user
    const statsMap = new Map<
      string,
      {
        inbound_count: number
        outbound_count: number
        synced_count: number
        pending_count: number
        failed_count: number
        last_activity_at: string | null
      }
    >()

    messages?.forEach((msg) => {
      const existing = statsMap.get(msg.skool_user_id) || {
        inbound_count: 0,
        outbound_count: 0,
        synced_count: 0,
        pending_count: 0,
        failed_count: 0,
        last_activity_at: null,
      }

      // Count by direction
      if (msg.direction === 'inbound') {
        existing.inbound_count++
      } else if (msg.direction === 'outbound') {
        existing.outbound_count++
      }

      // Count by status
      if (msg.status === 'synced') {
        existing.synced_count++
      } else if (msg.status === 'pending') {
        existing.pending_count++
      } else if (msg.status === 'failed') {
        existing.failed_count++
      }

      // Track most recent activity
      if (!existing.last_activity_at || msg.created_at > existing.last_activity_at) {
        existing.last_activity_at = msg.created_at
      }

      statsMap.set(msg.skool_user_id, existing)
    })

    // Build contacts with stats
    let contactsWithStats: ContactActivity[] = mappings.map((mapping) => {
      const stats = statsMap.get(mapping.skool_user_id) || {
        inbound_count: 0,
        outbound_count: 0,
        synced_count: 0,
        pending_count: 0,
        failed_count: 0,
        last_activity_at: null,
      }

      // Get config from the configMap
      const config = configMap.get(mapping.clerk_user_id)

      return {
        id: mapping.id,
        skool_user_id: mapping.skool_user_id,
        skool_username: mapping.skool_username,
        skool_display_name: mapping.skool_display_name,
        ghl_contact_id: mapping.ghl_contact_id,
        match_method: mapping.match_method as ContactActivity['match_method'],
        email: mapping.email || null,
        phone: mapping.phone || null,
        contact_type: mapping.contact_type || null,
        created_at: mapping.created_at,
        skool_conversation_id: conversationMap.get(mapping.skool_user_id) || null,
        stats,
        ghl_location_id: config?.ghl_location_id || '',
        skool_community_slug: config?.skool_community_slug || '',
      }
    })

    // Apply status filter (post-aggregation since it depends on message stats)
    if (status && status !== 'all') {
      if (status === 'pending') {
        contactsWithStats = contactsWithStats.filter((c) => c.stats.pending_count > 0)
      } else if (status === 'failed') {
        contactsWithStats = contactsWithStats.filter((c) => c.stats.failed_count > 0)
      } else if (status === 'synced') {
        // Has synced messages and no pending/failed
        contactsWithStats = contactsWithStats.filter(
          (c) =>
            c.stats.synced_count > 0 && c.stats.pending_count === 0 && c.stats.failed_count === 0
        )
      }
    }

    // Sort by last activity (most recent first), nulls last
    contactsWithStats.sort((a, b) => {
      if (!a.stats.last_activity_at && !b.stats.last_activity_at) return 0
      if (!a.stats.last_activity_at) return 1
      if (!b.stats.last_activity_at) return -1
      return b.stats.last_activity_at.localeCompare(a.stats.last_activity_at)
    })

    // Calculate summary
    const summary = {
      total_contacts: contactsWithStats.length,
      matched_contacts: contactsWithStats.filter((c) => c.ghl_contact_id !== null).length,
      unmatched_contacts: contactsWithStats.filter((c) => c.ghl_contact_id === null).length,
      total_messages: contactsWithStats.reduce(
        (acc, c) => acc + c.stats.inbound_count + c.stats.outbound_count,
        0
      ),
      contacts_with_pending: contactsWithStats.filter((c) => c.stats.pending_count > 0).length,
      contacts_with_failed: contactsWithStats.filter((c) => c.stats.failed_count > 0).length,
    }

    // Apply pagination
    const paginatedContacts = contactsWithStats.slice(offset, offset + limit)

    // Build debug info if requested
    let debugInfo: ContactActivityResponse['debug'] | undefined
    if (debug) {
      // Get total messages in db (not filtered by skool_user_id)
      const { count: totalMsgCount } = await supabase
        .from('dm_messages')
        .select('*', { count: 'exact', head: true })

      // Get sample of skool_user_ids from messages
      const { data: sampleMsgs } = await supabase
        .from('dm_messages')
        .select('skool_user_id')
        .limit(5)

      debugInfo = {
        total_messages_in_db: totalMsgCount || 0,
        sample_message_user_ids: (sampleMsgs || []).map((m) => m.skool_user_id),
        sample_mapping_user_ids: skoolUserIds.slice(0, 5),
      }
    }

    return NextResponse.json({
      contacts: paginatedContacts,
      summary,
      ...(debugInfo && { debug: debugInfo }),
    } as ContactActivityResponse)
  } catch (error) {
    console.error('[Contacts API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch contact activity', details: String(error) },
      { status: 500 }
    )
  }
}
