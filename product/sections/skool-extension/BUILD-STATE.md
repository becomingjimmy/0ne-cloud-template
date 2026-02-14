# Skool Chrome Extension - Build State

> **Purpose:** Chrome extension that handles ALL Skool communication (API interception, WebSocket tap, message sending, KPI sync, analytics, scheduling) and pushes data to 0ne-app for database storage and GHL sync.
> **Status:** Phase 2C Complete - Moving to Extension-Only Architecture

---

## Quick Resume

**Last Updated:** 2026-02-14
**Current Phase:** Phase 2C Complete ✅ - Service worker pushes to 0ne-app
**Next Phase:** Phase 3 - WebSocket interception for real-time sync
**Blocker:** None

**Key Discovery:** Skool uses API-driven architecture. Fetch interception captures structured data directly from `api2.skool.com/channels/{id}/messages` - no DOM parsing needed.

---

## CRITICAL: AWS WAF Blocks Server-Side Requests (2026-02-14)

**Discovery:** Skool uses AWS WAF bot protection that blocks ALL non-browser requests.

```bash
# Server-side request result:
HTTP 405 with x-amzn-waf-action: challenge

# This means:
- AWS WAF requires JavaScript browser challenge
- Valid JWT tokens are NOT enough
- ANY server-side Skool API calls will fail
- Affects: KPI sync, member sync, analytics, scheduling
```

**Impact:**
| Feature | Old Approach | New Approach |
|---------|--------------|--------------|
| DM Sync | Server-side API → blocked | Extension intercepts |
| KPI Sync | Server-side API → blocked | Extension fetches → pushes |
| Member Sync | Server-side API → blocked | Extension fetches → pushes |
| Analytics | Server-side API → blocked | Extension fetches → pushes |
| Post Scheduler | Server-side API → blocked | Extension posts → confirms |

**Conclusion:** The Chrome extension is the ONLY viable path for Skool integration. ALL Skool features must be moved to extension-based architecture.

---

**Verified Working (2026-02-14 00:43):**
- ✅ Intercepting `api2.skool.com/self/chat-channels` → 30 conversations captured
- ✅ Intercepting `api2.skool.com/channels/{id}/messages` → 8-26 messages per chat
- ✅ Data forwarded to service worker via postMessage bridge
- ✅ Uses Manifest V3 `world: "MAIN"` for CSP-compliant fetch interception

---

## ⚠️ CRITICAL: Multi-Agent Build Protocol

**This project MUST use the multi-agent workflow.**

### The Rule: Each Phase = 1 Agent

```
DO NOT build multiple phases in a single session.
DO NOT skip the agent workflow for "simple" phases.
ALWAYS spawn a Task agent for each phase.
```

### How to Deploy a Phase

1. Main session reads BUILD-STATE
2. Main session spawns a Task agent with phase details
3. Agent completes phase → commits → returns
4. Main session updates BUILD-STATE checkboxes
5. Repeat for next phase

---

## Why We Need This

### Current Limitations (discovered 2026-02-14)

| Problem | Impact | Extension Solution |
|---------|--------|-------------------|
| **Skool API returns ~1 message per conversation** | Cannot backfill full DM history | API interception captures all API responses |
| **Cookies expire frequently** | Server-side sync breaks silently | Extension uses active browser session |
| **No real-time sync** | Polling-based, delayed updates | WebSocket interception for instant capture |

### Architecture Pivot (2026-02-14)

**Discovery:** Skool uses API-driven architecture (Next.js), NOT server-rendered DOM.

**Old approach (DOM scraping):** Parse DOM elements with MutationObserver
**New approach (API interception):** Intercept fetch() calls to Skool API endpoints

**Why API interception is better:**
- ✅ Captures complete, structured data (not parsed HTML)
- ✅ Works regardless of DOM structure changes
- ✅ Gets message IDs, timestamps, sender IDs directly
- ✅ More reliable than CSS selector guessing
- ✅ Catches ALL messages loaded by the app

