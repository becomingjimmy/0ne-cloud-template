# Extension: Incremental DM Sync + Trash Button Fix

**Created:** 2026-02-17
**Status:** Complete — awaiting push

---

## Overview

**Problem 1:** `pollConversations()` fetches ALL conversations every 5-minute poll cycle (61 pages, 1,814 conversations) and re-fetches messages for every single one — even those with no new activity. Infrastructure for checkpoint-based sync already exists (`conversation_sync_status` table, API client functions, server endpoints) but `pollConversations()` completely ignores it.

**Problem 2:** The trash/clear button in both popup.tsx and sidepanel.tsx is non-functional — `handleClearBuffer` is a no-op placeholder, and the button is disabled based only on `bufferedMessages === 0` instead of also checking for errors.

**Goal:** Make conversation polling checkpoint-aware (skip unchanged conversations, only fetch new messages) and fix the broken trash button.

---

## CRITICAL: Multi-Agent Sequential Deployment

**This feature MUST use the multi-agent SEQUENTIAL workflow.**

```
DO NOT run phases simultaneously/in parallel.
DO NOT skip the Task agent workflow.
ALWAYS spawn a Task agent for each phase.
ALWAYS wait for Phase 1 to complete before starting Phase 2.
```

### Deployment Protocol

```
1. Main session reads this BUILD-STATE
2. Main session spawns Task agent for Phase 1
3. Agent completes Phase 1 -> commits -> returns
4. Main session updates BUILD-STATE checkboxes
5. Main session spawns Task agent for Phase 2
6. Agent completes Phase 2 -> commits -> returns
7. Main session updates BUILD-STATE checkboxes
8. Run: cd "03 - BUILD/03-1 - Apps/Skool-Extension" && bun run build
9. Jimmy reviews and pushes when ready
```

### Why Sequential (NOT Parallel)?

- Both phases modify the same `service-worker.ts` file
- Phase 2 message handler switch depends on the service-worker state from Phase 1
- Sequential avoids merge conflicts in the same file

---

## Phase 1: Incremental DM Sync with Checkpoint Tracking

**Commit:** `Phase 1: Incremental DM sync with checkpoint-based polling`

### Tasks

| # | Task | Status |
|---|------|--------|
| 1.1 | Add `fetchNewMessagesInTab()` function in service-worker.ts | [x] |
| 1.2 | Rewrite `pollConversations()` with checkpoint logic | [x] |
| 1.3 | Verify build: `bun run build` | [x] |

### Task 1.1: `fetchNewMessagesInTab()` (NEW function)

**File:** `src/background/service-worker.ts` (add after `fetchAllMessagesInTab` ~line 1069)

Fetches only messages AFTER a known message ID using forward pagination:

```typescript
async function fetchNewMessagesInTab(
  channelId: string,
  afterMessageId: string
): Promise<{ ok: boolean; messages: unknown[]; error?: string } | null>
```

- Uses Skool API: `?before=0&after=50&msg={afterMessageId}`
- Paginates forward via `has_more_after` (max 10 pages = 500 new messages)
- Deduplicates by message ID (same pattern as `fetchAllMessagesInTab`)
- Returns only the new messages (excludes the anchor message itself)

### Task 1.2: Rewrite `pollConversations()` with Checkpoint Logic

**File:** `src/background/service-worker.ts` (replace current implementation at line 1235)

Replace current implementation (fetches messages for ALL 30 conversations blindly) with:

```
1. Fetch page 1 of conversations (30 most recent) -- keep existing fetchConversationPage(0, 30)
2. Extract channel IDs from response
3. Call getConversationSyncStatus(channelIds) to get checkpoints from server
4. Build a Map<conversationId, ConversationSyncState> for quick lookup
5. For each conversation:
   a. Get its sync state from the map
   b. Compare channel.last_message_at vs syncState.lastSyncedMessageTime
   c. If NO sync state -> first time seeing this conversation -> fetch latest 100 msgs (existing fetchMessagesInTab)
   d. If last_message_at <= lastSyncedMessageTime -> SKIP (no new messages)
   e. If last_message_at > lastSyncedMessageTime -> fetch only new messages via fetchNewMessagesInTab(channelId, lastSyncedMessageId)
6. After pushing messages for each conversation, call updateConversationSyncStatus() with the newest message ID + timestamp
7. Log summary: "Synced X conversations, skipped Y (no changes)"
```

### Key Data Shapes

**Skool channel response** (from `content/index.ts:355`):
```typescript
{
  id: string,                    // channel/conversation ID
  user: { metadata: { name } },  // participant
  last_message_at: string,       // ISO timestamp -- THE checkpoint comparison key
  created_at: string,
  metadata: { num_unread: number }
}
```

**Skool message** (from `service-worker.ts:1288`):
```typescript
{
  id: string,
  metadata: { content, src, dst },
  created_at: string
}
```

### Existing Infrastructure to REUSE (do NOT recreate)

