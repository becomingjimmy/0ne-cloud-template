# Project Context: How SheetWidget Was Born

> This document captures the origin story and decision-making process behind SheetWidget.

---

## The Problem

**Date:** February 3, 2026

Jimmy was using an iOS app called **SHWIDGET** to display Google Sheets data on his iPhone's lock screen. The app worked well - it showed a metric called "Days Until Broke" pulled from cell B9 of his financial tracking spreadsheet.

The problem? SHWIDGET's free tier only allows **one row** (one metric). Want to display Revenue, Pipeline, and Deals alongside "Days Until Broke"? Pay up.

Jimmy's reaction: *"I don't want to pay, so goal is to be able to replicate SHWIDGET with no limit."*

---

## The Research

Before building, we evaluated three approaches:

### Option 1: Native iOS Development (WidgetKit)

**What it would take:**
- Mac + Xcode
- Learn Swift/SwiftUI
- Apple Developer account ($99/year)
- Build WidgetKit extension
- Implement Google Sheets API

**Verdict:** Overkill for this use case. Weeks of work for the same result.

### Option 2: Scriptable App

**What it would take:**
- Free app from App Store
- Write JavaScript (not Swift)
- No developer account needed
- Pre-existing Google Sheets integrations

**Verdict:** Perfect fit. JavaScript is close to Jimmy's TypeScript preference, and Scriptable already supports lock screen widgets.

### Option 3: WidgetGrid (No-Code)

**What it is:** An existing app that connects Google Sheets to iOS widgets.

**Verdict:** Would work, but less control and another app dependency.

---

## The Decision

**Scriptable** won because:

1. **Free** - No subscription, no paywall
2. **JavaScript** - Familiar language
3. **Full control** - Own the code, customize everything
4. **Lock screen support** - Native WidgetKit integration
5. **Simple Google Sheets access** - Public sheets need no API key

---

## Technical Discovery

During research, we discovered how SHWIDGET actually works:

1. User provides Google Sheet ID (from URL)
2. User specifies cell reference (e.g., "B9")
3. User adds a label (e.g., "Days Until Broke")
4. App fetches that cell and displays it

This is remarkably simple. Google Sheets has a built-in CSV export endpoint:

```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&range={CELL}
```

No API key required for published sheets. Just fetch the URL and parse the response.

---

## Implementation

### Version 1 (Prototype)

A 30-line script that:
- Fetches a single cell
- Displays it in a Scriptable widget
- Works on lock screen

**Tested:** Fetched B9 from Jimmy's sheet, got "2" (correct value).

### Version 2 (Production)

Enhanced with:
- Multiple metrics support (array configuration)
- Parallel fetching (faster)
- Automatic layout detection (lock screen vs home screen)
- Configurable styling (colors, fonts)
- Error handling
- Full documentation for public release

---

## Key Design Decisions

### 1. Array-Based Configuration

```javascript
const METRICS = [
  { label: "Days Until Broke", cell: "B9" },
  { label: "Revenue MTD", cell: "C12" },
];
```

**Why:** Non-technical users can add metrics without understanding the code.

### 2. Automatic Layout Detection

Script checks `config.widgetFamily` to determine if it's running on lock screen or home screen, then adjusts spacing and font sizes accordingly.

**Why:** One script works everywhere, no separate versions needed.

### 3. Parallel Fetching

```javascript
const promises = METRICS.map(async (metric) => {
  const value = await fetchCell(SHEET_ID, metric.cell);
  return { label: metric.label, value };
});
return Promise.all(promises);
```

**Why:** Fetching 5 cells sequentially takes 5x as long. Parallel is faster.

### 4. No API Key Required

Uses Google's CSV export endpoint instead of the Sheets API.

**Why:** Simpler setup. No Google Cloud Console, no OAuth, no credentials.

**Tradeoff:** Sheet must be "published to web" (public).

---

## What We Didn't Build (Future Ideas)

- **Multiple sheets** - Currently one sheet ID
- **Conditional formatting** - Red when negative, green when positive
- **Sparklines** - Mini charts showing trends
- **Caching** - Offline viewing with last-known values
- **Notifications** - Alert when a value crosses a threshold

These could be added, but the current version solves the original problem.

---

## Outcome

**Time to working solution:** ~30 minutes

**Result:** A free, unlimited alternative to a paid app feature

**Files created:**
- `SheetWidget.js` - The Scriptable script
- `README.md` - Public documentation
- `CHANGELOG.md` - Version history
- `LICENSE` - MIT (open source)
- `CONTEXT.md` - This document

---

## Lessons Learned

1. **Research before building** - Native iOS would have been massive overkill
2. **Existing tools are powerful** - Scriptable already solved the hard parts
3. **Simple APIs exist** - Google's CSV endpoint meant no authentication complexity
4. **Paywalls create opportunities** - Someone else's limitation is your feature
