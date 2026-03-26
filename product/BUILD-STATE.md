# 0ne Cloud - Build State

> **For Claude Code:** Read this file FIRST when working on 0ne Cloud.
> This is the nimble hub - it points you to the right place.

---

## Quick Resume

**Last Updated:** 2026-03-26
**Current Focus:** SaaS Buildout — Phase 0 (quality sweep) COMPLETE, Phase 1 (shell template extraction) is NEXT

**Session 2026-03-25/26 Summary (Quality Sweep):**
- ✅ 68/68 audit findings fixed across 8 sessions + 2 independent re-audits
- ✅ 5 critical + 7 high + 6 medium findings from re-audit also fixed
- ✅ Security: timing-safe auth, CSP/HSTS headers, CORS restrictions, XSS fixes, SSRF fixes
- ✅ Data: transactions, batch inserts, FK cascades, pagination guards
- ✅ Quality: shared utilities, type safety, error redaction, per-route auth
- ✅ Infrastructure: Supabase fully removed, env config, gitignore, SW error handling
- ✅ GHL tokens now encrypted at rest (matching Plaid pattern)
- ✅ All deliberate decisions documented in CLAUDE.md "DO NOT FIX" section

---

## SaaS Buildout Roadmap

**Architecture:** Managed Forks (Model B) — each customer gets their own forked repo + Vercel project + Neon DB. Full research: `02 - Projects/0ne-System/Cloud/SAAS-ARCHITECTURE-RESEARCH.md`

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 0** | ✅ COMPLETE | Quality sweep — 68 findings fixed, codebase production-ready |
| **Phase 1** | ⬜ NEXT | Extract SaaS shell template — strip Jimmy-specific data, create clean starter |
| **Phase 2** | ⬜ Planned | Multi-tenant auth — Clerk Orgs, tenant-scoped data, per-tenant API keys |
| **Phase 3** | ⬜ Planned | Automated provisioning — fork repo, deploy Vercel, provision Neon DB |
| **Phase 4** | ⬜ Planned | Onboarding flow — signup → shell → first app experience |
| **Phase 5** | ⬜ Planned | Template update mechanism — push updates to customer forks |
| **Phase 6** | ⬜ Planned | Billing integration |

### Phase 1: Shell Template Extraction (NEXT)

**Goal:** Create a clean 0ne Cloud starter template that new customers can fork.

**What to strip:**
- Fruitful Funding-specific config (GHL keys, Skool group IDs, tag mappings)
- Jimmy's personal data (Plaid tokens, expense categories, contact records)
- Business-specific cron schedules and sync configs
- Hardcoded group slugs (`fruitful`)

**What to keep:**
- App shell (sidebar, navigation, design system)
- Auth infrastructure (Clerk, requireAuth, requireAdmin)
- Security infrastructure (secureCompare, safeErrorResponse, encryption, CSP headers)
- Database schema (Drizzle + Neon, all tables)
- Extension infrastructure (auth, CORS, push routes)
- Cron framework (SyncLogger, CRON_SECRET auth pattern)
- KPI dashboard framework (empty, ready to configure)
- Personal expenses/banking framework

**Output:** A new branch or repo (`0ne-cloud-template`) that can be forked per customer.

### Key Research Docs

| Doc | Location |
|-----|----------|
| SaaS Architecture Research | `02 - Projects/0ne-System/Cloud/SAAS-ARCHITECTURE-RESEARCH.md` |
| Managed Forks UX | `02 - Projects/0ne-System/Cloud/MANAGED-FORKS-UX-WALKTHROUGH.md` |
| Signup Flow | `02 - Projects/0ne-System/Cloud/SIGNUP-TO-BUILDING-FLOW.md` |
| Vercel Platform Research | `02 - Projects/0ne-System/Cloud/VERCEL-PLATFORM-RESEARCH.md` |
| Unified Install Vision | `02 - Projects/0ne-System/Cloud/UNIFIED-INSTALL-VISION.md` |

---

## Feature Status

| Feature | Status | BUILD-STATE |
|---------|--------|-------------|
| KPI Dashboard | ✅ Complete | `COMPLETED-FEATURES.md` |
| Skool Scheduler | ✅ Complete | `sections/skool-scheduler/` |
| Skool-GHL DM Sync | ✅ Working | `sections/skool-sync/` |
| Skool Chrome Extension | ✅ Complete | `sections/skool-extension/` |
| Skool Inbox | ✅ Complete | `sections/skool-inbox/` |
| GHL Media Manager | ✅ Complete | `sections/media/` |
| Personal Expenses + Plaid | ✅ Production | `sections/personal-expenses/` |
| iOS Widget | ✅ Complete | `widget/README.md` |
| Sync Dashboard | ✅ Complete | `sections/sync-dashboard/` |
| Daily Notifications | ✅ Complete | — |
| Hand-Raiser Extension Routing | 🔄 Deploy | `sections/hand-raiser-extension-routing/` |
| Extension Incremental Sync | 🔄 Active | `sections/extension-incremental-sync/` |
| Contacts Reimagining | 🔄 Active | `sections/contacts-reimagine/` |
| Conversation Channels | 🔄 Active | `sections/conversation-channels/` |
| Hand-Raiser UI | ⬜ Planned | `sections/hand-raiser-ui/` |

---

## Architecture Notes

### Extension-First Skool Integration (2026-02-17)

AWS WAF blocks all server-side Skool API calls. The Chrome extension is the **sole data collector** for Skool. See `sections/skool-api-migration/BUILD-STATE.md`.

### Database: Neon + Drizzle ORM (2026-03-25)

Fully migrated from Supabase. 63 tables across 9 schema files. See CLAUDE.md for import patterns and known issues.

### Security Conventions (2026-03-26)

Comprehensive security patterns documented in CLAUDE.md: auth patterns per route group, secureCompare for all secrets, safeErrorResponse for all errors, encryption at rest for sensitive tokens, CORS allowlists, CSP headers. See CLAUDE.md "Security Conventions" and "Deliberate Decisions" sections.

---

## Quick Commands

```bash
# Start dev server
cd apps/web && bun dev

# Build (required before push — catches issues tsc misses)
cd apps/web && bun run build

# Run cron manually
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/{job}"
```
