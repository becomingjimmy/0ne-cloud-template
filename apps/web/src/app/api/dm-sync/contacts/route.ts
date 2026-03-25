import { NextRequest, NextResponse } from 'next/server'
import { db, eq, desc, and, or, count, inArray, isNull, isNotNull, ilike } from '@0ne/db/server'
import { dmContactMappings, dmMessages, dmSyncConfig, contactChannels as contactChannelsTable, skoolMembers, staffUsers as staffUsersTable } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

interface ContactChannelInfo {
  staffSkoolId: string
  skoolChannelId: string
  staffDisplayName: string | null
}

interface ContactActivity {
  id: string
  skoolUserId: string
  skoolUsername: string | null
  skoolDisplayName: string | null
  ghlContactId: string | null
  matchMethod: 'skool_id' | 'email' | 'name' | 'synthetic' | 'manual' | 'no_email' | 'skool_members' | null
  email: string | null
  phone: string | null
  contactType: 'community_member' | 'dm_contact' | 'unknown' | null
  createdAt: string
  skoolConversationId: string | null
  channels: ContactChannelInfo[]
  stats: {
    inboundCount: number
    outboundCount: number
    syncedCount: number
    pendingCount: number
    failedCount: number
    lastActivityAt: string | null
  }
  surveyAnswers: Array<{ question: string; answer: string }> | null
  ghlLocationId: string
  skoolCommunitySlug: string
}

interface ContactActivityResponse {
  contacts: ContactActivity[]
  summary: {
    totalContacts: number
    matchedContacts: number
    unmatchedContacts: number
    totalMessages: number
    contactsWithPending: number
    contactsWithFailed: number
  }
  total: number
}

/**
 * GET /api/dm-sync/contacts
 * List all contacts with sync activity stats
 * Uses server-side pagination for efficiency with thousands of contacts
 */
