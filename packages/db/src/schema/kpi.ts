import { pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { numericNumber } from './columns'

// ─── Contacts ────────────────────────────────────────────────────────────────

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ghlContactId: text('ghl_contact_id').unique(),
  skoolUserId: text('skool_user_id'),
  currentStage: text('current_stage').default('member'),
  stages: text('stages').array().default([]),
  creditStatus: text('credit_status').default('unknown'),
  leadAge: integer('lead_age').default(0),
  clientAge: integer('client_age').default(0),
  source: text('source'),
  campaign: text('campaign'),
  handRaiserType: text('hand_raiser_type'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  becameLeadAt: timestamp('became_lead_at', { withTimezone: true }),
  becameHandRaiserAt: timestamp('became_hand_raiser_at', { withTimezone: true }),
  becameQualifiedAt: timestamp('became_qualified_at', { withTimezone: true }),
  becameClientAt: timestamp('became_client_at', { withTimezone: true }),
  becameFundedAt: timestamp('became_funded_at', { withTimezone: true }),
  email: text('email'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
}, (table) => [
  index('idx_contacts_stage').on(table.currentStage),
  index('idx_contacts_source').on(table.source),
  index('idx_contacts_campaign').on(table.campaign),
])

// ─── Events ──────────────────────────────────────────────────────────────────

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  eventData: jsonb('event_data'),
  source: text('source'),
  campaign: text('campaign'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_events_contact_id').on(table.contactId),
  index('idx_events_event_type').on(table.eventType),
  index('idx_events_created_at').on(table.createdAt),
  index('idx_events_campaign').on(table.campaign),
])

// ─── Cohort Snapshots ────────────────────────────────────────────────────────

export const cohortSnapshots = pgTable('cohort_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  snapshotType: text('snapshot_type').notNull(),
  snapshotDay: integer('snapshot_day').notNull(),
  value: numericNumber('value', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uq_cohort_snapshots_contact_type_day').on(table.contactId, table.snapshotType, table.snapshotDay),
])

