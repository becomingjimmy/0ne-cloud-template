import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { sanitizeForPostgrestFilter } from '@/lib/postgrest-utils'

export const dynamic = 'force-dynamic'

interface ContactChannelInfo {
  staff_skool_id: string
  skool_channel_id: string
  staff_display_name: string | null
}

interface ContactActivity {
  id: string
  skool_user_id: string
  skool_username: string | null
  skool_display_name: string | null
  ghl_contact_id: string | null
  match_method: 'skool_id' | 'email' | 'name' | 'synthetic' | 'manual' | 'no_email' | 'skool_members' | null
  email: string | null
  phone: string | null
  contact_type: 'community_member' | 'dm_contact' | 'unknown' | null
  created_at: string
  skool_conversation_id: string | null
  channels: ContactChannelInfo[]
  stats: {
    inbound_count: number
    outbound_count: number
    synced_count: number
    pending_count: number
    failed_count: number
    last_activity_at: string | null
  }
  survey_answers: Array<{ question: string; answer: string }> | null
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
}

/**
 * GET /api/dm-sync/contacts
 * List all contacts with sync activity stats
 * Uses server-side pagination for efficiency with thousands of contacts
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)

    const search = searchParams.get('search')?.trim() || ''
    const matchMethod = searchParams.get('match_method')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)
    const matchStatus = searchParams.get('match_status') || 'all'
    const contactType = searchParams.get('contact_type') || 'all'

    // =========================================================================
    // 1. Get summary counts (fast, separate queries, no row limit)
    // =========================================================================

    // Total matched
    const { count: matchedCount } = await supabase
      .from('dm_contact_mappings')
      .select('*', { count: 'exact', head: true })
      .not('ghl_contact_id', 'is', null)

    // Total unmatched
    const { count: unmatchedCount } = await supabase
      .from('dm_contact_mappings')
      .select('*', { count: 'exact', head: true })
      .is('ghl_contact_id', null)

    // Total messages
    const { count: totalMessages } = await supabase
      .from('dm_messages')
      .select('*', { count: 'exact', head: true })

    // Contacts with pending
    const { data: pendingContacts } = await supabase
      .from('dm_messages')
      .select('skool_user_id')
      .eq('status', 'pending')

    const uniquePending = new Set(pendingContacts?.map((m) => m.skool_user_id) || [])

    // Contacts with failed
    const { data: failedContacts } = await supabase
      .from('dm_messages')
      .select('skool_user_id')
      .eq('status', 'failed')

    const uniqueFailed = new Set(failedContacts?.map((m) => m.skool_user_id) || [])

    const summary = {
      total_contacts: (matchedCount || 0) + (unmatchedCount || 0),
      matched_contacts: matchedCount || 0,
      unmatched_contacts: unmatchedCount || 0,
      total_messages: totalMessages || 0,
      contacts_with_pending: uniquePending.size,
      contacts_with_failed: uniqueFailed.size,
    }

    // =========================================================================
    // 2. Get paginated contacts (server-side pagination via .range())
    // =========================================================================

    let mappingsQuery = supabase
      .from('dm_contact_mappings')
      .select('*', { count: 'exact' })
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

    // Server-side pagination
    mappingsQuery = mappingsQuery.range(offset, offset + limit - 1)

    const { data: mappings, error: mappingsError } = await mappingsQuery

    if (mappingsError) {
      console.error('[Contacts API] GET mappings error:', mappingsError)
      return NextResponse.json({ error: mappingsError.message }, { status: 500 })
    }

    if (!mappings || mappings.length === 0) {
      return NextResponse.json({ contacts: [], summary } as ContactActivityResponse)
    }

    // =========================================================================
    // 3. Enrich page contacts with message stats + conversation IDs
    // =========================================================================

    // Get sync config for ghl_location_id and skool_community_slug
    const userIds = [...new Set(mappings.map((m) => m.clerk_user_id))]
    const { data: syncConfigs } = await supabase
      .from('dm_sync_config')
      .select('clerk_user_id, ghl_location_id, skool_community_slug')
      .in('clerk_user_id', userIds)

    const configMap = new Map<string, { ghl_location_id: string; skool_community_slug: string }>()
    syncConfigs?.forEach((config) => {
      configMap.set(config.clerk_user_id, {
        ghl_location_id: config.ghl_location_id,
        skool_community_slug: config.skool_community_slug,
      })
    })

    // Only fetch messages for this page's contacts (max 50 IDs, efficient)
    const pageSkoolUserIds = mappings.map((m) => m.skool_user_id)

    const { data: messages } = await supabase
      .from('dm_messages')
      .select('skool_user_id, direction, status, created_at, skool_conversation_id')
      .in('skool_user_id', pageSkoolUserIds)

    // Fetch contact_channels for this page's contacts
    const { data: contactChannels } = await supabase
      .from('contact_channels')
      .select('skool_user_id, staff_skool_id, skool_channel_id')
      .in('skool_user_id', pageSkoolUserIds)

    // Fetch survey_answers, email, phone from skool_members for this page's contacts
    const { data: memberData } = await supabase
      .from('skool_members')
      .select('skool_user_id, survey_answers, email, phone')
      .in('skool_user_id', pageSkoolUserIds)

    const surveyMap = new Map<string, Array<{ question: string; answer: string }> | null>()
    const memberEmailMap = new Map<string, string | null>()
    const memberPhoneMap = new Map<string, string | null>()
    memberData?.forEach((m) => {
      // Normalize: survey data can be array directly or nested {survey: [...]}
      let answers = m.survey_answers as unknown
      if (answers && typeof answers === 'object' && !Array.isArray(answers) && 'survey' in (answers as Record<string, unknown>)) {
        answers = (answers as { survey: unknown }).survey
      }
      const normalizedAnswers = Array.isArray(answers) ? answers as Array<{ question: string; answer: string }> : null
      surveyMap.set(m.skool_user_id, normalizedAnswers)

      // Email: use stored email, or extract from survey answers on-the-fly
      let email = m.email || null
      if (!email && normalizedAnswers) {
        for (const item of normalizedAnswers) {
          const ans = item.answer || ''
          if (ans.includes('@') && ans.includes('.')) {
            const match = ans.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
            if (match) { email = match[0].toLowerCase(); break }
          }
        }
      }
      memberEmailMap.set(m.skool_user_id, email)

      // Phone: use stored phone, or extract from survey answers on-the-fly
      let phone = m.phone || null
      if (!phone && normalizedAnswers) {
        for (const item of normalizedAnswers) {
          const q = (item.question || '').toLowerCase()
          const ans = item.answer || ''
          if (q.includes('phone') || q.includes('cell') || q.includes('mobile') || q.includes('whatsapp')) {
            const digits = ans.replace(/\D/g, '')
            if (digits.length >= 10) {
              phone = digits.length === 10 ? `+1${digits}` : `+${digits}`
              break
            }
          }
        }
      }
      memberPhoneMap.set(m.skool_user_id, phone)
    })

    // Build channels map per user (with staff display name lookup)
    const channelsMap = new Map<string, ContactChannelInfo[]>()

    // Get staff display names
    const staffIds = [...new Set(contactChannels?.map((c) => c.staff_skool_id) || [])]
    const staffNameMap = new Map<string, string | null>()
    if (staffIds.length > 0) {
      const { data: staffUsers } = await supabase
        .from('staff_users')
        .select('skool_user_id, display_name')
        .in('skool_user_id', staffIds)

      staffUsers?.forEach((s) => staffNameMap.set(s.skool_user_id, s.display_name))
    }

    contactChannels?.forEach((ch) => {
      const existing = channelsMap.get(ch.skool_user_id) || []
      existing.push({
        staff_skool_id: ch.staff_skool_id,
        skool_channel_id: ch.skool_channel_id,
        staff_display_name: staffNameMap.get(ch.staff_skool_id) || null,
      })
      channelsMap.set(ch.skool_user_id, existing)
    })

    // Aggregate message stats per user
    const statsMap = new Map<string, {
      inbound_count: number
      outbound_count: number
      synced_count: number
      pending_count: number
      failed_count: number
      last_activity_at: string | null
    }>()

    // Build conversation ID map (most recent per user)
    const conversationMap = new Map<string, string>()

    messages?.forEach((msg) => {
      // Stats
      const existing = statsMap.get(msg.skool_user_id) || {
        inbound_count: 0, outbound_count: 0,
        synced_count: 0, pending_count: 0, failed_count: 0,
        last_activity_at: null,
      }

      if (msg.direction === 'inbound') existing.inbound_count++
      else if (msg.direction === 'outbound') existing.outbound_count++

      if (msg.status === 'synced') existing.synced_count++
      else if (msg.status === 'pending') existing.pending_count++
      else if (msg.status === 'failed') existing.failed_count++

      if (!existing.last_activity_at || msg.created_at > existing.last_activity_at) {
        existing.last_activity_at = msg.created_at
      }

      statsMap.set(msg.skool_user_id, existing)

      // Conversation ID (most recent)
      if (msg.skool_conversation_id) {
        const currentConvo = conversationMap.get(msg.skool_user_id)
        if (!currentConvo) {
          conversationMap.set(msg.skool_user_id, msg.skool_conversation_id)
        }
      }
    })

    // =========================================================================
    // 4. Build response
    // =========================================================================

    let contactsWithStats: ContactActivity[] = mappings.map((mapping) => {
      const stats = statsMap.get(mapping.skool_user_id) || {
        inbound_count: 0, outbound_count: 0,
        synced_count: 0, pending_count: 0, failed_count: 0,
        last_activity_at: null,
      }

      const config = configMap.get(mapping.clerk_user_id)

      return {
        id: mapping.id,
        skool_user_id: mapping.skool_user_id,
        skool_username: mapping.skool_username,
        skool_display_name: mapping.skool_display_name,
        ghl_contact_id: mapping.ghl_contact_id,
        match_method: mapping.match_method as ContactActivity['match_method'],
        email: mapping.email || memberEmailMap.get(mapping.skool_user_id) || null,
        phone: mapping.phone || memberPhoneMap.get(mapping.skool_user_id) || null,
        contact_type: mapping.contact_type || null,
        created_at: mapping.created_at,
        skool_conversation_id: conversationMap.get(mapping.skool_user_id) || null,
        channels: channelsMap.get(mapping.skool_user_id) || [],
        stats,
        survey_answers: surveyMap.get(mapping.skool_user_id) || null,
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
        contactsWithStats = contactsWithStats.filter(
          (c) => c.stats.synced_count > 0 && c.stats.pending_count === 0 && c.stats.failed_count === 0
        )
      }
    }

    return NextResponse.json({ contacts: contactsWithStats, summary } as ContactActivityResponse)
  } catch (error) {
    console.error('[Contacts API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch contact activity', details: String(error) },
      { status: 500 }
    )
  }
}