**Key API endpoints to intercept:**
```
GET api2.skool.com/channels/{channel_id}/messages  → Message content
GET /_next/data/{build-id}/chats.json              → Conversation list
GET api2.skool.com/self/chat-channels              → Alternative chat list
```

**WebSocket for real-time:**
```
wss://groups-ps.skool.com/ws  → Real-time message events
```

### Multi-Staff Requirement

Jimmy + Juan (and potentially more) need to:
- Each use their own Skool account
- See all conversations in one GHL inbox
- Know WHO received/sent each message
- Reply from GHL and route to correct Skool account

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CHROME EXTENSIONS                                │
│                                                                          │
│    ┌────────────────────┐        ┌────────────────────┐                 │
│    │  Jimmy's Browser   │        │   Juan's Browser   │                 │
│    │  (Extension)       │        │   (Extension)      │                 │
│    │                    │        │                    │                 │
│    │  • API intercept   │        │  • API intercept   │                 │
│    │  • WebSocket tap   │        │  • WebSocket tap   │                 │
│    │  • Send messages   │        │  • Send messages   │                 │
│    │  • Cookie extract  │        │  • Cookie extract  │                 │
│    └─────────┬──────────┘        └─────────┬──────────┘                 │
│              │                             │                             │
│              └──────────────┬──────────────┘                            │
│                             │                                            │
│                    HTTPS Push to 0ne-app                                │
└─────────────────────────────┼────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                           0NE-APP (Vercel)                               │
│                                                                          │
│    ┌────────────────────────────────────────────────────────────┐       │
│    │  API Routes                                                 │       │
│    │                                                             │       │
│    │  /api/extension/push-messages    ← Inbound from extension  │       │
│    │  /api/extension/get-pending      → Outbound queue          │       │
│    │  /api/extension/confirm-sent     ← Delivery confirmation   │       │
│    │  /api/extension/push-cookies     ← Cookie refresh          │       │
│    └──────────────────────┬─────────────────────────────────────┘       │
│                           │                                              │
│              ┌────────────┴────────────┐                                │
│              ↓                         ↓                                │
│    ┌─────────────────┐       ┌─────────────────┐                        │
│    │    Supabase     │       │       GHL       │                        │
│    │   (Database)    │       │  (Conversation  │                        │
│    │                 │       │    Provider)    │                        │
│    │  • dm_messages  │       │                 │                        │
│    │  • staff_users  │       │  • Push inbound │                        │
│    │  • sync_queue   │       │  • Get outbound │                        │
│    └─────────────────┘       └─────────────────┘                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Staff Message Attribution

### Prefix System

**Inbound messages (Member → Staff) - LEFT side in GHL:**
```
John to Jimmy (via Skool): Hey, question about the course
John to Juan (via Skool): Can you help with my application?
```

**Outbound messages (Staff → Member) - RIGHT side in GHL:**
```
Jimmy (via Skool): Sure, here's what you need to do...
Juan (via Skool): I'll take a look at your file.
```

### Outbound Routing Priority

| Priority | Method | Example |
|----------|--------|---------|
| 1️⃣ **Override prefix** | User types `@juan ` at start of message | `@juan Hey...` → routes to Juan's Skool |
| 2️⃣ **GHL user mapping** | Look up GHL user → default Skool user | Jimmy's GHL → Jimmy's Skool |
| 3️⃣ **Last conversation** | Who last talked to this contact on Skool? | If Juan was last, route to Juan |
| 4️⃣ **Fallback** | Default staff (Jimmy) | If no other match, use primary account |

---

## Build Phases

### Phase 1: Extension Foundation ✅ COMPLETE
**Goal:** Basic extension shell that can read Skool DMs and push to 0ne-app

| Task | Status | Description |
|------|--------|-------------|
| 1.1 | ✅ | Create extension project (Manifest V3, TypeScript, esbuild) |
| 1.2 | ✅ | Implement Skool user detection (JWT parsing from auth_token cookie) |
| 1.3 | ✅ | Content script: Monitor DM inbox DOM changes |
| 1.4 | ✅ | Extract message data from DOM (sender, content, timestamp) |
| 1.5 | ✅ | Service worker: Relay messages to 0ne-app API |
| 1.6 | ✅ | Create `/api/extension/push-messages` endpoint |
| 1.7 | ✅ | Basic popup UI: Connection status, sync stats |