// ─── Campaigns ───────────────────────────────────────────────────────────────

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  type: text('type'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  adBudget: numericNumber('ad_budget', { precision: 10, scale: 2 }),
  revenueTarget: numericNumber('revenue_target', { precision: 10, scale: 2 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── Ad Metrics ──────────────────────────────────────────────────────────────

export const adMetrics = pgTable('ad_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  platform: text('platform').default('meta'),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  campaignMetaId: text('campaign_meta_id'),
  campaignName: text('campaign_name'),
  adsetId: text('adset_id'),
  adsetName: text('adset_name'),
  adId: text('ad_id'),
  adName: text('ad_name'),
  spend: numericNumber('spend', { precision: 10, scale: 2 }),
  impressions: integer('impressions'),
  clicks: integer('clicks'),
  reach: integer('reach'),
  frequency: numericNumber('frequency', { precision: 10, scale: 4 }),
  uniqueClicks: integer('unique_clicks'),
  linkClicks: integer('link_clicks'),
  landingPageViews: integer('landing_page_views'),
  completedRegistrations: integer('completed_registrations'),
  conversions: integer('conversions'),
  costPerConversion: numericNumber('cost_per_conversion', { precision: 10, scale: 2 }),
  roas: numericNumber('roas', { precision: 10, scale: 4 }),
  cpm: numericNumber('cpm', { precision: 10, scale: 2 }),
  cpc: numericNumber('cpc', { precision: 10, scale: 2 }),
  ctr: numericNumber('ctr', { precision: 10, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uq_ad_metrics_date_platform_adset_ad').on(table.date, table.platform, table.adsetId, table.adId),
])

// ─── Meta Account Daily ─────────────────────────────────────────────────────

export const metaAccountDaily = pgTable('meta_account_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  platform: text('platform').default('meta'),
  reach: integer('reach'),
  frequency: numericNumber('frequency', { precision: 10, scale: 4 }),
  uniqueClicks: integer('unique_clicks'),
  impressions: integer('impressions'),
  clicks: integer('clicks'),
  spend: numericNumber('spend', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uq_meta_account_daily_date_platform').on(table.date, table.platform),
])

// ─── Expenses ────────────────────────────────────────────────────────────────

export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  category: text('category'),
  amount: numericNumber('amount', { precision: 10, scale: 2 }).notNull(),
  frequency: text('frequency').default('one_time'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  expenseDate: date('expense_date'),
  isActive: boolean('is_active').default(true),
  isSystem: boolean('is_system').default(false),
  metaSyncDate: date('meta_sync_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── Revenue ─────────────────────────────────────────────────────────────────

export const revenue = pgTable('revenue', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  amount: numericNumber('amount', { precision: 10, scale: 2 }).notNull(),
  type: text('type'),
  description: text('description'),
  source: text('source').default('ghl'),
  transactionDate: date('transaction_date').notNull(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── Daily Aggregates ────────────────────────────────────────────────────────

export const dailyAggregates = pgTable('daily_aggregates', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  source: text('source'),
  newLeads: integer('new_leads').default(0),
  newHandRaisers: integer('new_hand_raisers').default(0),
  newQualified: integer('new_qualified').default(0),
  newVip: integer('new_vip').default(0),
  newPremium: integer('new_premium').default(0),
  newFunded: integer('new_funded').default(0),
  totalRevenue: numericNumber('total_revenue', { precision: 10, scale: 2 }).default(0),
  vipRevenue: numericNumber('vip_revenue', { precision: 10, scale: 2 }).default(0),
  premiumRevenue: numericNumber('premium_revenue', { precision: 10, scale: 2 }).default(0),
  successFeeRevenue: numericNumber('success_fee_revenue', { precision: 10, scale: 2 }).default(0),
  adSpend: numericNumber('ad_spend', { precision: 10, scale: 2 }).default(0),
  expenses: numericNumber('expenses', { precision: 10, scale: 2 }).default(0),
  totalFundedAmount: numericNumber('total_funded_amount', { precision: 12, scale: 2 }).default(0),
  fundedCount: integer('funded_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uq_daily_aggregates_date_campaign_source').on(table.date, table.campaignId, table.source),
])

// ─── Dimension: Sources ──────────────────────────────────────────────────────

export const dimensionSources = pgTable('dimension_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').unique(),
  displayName: text('display_name'),
  contactCount: integer('contact_count'),
  lastSeenDate: date('last_seen_date'),
  isActive: boolean('is_active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ─── Dimension: Campaigns ────────────────────────────────────────────────────

export const dimensionCampaigns = pgTable('dimension_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  campaignName: text('campaign_name'),
  contactCount: integer('contact_count'),
  lastSeenDate: date('last_seen_date'),
  isActive: boolean('is_active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ─── Dimension: Stages ───────────────────────────────────────────────────────

export const dimensionStages = pgTable('dimension_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  stage: text('stage').unique(),
  displayName: text('display_name'),
  color: text('color'),
  sortOrder: integer('sort_order'),
  contactCount: integer('contact_count'),
  lastUpdated: date('last_updated'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── Dimension: Expense Categories ───────────────────────────────────────────

export const dimensionExpenseCategories = pgTable('dimension_expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category').unique(),
  displayName: text('display_name'),
  color: text('color'),
  expenseCount: integer('expense_count'),
  totalAmount: numericNumber('total_amount', { precision: 10, scale: 2 }),
  isSystem: boolean('is_system'),
  lastUsedDate: date('last_used_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── Daily Expenses by Category ──────────────────────────────────────────────

export const dailyExpensesByCategory = pgTable('daily_expenses_by_category', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  category: text('category').notNull(),
  amount: numericNumber('amount', { precision: 10, scale: 2 }),
  isSystem: boolean('is_system'),
  expenseCount: integer('expense_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uq_daily_expenses_by_category_date_category').on(table.date, table.category),
])

// ─── Weekly Trends ───────────────────────────────────────────────────────────

export const weeklyTrends = pgTable('weekly_trends', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekStart: date('week_start'),
  weekNumber: text('week_number'),
  source: text('source'),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  newLeads: integer('new_leads'),
  newHandRaisers: integer('new_hand_raisers'),
  newQualified: integer('new_qualified'),
  newClients: integer('new_clients'),
  totalRevenue: numericNumber('total_revenue', { precision: 10, scale: 2 }),
  adSpend: numericNumber('ad_spend', { precision: 10, scale: 2 }),
  costPerLead: numericNumber('cost_per_lead', { precision: 10, scale: 2 }),
  costPerClient: numericNumber('cost_per_client', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uq_weekly_trends_week_source_campaign').on(table.weekStart, table.source, table.campaignId),
])
