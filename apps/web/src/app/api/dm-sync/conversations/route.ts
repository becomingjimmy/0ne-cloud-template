import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

interface ConversationParticipant {
  skool_user_id: string
  display_name: string | null
  username: string | null
}

interface ConversationLastMessage {
  text: string | null
  direction: 'inbound' | 'outbound'
  created_at: string
}

interface Conversation {
  conversation_id: string
  participant: ConversationParticipant
  last_message: ConversationLastMessage
  message_count: number
  pending_count: number
  synced_count: number
}

interface ConversationsSummary {
  total_conversations: number
  total_pending: number
}

interface ConversationsResponse {
  conversations: Conversation[]
  summary: ConversationsSummary
  pagination: {
    limit: number
    offset: number
    hasMore: boolean
  }
}

/**
 * GET /api/dm-sync/conversations
 * List all conversations grouped by skool_conversation_id
 * Query params: search, status, limit, offset
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)

    const search = searchParams.get('search')?.trim() || ''
    const status = searchParams.get('status') // 'all' | 'pending' | 'synced' | 'failed'
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Get all messages - we need to aggregate by conversation
    const { data: messages, error: messagesError } = await supabase
      .from('dm_messages')
      .select('skool_conversation_id, skool_user_id, direction, message_text, status, created_at, sender_name')
      .order('created_at', { ascending: false })

    if (messagesError) {
      console.error('[Conversations API] GET messages error:', messagesError)
      return NextResponse.json({ error: messagesError.message }, { status: 500 })
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({
        conversations: [],
        summary: {
          total_conversations: 0,
          total_pending: 0,
        },
        pagination: {
          limit,
          offset,
          hasMore: false,
        },
      } as ConversationsResponse)
    }

    // Get contact mappings for participant names
    const skoolUserIds = [...new Set(messages.map((m) => m.skool_user_id))]

    const { data: mappings } = await supabase
      .from('dm_contact_mappings')
      .select('skool_user_id, skool_username, skool_display_name')
      .in('skool_user_id', skoolUserIds)

    // Also check skool_members table as fallback for names
    const { data: members } = await supabase
      .from('skool_members')
      .select('skool_user_id, display_name, skool_username')
      .in('skool_user_id', skoolUserIds)

    // Get participant names from conversation_sync_status (extension-pushed Skool API data)
    const conversationIds = [...new Set(messages.map((m) => m.skool_conversation_id))]
    const { data: syncStatuses } = await supabase
      .from('conversation_sync_status')
      .select('conversation_id, participant_name')
      .in('conversation_id', conversationIds)
      .not('participant_name', 'is', null)

    // Build conversation name lookup (conversation_id → participant_name)
    const conversationNameMap = new Map<string, string>()
    syncStatuses?.forEach((s) => {
      if (s.participant_name) {
        conversationNameMap.set(s.conversation_id, s.participant_name)
      }
    })

    // Build user lookup map (dm_contact_mappings first, then skool_members fallback)
    const userMap = new Map<string, { username: string | null; display_name: string | null }>()
    members?.forEach((m) => {
      userMap.set(m.skool_user_id, {
        username: m.skool_username,
        display_name: m.display_name,
      })
    })
    // dm_contact_mappings overwrites skool_members (higher priority)
    mappings?.forEach((m) => {
      userMap.set(m.skool_user_id, {
        username: m.skool_username,
        display_name: m.skool_display_name,
      })
    })

    // Group messages by conversation
    const conversationMap = new Map<
      string,
      {
        conversation_id: string
        skool_user_id: string
        messages: typeof messages
        last_message: typeof messages[0] | null
        pending_count: number
        synced_count: number
        failed_count: number
      }
    >()

    messages.forEach((msg) => {
      const convId = msg.skool_conversation_id
      const existing = conversationMap.get(convId)

      if (existing) {
        existing.messages.push(msg)
        if (msg.status === 'pending') existing.pending_count++
        else if (msg.status === 'synced') existing.synced_count++
        else if (msg.status === 'failed') existing.failed_count++
      } else {
        conversationMap.set(convId, {
          conversation_id: convId,
          skool_user_id: msg.skool_user_id,
          messages: [msg],
          last_message: msg, // First message is most recent (sorted desc)
          pending_count: msg.status === 'pending' ? 1 : 0,
          synced_count: msg.status === 'synced' ? 1 : 0,
          failed_count: msg.status === 'failed' ? 1 : 0,
        })
      }
    })

    // Build conversation list with participant info
    let conversations: Conversation[] = Array.from(conversationMap.values()).map((conv) => {
      // Resolve the OTHER participant's skool_user_id (from inbound messages, not Jimmy's outbound)
      const inboundMsg = conv.messages.find((m) => m.direction === 'inbound')
      const participantUserId = inboundMsg?.skool_user_id || conv.skool_user_id

      const userInfo = userMap.get(participantUserId)

      // Try sender_name from an INBOUND message that has a valid name (not "Unknown")
      const inboundMessageWithName = conv.messages.find(
        (m) => m.direction === 'inbound' && m.sender_name && m.sender_name !== 'Unknown'
      )
      // Fallback to any message with a valid sender_name
      const anyMessageWithName = conv.messages.find(
        (m) => m.sender_name && m.sender_name !== 'Unknown'
      )
      const senderName = inboundMessageWithName?.sender_name || anyMessageWithName?.sender_name || null

      // Name from conversation_sync_status (extension-pushed from Skool API)
      const syncStatusName = conversationNameMap.get(conv.conversation_id) || null

      return {
        conversation_id: conv.conversation_id,
        participant: {
          skool_user_id: participantUserId,
          display_name: userInfo?.display_name || syncStatusName || senderName || null,
          username: userInfo?.username || null,
        },
        last_message: conv.last_message
          ? {
              text: conv.last_message.message_text,
              direction: conv.last_message.direction as 'inbound' | 'outbound',
              created_at: conv.last_message.created_at,
            }
          : {
              text: null,
              direction: 'inbound' as const,
              created_at: new Date().toISOString(),
            },
        message_count: conv.messages.length,
        pending_count: conv.pending_count,
        synced_count: conv.synced_count,
      }
    })

    // Apply search filter (by participant name)
    if (search) {
      const searchLower = search.toLowerCase()
      conversations = conversations.filter(
        (c) =>
          c.participant.display_name?.toLowerCase().includes(searchLower) ||
          c.participant.username?.toLowerCase().includes(searchLower)
      )
    }

    // Apply status filter
    if (status && status !== 'all') {
      if (status === 'pending') {
        conversations = conversations.filter((c) => c.pending_count > 0)
      } else if (status === 'synced') {
        conversations = conversations.filter((c) => c.pending_count === 0 && c.synced_count > 0)
      } else if (status === 'failed') {
        // Could add failed_count tracking if needed
        conversations = conversations.filter(
          (c) => c.pending_count === 0 && c.synced_count === 0
        )
      }
    }

    // Sort by last message date (most recent first)
    conversations.sort((a, b) => {
      const aDate = new Date(a.last_message.created_at).getTime()
      const bDate = new Date(b.last_message.created_at).getTime()
      return bDate - aDate
    })

    // Calculate summary before pagination
    const summary: ConversationsSummary = {
      total_conversations: conversations.length,
      total_pending: conversations.reduce((acc, c) => acc + c.pending_count, 0),
    }

    // Apply pagination
    const paginatedConversations = conversations.slice(offset, offset + limit)
    const hasMore = offset + limit < conversations.length

    return NextResponse.json({
      conversations: paginatedConversations,
      summary,
      pagination: {
        limit,
        offset,
        hasMore,
      },
    } as ConversationsResponse)
  } catch (error) {
    console.error('[Conversations API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch conversations', details: String(error) },
      { status: 500 }
    )
  }
}