### Phase 2: API Interception ✅ COMPLETE (Pivot from DOM)
**Goal:** Intercept Skool API calls instead of parsing DOM (more reliable)

| Task | Status | Description |
|------|--------|-------------|
| 2.1 | ✅ | Create `api-interceptor.ts` with fetch() interception |
| 2.2 | ✅ | Parse Skool API message format (`metadata.content`, `metadata.src/dst`) |
| 2.3 | ✅ | Parse Skool API channel format (conversations list) |
| 2.4 | ✅ | Deduplication via `seenMessageIds` Set |
| 2.5 | ✅ | XHR interception fallback |
| 2.6 | ✅ | Integrate with existing service worker message flow |

### Phase 2C: Push to 0ne-app ✅ COMPLETE
**Goal:** Service worker actually pushes captured data to 0ne-app API

| Task | Status | Description |
|------|--------|-------------|
| 2C.1 | ✅ | Service worker: Buffer incoming messages (`messageBuffers` Map) |
| 2C.2 | ✅ | Add deduplication in service worker (merge with existing buffer by ID) |
| 2C.3 | ✅ | POST to `/api/extension/push-messages` with batch of messages |
| 2C.4 | ✅ | Include: `staffSkoolId`, `conversationId`, `messages[]`, `timestamp` |
| 2C.5 | ✅ | Handle auth (API key from chrome.storage via `getApiConfig()`) |
| 2C.6 | ✅ | Update popup UI with push stats (total synced, last sync time) |
| 2C.7 | ✅ | Retry logic for failed pushes (exponential backoff, max 3 retries) |

**Implementation Notes:**
- `service-worker.ts`: Message buffering with `messageBuffers` Map, periodic flush via alarms (30s), threshold-based immediate flush (10 messages)
- `api-client.ts`: `pushMessages()` POSTs to API, `recordSuccessfulPush()`/`recordFailedPush()` track stats
- Popup already shows: totalPushed, lastSyncTime, bufferedMessages, connection status

**Service Worker Message Handling:**
```typescript
// In service-worker.ts
case 'MESSAGES_PARSED':
  await bufferMessages(payload.messages);
  await pushToOneApp(payload);
  break;

case 'CONVERSATIONS_FOUND':
  await bufferConversations(payload.conversations);
  break;
```

**API Payload Format:**
```typescript
POST /api/extension/push-messages
{
  staffSkoolId: "236af8c631ac4671919a4a9bc1b1fde0",
  messages: [
    {
      skoolMessageId: "abc123",
      conversationId: "ca8059a...",
      senderId: "sender-skool-id",
      content: "message text",
      timestamp: "2026-02-14T00:00:00Z",
      isOwnMessage: false
    }
  ]
}
```

---

### Phase 2B: Capture Full History (Optional Enhancement)
**Goal:** Auto-scroll to load complete conversation history

| Task | Status | Description |
|------|--------|-------------|
| 2B.1 | ⬜ | Detect when user opens a conversation modal |
| 2B.2 | ⬜ | Inject scroll trigger to load older messages |
| 2B.3 | ⬜ | Monitor for "no more messages" indicator |
| 2B.4 | ⬜ | Rate-limit scrolling (500ms intervals) |
| 2B.5 | ⬜ | Show "Syncing history..." indicator in popup |

**Note:** May not be needed if API interception captures enough on first load.

---

### Phase 3: WebSocket Interception
**Goal:** Real-time message capture (instant, no refresh needed)

