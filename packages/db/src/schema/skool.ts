import { pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { numericNumber } from './columns'

// ── skool_members ──────────────────────────────────────────────────────────────

export const skoolMembers = pgTable('skool_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  skoolUserId: text('skool_user_id').unique().notNull(),
  skoolUsername: text('skool_username'),
  displayName: text('display_name'),
  email: text('email'),
  bio: text('bio'),
  location: text('location'),
  profileImage: text('profile_image'),
  socialLinks: jsonb('social_links').default('{}'),
  groupSlug: text('group_slug').notNull().default('fruitful'),
  memberSince: timestamp('member_since', { withTimezone: true }),
  lastOnline: timestamp('last_online', { withTimezone: true }),
  attributionSource: text('attribution_source'),
  level: integer('level').default(1),
  points: integer('points').default(0),
  ghlContactId: text('ghl_contact_id'),
  matchedAt: timestamp('matched_at', { withTimezone: true }),
  matchMethod: text('match_method'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  aceScore: text('ace_score'),
  aceScoreExplanation: text('ace_score_explanation'),
  lifespanDays: integer('lifespan_days'),
  role: text('role').default('member'),
  postsCount: integer('posts_count').default(0),
  referralsCount: integer('referrals_count').default(0),
  mrrStatus: text('mrr_status'),
  surveyAnswers: jsonb('survey_answers'),
  phone: text('phone'),
}, (table) => [
  index('skool_members_username_idx').on(table.skoolUsername),
  index('skool_members_ghl_idx').on(table.ghlContactId),
  index('skool_members_email_idx').on(table.email),
  index('skool_members_group_slug_idx').on(table.groupSlug),
])

// ── skool_conversations ────────────────────────────────────────────────────────

export const skoolConversations = pgTable('skool_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  skoolChannelId: text('skool_channel_id').unique().notNull(),
  participantSkoolId: text('participant_skool_id'),
  participantName: text('participant_name'),
  participantUsername: text('participant_username'),
  participantImage: text('participant_image'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  lastMessagePreview: text('last_message_preview'),
  unreadCount: integer('unread_count').default(0),
  isArchived: boolean('is_archived').default(false),
  ghlConversationId: text('ghl_conversation_id'),
  ghlSyncedAt: timestamp('ghl_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ── skool_messages ─────────────────────────────────────────────────────────────

export const skoolMessages = pgTable('skool_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => skoolConversations.id, { onDelete: 'cascade' }),
  skoolMessageId: text('skool_message_id').unique().notNull(),
  senderSkoolId: text('sender_skool_id').notNull(),
  content: text('content').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  isOutbound: boolean('is_outbound').notNull(),
  ghlSyncedAt: timestamp('ghl_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ── skool_hand_raiser_campaigns ────────────────────────────────────────────────

export const skoolHandRaiserCampaigns = pgTable('skool_hand_raiser_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  postUrl: text('post_url').notNull(),
  skoolPostId: text('skool_post_id'),
  keywordFilter: text('keyword_filter'),
  dmTemplate: text('dm_template').notNull(),
  ghlTag: text('ghl_tag'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ── skool_hand_raiser_sent ─────────────────────────────────────────────────────

export const skoolHandRaiserSent = pgTable('skool_hand_raiser_sent', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => skoolHandRaiserCampaigns.id, { onDelete: 'cascade' }),
  skoolUserId: text('skool_user_id').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_hand_raiser_sent_campaign_user_idx').on(table.campaignId, table.skoolUserId),
])

// ── skool_metrics ──────────────────────────────────────────────────────────────

export const skoolMetrics = pgTable('skool_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupSlug: text('group_slug'),
  snapshotDate: date('snapshot_date'),
  membersTotal: integer('members_total'),
  membersActive: integer('members_active'),
  communityActivity: numericNumber('community_activity', { precision: 5, scale: 2 }),
  category: text('category'),
  categoryRank: integer('category_rank'),
  aboutPageVisits: integer('about_page_visits'),
  conversionRate: numericNumber('conversion_rate', { precision: 5, scale: 2 }),
  personalPosts: integer('personal_posts'),
  personalComments: integer('personal_comments'),
  personalPoints: integer('personal_points'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_metrics_group_date_idx').on(table.groupSlug, table.snapshotDate),
])

// ── skool_kpis ─────────────────────────────────────────────────────────────────

export const skoolKpis = pgTable('skool_kpis', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffSkoolId: text('staff_skool_id'),
  groupId: text('group_id'),
  metricName: text('metric_name').notNull(),
  metricValue: numericNumber('metric_value'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('skool_kpis_staff_idx').on(table.staffSkoolId),
  index('skool_kpis_group_idx').on(table.groupId),
  index('skool_kpis_metric_name_idx').on(table.metricName),
  index('skool_kpis_recorded_at_idx').on(table.recordedAt),
])

// ── skool_analytics ────────────────────────────────────────────────────────────

export const skoolAnalytics = pgTable('skool_analytics', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffSkoolId: text('staff_skool_id'),
  groupId: text('group_id'),
  postId: text('post_id'),
  metricType: text('metric_type').notNull(),
  metricValue: numericNumber('metric_value'),
  metricDate: date('metric_date'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_analytics_unique_idx').on(table.staffSkoolId, table.groupId, table.metricType, table.metricDate),
  index('skool_analytics_group_date_idx').on(table.groupId, table.metricDate),
  index('skool_analytics_post_idx').on(table.postId),
  index('skool_analytics_staff_idx').on(table.staffSkoolId),
  index('skool_analytics_type_idx').on(table.metricType),
  index('skool_analytics_group_type_date_idx').on(table.groupId, table.metricType, table.metricDate),
])

// ── skool_categories ───────────────────────────────────────────────────────────

export const skoolCategories = pgTable('skool_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupSlug: text('group_slug'),
  skoolId: text('skool_id'),
  name: text('name'),
  position: integer('position'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_categories_group_skool_idx').on(table.groupSlug, table.skoolId),
])

// ── skool_about_page_daily ─────────────────────────────────────────────────────

export const skoolAboutPageDaily = pgTable('skool_about_page_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupSlug: text('group_slug'),
  date: date('date'),
  visitors: integer('visitors'),
  conversionRate: numericNumber('conversion_rate', { precision: 5, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_about_page_daily_group_date_idx').on(table.groupSlug, table.date),
])

// ── skool_community_activity_daily ─────────────────────────────────────────────

export const skoolCommunityActivityDaily = pgTable('skool_community_activity_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupSlug: text('group_slug'),
  date: date('date'),
  activityCount: integer('activity_count'),
  dailyActiveMembers: integer('daily_active_members'),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_community_activity_daily_group_date_idx').on(table.groupSlug, table.date),
])

// ── skool_members_daily ────────────────────────────────────────────────────────

export const skoolMembersDaily = pgTable('skool_members_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupSlug: text('group_slug'),
  date: date('date'),
  totalMembers: integer('total_members'),
  activeMembers: integer('active_members'),
  newMembers: integer('new_members'),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_members_daily_group_date_idx').on(table.groupSlug, table.date),
])

// ── skool_members_monthly ──────────────────────────────────────────────────────

export const skoolMembersMonthly = pgTable('skool_members_monthly', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupSlug: text('group_slug'),
  month: date('month'),
  newMembers: integer('new_members'),
  existingMembers: integer('existing_members'),
  churnedMembers: integer('churned_members'),
  totalMembers: integer('total_members'),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_members_monthly_group_month_idx').on(table.groupSlug, table.month),
])

// ── skool_revenue_daily ────────────────────────────────────────────────────────

export const skoolRevenueDaily = pgTable('skool_revenue_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupSlug: text('group_slug'),
  snapshotDate: date('snapshot_date'),
  mrr: numericNumber('mrr', { precision: 10, scale: 2 }),
  retentionRate: numericNumber('retention_rate', { precision: 5, scale: 2 }),
  payingMembers: integer('paying_members'),
  churnCount: integer('churn_count'),
  ltv: numericNumber('ltv', { precision: 10, scale: 2 }),
  epl: numericNumber('epl', { precision: 10, scale: 2 }),
  arpu: numericNumber('arpu', { precision: 10, scale: 2 }),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_revenue_daily_group_date_idx').on(table.groupSlug, table.snapshotDate),
])

// ── skool_revenue_monthly ──────────────────────────────────────────────────────

export const skoolRevenueMonthly = pgTable('skool_revenue_monthly', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupSlug: text('group_slug'),
  month: date('month'),
  mrr: numericNumber('mrr', { precision: 10, scale: 2 }),
  payingMembers: integer('paying_members'),
  churnCount: integer('churn_count'),
  newSubscribers: integer('new_subscribers'),
  mrrChange: numericNumber('mrr_change', { precision: 10, scale: 2 }),
  churnRate: numericNumber('churn_rate', { precision: 5, scale: 2 }),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_revenue_monthly_group_month_idx').on(table.groupSlug, table.month),
])

// ── skool_subscription_events ──────────────────────────────────────────────────

export const skoolSubscriptionEvents = pgTable('skool_subscription_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupSlug: text('group_slug'),
  skoolUserId: text('skool_user_id'),
  eventType: text('event_type'),
  eventDate: date('event_date'),
  amount: numericNumber('amount', { precision: 10, scale: 2 }),
  currency: text('currency'),
  subscriptionTier: text('subscription_tier'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('skool_subscription_events_unique_idx').on(table.groupSlug, table.skoolUserId, table.eventType, table.eventDate),
])
