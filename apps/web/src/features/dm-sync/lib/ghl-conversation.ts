/**
 * GHL Conversation Provider Client
 *
 * Handles GHL Conversation Provider API interactions for DM sync.
 * Uses OAuth 2.0 with marketplace credentials to push inbound messages
 * and receive outbound webhooks from the GHL inbox.
 *
 * Provider alias: "Skool"
 *
 * @module dm-sync/lib/ghl-conversation
 */

import crypto from 'crypto'
import type {
  GhlConversation,
  GhlMessage,
  GhlContact,
  SendResult,
} from '../types'

// =============================================================================
// CONFIGURATION
// =============================================================================

const GHL_API_BASE = 'https://services.leadconnectorhq.com'
const GHL_OAUTH_URL = 'https://services.leadconnectorhq.com/oauth/token'

/**
 * GHL conversation client configuration
 */
export interface GhlConversationClientConfig {
  apiKey: string
  locationId: string
}

/**
 * GHL Marketplace OAuth configuration
 */
export interface GhlMarketplaceConfig {
  clientId: string
  clientSecret: string
  locationId: string
  conversationProviderId?: string
  /** Initial refresh token from OAuth authorization flow */
  refreshToken?: string
  /** User ID for database token persistence */
  userId?: string
  /** Callback to save new tokens after refresh (for DB persistence) */
  onTokenRefresh?: (tokens: {
    accessToken: string
    refreshToken: string
    expiresIn: number
  }) => Promise<void>
}

/**
 * OAuth token response
 */
interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope?: string
  locationId?: string
  userId?: string
}

/**
 * GHL API error response
 */
interface GhlApiError {
  message?: string
  error?: string
  statusCode?: number
}

// =============================================================================
// TOKEN CACHE
// =============================================================================

interface TokenCacheEntry {
  accessToken: string
  expiresAt: number
  refreshToken?: string
}

const tokenCache = new Map<string, TokenCacheEntry>()

// =============================================================================
// MARKETPLACE CLIENT CLASS
// =============================================================================

/**
 * Client for GHL Conversation Provider API (Marketplace App)
 *
 * This client uses OAuth 2.0 with marketplace credentials to:
 * - Push inbound messages from Skool to GHL inbox
 * - Create custom channel conversations
 * - Handle webhook verification
 *
 * @example
 * ```ts
 * const client = new GhlConversationProviderClient({
 *   clientId: process.env.GHL_MARKETPLACE_CLIENT_ID!,
 *   clientSecret: process.env.GHL_MARKETPLACE_CLIENT_SECRET!,
 *   locationId: 'loc_123',
 *   conversationProviderId: 'provider_456'
 * })
 *
 * const messageId = await client.pushInboundMessage(
 *   'loc_123',
 *   'contact_789',
 *   'skool_user_abc',
 *   'Hello from Skool!',
 *   'skool_msg_xyz'
 * )
 * ```
 */
export class GhlConversationProviderClient {
  private clientId: string
  private clientSecret: string
  private locationId: string
  private conversationProviderId: string
  private initialRefreshToken?: string
  private userId?: string
  private onTokenRefresh?: (tokens: {
    accessToken: string
    refreshToken: string
    expiresIn: number
  }) => Promise<void>

