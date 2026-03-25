import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core'
import { numericNumber } from './columns'

// ─── GHL Transactions ────────────────────────────────────────────────────────

export const ghlTransactions = pgTable('ghl_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ghlTransactionId: text('ghl_transaction_id').unique(),
  ghlContactId: text('ghl_contact_id'),
  ghlInvoiceId: text('ghl_invoice_id'),
  ghlSubscriptionId: text('ghl_subscription_id'),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  amount: numericNumber('amount', { precision: 10, scale: 2 }),
  currency: text('currency').default('USD'),
  status: text('status'),
  entityType: text('entity_type'),
  entitySourceType: text('entity_source_type'),
  entitySourceName: text('entity_source_name'),
  paymentMethod: text('payment_method'),
  invoiceNumber: text('invoice_number'),
  isLiveMode: boolean('is_live_mode'),
  transactionDate: timestamp('transaction_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
}, (table) => [
  index('idx_ghl_transactions_date').on(table.transactionDate),
  index('idx_ghl_transactions_status').on(table.status),
  index('idx_ghl_transactions_contact').on(table.ghlContactId),
  index('idx_ghl_transactions_date_status').on(table.transactionDate, table.status),
])

// ─── GHL Sync Log ────────────────────────────────────────────────────────────

export const ghlSyncLog = pgTable('ghl_sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  syncType: text('sync_type'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  recordsSynced: integer('records_synced'),
  status: text('status'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_ghl_sync_log_sync_type').on(table.syncType),
])