| Task | Status | Description |
|------|--------|-------------|
| 3.1 | ⬜ | In `main-world.ts`: Intercept `new WebSocket()` constructor |
| 3.2 | ⬜ | Intercept `WebSocket.prototype.send` and `onmessage` |
| 3.3 | ⬜ | Identify Skool WebSocket URL: `wss://groups-ps.skool.com/ws` |
| 3.4 | ⬜ | Parse WebSocket message format (likely JSON) |
| 3.5 | ⬜ | Filter for DM events: new_message, typing, read_receipt |
| 3.6 | ⬜ | Post to content script via postMessage |
| 3.7 | ⬜ | Forward to service worker for push to 0ne-app |

**WebSocket Interception Pattern:**
```typescript
// In main-world.ts
const OriginalWebSocket = window.WebSocket;
window.WebSocket = function(url, protocols) {
  const ws = new OriginalWebSocket(url, protocols);

  if (url.includes('skool.com')) {
    log('🔌 WebSocket connection:', url);

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'dm' || data.channel?.includes('chat')) {
          window.postMessage({
            source: 'skool-dm-sync-main',
            type: 'WEBSOCKET_MESSAGE',
            data: data
          }, '*');
        }
      } catch (e) {}
    });
  }

  return ws;
};
```

### Phase 4: Outbound Message Sending
**Goal:** Send DMs from GHL through the extension

| Task | Status | Description |
|------|--------|-------------|
| 4.1 | ⬜ | Create `/api/extension/get-pending` endpoint (poll for outbound queue) |
| 4.2 | ⬜ | Service worker: Poll endpoint at 30-second intervals |
| 4.3 | ⬜ | Content script: Navigate to target DM conversation |
| 4.4 | ⬜ | DOM automation: Inject message into compose box, trigger send |
| 4.5 | ⬜ | Create `/api/extension/confirm-sent` endpoint |
| 4.6 | ⬜ | Update GHL message status on confirmation |

### Phase 5: Multi-Staff Support
**Goal:** Support multiple team members with their own Skool accounts

| Task | Status | Description |
|------|--------|-------------|
| 5.1 | ⬜ | Create `staff_users` table with Skool ID → display name + GHL user ID |
| 5.2 | ⬜ | Modify push-messages to include staff_skool_id |
| 5.3 | ⬜ | Implement inbound prefix: `{Contact} to {Staff} (via Skool): message` |
| 5.4 | ⬜ | Implement outbound prefix (extend existing for multi-staff) |
| 5.5 | ⬜ | Implement outbound routing: GHL user → Skool user mapping |
| 5.6 | ⬜ | Implement `@staffname` override prefix parsing |
| 5.7 | ⬜ | Modify get-pending to filter by staff's Skool ID |
| 5.8 | ⬜ | Admin UI: Manage staff users in 0ne-app |

### Phase 6: Cookie Management
**Goal:** Auto-sync cookies to server for backup/KPI sync

| Task | Status | Description |
|------|--------|-------------|
| 6.1 | ⬜ | Content script: Extract all Skool cookies (auth_token, session) |
| 6.2 | ⬜ | Create `/api/extension/push-cookies` endpoint |
| 6.3 | ⬜ | Store encrypted in Supabase (per staff) |
| 6.4 | ⬜ | Update SKOOL_COOKIES env var or use per-staff cookies |
| 6.5 | ⬜ | Alert mechanism when cookies approach expiry |

### Phase 7: Clerk Auth Integration (Future)
**Goal:** Replace manual API key with seamless Clerk authentication

| Task | Status | Description |
|------|--------|-------------|
| 7.1 | ⬜ | Extension checks if user is logged into app.project0ne.ai |
| 7.2 | ⬜ | Use Clerk session token for API authentication |
| 7.3 | ⬜ | Remove manual API key requirement from popup |
| 7.4 | ⬜ | Auto-link Skool user to Clerk user in database |
| 7.5 | ⬜ | Show "Login to 0ne" button if not authenticated |

---

## Extension v2: Full Skool Integration (WAF Workaround)

> **Context:** Server-side Skool API calls are blocked by AWS WAF. These phases move ALL Skool interactions to the Chrome extension.

### Phase 8: Member/KPI Sync via Extension
**Goal:** Replace server-side KPI/member sync with extension-based sync