export async function GET(request: NextRequest) {
  try {
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
    const [{ count: matchedCount }] = await db.select({ count: count() }).from(dmContactMappings)
      .where(isNotNull(dmContactMappings.ghlContactId))

    // Total unmatched
    const [{ count: unmatchedCount }] = await db.select({ count: count() }).from(dmContactMappings)
      .where(isNull(dmContactMappings.ghlContactId))

    // Total messages
    const [{ count: totalMessages }] = await db.select({ count: count() }).from(dmMessages)

    // Contacts with pending
    const pendingContacts = await db.select({ skoolUserId: dmMessages.skoolUserId })
      .from(dmMessages)
      .where(eq(dmMessages.status, 'pending'))

    const uniquePending = new Set(pendingContacts.map((m) => m.skoolUserId))

    // Contacts with failed
    const failedContacts = await db.select({ skoolUserId: dmMessages.skoolUserId })
      .from(dmMessages)
      .where(eq(dmMessages.status, 'failed'))

    const uniqueFailed = new Set(failedContacts.map((m) => m.skoolUserId))

    const summary = {
      totalContacts: (matchedCount || 0) + (unmatchedCount || 0),
      matchedContacts: matchedCount || 0,
      unmatchedContacts: unmatchedCount || 0,
      totalMessages: totalMessages || 0,
      contactsWithPending: uniquePending.size,
      contactsWithFailed: uniqueFailed.size,
    }

    // =========================================================================
    // 2. Get paginated contacts (server-side pagination)
    // =========================================================================

    // Build where conditions
    const conditions: ReturnType<typeof eq>[] = []

    if (search) {
      conditions.push(
        or(
          ilike(dmContactMappings.skoolUsername, `%${search}%`),
          ilike(dmContactMappings.skoolDisplayName, `%${search}%`)
        )!
      )
    }

    if (matchMethod && matchMethod !== 'all') {
      conditions.push(eq(dmContactMappings.matchMethod, matchMethod))
    }

    if (matchStatus === 'matched') {
      conditions.push(isNotNull(dmContactMappings.ghlContactId))
    } else if (matchStatus === 'unmatched') {
      conditions.push(isNull(dmContactMappings.ghlContactId))
    }

    if (contactType && contactType !== 'all') {
      conditions.push(eq(dmContactMappings.contactType, contactType))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Get total filtered count
    const [{ count: filteredCount }] = await db.select({ count: count() }).from(dmContactMappings)
      .where(whereClause)

    // Get paginated results
    const mappings = await db.select().from(dmContactMappings)
      .where(whereClause)
      .orderBy(desc(dmContactMappings.createdAt))
      .limit(limit)
      .offset(offset)

    if (mappings.length === 0) {
      return NextResponse.json({ contacts: [], summary, total: (filteredCount || 0) } as ContactActivityResponse)
    }

    // =========================================================================
    // 3. Enrich page contacts with message stats + conversation IDs
    // =========================================================================

    // Get sync config for ghl_location_id and skool_community_slug
    const userIds = [...new Set(mappings.map((m) => m.clerkUserId).filter(Boolean))] as string[]
    const syncConfigs = userIds.length > 0
      ? await db.select({
          clerkUserId: dmSyncConfig.clerkUserId,
          ghlLocationId: dmSyncConfig.ghlLocationId,
          skoolCommunitySlug: dmSyncConfig.skoolCommunitySlug,
        }).from(dmSyncConfig).where(inArray(dmSyncConfig.clerkUserId, userIds))
      : []

    const configMap = new Map<string, { ghlLocationId: string; skoolCommunitySlug: string }>()
    syncConfigs.forEach((config) => {
      if (config.clerkUserId) {
        configMap.set(config.clerkUserId, {
          ghlLocationId: config.ghlLocationId || '',
          skoolCommunitySlug: config.skoolCommunitySlug || '',
        })
      }
    })

    // Only fetch messages for this page's contacts (max 50 IDs, efficient)
    const pageSkoolUserIds = mappings.map((m) => m.skoolUserId).filter(Boolean) as string[]

    const messages = pageSkoolUserIds.length > 0
      ? await db.select({
          skoolUserId: dmMessages.skoolUserId,
          direction: dmMessages.direction,
          status: dmMessages.status,
          createdAt: dmMessages.createdAt,
          skoolConversationId: dmMessages.skoolConversationId,
        }).from(dmMessages).where(inArray(dmMessages.skoolUserId, pageSkoolUserIds))
      : []

    // Fetch contact_channels for this page's contacts
    const contactChannelsData = pageSkoolUserIds.length > 0
      ? await db.select({
          skoolUserId: contactChannelsTable.skoolUserId,
          staffSkoolId: contactChannelsTable.staffSkoolId,
          skoolChannelId: contactChannelsTable.skoolChannelId,
        }).from(contactChannelsTable).where(inArray(contactChannelsTable.skoolUserId, pageSkoolUserIds))
      : []

    // Fetch survey_answers, email, phone from skool_members for this page's contacts
    const memberData = pageSkoolUserIds.length > 0
      ? await db.select({
          skoolUserId: skoolMembers.skoolUserId,
          surveyAnswers: skoolMembers.surveyAnswers,
          email: skoolMembers.email,
          phone: skoolMembers.phone,
        }).from(skoolMembers).where(inArray(skoolMembers.skoolUserId, pageSkoolUserIds))
      : []

    const surveyMap = new Map<string, Array<{ question: string; answer: string }> | null>()
    const memberEmailMap = new Map<string, string | null>()
    const memberPhoneMap = new Map<string, string | null>()
    memberData.forEach((m) => {
      // Normalize: survey data can be array directly or nested {survey: [...]}
      let answers = m.surveyAnswers as unknown
      if (answers && typeof answers === 'object' && !Array.isArray(answers) && 'survey' in (answers as Record<string, unknown>)) {
        answers = (answers as { survey: unknown }).survey
      }
      const normalizedAnswers = Array.isArray(answers) ? answers as Array<{ question: string; answer: string }> : null
      surveyMap.set(m.skoolUserId, normalizedAnswers)

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
      memberEmailMap.set(m.skoolUserId, email)

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
      memberPhoneMap.set(m.skoolUserId, phone)
    })

    // Build channels map per user (with staff display name lookup)
    const channelsMap = new Map<string, ContactChannelInfo[]>()

    // Get staff display names
    const staffIds = [...new Set(contactChannelsData.map((c) => c.staffSkoolId).filter(Boolean))] as string[]
    const staffNameMap = new Map<string, string | null>()
    if (staffIds.length > 0) {
      const staffData = await db.select({
        skoolUserId: staffUsersTable.skoolUserId,
        displayName: staffUsersTable.displayName,
      }).from(staffUsersTable).where(inArray(staffUsersTable.skoolUserId, staffIds))

      staffData.forEach((s) => staffNameMap.set(s.skoolUserId, s.displayName))
    }

    contactChannelsData.forEach((ch) => {
      if (!ch.skoolUserId) return
      const existing = channelsMap.get(ch.skoolUserId) || []
      existing.push({
        staffSkoolId: ch.staffSkoolId || '',
        skoolChannelId: ch.skoolChannelId || '',
        staffDisplayName: ch.staffSkoolId ? staffNameMap.get(ch.staffSkoolId) || null : null,
      })
      channelsMap.set(ch.skoolUserId, existing)
    })

    // Aggregate message stats per user
    const statsMap = new Map<string, {
      inboundCount: number
      outboundCount: number
      syncedCount: number
      pendingCount: number
      failedCount: number
      lastActivityAt: string | null
    }>()

    // Build conversation ID map (most recent per user)
    const conversationMap = new Map<string, string>()

    messages.forEach((msg) => {
      if (!msg.skoolUserId) return
      // Stats
      const existing = statsMap.get(msg.skoolUserId) || {
        inboundCount: 0, outboundCount: 0,
        syncedCount: 0, pendingCount: 0, failedCount: 0,
        lastActivityAt: null,
      }

      if (msg.direction === 'inbound') existing.inboundCount++
      else if (msg.direction === 'outbound') existing.outboundCount++

      if (msg.status === 'synced') existing.syncedCount++
      else if (msg.status === 'pending') existing.pendingCount++
      else if (msg.status === 'failed') existing.failedCount++

      const createdAtStr = msg.createdAt?.toISOString() || null
      if (createdAtStr && (!existing.lastActivityAt || createdAtStr > existing.lastActivityAt)) {
        existing.lastActivityAt = createdAtStr
      }

      statsMap.set(msg.skoolUserId, existing)

      // Conversation ID (most recent)
      if (msg.skoolConversationId) {
        const currentConvo = conversationMap.get(msg.skoolUserId)
        if (!currentConvo) {
          conversationMap.set(msg.skoolUserId, msg.skoolConversationId)
        }
      }
    })

    // =========================================================================
    // 4. Build response
    // =========================================================================

    let contactsWithStats: ContactActivity[] = mappings.map((mapping) => {
      const skoolUserId = mapping.skoolUserId || ''
      const stats = statsMap.get(skoolUserId) || {
        inboundCount: 0, outboundCount: 0,
        syncedCount: 0, pendingCount: 0, failedCount: 0,
        lastActivityAt: null,
      }

      const config = mapping.clerkUserId ? configMap.get(mapping.clerkUserId) : undefined

      return {
        id: mapping.id,
        skoolUserId: skoolUserId,
        skoolUsername: mapping.skoolUsername,
        skoolDisplayName: mapping.skoolDisplayName,
        ghlContactId: mapping.ghlContactId,
        matchMethod: mapping.matchMethod as ContactActivity['matchMethod'],
        email: mapping.email || memberEmailMap.get(skoolUserId) || null,
        phone: mapping.phone || memberPhoneMap.get(skoolUserId) || null,
        contactType: (mapping.contactType as ContactActivity['contactType']) || null,
        createdAt: mapping.createdAt?.toISOString() || new Date().toISOString(),
        skoolConversationId: conversationMap.get(skoolUserId) || null,
        channels: channelsMap.get(skoolUserId) || [],
        stats,
        surveyAnswers: surveyMap.get(skoolUserId) || null,
        ghlLocationId: config?.ghlLocationId || '',
        skoolCommunitySlug: config?.skoolCommunitySlug || '',
      }
    })

    // Apply status filter (post-aggregation since it depends on message stats)
    if (status && status !== 'all') {
      if (status === 'pending') {
        contactsWithStats = contactsWithStats.filter((c) => c.stats.pendingCount > 0)
      } else if (status === 'failed') {
        contactsWithStats = contactsWithStats.filter((c) => c.stats.failedCount > 0)
      } else if (status === 'synced') {
        contactsWithStats = contactsWithStats.filter(
          (c) => c.stats.syncedCount > 0 && c.stats.pendingCount === 0 && c.stats.failedCount === 0
        )
      }
    }

    return NextResponse.json({ contacts: contactsWithStats, summary, total: (filteredCount || 0) } as ContactActivityResponse)
  } catch (error) {
    console.error('[Contacts API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch contact activity', details: String(error) },
      { status: 500 }
    )
  }
}