  constructor(config: GhlMarketplaceConfig) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.locationId = config.locationId
    this.conversationProviderId = config.conversationProviderId || ''
    this.initialRefreshToken = config.refreshToken
    this.userId = config.userId
    this.onTokenRefresh = config.onTokenRefresh
  }

  /**
   * Get OAuth access token, refreshing if necessary
   *
   * GHL Marketplace apps MUST use refresh_token grant type.
   * The initial refresh token comes from the OAuth authorization flow.
   */
  private async getAccessToken(): Promise<string> {
    const cacheKey = `${this.clientId}:${this.locationId}`
    const cached = tokenCache.get(cacheKey)

    // Return cached token if still valid (with 5 minute buffer)
    if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cached.accessToken
    }

    // Determine which refresh token to use
    const refreshTokenToUse = cached?.refreshToken || this.initialRefreshToken

    if (!refreshTokenToUse) {
      throw new Error(
        'GHL OAuth requires a refresh token. ' +
        'Visit /api/auth/ghl/callback to authorize the app and get your refresh token, ' +
        'then add GHL_MARKETPLACE_REFRESH_TOKEN to your environment.'
      )
    }

    // Refresh the token
    const newToken = await this.refreshToken(refreshTokenToUse)
    tokenCache.set(cacheKey, newToken)
    return newToken.accessToken
  }

  /**
   * Get token using client credentials grant
   */
  private async getClientCredentialsToken(): Promise<TokenCacheEntry> {
    const response = await fetch(GHL_OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OAuth token request failed: ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as OAuthTokenResponse

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token,
    }
  }

  /**
   * Refresh an existing token
   *
   * IMPORTANT: GHL refresh tokens are single-use. After each refresh,
   * the new refresh token MUST be persisted or it will be lost.
   */
  private async refreshToken(refreshToken: string): Promise<TokenCacheEntry> {
    const response = await fetch(GHL_OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OAuth refresh failed: ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as OAuthTokenResponse

    const newRefreshToken = data.refresh_token || refreshToken

    // Persist the new tokens to database if callback provided
    // This is CRITICAL because GHL refresh tokens are single-use
    if (this.onTokenRefresh && data.refresh_token) {
      try {
        await this.onTokenRefresh({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
        })
        console.log('[GHL Provider] New tokens persisted to database')
      } catch (error) {
        console.error('[GHL Provider] Failed to persist tokens:', error)
        // Don't throw - we can still use the token for this request
      }
    }

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: newRefreshToken,
    }
  }

  /**
   * Make authenticated API request with retry on 401
   */
  private async request<T>(
    endpoint: string,
    options?: RequestInit & { retryOnAuth?: boolean }
  ): Promise<T> {
    const { retryOnAuth = true, ...fetchOptions } = options || {}
    const accessToken = await this.getAccessToken()
    const url = `${GHL_API_BASE}${endpoint}`

    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
        ...fetchOptions?.headers,
      },
    })

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5')
      console.warn(`[GHL Provider] Rate limited, waiting ${retryAfter}s`)
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
      return this.request(endpoint, { ...options, retryOnAuth: false })
    }

    // Handle auth errors with retry
    if (response.status === 401 && retryOnAuth) {
      const cacheKey = `${this.clientId}:${this.locationId}`
      tokenCache.delete(cacheKey)
      return this.request(endpoint, { ...options, retryOnAuth: false })
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as GhlApiError
      const errorMessage = errorData.message || errorData.error || response.statusText
      console.error(`[GHL Provider] API error: ${response.status}`, {
        endpoint,
        error: errorMessage,
      })
      throw new Error(`GHL API error: ${response.status} - ${errorMessage}`)
    }

    return response.json()
  }

  /**
   * Push inbound message from Skool to GHL inbox
   *
   * This creates a message in the GHL unified inbox that appears to come
   * from the "Skool" channel (conversation provider).
   *
   * IMPORTANT: Uses /conversations/messages/inbound endpoint (not /conversations/messages)
   * so the message appears on the LEFT side of the chat (from the contact).
   *
   * @param locationId - GHL location ID
   * @param contactId - GHL contact ID
   * @param skoolUserId - Skool user ID (used as externalId for threading)
   * @param messageText - The message content
   * @param skoolMessageId - Skool message ID (used as altId for deduplication)
   * @returns GHL message ID
   */
  async pushInboundMessage(
    locationId: string,
    contactId: string,
    skoolUserId: string,
    messageText: string,
    skoolMessageId: string
  ): Promise<string> {
    // Use the dedicated inbound endpoint for Conversation Providers
    // This ensures messages appear on the LEFT side (from contact)
    const body = {
      type: 'Custom',
      contactId,
      locationId,
      message: messageText,
      conversationProviderId: this.conversationProviderId,
      altId: skoolMessageId, // For deduplication
      // External ID helps GHL thread messages from the same Skool user
      externalId: skoolUserId,
    }

    console.log('[GHL Provider] Pushing inbound message:', {
      contactId,
      skoolUserId,
      messageLength: messageText?.length || 0,
      altId: skoolMessageId,
    })

    // Use /conversations/messages/inbound for inbound messages
    // This is the correct endpoint for messages FROM the contact
    const response = await this.request<{
      conversationId?: string
      messageId?: string
      message?: { id: string }
      id?: string
    }>('/conversations/messages/inbound', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const messageId = response.messageId || response.message?.id || response.id
    if (!messageId) {
      console.error('[GHL Provider] Unexpected response:', response)
      throw new Error('GHL push message response missing messageId')
    }

    console.log('[GHL Provider] Message pushed successfully:', messageId)
    return messageId
  }

  /**
   * Push outbound message from Jimmy (Skool) to GHL inbox
   *
   * This creates a message in the GHL unified inbox that appears to come
   * FROM the business (Jimmy), shown on the RIGHT side of the chat.
   *
   * Uses the inbound endpoint with direction: 'outbound' to control positioning.
   *
   * @param locationId - GHL location ID
   * @param contactId - GHL contact ID
   * @param skoolUserId - Skool user ID (the contact's Skool ID)
   * @param messageText - The message content
   * @param skoolMessageId - Skool message ID (used as altId for deduplication)
   * @returns GHL message ID
   */
  async pushOutboundMessage(
    locationId: string,
    contactId: string,
    skoolUserId: string,
    messageText: string,
    skoolMessageId: string
  ): Promise<string> {
    console.log('[GHL Provider] Pushing outbound message:', {
      contactId,
      skoolUserId,
      messageLength: messageText?.length || 0,
      altId: skoolMessageId,
    })

    // Try using inbound endpoint with direction field to control positioning
    // Some custom providers use this to distinguish message direction
    const body = {
      type: 'Custom',
      contactId,
      locationId,
      message: messageText,
      conversationProviderId: this.conversationProviderId,
      altId: skoolMessageId,
      externalId: skoolUserId,
      direction: 'outbound', // Try to indicate this is an outbound message
    }

    const response = await this.request<{
      conversationId?: string
      messageId?: string
      message?: { id: string }
      id?: string
    }>('/conversations/messages/inbound', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const messageId = response.messageId || response.message?.id || response.id
    if (!messageId) {
      console.error('[GHL Provider] Unexpected response:', response)
      throw new Error('GHL push outbound message response missing messageId')
    }

    console.log('[GHL Provider] Outbound message pushed successfully:', messageId)
    return messageId
  }

  /**
   * Get or create a conversation for a contact on the Skool channel
   *
   * For Conversation Providers, conversations are created when the first
   * message is pushed. We use a system message via the inbound endpoint
   * to establish the conversation if one doesn't exist.
   *
   * @param locationId - GHL location ID
   * @param contactId - GHL contact ID
   * @param channelType - Provider alias (default: 'Skool')
   * @returns Conversation ID
   */
  async getOrCreateConversation(
    locationId: string,
    contactId: string,
    _channelType: string = 'Skool'
  ): Promise<string> {
    // For Conversation Providers, push a system message to create/get the conversation
    // The inbound endpoint returns the conversationId
    const body = {
      type: 'Custom',
      contactId,
      locationId,
      message: '⚡ Skool channel connected',
      conversationProviderId: this.conversationProviderId,
      altId: `init-${contactId}-${Date.now()}`,
      externalId: contactId,
    }

    console.log('[GHL Provider] Creating/getting conversation via inbound message')

    const response = await this.request<{
      conversationId?: string
      messageId?: string
    }>('/conversations/messages/inbound', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const conversationId = response.conversationId
    if (!conversationId) {
      console.error('[GHL Provider] No conversationId in response:', response)
      throw new Error('GHL create conversation response missing conversationId')
    }

    console.log('[GHL Provider] Got conversationId:', conversationId)
    return conversationId
  }

  /**
   * Set the conversation provider ID (required for push messages)
   */
  setConversationProviderId(providerId: string): void {
    this.conversationProviderId = providerId
  }
}

// =============================================================================
// WEBHOOK SIGNATURE VERIFICATION
// =============================================================================

/**
 * Verify GHL webhook signature using HMAC-SHA256
 *
 * GHL signs webhooks using the marketplace webhook secret.
 * The signature is sent in the X-GHL-Signature header.
 *
 * NOTE: Currently unused — our Conversation Provider webhooks don't include
 * signatures (by GHL design). This exists for standard GHL webhooks if we
 * add them later.
 *
 * TODO (by July 1, 2026): GHL is deprecating X-WH-Signature (SHA-256) in
 * favor of X-GHL-Signature (ED25519). If we start using signature verification,
 * update this function to use ED25519 instead of HMAC-SHA256.
 * Ref: https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/
 *
 * @param payload - Raw request body as string
 * @param signature - Signature from X-GHL-Signature header
 * @param secret - Webhook secret (GHL_MARKETPLACE_WEBHOOK_SECRET)
 * @returns True if signature is valid
 */
export function verifyGhlWebhookSignature(
  payload: string,
  signature: string,
  secret?: string
): boolean {
  const webhookSecret = secret || process.env.GHL_MARKETPLACE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[GHL Webhook] Missing webhook secret')
    return false
  }

  if (!signature) {
    console.error('[GHL Webhook] Missing signature header')
    return false
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex')

    // Constant-time comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expectedSignature)

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  } catch (error) {
    console.error('[GHL Webhook] Signature verification error:', error)
    return false
  }
}

// =============================================================================
// OUTBOUND WEBHOOK TYPES
// =============================================================================

/**
 * Payload for outbound message webhook from GHL
 */
export interface GhlOutboundMessagePayload {
  contactId: string
  body: string
  conversationId: string
  locationId: string
  messageId?: string
  replyToAltId?: string // If replying to a specific message
  type?: string
  direction?: string
  dateAdded?: string
}

// =============================================================================
// LEGACY CLIENT CLASS (for backward compatibility)
// =============================================================================

/**
 * Client for GHL Conversations API (legacy, non-marketplace)
 *
 * @deprecated Use GhlConversationProviderClient for marketplace apps
 */
export class GhlConversationClient {
  private apiKey: string
  private locationId: string

  constructor(config: GhlConversationClientConfig) {
    this.apiKey = config.apiKey
    this.locationId = config.locationId
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${GHL_API_BASE}${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
        ...options?.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GHL API error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  /**
   * Get or create a conversation for a contact
   */
  async getOrCreateConversation(contactId: string): Promise<GhlConversation> {
    // Try to find existing conversation first
    const existing = await this.findConversationByContact(contactId)
    if (existing) {
      return existing
    }

    // Create new conversation
    return this.createConversation(contactId)
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(
    conversationId: string,
    message: string,
    options?: { type?: string }
  ): Promise<SendResult> {
    try {
      const response = await this.request<{
        messageId?: string
        message?: { id: string }
      }>('/conversations/messages', {
        method: 'POST',
        body: JSON.stringify({
          type: options?.type || 'Custom',
          conversationId,
          message,
        }),
      })

      return {
        success: true,
        ghlMessageId: response.messageId || response.message?.id,
      }
    } catch (error) {
      console.error('[GHL Conversation] Send message failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(
    conversationId: string,
    options?: { limit?: number; lastMessageId?: string }
  ): Promise<GhlMessage[]> {
    const searchParams = new URLSearchParams({
      limit: String(options?.limit || 50),
    })

    if (options?.lastMessageId) {
      searchParams.set('lastMessageId', options.lastMessageId)
    }

    const response = await this.request<{ messages?: GhlMessage[] }>(
      `/conversations/${conversationId}/messages?${searchParams.toString()}`
    )

    return response.messages || []
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId: string): Promise<GhlConversation | null> {
    try {
      const response = await this.request<{ conversation?: GhlConversation }>(
        `/conversations/${conversationId}`
      )
      return response.conversation || null
    } catch {
      return null
    }
  }

  /**
   * Search conversations by contact
   */
  async findConversationByContact(contactId: string): Promise<GhlConversation | null> {
    try {
      const searchParams = new URLSearchParams({
        locationId: this.locationId,
        contactId,
      })

      const response = await this.request<{ conversations?: GhlConversation[] }>(
        `/conversations/search?${searchParams.toString()}`
      )

      return response.conversations?.[0] || null
    } catch {
      return null
    }
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    contactId: string,
    options?: { type?: string }
  ): Promise<GhlConversation> {
    const response = await this.request<{ conversation: GhlConversation }>(
      '/conversations',
      {
        method: 'POST',
        body: JSON.stringify({
          locationId: this.locationId,
          contactId,
          type: options?.type || 'Custom',
        }),
      }
    )

    return response.conversation
  }

  /**
   * Get contact by ID
   */
  async getContact(contactId: string): Promise<GhlContact | null> {
    try {
      const response = await this.request<{ contact?: GhlContact }>(
        `/contacts/${contactId}`
      )
      return response.contact || null
    } catch {
      return null
    }
  }

  /**
   * Search contacts by email
   */
  async searchContactsByEmail(email: string): Promise<GhlContact[]> {
    const searchParams = new URLSearchParams({
      locationId: this.locationId,
      query: email,
    })

    const response = await this.request<{ contacts?: GhlContact[] }>(
      `/contacts/?${searchParams.toString()}`
    )

    // Filter for exact email match
    return (response.contacts || []).filter(
      (c) => c.email?.toLowerCase() === email.toLowerCase()
    )
  }

  /**
   * Search contacts by name
   */
  async searchContactsByName(name: string): Promise<GhlContact[]> {
    const searchParams = new URLSearchParams({
      locationId: this.locationId,
      query: name,
    })

    const response = await this.request<{ contacts?: GhlContact[] }>(
      `/contacts/?${searchParams.toString()}`
    )

    return response.contacts || []
  }

  /**
   * Create a new contact
   */
  async createContact(data: {
    email?: string
    firstName?: string
    lastName?: string
    phone?: string
    tags?: string[]
  }): Promise<GhlContact> {
    const response = await this.request<{ contact: GhlContact }>('/contacts/', {
      method: 'POST',
      body: JSON.stringify({
        locationId: this.locationId,
        ...data,
      }),
    })

    return response.contact
  }

  /**
   * Add tags to a contact
   */
  async addTags(contactId: string, tags: string[]): Promise<void> {
    await this.request(`/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    })
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a GHL conversation client with configuration
 * @deprecated Use createGhlConversationProviderClient for marketplace apps
 */
export function createGhlConversationClient(
  config: GhlConversationClientConfig
): GhlConversationClient {
  return new GhlConversationClient(config)
}

/**
 * Create a GHL conversation client from environment
 * @deprecated Use createGhlConversationProviderClientFromEnv for marketplace apps
 */
export function createGhlConversationClientFromEnv(
  locationId: string
): GhlConversationClient {
  const apiKey = process.env.GHL_API_KEY

  if (!apiKey) {
    throw new Error('GHL_API_KEY environment variable is required')
  }

  return new GhlConversationClient({
    apiKey,
    locationId,
  })
}

/**
 * Create a GHL Conversation Provider client from marketplace credentials
 */
export function createGhlConversationProviderClient(
  config: GhlMarketplaceConfig
): GhlConversationProviderClient {
  return new GhlConversationProviderClient(config)
}

/**
 * Create a GHL Conversation Provider client from environment variables
 */
export function createGhlConversationProviderClientFromEnv(
  locationId: string,
  conversationProviderId?: string
): GhlConversationProviderClient {
  const clientId = process.env.GHL_MARKETPLACE_CLIENT_ID
  const clientSecret = process.env.GHL_MARKETPLACE_CLIENT_SECRET
  const refreshToken = process.env.GHL_MARKETPLACE_REFRESH_TOKEN

  if (!clientId || !clientSecret) {
    throw new Error(
      'GHL_MARKETPLACE_CLIENT_ID and GHL_MARKETPLACE_CLIENT_SECRET environment variables are required'
    )
  }

  if (!refreshToken) {
    throw new Error(
      'GHL_MARKETPLACE_REFRESH_TOKEN is required. ' +
      'Visit /api/auth/ghl/callback to authorize the app and get your refresh token.'
    )
  }

  return new GhlConversationProviderClient({
    clientId,
    clientSecret,
    locationId,
    conversationProviderId,
    refreshToken,
  })
}

/**
 * Create a GHL Conversation Provider client with database-backed token persistence
 *
 * This version stores tokens in the database and automatically saves new tokens
 * after each refresh. This is the preferred method for production use since
 * GHL refresh tokens are single-use.
 *
 * @param userId - User ID for token storage
 * @param locationId - GHL location ID
 * @param conversationProviderId - Optional conversation provider ID
 * @param storedTokens - Pre-fetched tokens from database (optional, will use env vars if not provided)
 * @returns Configured GHL client with token persistence
 */
export async function createGhlConversationProviderClientWithPersistence(
  userId: string,
  locationId: string,
  conversationProviderId?: string,
  storedTokens?: { refreshToken: string; accessToken?: string; expiresAt?: Date }
): Promise<GhlConversationProviderClient> {
  // Dynamically import to avoid circular dependencies
  const { saveTokens } = await import('./ghl-token-store')

  const clientId = process.env.GHL_MARKETPLACE_CLIENT_ID
  const clientSecret = process.env.GHL_MARKETPLACE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error(
      'GHL_MARKETPLACE_CLIENT_ID and GHL_MARKETPLACE_CLIENT_SECRET environment variables are required'
    )
  }

  // Use stored tokens or fall back to environment
  const refreshToken =
    storedTokens?.refreshToken || process.env.GHL_MARKETPLACE_REFRESH_TOKEN

  if (!refreshToken) {
    throw new Error(
      'GHL refresh token not found in database or environment. ' +
      'Visit /api/auth/ghl/callback to authorize the app.'
    )
  }

  return new GhlConversationProviderClient({
    clientId,
    clientSecret,
    locationId,
    conversationProviderId,
    refreshToken,
    userId,
    onTokenRefresh: async (tokens) => {
      await saveTokens(userId, tokens)
    },
  })
}

// =============================================================================
// CONVERSATION PROVIDER REGISTRATION
// =============================================================================

/**
 * Response from GHL conversation provider registration
 */
export interface ConversationProviderRegistrationResponse {
  providerId: string
  name: string
  description?: string
  type?: string
}

/**
 * Register a new Conversation Provider with GHL
 *
 * This is a one-time setup operation that registers your app as a custom
 * channel in the GHL unified inbox. Once registered, you receive a providerId
 * that must be stored and used for all subsequent message operations.
 *
 * @param config - Marketplace credentials (clientId, clientSecret)
 * @param locationId - GHL location ID to register the provider for
 * @param appUrl - Your deployed app URL (e.g., https://0ne-app.vercel.app)
 * @returns Provider registration details including the providerId
 *
 * @example
 * ```ts
 * const result = await registerConversationProvider(
 *   {
 *     clientId: process.env.GHL_MARKETPLACE_CLIENT_ID!,
 *     clientSecret: process.env.GHL_MARKETPLACE_CLIENT_SECRET!,
 *   },
 *   'loc_123',
 *   'https://0ne-app.vercel.app'
 * )
 * console.log('Provider ID:', result.providerId)
 * // Add to .env: GHL_CONVERSATION_PROVIDER_ID=result.providerId
 * ```
 */
export async function registerConversationProvider(
  config: { clientId: string; clientSecret: string; refreshToken: string },
  locationId: string,
  appUrl: string
): Promise<ConversationProviderRegistrationResponse> {
  // Get an access token using the refresh token
  // GHL Marketplace apps MUST use refresh_token grant (client_credentials not supported)
  const tokenResponse = await fetch(GHL_OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }),
  })

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text()
    throw new Error(`OAuth token request failed: ${tokenResponse.status} - ${errorText}`)
  }

  const tokenData = (await tokenResponse.json()) as OAuthTokenResponse
  const accessToken = tokenData.access_token

  // Log if we got a new refresh token (should be stored)
  if (tokenData.refresh_token && tokenData.refresh_token !== config.refreshToken) {
    console.log('[GHL Provider] New refresh token received - update your environment:')
    console.log(`  GHL_MARKETPLACE_REFRESH_TOKEN=${tokenData.refresh_token}`)
  }

  // Register the conversation provider
  const registrationBody = {
    locationId,
    name: 'Skool',
    description: 'Skool community DMs synced to GHL inbox',
    type: 'Custom',
    outboundWebhookUrl: `${appUrl}/api/webhooks/ghl/outbound-message`,
  }

  console.log('[GHL Provider] Registering conversation provider:', {
    locationId,
    name: registrationBody.name,
    outboundWebhookUrl: registrationBody.outboundWebhookUrl,
  })

  const response = await fetch(`${GHL_API_BASE}/conversations/providers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
    },
    body: JSON.stringify(registrationBody),
  })

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as GhlApiError
    const errorMessage = errorData.message || errorData.error || response.statusText
    throw new Error(`GHL provider registration failed: ${response.status} - ${errorMessage}`)
  }

  const result = (await response.json()) as ConversationProviderRegistrationResponse

  console.log('[GHL Provider] Registration successful:', {
    providerId: result.providerId,
    name: result.name,
  })

  return result
}
