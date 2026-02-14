/**
 * Skool DM Client
 *
 * Server-side client for reading and sending Skool DMs.
 * Uses SKOOL_COOKIES for authentication.
 *
 * @module dm-sync/lib/skool-dm-client
 */

import type {
  SkoolConversation,
  SkoolMessage,
  SkoolUser,
  SkoolComment,
  SendResult,
} from '../types'

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Skool API base URL for DM operations */
const SKOOL_API_BASE = 'https://api2.skool.com'

/** Human-like delay range for sending messages (ms) */
const HUMAN_DELAY_MIN_MS = 2000
const HUMAN_DELAY_MAX_MS = 5000

/** Rate limit delay between API requests (ms) */
const REQUEST_DELAY_MS = 200

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Error codes for Skool DM operations
 */
export type SkoolDmErrorCode =
  | 'COOKIES_EXPIRED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'

/**
 * Custom error for Skool DM operations
 */
export class SkoolDmError extends Error {
  constructor(
    message: string,
    public code: SkoolDmErrorCode,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'SkoolDmError'
  }
}

// =============================================================================
// RAW API RESPONSE TYPES
// =============================================================================

/**
 * Raw chat channel from Skool API
 */
interface SkoolApiChatChannel {
  id: string
  type: 'user'
  user: {
    id: string
    name: string
    displayName: string
    image: string | null
  }
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadCount: number
}

/**
 * Raw message from Skool API
 *
 * Note: The actual API response has a different structure than the original interface.
 * Content is in metadata.content, sender is in metadata.src, etc.
 */
interface SkoolApiMessage {
  id: string
  channel_id: string
  metadata: {
    content: string
    src: string  // sender ID
    dst: string  // recipient ID
  }
  created_at: string
  updated_at: string
}

/**
 * Raw comment from Skool API
 */
interface SkoolApiComment {
  id: string
  userId: string
  user?: {
    id: string
    name: string
    displayName: string
    image?: string | null
  }
  content: string
  createdAt: string
}

// =============================================================================
// CLIENT CONFIGURATION
// =============================================================================

/**
 * Skool DM client configuration
 */
export interface SkoolDmClientConfig {
  cookies: string
  communitySlug?: string
}

// =============================================================================
// CLIENT CLASS
// =============================================================================

/**
 * Client for interacting with Skool DM API
 *
 * @example
 * ```ts
 * const client = new SkoolDmClient({
 *   cookies: process.env.SKOOL_COOKIES!,
 * })
 *
 * const conversations = await client.getInbox()
 * const messages = await client.getMessages(conversations[0].channelId)
 * ```
 */
export class SkoolDmClient {
  private cookies: string
  private communitySlug?: string
  private currentUserId: string | null = null