| Task | Status | Description |
|------|--------|-------------|
| 8.1 | ⬜ | Intercept `api2.skool.com/groups/{id}/members` API responses |
| 8.2 | ⬜ | Parse member data: id, name, email, joined date, level, points |
| 8.3 | ⬜ | Create `/api/extension/push-members` endpoint in 0ne-app |
| 8.4 | ⬜ | Store members in `skool_members` table (upsert on skool_user_id) |
| 8.5 | ⬜ | Intercept `api2.skool.com/groups/{id}/stats` for KPIs |
| 8.6 | ⬜ | Create `/api/extension/push-kpis` endpoint |
| 8.7 | ⬜ | Store KPIs in `skool_kpis` table with timestamp |
| 8.8 | ⬜ | Update popup UI: Show member count, last KPI sync |
| 8.9 | ⬜ | Trigger sync on Skool admin page visit |

**API Endpoints to Intercept:**
```
GET api2.skool.com/groups/{group_id}/members?page=1&limit=50
GET api2.skool.com/groups/{group_id}/stats
GET api2.skool.com/groups/{group_id}/leaderboard
```

**Database Schema:**
```sql
-- skool_members table (new or update existing)
CREATE TABLE skool_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,  -- 0ne-app user who synced this
  group_id TEXT NOT NULL,
  skool_user_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  avatar_url TEXT,
  level INTEGER,
  points INTEGER,
  joined_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, skool_user_id)
);

-- skool_kpis table
CREATE TABLE skool_kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,  -- 'members', 'engagement', 'posts', etc.
  metric_value NUMERIC,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Phase 9: Analytics Sync via Extension
**Goal:** Capture Skool analytics/engagement data via extension

| Task | Status | Description |
|------|--------|-------------|
| 9.1 | ⬜ | Intercept analytics API calls on Skool admin dashboard |
| 9.2 | ⬜ | Parse engagement metrics: views, comments, likes, shares |
| 9.3 | ⬜ | Create `/api/extension/push-analytics` endpoint |
| 9.4 | ⬜ | Store in `skool_analytics` table with date dimension |
| 9.5 | ⬜ | Capture post-level analytics when viewing individual posts |
| 9.6 | ⬜ | Update popup UI: Show last analytics sync |

**API Endpoints to Intercept:**
```
GET api2.skool.com/groups/{group_id}/analytics
GET api2.skool.com/groups/{group_id}/posts/{post_id}/stats
GET api2.skool.com/groups/{group_id}/engagement
```

### Phase 10: Post Scheduler via Extension
**Goal:** Post scheduled content to Skool through the extension

| Task | Status | Description |
|------|--------|-------------|
| 10.1 | ⬜ | Create `/api/extension/get-scheduled-posts` endpoint |
| 10.2 | ⬜ | Extension polls for posts due in next 5 minutes |
| 10.3 | ⬜ | Navigate to correct Skool group/category |
| 10.4 | ⬜ | DOM automation: Fill post form (title, body, attachments) |
| 10.5 | ⬜ | Trigger publish, wait for success |
| 10.6 | ⬜ | Create `/api/extension/confirm-posted` endpoint |
| 10.7 | ⬜ | Update `scheduled_posts` table with posted status + Skool post ID |
| 10.8 | ⬜ | Handle errors: Network, validation, rate limiting |
| 10.9 | ⬜ | Update popup UI: Show scheduled queue, next post time |

**Post Scheduling Flow:**
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  0ne-app     │     │  Extension   │     │   Skool      │
│  Scheduler   │────▶│  Polls API   │────▶│  DOM Post    │
│  Dashboard   │     │  Every 30s   │     │  Automation  │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Create      │     │  Fetch due   │     │  Capture     │
│  scheduled   │     │  posts       │     │  post ID     │
│  post        │     │  Post to     │     │  Confirm     │
│              │     │  Skool       │     │  success     │
└──────────────┘     └──────────────┘     └──────────────┘
```

