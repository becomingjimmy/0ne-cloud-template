-- Migration: Remove auto-imported personal expenses
-- Date: 2026-03-23
-- Context: The sync-plaid cron was auto-creating personal_expenses for every
--          bank transaction, inflating burn rate. This migration removes all
--          auto-imported entries and preserves manually-entered expenses.

BEGIN;

-- Step 1: Clear personal_expense_id links on plaid_transactions
-- that point to auto-imported expenses (before deleting the expenses)
UPDATE plaid_transactions
SET personal_expense_id = NULL
WHERE personal_expense_id IN (
  SELECT id FROM personal_expenses
  WHERE notes LIKE 'Auto-imported from Plaid%'
);

-- Step 2: Delete all auto-imported personal expenses
DELETE FROM personal_expenses
WHERE notes LIKE 'Auto-imported from Plaid%';

COMMIT;