  constructor(config: SkoolDmClientConfig) {
    if (!config.cookies) {
      throw new SkoolDmError(
        'SKOOL_COOKIES is required',
        'COOKIES_EXPIRED'
      )
    }
    this.cookies = config.cookies
    this.communitySlug = config.communitySlug
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Make authenticated request to Skool API
   */
  private async fetch<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    const fullUrl = url.startsWith('http') ? url : `${SKOOL_API_BASE}${url}`

    console.log(`[SkoolDmClient] ${options.method || 'GET'} ${fullUrl}`)
    console.log(`[SkoolDmClient] Cookie length: ${this.cookies?.length || 0}, has auth_token: ${this.cookies?.includes('auth_token=') || false}`)

    try {
      const response = await fetch(fullUrl, {
        ...options,
        headers: {
          accept: 'application/json',
          'accept-language': 'en-US,en;q=0.9',
          'content-type': 'application/json',
          cookie: this.cookies,
          origin: 'https://www.skool.com',
          referer: 'https://www.skool.com/',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...options.headers,
        },
      })

      // Handle error responses
      if (!response.ok) {
        const errorCode = this.mapStatusToErrorCode(response.status)
        const responseText = await response.text()
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`

        try {
          const errorData = JSON.parse(responseText)
          errorMessage = errorData.message || errorData.error || errorMessage
        } catch {
          // If not JSON, include raw response
          errorMessage = `HTTP ${response.status}: ${responseText.substring(0, 200)}`
        }

        console.error(
          `[SkoolDmClient] API error: ${response.status} - ${errorMessage}`
        )

        throw new SkoolDmError(errorMessage, errorCode, response.status)
      }

      return response.json()
    } catch (error) {
      // Re-throw SkoolDmError as-is
      if (error instanceof SkoolDmError) {
        throw error
      }

      // Wrap network errors
      console.error(`[SkoolDmClient] Network error:`, error)
      throw new SkoolDmError(
        error instanceof Error ? error.message : 'Network error',
        'NETWORK_ERROR'
      )
    }
  }

  /**
   * Map HTTP status code to error code
   */
  private mapStatusToErrorCode(status: number): SkoolDmErrorCode {
    switch (status) {
      case 401:
        return 'COOKIES_EXPIRED'
      case 403:
        return 'FORBIDDEN'
      case 404:
        return 'NOT_FOUND'
      case 429:
        return 'RATE_LIMITED'
      default:
        return 'UNKNOWN_ERROR'
    }
  }

  /**
   * Extract error message from response
   */
  private async getErrorMessage(response: Response): Promise<string> {
    try {
      const data = await response.json()
      return (
        data.message ||
        data.error ||
        `HTTP ${response.status}: ${response.statusText}`
      )
    } catch {
      return `HTTP ${response.status}: ${response.statusText}`
    }
  }

  /**
   * Human-like delay before sending messages
   * Randomized between 2-5 seconds
   */
  private async humanDelay(): Promise<void> {
    const delay =
      HUMAN_DELAY_MIN_MS +
      Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS)
    console.log(
      `[SkoolDmClient] Human-like delay: ${Math.round(delay)}ms`
    )
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  /**
   * Rate limit delay between requests
   */
  private async requestDelay(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS))
  }

  /**
   * Extract user_id from auth_token JWT in cookies
   *
   * The Skool auth_token is a JWT that contains the user_id in its payload.
   * Format: auth_token=eyJ...header...eyJ...payload...signature
   */
  private extractUserIdFromAuthToken(): string | null {
    try {
      // Find auth_token in cookies
      const authTokenMatch = this.cookies.match(/auth_token=([^;]+)/)
      if (!authTokenMatch) {
        return null
      }

      const jwt = authTokenMatch[1]
      const parts = jwt.split('.')
      if (parts.length !== 3) {
        return null
      }

      // Decode the payload (second part)
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64').toString('utf-8')
      )

      if (payload.user_id && typeof payload.user_id === 'string') {
        return payload.user_id
      }

      return null
    } catch (error) {
      console.log('[SkoolDmClient] Failed to extract user_id from auth_token:', error)
      return null
    }
  }

  /**
   * Transform API chat channel to SkoolConversation
   */
  private transformChannel(channel: SkoolApiChatChannel): SkoolConversation {
    return {
      id: channel.id,
      channelId: channel.id,
      participant: {
        id: channel.user.id,
        username: channel.user.name,
        displayName: channel.user.displayName,
        profileImage: channel.user.image,
      },
      lastMessageAt: channel.lastMessageAt
        ? new Date(channel.lastMessageAt)
        : null,
      lastMessagePreview: channel.lastMessagePreview,
      unreadCount: channel.unreadCount,
    }
  }

  /**
   * Transform API message to SkoolMessage
   *
   * Maps the Skool API response structure (metadata.content, metadata.src)
   * to our internal SkoolMessage format.
   */
  private transformMessage(
    message: SkoolApiMessage,
    currentUserId: string
  ): SkoolMessage {
    const isOutbound = message.metadata.src === currentUserId

    // Debug logging to diagnose outbound detection
    console.log(`[SkoolDmClient] transformMessage: id=${message.id}, src=${message.metadata.src}, currentUserId=${currentUserId}, isOutbound=${isOutbound}, content="${(message.metadata.content || '').substring(0, 50)}..."`)

    return {
      id: message.id,
      conversationId: message.channel_id,
      senderId: message.metadata.src,
      content: message.metadata.content,
      sentAt: new Date(message.created_at),
      isOutbound,
    }
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Get DM inbox (list of conversations)
   *
   * @param offset - Pagination offset (default: 0)
   * @param limit - Number of conversations to fetch (default: 50)
   * @returns Array of conversations
   */
  async getInbox(offset = 0, limit = 25): Promise<SkoolConversation[]> {
    console.log(
      `[SkoolDmClient] Fetching inbox: offset=${offset}, limit=${limit}`
    )

    const url = new URL(`${SKOOL_API_BASE}/self/chat-channels`)
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('last', 'true')
    url.searchParams.set('unread-only', 'false')

    const response = await this.fetch<{ channels: SkoolApiChatChannel[] }>(
      url.toString()
    )

    console.log(
      `[SkoolDmClient] Fetched ${response.channels?.length || 0} conversations`
    )

    return (response.channels || []).map((channel) =>
      this.transformChannel(channel)
    )
  }

  /**
   * Get all conversations with pagination
   *
   * @returns Array of all conversations
   */
  async getAllInbox(): Promise<SkoolConversation[]> {
    const allConversations: SkoolConversation[] = []
    let offset = 0
    const limit = 25 // Skool API max limit is 25
    const maxIterations = 200 // Safety limit (increased to compensate for smaller batches)

    for (let i = 0; i < maxIterations; i++) {
      const conversations = await this.getInbox(offset, limit)
      allConversations.push(...conversations)

      if (conversations.length < limit) {
        break
      }

      offset += limit
      await this.requestDelay()
    }

    console.log(
      `[SkoolDmClient] Fetched ${allConversations.length} total conversations`
    )

    return allConversations
  }

  /**
   * Get messages in a conversation (single page)
   *
   * @param channelId - The conversation channel ID
   * @param options - Pagination options
   * @returns Array of messages (ordered by creation time ascending by default)
   */
  async getMessages(
    channelId: string,
    options?: {
      after?: string    // Get messages after this ID (for forward pagination)
      before?: string   // Get messages before this ID (for backward pagination)
      limit?: number    // Max messages to fetch (default: 50)
    }
  ): Promise<SkoolMessage[]> {
    console.log(
      `[SkoolDmClient] Fetching messages for channel: ${channelId}`,
      options
    )

    const url = new URL(`${SKOOL_API_BASE}/channels/${channelId}/messages`)

    // Skool API requires either 'after' or 'before' to be set
    // Default to 'after=1' which gets all messages from the beginning
    if (options?.before) {
      url.searchParams.set('before', options.before)
    } else {
      // Use after (default to '1' to get all messages from start)
      url.searchParams.set('after', options?.after ?? '1')
    }

    if (options?.limit) {
      url.searchParams.set('limit', String(options.limit))
    }

    const response = await this.fetch<{ messages: SkoolApiMessage[] }>(
      url.toString()
    )

    console.log(
      `[SkoolDmClient] Fetched ${response.messages?.length || 0} messages`
    )

    // Get current user ID for determining outbound messages
    const currentUserId = await this.getCurrentUserId()

    return (response.messages || []).map((message) =>
      this.transformMessage(message, currentUserId)
    )
  }

  /**
   * Get ALL messages in a conversation (with pagination)
   *
   * Uses backward pagination with 'before' parameter to fetch from
   * newest to oldest messages. This works better with Skool's API.
   *
   * @param channelId - The conversation channel ID
   * @param options - Fetch options
   * @returns Array of all messages (newest first)
   */
  async getAllMessages(
    channelId: string,
    options?: {
      maxMessages?: number  // Stop after this many messages (default: 500)
      sinceDate?: Date      // Only fetch messages newer than this date
    }
  ): Promise<SkoolMessage[]> {
    const maxMessages = options?.maxMessages ?? 500
    const sinceDate = options?.sinceDate
    const allMessages: SkoolMessage[] = []
    let beforeCursor: string | undefined = undefined // Start from most recent
    let iteration = 0
    const pageSize = 50
    const maxIterations = Math.ceil(maxMessages / pageSize) + 5 // Safety limit

    console.log(
      `[SkoolDmClient] Fetching all messages for channel: ${channelId}, maxMessages: ${maxMessages}`
    )

    // First, get the most recent messages with after=1
    // This gives us a starting point for backward pagination
    let initialMessages: SkoolMessage[]
    try {
      initialMessages = await this.getMessages(channelId, {
        after: '1',
        limit: pageSize,
      })
    } catch (error) {
      console.log(`[SkoolDmClient] Error fetching initial messages:`, error)
      return allMessages
    }

    if (initialMessages.length === 0) {
      console.log(`[SkoolDmClient] No messages found in conversation`)
      return allMessages
    }

    // Add initial messages
    for (const msg of initialMessages) {
      if (sinceDate && msg.sentAt < sinceDate) continue
      allMessages.push(msg)
    }

    console.log(`[SkoolDmClient] Initial fetch: ${initialMessages.length} messages`)

    // If we got a full page or want more, try backward pagination
    if (initialMessages.length >= pageSize || allMessages.length < maxMessages) {
      // The oldest message from initial fetch is our cursor for backward pagination
      beforeCursor = initialMessages[0].id

      while (iteration < maxIterations && allMessages.length < maxMessages) {
        iteration++

        let messages: SkoolMessage[]
        try {
          messages = await this.getMessages(channelId, {
            before: beforeCursor,
            limit: pageSize,
          })
        } catch (error) {
          // Handle end of conversation
          if (error instanceof SkoolDmError && error.statusCode === 400) {
            console.log(`[SkoolDmClient] Reached beginning of conversation (API returned 400)`)
            break
          }
          throw error
        }

        if (messages.length === 0) {
          console.log(`[SkoolDmClient] No more older messages found`)
          break
        }

        // Add messages (prepend since they're older)
        let addedCount = 0
        for (const msg of messages) {
          if (sinceDate && msg.sentAt < sinceDate) {
            console.log(`[SkoolDmClient] Reached date limit, stopping`)
            return allMessages.reverse() // Return in chronological order
          }

          // Prepend older messages
          allMessages.unshift(msg)
          addedCount++

          if (allMessages.length >= maxMessages) {
            console.log(`[SkoolDmClient] Reached max messages limit (${maxMessages})`)
            return allMessages.reverse() // Return in chronological order
          }
        }

        // If we got fewer than a full page, we've reached the beginning
        if (messages.length < pageSize) {
          console.log(`[SkoolDmClient] Got partial page (${messages.length}/${pageSize}), reached beginning`)
          break
        }

        // Update cursor to oldest message
        beforeCursor = messages[0].id

        console.log(
          `[SkoolDmClient] Iteration ${iteration}: fetched ${messages.length}, total: ${allMessages.length}, cursor: ${beforeCursor}`
        )

        // Rate limiting
        await this.requestDelay()
      }
    }

    console.log(
      `[SkoolDmClient] Finished fetching all messages: ${allMessages.length} total`
    )

    // Return in chronological order (oldest first)
    return allMessages.reverse()
  }

  /**
   * Send a DM to a conversation
   *
   * Includes a human-like delay (2-5 seconds) before sending
   * to avoid detection as automated behavior.
   *
   * @param channelId - The conversation channel ID
   * @param content - The message content
   * @returns Send result with success status and message ID
   */
  async sendMessage(channelId: string, content: string): Promise<SendResult> {
    console.log(
      `[SkoolDmClient] Sending message to channel: ${channelId}`
    )

    // Human-like delay
    await this.humanDelay()

    try {
      const response = await this.fetch<{ message: SkoolApiMessage }>(
        `/channels/${channelId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content }),
        }
      )