**DOM Automation (content script):**
```typescript
// Navigate to post creation
await navigateToGroup(groupId);
await clickNewPost();

// Fill form
await setPostCategory(category);
await setPostTitle(title);
await setPostBody(body);  // Rich text editor

// Attach media if needed
if (attachments.length > 0) {
  await uploadAttachments(attachments);
}

// Publish
await clickPublish();
await waitForSuccess();

// Extract post ID from URL or response
const postId = extractPostId();
return postId;
```

---

## Critical File Paths

### Extension
```
03 - BUILD/03-1 - Apps/Skool-Extension/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── src/
│   ├── background/
│   │   └── service-worker.ts       # Message relay, polling
│   ├── content/
│   │   ├── index.ts                # Main entry, init sequence
│   │   ├── api-interceptor.ts      # ✅ PRIMARY: Fetch/XHR interception
│   │   ├── dm-monitor.ts           # Fallback: DOM observation + navigation
│   │   ├── dm-sender.ts            # Outbound DOM automation (future)
│   │   ├── websocket-tap.ts        # WebSocket interception (future)
│   │   └── cookie-extractor.ts     # Cookie management (future)
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.tsx               # Status UI
│   │   └── popup.css
│   ├── lib/
│   │   ├── api-client.ts           # 0ne-app API client
│   │   ├── skool-parser.ts         # DOM parsing utilities (fallback)
│   │   ├── skool-auth.ts           # Auth token handling
│   │   ├── jwt-parser.ts           # JWT decoding
│   │   └── storage.ts              # Chrome storage wrapper
│   └── types/
│       └── index.ts
└── dist/                           # Built extension (gitignored)
```

### 0ne-app API Routes (to be created)
```
apps/web/src/app/api/extension/
├── push-messages/route.ts          # Inbound from extension
├── get-pending/route.ts            # Outbound queue
├── confirm-sent/route.ts           # Delivery confirmation
└── push-cookies/route.ts           # Cookie sync
```

### Database Changes (to be created)
```sql
-- staff_users table
CREATE TABLE staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  skool_user_id TEXT UNIQUE NOT NULL,
  skool_username TEXT,
  display_name TEXT,
  ghl_user_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Modify dm_messages
ALTER TABLE dm_messages ADD COLUMN staff_skool_id TEXT;
ALTER TABLE dm_messages ADD COLUMN staff_display_name TEXT;

-- extension_cookies table
CREATE TABLE extension_cookies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_skool_id TEXT NOT NULL REFERENCES staff_users(skool_user_id),
  cookies_encrypted TEXT NOT NULL,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Extension Framework | Manifest V3 (vanilla, no Plasmo) |
| Language | TypeScript |
| Build Tool | Bun + esbuild |
| Popup UI | React (minimal) |
| API Client | fetch (native) |
| Storage | chrome.storage.local |
| Auth | Skool JWT parsing (no separate auth needed) |

---

## Security Considerations

1. **Extension-to-Server Auth:**
   - Generate unique API key per staff in 0ne-app
   - Store in extension's chrome.storage.local
   - Send in `Authorization` header

2. **Cookie Encryption:**
   - Encrypt cookies before storing in Supabase
   - Use environment-based encryption key

3. **No Public Distribution:**
   - Developer mode only (no Chrome Web Store)
   - Manual installation per team member

---

## Verification Checklists

### Phase 1 Verification
- [ ] Extension loads in Chrome developer mode
- [ ] Shows popup with "Skool Extension" text
- [ ] Console shows "Service worker registered"
- [ ] Content script detects Skool DM pages
- [ ] Messages extracted from DOM match actual content
- [ ] Push to 0ne-app API succeeds

### Phase 4 Verification
- [ ] GHL outbound message appears in pending queue
- [ ] Extension receives and processes pending message
- [ ] DOM automation sends message successfully
- [ ] Confirmation sent back to 0ne-app
- [ ] GHL shows message as delivered

### Phase 5 Verification
- [ ] Extension on Jimmy's browser pushes with Jimmy's staff ID
- [ ] Extension on Juan's browser pushes with Juan's staff ID
- [ ] GHL shows prefixed messages from both staff
- [ ] Reply from GHL routes to correct staff's Skool

---

## Agent Prompt Template

```
Deploy Phase {X.Y} of the Skool Chrome Extension.

