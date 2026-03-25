/**
 * DM Sync Feature — Client-safe barrel
 *
 * Types, hooks, and components only.
 * For server-side lib/* imports, use '@/features/dm-sync/server'.
 *
 * @module dm-sync
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
  // Skool types
  SkoolUser,
  SkoolConversation,
  SkoolMessage,
  SkoolComment,
  // Database row types
  DmSyncConfigRow,
  ContactMappingRow,
  DmMessageRow,
  HandRaiserCampaignRow,
  HandRaiserSentRow,
  StaffUserRow,
  // Domain types
  DmSyncConfig,
  ContactMapping,
  DmMessage,
  HandRaiserCampaign,
  HandRaiserSent,
  StaffUser,
  // Result types
  SyncResult,
  SyncError,
  SendResult,
  MapContactResult,
  HandRaiserResult,
  // Input types
  CreateSyncConfigInput,
  CreateHandRaiserCampaignInput,
  SendDmInput,
  // GHL types
  GhlContact,
  GhlConversation,
  GhlMessage,
  // Inbox conversation types
  InboxConversationParticipant,
  InboxConversationLastMessage,
  InboxConversation,
  InboxConversationsSummary,
  InboxMessage,
  InboxConversationDetail,
} from './types'

// =============================================================================
// HOOKS
// =============================================================================

export {
  useHandRaisers,
  createHandRaiser,
  updateHandRaiser,
  deleteHandRaiser,
  type HandRaiserCampaignWithStats,
  type CreateHandRaiserInput,
} from './hooks/use-hand-raisers'

export {
  useContactActivity,
  type ContactActivity,
  type ContactActivitySummary,
  type UseContactActivityOptions,
  type UseContactActivityReturn,
} from './hooks/use-contact-activity'

export {
  useRawMessages,
  type RawMessage,
  type RawMessagesSummary,
  type RawMessagesPagination,
  type UseRawMessagesOptions,
  type UseRawMessagesReturn,
} from './hooks/use-raw-messages'

export {
  useConversations,
  type Conversation,
  type ConversationParticipant,
  type ConversationLastMessage,
  type ConversationsSummary,
  type UseConversationsOptions,
  type UseConversationsReturn,
} from './hooks/use-conversations'

export {
  useConversationDetail,
  type ConversationMessage,
  type ConversationDetailParticipant,
  type ConversationDetail as ConversationDetailData,
  type UseConversationDetailReturn,
} from './hooks/use-conversation-detail'

export {
  useManualMatch,
  useSyntheticCreate,
} from './hooks/use-contact-mutations'

// =============================================================================
// COMPONENTS
// =============================================================================

export { StaffUsersManager } from './components/StaffUsersManager'
export { ConversationList } from './components/ConversationList'
export { ConversationItem } from './components/ConversationItem'
export { ConversationDetail } from './components/ConversationDetail'
export { MessageBubble } from './components/MessageBubble'
export { ContactEditDialog } from './components/ContactEditDialog'