      console.log(
        `[SkoolDmClient] Message sent successfully: ${response.message?.id}`
      )

      return {
        success: true,
        skoolMessageId: response.message?.id,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      console.error(`[SkoolDmClient] Failed to send message:`, errorMessage)

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Get or create a conversation with a user
   *
   * First checks existing conversations for the user.
   * If not found, creates a new conversation.
   *
   * @param userId - The Skool user ID to start/get conversation with
   * @returns The conversation with the user
   */
  async getOrCreateConversation(userId: string): Promise<SkoolConversation> {
    console.log(
      `[SkoolDmClient] Getting or creating conversation for user: ${userId}`
    )

    // First, try to find existing conversation
    const existingConversation = await this.findConversationByUserId(userId)
    if (existingConversation) {
      console.log(
        `[SkoolDmClient] Found existing conversation: ${existingConversation.channelId}`
      )
      return existingConversation
    }

    // Create new conversation by sending an empty message
    // Skool auto-creates the channel when you message a user
    console.log(`[SkoolDmClient] Creating new conversation with user: ${userId}`)

    const response = await this.fetch<{
      channel: SkoolApiChatChannel
    }>('/channels', {
      method: 'POST',
      body: JSON.stringify({
        type: 'user',
        userId: userId,
      }),
    })

    console.log(
      `[SkoolDmClient] Created conversation: ${response.channel?.id}`
    )

    return this.transformChannel(response.channel)
  }

  /**
   * Find a conversation by user ID
   *
   * @param userId - The Skool user ID
   * @returns The conversation if found, null otherwise
   */
  async findConversationByUserId(
    userId: string
  ): Promise<SkoolConversation | null> {
    // Fetch conversations and look for matching user
    const conversations = await this.getAllInbox()
    const found = conversations.find((conv) => conv.participant.id === userId)
    return found || null
  }

  /**
   * Get the current authenticated user's ID
   *
   * Uses multiple strategies:
   * 1. Check SKOOL_USER_ID environment variable
   * 2. Try /self/user endpoint (unreliable - often returns 404)
   * 3. Infer from conversation context (the message sender who ISN'T the conversation participant)
   */
  async getCurrentUserId(): Promise<string> {
    if (this.currentUserId) {
      console.log(`[SkoolDmClient] Returning cached current user ID: ${this.currentUserId}`)
      return this.currentUserId
    }

    // Strategy 1: Check environment variable (most reliable)
    const envUserId = process.env.SKOOL_USER_ID
    if (envUserId) {
      console.log(`[SkoolDmClient] Using SKOOL_USER_ID from environment: ${envUserId}`)
      this.currentUserId = envUserId
      return this.currentUserId
    }

    // Strategy 2: Extract from auth_token JWT in cookies
    const jwtUserId = this.extractUserIdFromAuthToken()
    if (jwtUserId) {
      console.log(`[SkoolDmClient] Extracted user ID from auth_token JWT: ${jwtUserId}`)
      this.currentUserId = jwtUserId
      return this.currentUserId
    }

    // Strategy 3: Try /self/user endpoint (often fails with 404)
    try {
      console.log(`[SkoolDmClient] Trying /self/user endpoint...`)
      const response = await this.fetch<{ user: { id: string } }>(
        '/self/user'
      )
      if (response.user?.id) {
        this.currentUserId = response.user.id
        console.log(`[SkoolDmClient] Got user ID from /self/user: ${this.currentUserId}`)
        return this.currentUserId
      }
    } catch (error) {
      console.log(
        '[SkoolDmClient] /self/user endpoint failed (expected):',
        error instanceof Error ? error.message : error
      )
    }

    // Strategy 4: Infer from conversations
    // In a DM, any message where sender !== participant must be from the current user
    console.log(`[SkoolDmClient] Attempting to infer user ID from conversations...`)
    try {
      const conversations = await this.getInbox(0, 5)
      for (const conv of conversations) {
        const messages = await this.getMessagesRaw(conv.channelId, '1')
        for (const msg of messages) {
          // If sender is NOT the conversation participant, sender must be current user
          if (msg.metadata.src !== conv.participant.id) {
            this.currentUserId = msg.metadata.src
            console.log(`[SkoolDmClient] Inferred user ID from outbound message: ${this.currentUserId}`)
            return this.currentUserId
          }
          // Alternative: if dst is NOT the participant, dst must be current user
          if (msg.metadata.dst !== conv.participant.id) {
            this.currentUserId = msg.metadata.dst
            console.log(`[SkoolDmClient] Inferred user ID from inbound message dst: ${this.currentUserId}`)
            return this.currentUserId
          }
        }
      }
    } catch (error) {
      console.error('[SkoolDmClient] Failed to infer user ID from conversations:', error)
    }

    console.error('[SkoolDmClient] CRITICAL: Could not determine current user ID!')
    console.error('[SkoolDmClient] Set SKOOL_USER_ID environment variable to fix outbound detection.')
    this.currentUserId = ''
    return this.currentUserId
  }

  /**
   * Get raw messages without transformation (for user ID inference)
   */
  private async getMessagesRaw(
    channelId: string,
    afterMessageId = '1'
  ): Promise<SkoolApiMessage[]> {
    const url = new URL(`${SKOOL_API_BASE}/channels/${channelId}/messages`)
    url.searchParams.set('after', afterMessageId)

    const response = await this.fetch<{ messages: SkoolApiMessage[] }>(
      url.toString()
    )

    return response.messages || []
  }

  /**
   * Fetch user profile by ID
   *
   * @param userId - The Skool user ID
   * @returns User profile if found
   */
  async getUser(userId: string): Promise<SkoolUser | null> {
    console.log(`[SkoolDmClient] Fetching user profile: ${userId}`)

    try {
      const response = await this.fetch<{
        user: {
          id: string
          name: string
          displayName: string
          image: string | null
          email?: string
        }
      }>(`/users/${userId}`)

      if (!response.user) {
        return null
      }

      return {
        id: response.user.id,
        username: response.user.name,
        displayName: response.user.displayName,
        profileImage: response.user.image,
        email: response.user.email,
      }
    } catch (error) {
      if (
        error instanceof SkoolDmError &&
        error.code === 'NOT_FOUND'
      ) {
        return null
      }
      throw error
    }
  }

  /**
   * Mark a conversation as read
   *
   * @param conversationId - The conversation ID to mark as read
   */
  async markAsRead(conversationId: string): Promise<void> {
    console.log(`[SkoolDmClient] Marking conversation as read: ${conversationId}`)

    await this.fetch(`/channels/${conversationId}/read`, {
      method: 'POST',
    })
  }

  // ===========================================================================
  // POST COMMENTS API (Hand-Raiser Feature)
  // ===========================================================================

  /**
   * Get comments on a Skool post
   *
   * @param postId - The post ID (extracted from URL)
   * @param communitySlug - The community slug (optional, uses instance default)
   * @returns Array of comments
   */
  async getPostComments(
    postId: string,
    communitySlug?: string
  ): Promise<SkoolComment[]> {
    const slug = communitySlug || this.communitySlug
    if (!slug) {
      throw new SkoolDmError(
        'Community slug is required for fetching post comments',
        'UNKNOWN_ERROR'
      )
    }

    console.log(`[SkoolDmClient] Fetching comments for post: ${postId}`)

    // Skool API endpoint for post comments
    // The endpoint structure is: /groups/{groupSlug}/posts/{postId}/comments
    const url = `${SKOOL_API_BASE}/groups/${slug}/posts/${postId}/comments`

    try {
      const response = await this.fetch<{ comments: SkoolApiComment[] }>(url)

      console.log(
        `[SkoolDmClient] Fetched ${response.comments?.length || 0} comments`
      )

      return (response.comments || []).map((comment) =>
        this.transformComment(comment)
      )
    } catch (error) {
      if (error instanceof SkoolDmError && error.code === 'NOT_FOUND') {
        // Post might not exist or no comments yet
        console.log(`[SkoolDmClient] No comments found for post: ${postId}`)
        return []
      }
      throw error
    }
  }

  /**
   * Parse post ID from a Skool post URL
   *
   * Supports formats:
   * - https://www.skool.com/community/post-slug-abc123
   * - https://www.skool.com/community/post/abc123
   *
   * @param url - The full Skool post URL
   * @returns Object with postId and communitySlug
   */
  parsePostIdFromUrl(url: string): { postId: string; communitySlug: string } {
    // Remove trailing slash
    const cleanUrl = url.replace(/\/$/, '')

    // Parse the URL
    let urlObj: URL
    try {
      urlObj = new URL(cleanUrl)
    } catch {
      throw new SkoolDmError(
        `Invalid URL format: ${url}`,
        'UNKNOWN_ERROR'
      )
    }

    // Expected path: /community-slug/post-slug-postid or /community-slug/post/postid
    const pathParts = urlObj.pathname.split('/').filter(Boolean)

    if (pathParts.length < 2) {
      throw new SkoolDmError(
        `Invalid Skool post URL format: ${url}`,
        'UNKNOWN_ERROR'
      )
    }

    const communitySlug = pathParts[0]

    // Check if it's /community/post/postid format
    if (pathParts[1] === 'post' && pathParts[2]) {
      return {
        postId: pathParts[2],
        communitySlug,
      }
    }

    // Otherwise, extract postId from the slug (last segment after final hyphen)
    // Format: post-title-slug-abc123 -> abc123
    const postSlug = pathParts[pathParts.length - 1]

    // Try to extract the postId from the end of the slug
    // Skool post IDs are typically alphanumeric, 8-12 characters
    const lastHyphenIndex = postSlug.lastIndexOf('-')
    if (lastHyphenIndex !== -1) {
      const potentialId = postSlug.substring(lastHyphenIndex + 1)
      // Validate it looks like an ID (alphanumeric, reasonable length)
      if (/^[a-zA-Z0-9]{4,20}$/.test(potentialId)) {
        return {
          postId: potentialId,
          communitySlug,
        }
      }
    }

    // If we can't extract from slug, use the whole slug as the postId
    // (some URLs may be in a different format)
    return {
      postId: postSlug,
      communitySlug,
    }
  }

  /**
   * Transform API comment to SkoolComment
   */
  private transformComment(comment: SkoolApiComment): SkoolComment {
    return {
      id: comment.id,
      userId: comment.userId || comment.user?.id || '',
      username: comment.user?.name || '',
      displayName: comment.user?.displayName || '',
      content: comment.content,
      createdAt: comment.createdAt,
    }
  }

  /**
   * Test the connection and authentication
   *
   * @returns Connection status
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.getInbox(0, 1)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Singleton instance
 */
let clientInstance: SkoolDmClient | null = null

/**
 * Get the shared Skool DM client instance
 *
 * Uses SKOOL_COOKIES from environment.
 */
export function getSkoolDmClient(): SkoolDmClient {
  if (!clientInstance) {
    clientInstance = createSkoolDmClient()
  }
  return clientInstance
}

/**
 * Create a Skool DM client with environment configuration
 *
 * @param communitySlug - Optional community slug
 * @param cookies - Optional cookies (defaults to SKOOL_COOKIES env)
 */
export function createSkoolDmClient(
  communitySlug?: string,
  cookies?: string
): SkoolDmClient {
  const cookieValue = cookies || process.env.SKOOL_COOKIES

  if (!cookieValue) {
    throw new SkoolDmError(
      'SKOOL_COOKIES environment variable is required',
      'COOKIES_EXPIRED'
    )
  }

  return new SkoolDmClient({
    cookies: cookieValue,
    communitySlug,
  })
}
