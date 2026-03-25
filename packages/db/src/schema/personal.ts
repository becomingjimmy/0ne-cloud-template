import { pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { numericNumber } from './columns'

// ---------------------------------------------------------------------------
// Personal Expenses
// ---------------------------------------------------------------------------

export const personalExpenses = pgTable('personal_expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  category: text('category'),
  amount: numericNumber('amount', { precision: 10, scale: 2 }).notNull(),
  frequency: text('frequency').default('one_time'),
  expenseDate: date('expense_date'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  isActive: boolean('is_active').default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('personal_expenses_category_idx').on(table.category),
  index('personal_expenses_date_idx').on(table.expenseDate),
  index('personal_expenses_active_idx').on(table.isActive),
])

// ---------------------------------------------------------------------------
// Personal Expense Categories
// ---------------------------------------------------------------------------

export const personalExpenseCategories = pgTable('personal_expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  slug: text('slug').unique().notNull(),
  color: text('color'),
  description: text('description'),
  displayOrder: integer('display_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ---------------------------------------------------------------------------
// Expense Categories
// ---------------------------------------------------------------------------

export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  slug: text('slug').unique().notNull(),
  color: text('color'),
  description: text('description'),
  isSystem: boolean('is_system').default(false),
  displayOrder: integer('display_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ---------------------------------------------------------------------------
// Plaid Items
// ---------------------------------------------------------------------------

export const plaidItems = pgTable('plaid_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: text('item_id').unique().notNull(),
  accessToken: text('access_token').notNull(),
  institutionId: text('institution_id'),
  institutionName: text('institution_name'),
  transactionCursor: text('transaction_cursor'),
  status: text('status').default('active'),
  errorCode: text('error_code'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('plaid_items_status_idx').on(table.status),
])

// ---------------------------------------------------------------------------
// Plaid Accounts
// ---------------------------------------------------------------------------

export const plaidAccounts = pgTable('plaid_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id').notNull().references(() => plaidItems.id, { onDelete: 'cascade' }),
  accountId: text('account_id').unique().notNull(),
  name: text('name'),
  officialName: text('official_name'),
  type: text('type'),
  subtype: text('subtype'),
  mask: text('mask'),
  currentBalance: numericNumber('current_balance', { precision: 10, scale: 2 }),
  availableBalance: numericNumber('available_balance', { precision: 10, scale: 2 }),
  creditLimit: numericNumber('credit_limit', { precision: 10, scale: 2 }),
  isoCurrencyCode: text('iso_currency_code').default('USD'),
  scope: text('scope').default('personal'),
  isHidden: boolean('is_hidden').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('plaid_accounts_item_idx').on(table.itemId),
  index('plaid_accounts_type_idx').on(table.type),
  index('plaid_accounts_scope_idx').on(table.scope),
])

// ---------------------------------------------------------------------------
// Plaid Transactions
// ---------------------------------------------------------------------------

export const plaidTransactions = pgTable('plaid_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: text('transaction_id').unique().notNull(),
  accountId: uuid('account_id').notNull().references(() => plaidAccounts.id, { onDelete: 'cascade' }),
  amount: numericNumber('amount', { precision: 10, scale: 2 }),
  date: date('date').notNull(),
  name: text('name'),
  merchantName: text('merchant_name'),
  category: text('category').array(),
  personalFinanceCategoryPrimary: text('personal_finance_category_primary'),
  personalFinanceCategoryDetailed: text('personal_finance_category_detailed'),
  mappedCategory: text('mapped_category'),
  personalExpenseId: uuid('personal_expense_id').references(() => personalExpenses.id, { onDelete: 'set null' }),
  isExcluded: boolean('is_excluded').default(false),
  isPending: boolean('is_pending').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('plaid_transactions_account_idx').on(table.accountId),
  index('plaid_transactions_date_idx').on(table.date),
  index('plaid_transactions_mapped_category_idx').on(table.mappedCategory),
  index('plaid_transactions_excluded_idx').on(table.isExcluded),
])

// ---------------------------------------------------------------------------
// Plaid Category Mappings
// ---------------------------------------------------------------------------

export const plaidCategoryMappings = pgTable('plaid_category_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  plaidPrimary: text('plaid_primary').notNull(),
  plaidDetailed: text('plaid_detailed'),
  expenseCategorySlug: text('expense_category_slug'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('plaid_category_mappings_primary_detailed_idx').on(table.plaidPrimary, table.plaidDetailed),
])
