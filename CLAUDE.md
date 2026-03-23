# 0ne Cloud - Claude Code Instructions

## FIRST: Read Build State

**Before doing ANY work on this project, read:**
```
product/BUILD-STATE.md
```

This nimble hub shows what's active and points to the right feature BUILD-STATE.

**Structure:**
- `product/BUILD-STATE.md` → Quick resume + active feature index
- `product/sections/{feature}/BUILD-STATE.md` → Feature-specific implementation plans
- `product/COMPLETED-FEATURES.md` → Archived feature details (read only when needed)

---

## Build Protocol (CRITICAL)

### Multi-Agent Sequential Deployment

**For any non-trivial feature (3+ phases), use this pattern:**

1. **Each phase = 1 agent with fresh context**
   - Spawn a Task agent for each phase
   - Agent completes phase → commits (NO push) → returns
   - Main session orchestrates, agents execute

2. **Phase completion checklist:**
   - [ ] Code complete
   - [ ] Tests pass (if applicable)
   - [ ] Commit with descriptive message
   - [ ] Update BUILD-STATE checkboxes
   - [ ] NO push (Jimmy will push)

3. **Before deploying phases, ask:**
   > "Deploy all phases now, or pause between each?"

### Why Agents?

- **Fresh context window:** Each agent starts clean, avoiding context exhaustion
- **Parallel execution:** Multiple independent phases can run simultaneously
- **Atomic commits:** Each phase is a complete, reviewable unit
- **Resumability:** If interrupted, just deploy the next phase

### When to Use Agents

| Scenario | Approach |
|----------|----------|
| Single file change | Direct edit (no agent) |
| 2-3 related changes | Direct edit (no agent) |
| Multi-file feature phase | Use Task agent |
| Database + API + UI | Use Task agent |
| Research/exploration | Use Explore agent |

---

## Session Protocol

**At session START:**
1. Read `product/BUILD-STATE.md`
2. Identify current focus from "Active Features" table
3. Read the relevant section BUILD-STATE (if working on specific feature)
4. Continue from where it left off

**At session END:**
1. Update section BUILD-STATE checkboxes
2. Update root BUILD-STATE "Current Focus" if changed
3. Commit work (NO push unless asked)

---

## Project Overview

0ne Cloud is Jimmy's personal cloud app - a command center for business operations.

**Apps included:**
- KPI Dashboard - Business metrics and funnel tracking
- Skool Scheduler - Automated post publishing
- Skool Sync - Sync Skool messages with GoHighLevel CRM
- GHL Media Manager - Media library management
- Personal Expenses - Expense tracking with Plaid bank integration

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| UI | React + Tailwind CSS v4 |
| Components | Custom (shadcn/ui patterns) |
| Auth | Clerk |
| Database | Supabase (PostgreSQL) |
| Package Manager | bun (NEVER npm/yarn/pnpm) |

---

## Key Directories

```
0ne-cloud/
├── product/                 ← Specs and build tracking
│   ├── BUILD-STATE.md       ← Nimble hub (read FIRST)
│   ├── COMPLETED-FEATURES.md← Archived features
│   └── sections/            ← Per-feature BUILD-STATEs
├── apps/
│   └── web/                 ← Next.js app
│       └── src/
│           ├── app/         ← Pages (App Router)
│           ├── components/  ← Shared components
│           └── features/    ← Feature-specific code
├── packages/
│   ├── ui/                  ← Shared UI components
│   ├── db/                  ← Database client + schemas
│   └── auth/                ← Auth utilities
├── widget/                  ← iOS Scriptable widget (see below)
```

---

## Design System

- **Primary:** #FF692D (Monarch orange)
- **Background:** #F6F5F3 (warm cream)
- **Text:** #22201D (near-black)
- **Sidebar:** #1C1B19 (dark charcoal)
- **Border Radius:** 6px (0.375rem)
- **Shadows:** Subtle - `rgba(34,32,29,0.05)`

---

## Commands

```bash
# Start dev server
cd apps/web && bun dev

# Install dependencies
bun install

# Database migrations
psql "$DATABASE_URL" -f packages/db/schemas/{migration}.sql

# Run cron manually
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/{job}"
```

---

## iOS Widget (IMPORTANT - External Consumer)

**Location:** `widget/SheetWidget.js` (Scriptable iOS app)

**API endpoint:** `GET /api/widget/metrics` (`apps/web/src/app/api/widget/metrics/route.ts`)

**Auth:** Bearer token via `WIDGET_API_KEY` env var (NOT Clerk — widgets can't do browser sessions)

**What it returns:** 4 personal finance KPIs (Cash On Hand, Burn Rate, Runway Days, Runway Months)

**If you change the widget API:** The iPhone widget will break. Check:
- Response shape: `{ metrics: [{ label, value }], updatedAt }` must be preserved
- `WIDGET_API_KEY` env var must be set in Vercel
- Queries: `plaid_accounts` (balances) and `personal_expenses` (burn rate)

See `widget/README.md` for full architecture.

---

## Git Protocol

- **Commit after each phase** (not after each file)
- **NO push** unless Jimmy explicitly asks
- **Descriptive messages:** `Phase X: {what was built}`
- **Co-Author:** Include `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`
