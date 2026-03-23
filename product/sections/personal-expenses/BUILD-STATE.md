# Personal Expenses Mini App - Build State

> New "Personal" mini app for tracking personal expenses with manual input, burn rate, and category management.

## Phases

### Phase 1: Foundation (DB + Permissions + Navigation)
- [ ] SQL migration: `personal_expenses` table
- [ ] SQL migration: `personal_expense_categories` table
- [ ] Default categories seeded: Housing, Food, Transportation, Subscriptions
- [ ] RLS policies on both tables
- [ ] `personal` added to AppId in permissions.ts
- [ ] `personal` added to DEFAULT_PERMISSIONS
- [ ] Personal app config in apps.ts (Wallet icon, /personal route)
- [ ] Personal navigation in getAppNavigation (Expenses sub-page)
- [ ] Personal app added to Sidebar.tsx allAppsNavigation

### Phase 2: API Routes
- [ ] GET /api/personal/expenses — list + summary + monthly trends
- [ ] POST /api/personal/expenses — create expense
- [ ] PUT /api/personal/expenses — update expense
- [ ] PATCH /api/personal/expenses — toggle active
- [ ] DELETE /api/personal/expenses — remove expense
- [ ] GET /api/personal/expense-categories — list categories
- [ ] POST /api/personal/expense-categories — create category
- [ ] PUT /api/personal/expense-categories — update category
- [ ] DELETE /api/personal/expense-categories — delete category

### Phase 3: Frontend (Hooks + Page + Dialogs)
- [ ] Feature directory: features/personal/
- [ ] Hook: use-personal-expenses.ts
- [ ] Hook: use-personal-expense-categories.ts
- [ ] Component: ExpenseDialog.tsx (adapted from KPI)
- [ ] Component: CategoryDialog.tsx (adapted from KPI)
- [ ] Page: app/personal/expenses/page.tsx
- [ ] Page: app/personal/page.tsx (overview/redirect)

## Key Files

- `packages/auth/src/permissions.ts` — AppId type
- `apps/web/src/lib/apps.ts` — App config + navigation
- `apps/web/src/components/shell/Sidebar.tsx` — Sidebar navigation
- `packages/db/schemas/kpi.sql` — Reference for schema patterns
- `apps/web/src/app/kpi/expenses/page.tsx` — Reference for UI patterns
- `apps/web/src/features/kpi/hooks/use-kpi-data.ts` — Reference for hooks

### Phase 4: Plaid Banking Integration
- [x] Plaid account linking and balance display
- [x] Transaction sync via cron (plaid_transactions table)
- [x] "All Transactions" tab with search and pagination
- [x] "Add to Expenses" button to promote transactions to tracked expenses
- [x] Category auto-mapping (plaid_category_mappings table)

### Phase 5: iOS Widget
- [x] Widget API endpoint: GET /api/widget/metrics
- [x] Bearer token auth (WIDGET_API_KEY env var)
- [x] Returns: Cash On Hand, Burn Rate, Runway (Days/Months)
- [x] SheetWidget.js (Scriptable iOS app) in widget/ directory

## Notes

- Personal categories: Housing, Food, Transportation, Subscriptions (minimal set)
- No business logic: no ad_metrics, no ROI, no channel performance
- Separate tables from business expenses
- Plaid banking integration live (accounts, transactions, balances)
- **Auto-import REMOVED (2026-03-23):** sync-plaid cron no longer auto-creates personal_expenses. Users manually promote transactions via "Add to Expenses" button.
- iOS widget lives in `widget/` directory — see widget/README.md for API dependency