CONTEXT:
- Read BUILD-STATE: 03 - BUILD/03-1 - Apps/0ne-app/product/sections/skool-extension/BUILD-STATE.md
- Extension location: 03 - BUILD/03-1 - Apps/Skool-Extension/
- 0ne-app location: 03 - BUILD/03-1 - Apps/0ne-app/

TASK:
{Task description from BUILD-STATE}

SUCCESS CRITERIA:
{Specific verification steps}

COMMIT: "Phase {X.Y}: {Description}"
```

---

## Next Step

### Phase 3: WebSocket Interception ⬅️ START HERE

**What's Working:**
- ✅ API interception captures conversations + messages
- ✅ Data flows to service worker
- ✅ Service worker pushes to 0ne-app API with buffering, dedup, retry
- ✅ Popup shows sync stats (totalPushed, lastSyncTime, connection status)
- ✅ Extension messages sync to GHL via cron job

**Next Tasks:**
1. Intercept `new WebSocket()` constructor in `main-world.ts`
2. Intercept `WebSocket.prototype.send` and `onmessage`
3. Filter for DM events from `wss://groups-ps.skool.com/ws`
4. Forward real-time messages to service worker

**Goal:** Capture messages instantly as they arrive via WebSocket, not just on page load/refresh.

---

## Phase Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ | Extension Foundation |
| 2 | ✅ | API Interception (Pivot from DOM) |
| 2B | ⬜ | Full History Capture (Optional) |
| 2C | ✅ | Push to 0ne-app |
| 3 | ⬅️ | WebSocket Interception (Real-time) |
| 4 | ⬜ | Outbound Message Sending |
| 5 | ⬜ | Multi-Staff Support |
| 6 | ⬜ | Cookie Management |
| 7 | ⬜ | Clerk Auth Integration |
| **8** | ⬜ | **Member/KPI Sync via Extension** |
| **9** | ⬜ | **Analytics Sync via Extension** |
| **10** | ⬜ | **Post Scheduler via Extension** |

---

## Agent Deployment Protocol

### CRITICAL: One Phase = One Agent

```
⚠️ DO NOT implement multiple phases in one session
⚠️ DO NOT skip the Task agent workflow
⚠️ ALWAYS spawn a fresh Task agent for each phase
```

### Step-by-Step Deployment

1. **Read this BUILD-STATE** in main session
2. **Identify next phase** from Phase Roadmap table
3. **Spawn Task agent** with phase-specific prompt (see template below)
4. **Agent completes phase** → commits → returns result
5. **Main session updates** BUILD-STATE checkboxes
6. **Repeat** for next phase

### Agent Prompt Template

```
You are deploying Phase {X} of the Skool Chrome Extension.

## Context
- Extension location: 03 - BUILD/03-1 - Apps/Skool-Extension/
- 0ne-app location: 03 - BUILD/03-1 - Apps/0ne-app/
- BUILD-STATE: product/sections/skool-extension/BUILD-STATE.md

## Your Phase Tasks
{Copy tasks from Phase table in BUILD-STATE}

## Success Criteria
{Copy specific verification from phase}

## On Completion
1. Ensure extension builds: `cd "03 - BUILD/03-1 - Apps/Skool-Extension" && bun run build`
2. If 0ne-app changes: `cd "03 - BUILD/03-1 - Apps/0ne-app/apps/web" && bun run build`
3. Commit with message: "Phase {X}: {description}"
4. Return summary of what was created/modified
5. DO NOT PUSH (Jimmy will push)
```

### Parallel vs Sequential Phases

**Can run in parallel:**
- Phase 8 (Member/KPI) and Phase 9 (Analytics) - independent data flows
- Multiple extension features if they don't share state

**Must run sequentially:**
- Phase 3 before Phase 4 (WebSocket before outbound sending)
- Phase 5 before Phase 6 (Multi-staff before cookie management)
- Any phase that depends on schema changes from previous phase
