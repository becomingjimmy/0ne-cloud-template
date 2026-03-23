# 0ne Cloud Widget (SheetWidget v2)

iOS lock screen and home screen widget that displays personal finance KPIs from your 0ne Cloud instance.

Built with [Scriptable](https://apps.apple.com/us/app/scriptable/id1405459188) (free iOS app).

---

## What It Shows

| Metric | Source |
|--------|--------|
| Cash On Hand | Sum of personal-scoped depository accounts (Plaid) |
| Burn Rate | Monthly tracked expenses from personal_expenses table |
| Runway (Days) | Cash on hand / daily burn rate |
| Runway (Months) | Cash on hand / monthly burn rate |

---

## Setup

1. Install [Scriptable](https://apps.apple.com/us/app/scriptable/id1405459188) from App Store
2. Set `WIDGET_API_KEY` in your Vercel environment variables (any secure random string)
3. Open Scriptable, create new script, paste contents of `SheetWidget.js`
4. Set `API_KEY` in the script to match your `WIDGET_API_KEY`
5. Run the script to test (shows preview widget)
6. Add to lock screen or home screen via iOS widget picker

---

## API Dependency

This widget consumes **`GET /api/widget/metrics`** from the 0ne Cloud web app.

**Endpoint:** `apps/web/src/app/api/widget/metrics/route.ts`

**Auth:** Bearer token. The widget sends `Authorization: Bearer {API_KEY}` and the API validates against `process.env.WIDGET_API_KEY`.

**If the widget breaks after a code change**, check:
1. Does `/api/widget/metrics` still exist?
2. Does it still return `{ metrics: [{ label, value }], updatedAt }` shape?
3. Is `WIDGET_API_KEY` still set in Vercel env?
4. Do the Supabase queries still work (`plaid_accounts`, `personal_expenses`)?

---

## Architecture

```
iPhone (Scriptable)          0ne Cloud (Vercel)           Supabase
 SheetWidget.js  ──Bearer──> /api/widget/metrics ──────> plaid_accounts
                                                  ──────> personal_expenses
```

The widget is a **read-only consumer**. It cannot modify data.

---

## History

- **v1.0.0** (2026-02-03): Google Sheets data fetcher (open source SHWIDGET alternative)
- **v2.0.0** (2026-03-13): Switched to 0ne Cloud API for personal finance KPIs
