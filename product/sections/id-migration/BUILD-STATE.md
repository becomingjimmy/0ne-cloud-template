# ID Column Migration - Build State

**Created:** 2026-02-16
**Completed:** 2026-02-17
**Status:** Complete

---

## Overview

Rename every ambiguous `user_id` column across 9 database tables to use explicit names (`clerk_user_id` or `staff_skool_id`). Fix the mixed-ID bug in `dm_messages` where the same column stores both Clerk User IDs and Skool Staff IDs depending on the code path.

**Why:** The generic `user_id` column stores Clerk IDs in some tables and Skool Staff IDs in others. In `dm_messages` it stores BOTH, causing real bugs (hand-raiser creation failed, get-pending uses hacky OR queries). This migration makes every column self-documenting.

**Naming Convention:**
| Column Name | Always Stores | Format |
|-------------|--------------|--------|
| `clerk_user_id` | Clerk auth user ID | `user_2x...` |
| `skool_user_id` | A Skool member's ID | Numeric string |
| `staff_skool_id` | Staff member's Skool ID | Numeric string |
| `ghl_contact_id` | GHL contact ID | GHL format |
| `ghl_user_id` | GHL team member ID | GHL format |

**Column Rename Map:**
| Table | Old | New | Currently Stores |
|-------|-----|-----|------------------|
| `dm_sync_config` | `user_id` | `clerk_user_id` | Clerk ID |
| `dm_contact_mappings` | `user_id` | `clerk_user_id` | Clerk ID |
| `dm_messages` | `user_id` | `clerk_user_id` | **MIXED** (bug) |
| `dm_hand_raiser_campaigns` | `user_id` | `clerk_user_id` | Clerk ID |
| `staff_users` | `user_id` | `clerk_user_id` | Clerk ID |
| `notification_preferences` | `user_id` | `clerk_user_id` | Clerk ID (PK) |
| `skool_members` | `user_id` | `staff_skool_id` | Skool Staff ID |
| `skool_kpis` | `user_id` | `staff_skool_id` | Skool Staff ID |
| `skool_analytics` | `user_id` | `staff_skool_id` | Skool Staff ID |

---

## CRITICAL: Sequential Agent Workflow

```
DO NOT run phases in parallel.
DO NOT skip the code review step in any phase.
ALWAYS run phases sequentially: Phase 1 -> 2 -> 3 -> 4.
Each phase = 1 Task agent with fresh context.
```

### How to Deploy

1. Main session reads this BUILD-STATE
2. Main session spawns a Task agent for Phase 1
3. Agent **reads all relevant files first** to verify current state
4. Agent completes phase -> commits (NO push) -> returns
5. Main session verifies -> spawns next phase agent
6. Repeat until all phases complete
7. Jimmy pushes + runs SQL migration

---

## Phase 1: SQL Migration + Type Definitions

**Agent instructions:** Before writing any code, READ these files to verify the current column names and schema match what this plan expects:
- `packages/db/schemas/027-dm-sync.sql`
- `packages/db/schemas/029-skool-members-kpis.sql`
- `packages/db/schemas/030-skool-analytics.sql`
- `packages/db/schemas/032-staff-users.sql`
- `apps/web/src/features/dm-sync/types.ts`

**Tasks:**
- [x] Create `packages/db/schemas/035-rename-user-id-columns.sql`:
  - RENAME COLUMN for all 9 tables (wrapped in BEGIN/COMMIT)
  - Add SQL COMMENTs on each renamed column
  - Data backfill: `UPDATE dm_messages SET clerk_user_id = s.clerk_user_id FROM staff_users s WHERE dm_messages.staff_skool_id = s.skool_user_id AND dm_messages.clerk_user_id NOT LIKE 'user_%'`
  - Rollback script in comments
