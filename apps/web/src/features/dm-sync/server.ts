import 'server-only'

/**
 * DM Sync — Server-only exports
 *
 * All lib/* modules that touch the database or external APIs.
 * Import from '@/features/dm-sync/server' in API routes / server components.
 *
 * @module dm-sync/server
 */

// =============================================================================
// CONTACT MAPPER
// =============================================================================

export {
  ContactMapper,
  createContactMapper,
  generateSyntheticEmail,
  isSyntheticEmail,
  normalizeName,
  calculateNameSimilarity,
  parseDisplayName,
  // New exports for Phase 3
  findOrCreateGhlContact,
  findGhlContactsForUsers,
  extractMemberEmail,
  extractMemberPhone,
  type ContactMapperConfig,
  type MatchMethod,
  type ContactLookupResult,
} from './lib/contact-mapper'

// =============================================================================
// GHL CONVERSATION CLIENT
// =============================================================================

export {
  // Legacy client (non-marketplace)
  GhlConversationClient,
  createGhlConversationClient,
  createGhlConversationClientFromEnv,
  type GhlConversationClientConfig,
  // Marketplace client (Phase 4)
  GhlConversationProviderClient,
  createGhlConversationProviderClient,
  createGhlConversationProviderClientFromEnv,
  // Marketplace client with DB persistence (recommended)
  createGhlConversationProviderClientWithPersistence,
  type GhlMarketplaceConfig,
  // Webhook utilities
  verifyGhlWebhookSignature,
  type GhlOutboundMessagePayload,
} from './lib/ghl-conversation'

// =============================================================================
// GHL TOKEN STORE
// =============================================================================

export {
  getStoredTokens,
  saveTokens,
  clearTokens,
  tokensNeedRefresh,
  type StoredTokens,
  type TokenUpdate,
} from './lib/ghl-token-store'

// =============================================================================
// SYNC ENGINE
// =============================================================================

export {
  getEnabledSyncConfigs,
  // Extension message sync (Phase 2 - Skool Sync)
  syncExtensionMessages,
  // Hand-raiser functions (Phase 7)
  getUsersWithActiveHandRaisers,
  // Utilities
  needsSync,
  calculateSyncPriority,
  sortBySyncPriority,
  // Types
  type SyncEngineConfig,
  type SyncOptions,
  type ExtensionSyncResult,
} from './lib/sync-engine'

// =============================================================================
// STAFF USERS (Phase 5)
// =============================================================================

export {
  // CRUD operations
  getStaffUsers,
  getActiveStaffUsers,
  getStaffBySkoolId,
  getStaffByGhlUserId,
  getDefaultStaff,
  createStaffUser,
  updateStaffUser,
  deleteStaffUser,
  // Routing logic
  parseStaffOverride,
  resolveOutboundStaff,
  // Message formatting
  formatInboundMessage,
  formatOutboundMessage,
  stripStaffPrefix,
  // Types
  type StaffUserInput,
  type ResolvedStaff,
} from './lib/staff-users'
