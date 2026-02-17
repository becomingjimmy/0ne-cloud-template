# 0ne App - Build State

> **For Claude Code:** Read this file FIRST when working on 0ne-app.
> This is the nimble hub - it points you to the right place.

---

## Quick Resume

**Last Updated:** 2026-02-17
**Current Focus:** ID Column Migration complete — next up: Hand-Raiser UI

**Session 2026-02-17 Summary:**
- ✅ Renamed `user_id` → `clerk_user_id` across 8 tables (SQL migration 035)
- ✅ Renamed `user_id` → `staff_skool_id` on skool_kpis + skool_analytics
- ✅ Backfilled 5,075 dm_messages rows with correct Clerk IDs (mixed-ID bug fixed)
- ✅ Updated 36+ TypeScript files across types, lib, routes, crons
- ✅ Fixed push-members route to match restructured skool_members schema
- ✅ Full audit: 0 column mismatches remaining

---

## Active Features

| Feature | Status | BUILD-STATE Location |
|---------|--------|---------------------|
| Skool-GHL DM Sync | ✅ Working | `sections/skool-sync/BUILD-STATE.md` |
| Skool Inbox | ✅ Complete | `sections/skool-inbox/BUILD-STATE.md` |
| Hand-Raiser Extension Routing | 🔄 Deploy | `sections/hand-raiser-extension-routing/BUILD-STATE.md` |
| Skool Chrome Extension | ✅ Complete | `sections/skool-extension/BUILD-STATE.md` |
| Skool API Migration | ✅ Complete | `sections/skool-api-migration/BUILD-STATE.md` |
| ID Column Migration | ✅ Complete | `sections/id-migration/BUILD-STATE.md` |
| Hand-Raiser UI | ⬜ Planned | `sections/hand-raiser-ui/BUILD-STATE.md` |
| Cron Fix + Sync Dashboard | ✅ Complete | `sections/sync-dashboard/BUILD-STATE.md` |
| Skool Scheduler | ✅ Complete | `sections/skool-scheduler/BUILD-STATE.md` |
| GHL Media Manager | ✅ Complete | `sections/media/BUILD-STATE.md` |

### How to Navigate

**Starting a feature:** Read the feature's BUILD-STATE in `sections/{feature}/BUILD-STATE.md`

**Checking history:** Read `COMPLETED-FEATURES.md` for archived implementation details

---

## Next Actions

### Hand-Raiser Campaign UI (Queued)
**Build UI to manage Hand-Raiser campaigns (auto-DM Skool commenters)**

**To deploy:** Read `sections/hand-raiser-ui/BUILD-STATE.md` and deploy 4 phases using multi-agent workflow:
1. Spawn Phases 1-3 in parallel (API, Hook, Dialog)
2. Then Phase 4 (Page + Navigation)

---

## Cleanup Tasks (from 2026-02-16 session)

1. **Optional: Reduce webhook logging** - Currently verbose for debugging, can trim later

---

## Blockers / Decisions Needed

None currently.

---

## Architecture Note: Extension-First Skool Integration (2026-02-17)

AWS WAF blocks all server-side Skool API calls. The Chrome extension is the **sole data collector** for Skool. The extension-first migration is **complete** (all 8 phases deployed).

**Killed crons:**
- `sync-skool` (daily member/KPI fetch) - removed from vercel.json
- `syncInboundMessages` in `sync-skool-dms` - removed (server-side Skool fetch)
- `hand-raiser-check` - removed from vercel.json (route is no-op, migrated to extension)
- `send-pending-dms` - removed from vercel.json (server-side Skool DM sending is broken)
- `sync-about-analytics` - route converted to no-op (data now pushed by extension)
- `sync-member-history` - route converted to no-op (data now pushed by extension)

**Active crons (non-Skool or processing only):**
- `sync-ghl` - GHL data sync (daily)
- `sync-meta` - Meta ads sync (daily)
- `aggregate` - Data aggregation (daily)
- `send-daily-snapshot` - Notifications (daily)
- `sync-skool-dms` - Extension message processing → GHL only (every 5min)

**Extension-first migration complete** — see `sections/skool-api-migration/BUILD-STATE.md` for full plan. All server-side Skool API calls have been removed or converted to no-ops.

---

## Quick Commands

```bash
# Start dev server
cd apps/web && bun dev

# Run GHL sync
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/sync-ghl"

# Run Meta ads sync
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/sync-meta"
```

---

## Completed Features

See `COMPLETED-FEATURES.md` for full archive. Summary:

- ✅ KPI Dashboard (Overview, Funnel, Cohorts, Expenses, Skool, GHL, Facebook Ads)
- ✅ Skool Post Scheduler (Variation Groups, Campaigns, One-Off Posts)
- ✅ Skool Post Drafts & External API
- ✅ GHL Media Manager
- ✅ Sync Dashboard
- ✅ Daily Notifications
- ✅ Source Filtering System
- ✅ Expenses System Upgrade
- ✅ Skool Revenue & MRR Integration
- ✅ Skool-GHL DM Sync (bidirectional - Skool↔GHL↔0ne Inbox all working as of 2026-02-16)
- ✅ Skool Chrome Extension (12 phases: API intercept, WebSocket, DM send, multi-staff, cookies, auth, members/KPI/analytics, scheduler, polling, backfill)