- [x] Update `apps/web/src/features/dm-sync/types.ts`:
  - `DmMessageRow.user_id` -> `clerk_user_id`
  - `HandRaiserCampaignRow.user_id` -> `clerk_user_id` (if exists in types)
  - `StaffUserRow.user_id` -> `clerk_user_id`
  - Any other Row interfaces with `user_id`
- [x] Commit: `Phase 1: SQL migration and type definitions for ID column rename`

**Verify:** `bun tsc --noEmit` in `apps/web` (will show broken references - expected, fixed in later phases)

---

## Phase 2: Core Library Files

**Agent instructions:** Before writing any code, READ these files end-to-end to find ALL `user_id` references (don't rely on line numbers from planning - they may have shifted):
- `apps/web/src/features/dm-sync/lib/sync-engine.ts` (large file - read in chunks)
- `apps/web/src/features/dm-sync/lib/staff-users.ts`
- `apps/web/src/features/dm-sync/lib/contact-mapper.ts`

**Tasks:**
- [x] Update `sync-engine.ts` (~14 occurrences):
  - All `.eq('user_id', ...)` -> `.eq('clerk_user_id', ...)` in dm_sync_config, dm_messages, dm_contact_mappings queries
  - All `user_id:` in object inserts -> `clerk_user_id:`
  - `getEnabledSyncConfigs()`: `.select('user_id, ...')` -> `.select('clerk_user_id, ...')`
  - `getUsersWithActiveHandRaisers()`: `.select('user_id')` -> `.select('clerk_user_id')`
  - Note: ALL userId values in this file come from Clerk auth() - they ARE Clerk IDs
- [x] Update `staff-users.ts` (~13 occurrences):
  - All `.eq('user_id', ...)` -> `.eq('clerk_user_id', ...)` (staff_users table)
  - Insert: `user_id: input.userId` -> `clerk_user_id: input.userId`
  - Reads: `existing.user_id` -> `existing.clerk_user_id`
- [x] Update `contact-mapper.ts` (~4 occurrences):
  - `.eq('user_id', userId)` -> `.eq('clerk_user_id', userId)` (dm_contact_mappings table)
  - Insert: `user_id: userId` -> `clerk_user_id: userId`
- [x] Commit: `Phase 2: Update core library files for renamed ID columns`

**Verify:** `bun tsc --noEmit` (fewer errors now, remaining are in API routes)

---

## Phase 3: Extension + Webhook API Routes

**Agent instructions:** Before writing any code, READ these files to understand the current query patterns and data flow:
- `apps/web/src/app/api/extension/push-messages/route.ts`
- `apps/web/src/app/api/extension/get-pending/route.ts`
- `apps/web/src/app/api/extension/retry-failed/route.ts`
- `apps/web/src/app/api/extension/push-members/route.ts`
- `apps/web/src/app/api/extension/push-kpis/route.ts`
- `apps/web/src/app/api/extension/push-analytics/route.ts`
- `apps/web/src/app/api/webhooks/ghl/outbound-message/route.ts`

**Critical logic changes (not just renames):**
- [x] `push-messages/route.ts`:
  - Dedup query: `.eq('user_id', staffSkoolId)` -> use `staff_skool_id` column instead
  - Insert: `user_id: staffSkoolId` -> look up Clerk ID from `staff_users`, write `clerk_user_id: clerkId`. Use `authResult.userId` if Clerk auth available.
- [x] `get-pending/route.ts`:
  - Debug query: update `user_id` references to `clerk_user_id`
  - Main query: `.or('user_id.eq.${staffSkoolId},staff_skool_id.eq.${staffSkoolId}')` -> `.eq('staff_skool_id', staffSkoolId)` (after fix, clerk_user_id won't contain Skool IDs)
- [x] `retry-failed/route.ts`: same OR pattern fix as get-pending
- [x] `outbound-message/route.ts`:
  - Insert: `user_id: staffSkoolId` -> `clerk_user_id: typedMapping.clerk_user_id` (the mapping row has the Clerk ID)
  - Conversation lookup: use `staff_skool_id` instead of `user_id` for staff matching

**Simple renames (column name string only):**
- [x] `push-members/route.ts`: `user_id: staffSkoolId` -> `staff_skool_id: staffSkoolId`
- [x] `push-kpis/route.ts`: `user_id: staffSkoolId` -> `staff_skool_id: staffSkoolId`
- [x] `push-analytics/route.ts`: `user_id: staffSkoolId` -> `staff_skool_id: staffSkoolId` (both insert and query)
- [x] Commit: `Phase 3: Update extension and webhook routes for renamed ID columns`

**Verify:** `bun tsc --noEmit`

---

## Phase 4: DM Sync API Routes + Crons + Final Verification

**Agent instructions:** Before writing any code, READ these files and grep for any remaining `user_id` string references:
- `apps/web/src/app/api/dm-sync/hand-raisers/route.ts`
- `apps/web/src/app/api/dm-sync/contacts/route.ts`
- `apps/web/src/app/api/dm-sync/raw-messages/route.ts`
- `apps/web/src/app/api/dm-sync/conversations/[id]/send/route.ts`
- `apps/web/src/app/api/cron/sync-skool-dms/route.ts`
- `apps/web/src/app/api/cron/hand-raiser-check/route.ts`

**Tasks:**
- [x] `hand-raisers/route.ts`: `user_id: userId` -> `clerk_user_id: userId`
- [x] `contacts/route.ts`: `m.user_id` -> `m.clerk_user_id`, `.in('user_id', ...)` -> `.in('clerk_user_id', ...)`, `config.user_id` -> `config.clerk_user_id`, `mapping.user_id` -> `mapping.clerk_user_id`
- [x] `raw-messages/route.ts`: `m.user_id` -> `m.clerk_user_id`, `.in('user_id', ...)` -> `.in('clerk_user_id', ...)`, `c.user_id` -> `c.clerk_user_id`, `msg.user_id` -> `msg.clerk_user_id`
- [x] `conversations/[id]/send/route.ts`: `.select('skool_user_id, user_id')` -> `.select('skool_user_id, clerk_user_id')`, `user_id: existingMessage.user_id` -> `clerk_user_id: existingMessage.clerk_user_id`
- [x] `cron/sync-skool-dms/route.ts`: `config.user_id` -> `config.clerk_user_id`
- [x] `cron/hand-raiser-check/route.ts`: `user.user_id` -> `user.clerk_user_id`
- [x] Run global grep to catch any remaining references
- [x] `bun run build --filter=web` must pass clean
- [x] Commit: `Phase 4: Update DM sync API routes and crons for renamed ID columns`

---

## Deployment Sequence (After All 4 Phases Committed)

Short maintenance window (~3 min) since this is a personal app:

1. Push all commits to `dev`
2. Wait for Vercel preview deploy to complete (~60-90s)
3. Run SQL migration (`035-rename-user-id-columns.sql`) in Supabase SQL Editor
4. Verify with SQL queries below
5. Test key endpoints on preview
6. Monitor logs

**Rollback:** Reverse all RENAME COLUMN statements + revert git commits.

---

## Verification

**SQL checks after migration:**
```sql
-- No user_id columns should remain
SELECT column_name, table_name FROM information_schema.columns
WHERE table_name IN ('dm_sync_config','dm_contact_mappings','dm_messages',
  'dm_hand_raiser_campaigns','staff_users','notification_preferences',
  'skool_members','skool_kpis','skool_analytics')
AND column_name = 'user_id';
-- Expected: 0 rows

-- No Skool IDs in dm_messages.clerk_user_id after backfill
SELECT clerk_user_id, count(*) FROM dm_messages
WHERE clerk_user_id NOT LIKE 'user_%' GROUP BY clerk_user_id;
-- Expected: 0 rows
```

**Code checks:**
- `bun tsc --noEmit` passes
- `bun run build --filter=web` passes
- No `'user_id'` string literals in Supabase queries