| What | Where | Purpose |
|------|-------|---------|
| `getConversationSyncStatus()` | `src/lib/api-client.ts:1221` | Fetch checkpoints from server |
| `updateConversationSyncStatus()` | `src/lib/api-client.ts:1289` | Update checkpoint after sync |
| `ConversationSyncState` type | `src/types/index.ts:616` | `{ lastSyncedMessageId, lastSyncedMessageTime, backfillComplete, ... }` |
| `conversation_sync_status` table | Server DB | Stores per-conversation checkpoints |
| `GET /api/extension/conversation-sync-status` | 0ne-app server route | Returns sync states |
| `POST /api/extension/update-conversation-sync` | 0ne-app server route | Upserts sync state |
| `fetchConversationPage()` | `service-worker.ts:869` | Single page fetch (already used) |
| `fetchMessagesInTab()` | `service-worker.ts:964` | Fetch messages with optional anchor |
| `fetchAllMessagesInTab()` | `service-worker.ts:1018` | Pattern reference for pagination + dedup |

---

## Phase 2: Fix Trash/Clear Errors Button

**Commit:** `Phase 2: Fix trash button to clear errors and buffer`

### Tasks

| # | Task | Status |
|---|------|--------|
| 2.1 | Add `CLEAR_ERRORS` to `ExtensionMessageType` | [x] |
| 2.2 | Add `CLEAR_ERRORS` handler in service-worker.ts | [x] |
| 2.3 | Wire up `handleClearBuffer` in popup.tsx | [x] |
| 2.4 | Wire up `handleClearBuffer` in sidepanel.tsx | [x] |
| 2.5 | Fix disabled condition in both popup.tsx and sidepanel.tsx | [x] |
| 2.6 | Verify build: `bun run build` | [x] |

### Task 2.1: Add Message Type

**File:** `src/types/index.ts` (line 141, before `"CHAT_ENDPOINT_DISCOVERED"`)

Add `"CLEAR_ERRORS"` to the `ExtensionMessageType` union type.

### Task 2.2: Add Message Handler

**File:** `src/background/service-worker.ts` (after `RETRY_FAILED_MESSAGES` case ~line 3027)

```typescript
case "CLEAR_ERRORS":
  messageBuffers.clear();
  updateSyncStats({
    totalErrors: 0,
    lastError: undefined,
  }).then(() => {
    sendResponse({ success: true, data: { cleared: true } });
  });
  return true;
```

### Task 2.3 + 2.4: Wire Up handleClearBuffer

**Files:** `src/popup/popup.tsx` (line 331) and `src/popup/sidepanel.tsx` (line 365)

Replace the no-op:
```typescript
const handleClearBuffer = () => {
  console.log("Clear buffer requested");  // <- DELETE THIS
};
```

With:
```typescript
const handleClearBuffer = () => {
  chrome.runtime.sendMessage({ type: "CLEAR_ERRORS" } as ExtensionMessage, () => {
    refreshSyncStatus();
  });
};
```

### Task 2.5: Fix Disabled Condition

**Files:** `src/popup/popup.tsx` (line 720) and `src/popup/sidepanel.tsx` (line 725)

Change from:
```
disabled={syncStatus.bufferedMessages === 0}
```

To:
```
disabled={syncStatus.bufferedMessages === 0 && !syncStatus.lastError}
```

**Rationale:** The trash button should be enabled when there are errors to clear OR buffered messages to discard. Jimmy explicitly said: "dont make it dependant on anything other than errors being shown."

---

## Verification

1. `cd "03 - BUILD/03-1 - Apps/Skool-Extension" && bun run build` -- builds cleanly
2. Load unpacked extension in Chrome, open Skool tab
3. **Incremental sync test:**
   - First poll: all 30 conversations should sync (no prior checkpoints)
   - Second poll (5 min later): most conversations should show "SKIP (no new messages)" in console
   - Send a test DM -> next poll should only fetch messages for that one conversation
   - Console should log: `"Synced X conversations, skipped Y (no changes)"`
4. **Trash button test:**
   - When errors exist: trash button should be enabled (red, clickable)
   - Click trash -> errors cleared, button grays out
   - When buffered messages exist but no errors: trash button should still be enabled
   - When neither errors nor buffered messages: trash button should be disabled

---

## Critical File Paths

### Extension (to modify)
```
03 - BUILD/03-1 - Apps/Skool-Extension/
  src/background/service-worker.ts    <- Phase 1 + Phase 2 (message handler)
  src/types/index.ts                  <- Phase 2 (add CLEAR_ERRORS type)
  src/popup/popup.tsx                 <- Phase 2 (trash button)
  src/popup/sidepanel.tsx             <- Phase 2 (trash button)
```

### Extension (read-only reference)
```
03 - BUILD/03-1 - Apps/Skool-Extension/
  src/lib/api-client.ts               <- getConversationSyncStatus(), updateConversationSyncStatus()
  src/content/index.ts                <- Channel response shape reference
  CLAUDE.md                           <- Extension architecture docs
```

### 0ne-app (read-only, already exists)
```
03 - BUILD/03-1 - Apps/0ne-app/apps/web/src/app/api/extension/
  conversation-sync-status/route.ts   <- Server endpoint (GET sync state)
  update-conversation-sync/route.ts   <- Server endpoint (POST upsert)
```
