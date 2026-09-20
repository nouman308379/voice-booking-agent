# Voice Booking Agent — Specification

A voice agent that books appointments over the phone and on the web. Calendar
writes go through a **swappable connector**; Google Calendar is simply the first
implementation.

- **Status:** design — no code written yet
- **Last updated:** 2026-09-20

---

## 1. Overview & Goals

### What this is

A caller dials a phone number (or clicks a button on a web page), talks to an AI
agent in natural speech, and ends the conversation with a real appointment on a
real calendar. No human involved.

### What the demo must prove to a client

1. The agent **never invents availability** — every time it offers is a time that
   is genuinely free.
2. Two people booking the same slot at the same moment cannot both win.
3. The appointment shows up in the business's actual calendar, in the correct
   timezone, within seconds.
4. The whole thing is **not welded to Google**. Swapping to Outlook, Cal.com, or a
   clinic PMS is a new file in one directory, not a rewrite.
5. Every call leaves a transcript and a summary you can read afterwards.

### Non-goals (deliberately out of scope)

| Not building | Why |
|---|---|
| Authentication / user accounts | Demo only. Nobody logs in. |
| Multi-tenant support | One business, one calendar. Schema is shaped so tenancy can be added later without a migration nightmare. |
| SMS / email confirmations | Later phase. |
| Google Meet / video links | Later phase. |
| Outbound calling | Inbound + web widget only. |
| Multiple staff, rooms, or resources | One bookable calendar. |
| Multiple service types | One fixed-length appointment type. |
| Payments, deposits, insurance | Not relevant to the demo. |

These are listed not as limitations but as **scope discipline**. Section 14 says
when each one comes back.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Runtime | Node 22, TypeScript 5 (strict) |
| Framework | Next.js 16, App Router |
| Database | PostgreSQL 16 (Docker Compose locally) |
| ORM | Drizzle 7 |
| Validation | Zod 4 — every webhook body and tool argument |
| Voice | ElevenLabs Agents |
| Telephony | Twilio (native ElevenLabs integration) |
| UI | Tailwind 4 + shadcn/ui |
| Package manager | pnpm |
| Tests | Vitest |

**Why Next.js and not a bare Fastify service.** The demo needs three things in one
deployable: the webhook routes ElevenLabs calls, a page hosting the web voice
widget, and a dashboard showing appointments landing live. The dashboard is the
part that actually sells this in a client meeting. Next.js gives all three with
one `pnpm dev` and one deploy. It also matches the conventions already in use in
`retell-ai-test`, so patterns port over directly.

---

## 3. Architecture

### Three layers, one hard boundary

```
┌───────────────────────────────────────────────────────────────┐
│  VOICE LAYER            ElevenLabs Agents (config-as-code)    │
│  Speech in/out, turn-taking, LLM, tool selection.             │
│  Knows nothing about Postgres or Google.                      │
└───────────────────────────┬───────────────────────────────────┘
                            │  HTTPS webhooks (init, tools, post-call)
┌───────────────────────────▼───────────────────────────────────┐
│  APPLICATION LAYER        our Next.js server                  │
│  Availability engine · slot holds · booking transaction ·     │
│  customers · conversation logs.                               │
│  OWNS ALL TRUTH AND ALL DECISIONS.                            │
└───────────────────────────┬───────────────────────────────────┘
                            │  CalendarConnector interface  ◄── the seam
┌───────────────────────────▼───────────────────────────────────┐
│  CALENDAR LAYER           pure I/O, swappable                 │
│  google/ · memory/ · (later: outlook/ · calcom/ · pms/)       │
└───────────────────────────────────────────────────────────────┘
```

The rule that keeps this honest: **the application layer may only speak to the
calendar layer through `CalendarConnector`.** No `googleapis` import exists
outside `src/services/calendar/providers/google/`. Section 15 includes a test
that enforces this.

### Inbound call, end to end

```
 1. Caller dials the Twilio number
 2. Twilio ──► ElevenLabs (native integration, no media server of ours)
 3. ElevenLabs ──► POST /api/voice/init
       body: { caller_id, called_number, call_sid, agent_id, conversation_id }
    We look up the caller by phone, and reply with dynamic variables:
       today's date, current time, timezone, business hours, appointment
       length, and the caller's name if we know them.
 4. Agent greets. Caller: "I'd like to come in next Tuesday afternoon."
 5. Agent ──► POST /api/voice/tools?tool=check_availability
       We compute free slots, return a short spoken sentence + signed slot_ids.
 6. Agent offers times. Caller picks one.
 7. Agent ──► POST /api/voice/tools?tool=hold_slot        (5-minute TTL)
 8. Agent confirms name + date + time back to the caller.
 9. Agent ──► POST /api/voice/tools?tool=book_appointment
       SERIALIZABLE tx: consume hold, insert appointment (pending_sync), commit.
       Then, outside the tx: connector.createEvent() ──► status = confirmed.
10. Agent: "You're all set for Tuesday the 23rd at 2 PM."  Call ends.
11. ElevenLabs ──► POST /api/voice/post-call
       HMAC-verified. Store transcript, summary, data collection. Release any
       hold that was never consumed.
```

The web widget takes the same path from step 4 onward. Only step 3 differs: the
browser has no `caller_id`, so dynamic variables are minted by
`POST /api/voice/widget-token` instead.

---

## 4. The Calendar Connector Port

This is the most important file in the repository.

`src/services/calendar/calendar-port.ts`

```ts
/** A block of time the calendar is already occupied. Half-open: [start, end). */
export interface BusyInterval {
  start: Date
  end: Date
}

export interface CalendarEventInput {
  /**
   * Stable across retries. The provider MUST NOT create a second event when
   * called twice with the same key. Derived from the appointment id.
   */
  idempotencyKey: string
  start: Date
  end: Date
  /** IANA zone, e.g. "America/Toronto". Never a UTC offset. */
  timeZone: string
  title: string
  description?: string
  customer: {
    name: string
    phone?: string
    email?: string
  }
  /** Round-tripped where the provider supports it; ignored where it doesn't. */
  metadata?: Record<string, string>
}

/** Opaque handle to an event in the remote system. Never parsed by callers. */
export interface CalendarEventRef {
  externalId: string
  externalUrl?: string
  /** Optimistic-concurrency token, when the provider offers one. */
  etag?: string
}

export type ExternalEventChange =
  | { kind: "upsert"; ref: CalendarEventRef; start: Date; end: Date; busy: boolean }
  | { kind: "delete"; externalId: string }

export interface CalendarConnector {
  readonly provider: string

  /** Busy blocks in [from, to). The negative space the engine books into. */
  getBusy(range: { from: Date; to: Date }): Promise<BusyInterval[]>

  createEvent(input: CalendarEventInput): Promise<CalendarEventRef>

  updateEvent(
    ref: CalendarEventRef,
    patch: Partial<CalendarEventInput>,
  ): Promise<CalendarEventRef>

  deleteEvent(ref: CalendarEventRef): Promise<void>

  /**
   * Optional incremental pull, so events created directly in the calendar by a
   * human invalidate slots we would otherwise offer. Providers without change
   * feeds simply omit this and we fall back to polling getBusy().
   */
  listChanges?(
    syncToken: string | null,
  ): Promise<{ changes: ExternalEventChange[]; nextSyncToken: string }>

  healthCheck(): Promise<{ ok: boolean; detail?: string }>
}
```

### Rules the port enforces

1. **No provider types cross this boundary.** The interface speaks `Date`, IANA
   timezone strings, and opaque `externalId` / `etag`. Nothing from `googleapis`
   appears in a signature.
2. **All errors are normalized.** Every provider catches its own failures and
   rethrows a `CalendarError` from `src/services/calendar/errors.ts`:

   ```ts
   export type CalendarErrorCode =
     | "CONFLICT"      // already exists / etag mismatch
     | "NOT_FOUND"     // event or calendar gone
     | "AUTH"          // credentials rejected or revoked
     | "RATE_LIMITED"  // back off and retry
     | "UNAVAILABLE"   // transient upstream failure
     | "INVALID"       // we sent something the provider rejected

   export class CalendarError extends Error {
     constructor(
       readonly code: CalendarErrorCode,
       message: string,
       readonly retryable: boolean,
       readonly cause?: unknown,
     ) { super(message) }
   }
   ```

   Callers branch on `code` and `retryable` only — never on an HTTP status or a
   provider-specific message.
3. **`createEvent` is idempotent.** Given the same `idempotencyKey`, calling it
   twice yields one event and two identical `CalendarEventRef`s. This is a
   requirement on the *provider*, not a hope on the caller's part.
4. **Times are absolute.** `start` and `end` are instants. `timeZone` is carried
   separately so the provider can render a wall-clock time correctly and so DST
   transitions behave.

### Selecting a connector

`src/services/calendar/get-connector.ts`

```ts
export function getCalendarConnector(): CalendarConnector {
  switch (env.CALENDAR_PROVIDER) {
    case "google": return new GoogleCalendarConnector({ ... })
    case "memory": return getSharedInMemoryConnector()
    default: throw new Error(`Unknown CALENDAR_PROVIDER: ${env.CALENDAR_PROVIDER}`)
  }
}
```

Nothing else in the codebase constructs a connector.

### Two implementations from day one

| Provider | Purpose |
|---|---|
| `providers/google/` | The real one. |
| `providers/memory/` | In-process calendar backed by an array. Lets the entire demo run, and the entire test suite pass, with no Google account, no credentials, and no network. |

The in-memory connector is not a toy — it is the **proof the abstraction holds**.
If the availability engine and booking service work identically against both, the
seam is real. A shared conformance test suite (§15) runs against every connector.

---

## 5. Google Calendar Provider

Confined to `src/services/calendar/providers/google/`.

### Authentication — service account, not OAuth

Create a Google Cloud service account, enable the Calendar API, download the JSON
key, then **share the target calendar with the service account's email address**
(Calendar settings → "Share with specific people" → "Make changes to events").

This works for ordinary Gmail calendars, not just Workspace, and it avoids the
two things that make OAuth painful for a demo: no consent screen to click
through, and no refresh token quietly expiring after seven days in testing mode.

Scope: `https://www.googleapis.com/auth/calendar`

The trade-off worth knowing: a service account without domain-wide delegation
cannot invite attendees. Irrelevant now — customer invites are out of scope
(§1) — but it is the reason Phase "later" for email confirmations may need to
revisit this.

### `getBusy` → `freebusy.query`

```
POST https://www.googleapis.com/calendar/v3/freeBusy
{ "timeMin": ..., "timeMax": ..., "timeZone": "...",
  "items": [{ "id": GOOGLE_CALENDAR_ID }] }
```

Returns busy intervals directly — no need to page through events, no need to
expand recurrence rules ourselves, and declined/transparent events are already
excluded. Cap each query at ~30 days and chunk longer ranges.

### `createEvent` → `events.insert` with a client-supplied ID

This is where idempotency comes from. Google lets the caller choose the event id,
and a second insert with an existing id returns **409 Conflict**.

The id charset is base32hex: lowercase `a`–`v` and digits `0`–`9`, length 5–1024.
So `idempotencyKey` is encoded, not passed raw:

```ts
// appointment uuid ──► base32hex, prefixed so events are identifiable by eye
const eventId = "bk" + base32hex(appointmentId).toLowerCase()
```

Handling:

| Result | Action |
|---|---|
| 200/201 | Return the new `CalendarEventRef`. |
| 409 Conflict | The event already exists — `events.get` it and return that ref. **This is success, not failure.** |
| 401/403 | `CalendarError("AUTH", retryable: false)` |
| 429 / 5xx | `CalendarError("RATE_LIMITED" \| "UNAVAILABLE", retryable: true)` |

### `updateEvent` → `events.patch` with `If-Match`

Send the stored `etag` as `If-Match`. A **412 Precondition Failed** means someone
edited the event in Google since we last read it — surface as `CONFLICT` and let
the caller re-read rather than blindly overwriting a human's change.

### `deleteEvent` → `events.delete`

**410 Gone** means it was already deleted. Treat as success — the desired state
(no event) is the actual state.

### `listChanges` → `events.list` with `syncToken`

Store `nextSyncToken` in `CalendarSyncState`. A **410 Gone** on the token means it
expired: discard it, do a full resync from `null`, and carry on. A small cron
route (`/api/cron/sync-calendar`) pulls changes so events a human adds directly
in Google stop being offered as free.

### Retry policy

Exponential backoff with jitter, 3 attempts, only on `retryable: true`. Google's
Calendar quota is generous but per-minute; the busy cache (§6) matters more for
staying under it than the retry policy does.

---

## 6. Availability Engine

`src/services/availability/`

### Configuration (one `Business` row)

```ts
{
  timeZone: "America/Toronto",     // IANA, single source of truth for the demo
  hours: {                          // per weekday, local wall-clock
    mon: [{ open: "09:00", close: "17:00" }],
    tue: [{ open: "09:00", close: "17:00" }],
    wed: [{ open: "09:00", close: "13:00" }],  // half day
    thu: [{ open: "09:00", close: "17:00" }],
    fri: [{ open: "09:00", close: "17:00" }],
    sat: [], sun: [],
  },
  appointmentDurationMinutes: 30,
  slotGranularityMinutes: 15,       // start times land on :00, :15, :30, :45
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minLeadMinutes: 120,              // nothing bookable in the next 2 hours
  maxHorizonDays: 60,
  blackoutDates: ["2026-12-25"],
}
```

### Algorithm

```
1. Clamp the requested range to [now + minLeadMinutes, now + maxHorizonDays].
2. For each day in range, in the business timezone:
     a. Skip if blackout or no open hours.
     b. Walk the day's open windows on the slotGranularity grid, emitting
        candidate slots of appointmentDuration that fit entirely inside.
3. Subtract everything occupied:
     - connector.getBusy(range)            ← the external calendar
     - Appointment rows where status != cancelled
     - SlotHold rows where expiresAt > now and consumedAt is null
   A candidate survives only if it overlaps none of the above, once the
   before/after buffers are applied.
4. Sort by start time, return the first N (default 3).
5. Sign each survivor into an opaque slot_id (§7).
```

### Why it subtracts from three sources, not one

The external calendar does not know about slots we are mid-negotiation on. The
`SlotHold` table is what stops the web widget from being offered 2 PM while a
phone caller is three seconds away from confirming 2 PM.

### Latency

A server tool blocks the conversation — the caller hears silence while it runs.
Budget **under 1.5 seconds** end to end.

The `freebusy` round trip is the slow part, so cache it: key on the day range,
TTL 30 seconds, invalidated immediately on any local write. Thirty seconds of
staleness is acceptable because every booking re-validates inside the
transaction anyway (§7) — the cache can only cause a slot to be *offered* that
then fails, never a double-booking.

Configure a filler phrase on the ElevenLabs tool ("Let me check the calendar…")
so the pause is natural rather than dead air.

---

## 7. Double-Booking & Idempotency

Five independent layers. Any one failing does not produce a double-booking.

### Layer 1 — Signed slot IDs (the LLM cannot invent a time)

An LLM asked for a `slot_id` will happily hallucinate one. So a `slot_id` is an
HMAC-signed token, issued only by `check_availability`:

`src/lib/slot-id.ts` — ported from the same file in `retell-ai-test`.

```ts
// payload { st: epochMs, et: epochMs }  ──►  base64url(payload) + "." + base64url(hmac)
export function encodeSlotId(slot: { startTime: Date; endTime: Date }): string
export function decodeSlotId(slotId: string): { startTime: Date; endTime: Date } | null
```

`decodeSlotId` returns `null` — never throws — when the signature fails, the
format is wrong, `end <= start`, or the slot is **already in the past** (60s grace
for clock skew). The past-slot check is a separate concern from forgery: it stops
an agent replaying a valid token from earlier in a long call.

Every rejection path logs a non-PII reason, which is what makes a failed live
booking diagnosable from the logs without redeploying.

### Layer 2 — Slot holds

The moment the caller says "yes, 2 PM works", `hold_slot` writes a `SlotHold`
row with a **5-minute** TTL. From that instant the slot disappears from every
other `check_availability`, on every channel.

A hold is cheap and disposable. It expires on its own; the post-call webhook also
releases any hold the conversation never consumed.

### Layer 3 — The booking transaction

```
BEGIN ISOLATION LEVEL SERIALIZABLE
  1. Re-verify the hold: exists, belongs to this conversation_id,
     expiresAt > now(), consumedAt is null.
  2. Re-verify no Appointment overlaps [start, end) with status != cancelled.
  3. Upsert Customer by phone.
  4. INSERT Appointment { status: 'pending_sync', idempotencyKey: <uuid> }
  5. UPDATE SlotHold SET consumedAt = now()
COMMIT
```

On a serialization failure, retry once; if it fails again, return a spoken
"that time was just taken — let me find you another" and loop back to
`check_availability`. That is a good conversational outcome, not an error.

### Layer 4 — A database constraint that cannot be bypassed

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status <> 'cancelled');
```

Application logic can have a bug. This cannot. It is the honest answer when a
client asks "but what if two people call at once?"

### Layer 5 — Calendar write after commit, with a reconciler

The calendar write is a network call and must not sit inside a `SERIALIZABLE`
transaction holding locks. So:

```
COMMIT  ──►  connector.createEvent()  ──►  status = 'confirmed', store externalId
```

If the calendar write fails, **the caller is still correctly told they are
booked** — Postgres is the source of truth and the appointment exists. The row
stays `pending_sync`, and `src/services/booking/reconciler.ts` (invoked by
`/api/cron/reconcile`) retries it with the same `idempotencyKey`. Because
`createEvent` is idempotent (§5), retrying is always safe, even if the original
call actually succeeded and only the response was lost.

### Idempotency of the tool call itself

ElevenLabs may retry a tool call on a timeout. `book_appointment` is keyed on
`(conversation_id, slot_id)`: if an appointment already exists for that pair, it
returns the existing booking with the same spoken confirmation rather than
creating a second one.

---

## 8. Data Model

`prisma/schema.prisma`

```prisma
model Business {
  id                         String   @id @default(uuid())
  name                       String
  timeZone                   String   // IANA
  hours                      Json     // { mon: [{open,close}], ... }
  appointmentDurationMinutes Int      @default(30)
  slotGranularityMinutes     Int      @default(15)
  bufferBeforeMinutes        Int      @default(0)
  bufferAfterMinutes         Int      @default(0)
  minLeadMinutes             Int      @default(120)
  maxHorizonDays             Int      @default(60)
  blackoutDates              String[] @default([])
  // Single row for now. Every other table carries businessId so multi-tenant
  // is an auth change later, not a migration.
}

model Customer {
  id           String        @id @default(uuid())
  businessId   String
  phone        String        // E.164
  name         String
  email        String?
  appointments Appointment[]
  createdAt    DateTime      @default(now())

  @@unique([businessId, phone])
}

enum AppointmentStatus {
  pending_sync   // in our DB, not yet on the calendar
  confirmed      // on the calendar
  cancelled
}

enum BookingSource {
  phone
  web
}

model Appointment {
  id              String            @id @default(uuid())
  businessId      String
  customerId      String
  customer        Customer          @relation(fields: [customerId], references: [id])
  startsAt        DateTime          @db.Timestamptz
  endsAt          DateTime          @db.Timestamptz
  status          AppointmentStatus @default(pending_sync)
  source          BookingSource
  conversationId  String?
  notes           String?

  // Calendar mirror
  externalEventId String?
  externalEtag    String?
  externalUrl     String?
  idempotencyKey  String            @unique
  syncAttempts    Int               @default(0)
  lastSyncError   String?

  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  @@index([businessId, startsAt])
  @@index([status])
  // Plus the gist exclusion constraint from §7, added via raw SQL migration.
}

model SlotHold {
  id             String    @id @default(uuid())
  businessId     String
  startsAt       DateTime  @db.Timestamptz
  endsAt         DateTime  @db.Timestamptz
  conversationId String
  expiresAt      DateTime  @db.Timestamptz
  consumedAt     DateTime?
  createdAt      DateTime  @default(now())

  @@index([businessId, expiresAt])
}

enum ConversationChannel { phone  web }

model Conversation {
  id              String              @id @default(uuid())
  businessId      String
  externalId      String              @unique  // ElevenLabs conversation_id
  channel         ConversationChannel
  callerPhone     String?
  callSid         String?
  status          String?
  transcript      Json?
  summary         String?
  dataCollection  Json?
  durationSeconds Int?
  startedAt       DateTime            @default(now())
  endedAt         DateTime?
  appointmentId   String?

  @@index([businessId, startedAt])
}

model CalendarSyncState {
  id           String    @id @default(uuid())
  businessId   String
  provider     String
  syncToken    String?
  lastSyncedAt DateTime?

  @@unique([businessId, provider])
}
```

---

## 9. Voice Tool Contracts

### Transport

One route handles every tool, selected by query param — the pattern from
`retell-ai-test/app/api/webhooks/retell/tools/route.ts`:

```
POST /api/voice/tools?tool=<name>
Header: X-Voice-Tool-Secret: <VOICE_TOOL_SECRET>
```

`src/services/voice-tools/tool-handlers.ts` holds the dispatch map:

```ts
export const TOOL_HANDLERS: Record<string, (args: ToolArgs, ctx: ToolContext) => Promise<ToolResponse>> = {
  check_availability:     handleCheckAvailability,
  hold_slot:              handleHoldSlot,
  book_appointment:       handleBookAppointment,
  lookup_appointment:     handleLookupAppointment,
  reschedule_appointment: handleRescheduleAppointment,
  cancel_appointment:     handleCancelAppointment,
}
```

The route stays thin: authenticate, look up the handler, parse, call, respond.

### Response shape

`src/services/voice-tools/shared/types.ts`

```ts
export type ToolArgs = Record<string, string | number | undefined>

export interface ToolResponse {
  /** Spoken aloud (or closely paraphrased) by the agent. Short. Natural. */
  result: string
  /** Structured payload. Never spoken. */
  data?: unknown
  /**
   * Set when args fail validation. The agent is instructed (Hard Rule 6) to
   * read `result` as a re-ask and call the same tool again with corrected
   * input — rather than dead-ending the call.
   */
  validation_error?: {
    field: string
    code: string
    message: string
    retry: true
  }
}
```

### Writing `result` for speech, not for a screen

This is the difference between a demo that sounds good and one that doesn't.

| Don't | Do |
|---|---|
| `"3 slots available"` | `"I have Tuesday the 23rd at 2 PM, Tuesday at 4:30, or Wednesday morning at 10."` |
| `"2026-09-23T14:00:00Z"` | `"Tuesday the 23rd at 2 PM"` |
| `"ERROR: slot_id invalid"` | `"Sorry, that time just got taken. Want me to find another?"` |
| Returning 12 options | Return **3**. More than three is unlistenable. |

All times formatted in the business timezone by `src/lib/time.ts`
(`toSpokenDateTime`, `toSpokenDate`, `toSpokenTime`). No ISO string ever reaches
`result`.

### The tools

---

**`check_availability`**

| Arg | Type | Notes |
|---|---|---|
| `date_preference` | string? | Natural: `"next Tuesday"`, `"tomorrow afternoon"`, `"this week"` |
| `time_preference` | string? | `"morning"` \| `"afternoon"` \| `"evening"` \| `"any"` |

Resolves the phrase against `{{today_date}}` in the business timezone, runs the
engine, returns up to 3 slots.

```jsonc
{
  "result": "I have Tuesday the 23rd at 2 PM, Tuesday at 4:30, or Wednesday at 10 AM.",
  "data": {
    "slots": [
      { "slot_id": "eyJzd...abc.9f2c1d", "spoken": "Tuesday the 23rd at 2 PM" }
    ]
  }
}
```

Empty result is a conversational move, not an error:
`"I don't have anything Tuesday. My next opening is Thursday at 11 AM — does that work?"`

---

**`hold_slot`**

| Arg | Type |
|---|---|
| `slot_id` | string (required) |

Verifies the signature, re-checks the slot is still free, writes a `SlotHold`
with a 5-minute TTL against the current `conversation_id`.

- Success: `{ "result": "Got it, I'm holding Tuesday at 2 PM for you." }`
- Taken: `{ "result": "That one just got taken. Want me to check nearby times?" }`

---

**`book_appointment`**

| Arg | Type | Notes |
|---|---|---|
| `slot_id` | string | Required |
| `customer_name` | string | Required |
| `customer_phone` | string | Pre-filled from `caller_id` on phone; asked for on web |
| `notes` | string? | Reason for visit |

Runs §7 layers 3–5.

```jsonc
{
  "result": "Perfect, you're booked for Tuesday the 23rd at 2 PM. See you then.",
  "data": { "appointment_id": "...", "starts_at": "2026-09-23T18:00:00Z" }
}
```

Bad phone number:

```jsonc
{
  "result": "I didn't catch that number — can you give me the ten digits again?",
  "validation_error": { "field": "customer_phone", "code": "invalid_phone",
                        "message": "not E.164", "retry": true }
}
```

---

**`lookup_appointment`**

| Arg | Type |
|---|---|
| `customer_phone` | string? (defaults to `caller_id`) |

Returns the caller's next upcoming appointment, or says there isn't one. Returns
an internal `appointment_id` in `data` for the next two tools.

---

**`reschedule_appointment`**

| Arg | Type |
|---|---|
| `appointment_id` | string |
| `slot_id` | string (new time) |

Books the new slot first, then releases the old one, then `connector.updateEvent`
with the stored etag. Old-time-first would risk losing both.

---

**`cancel_appointment`**

| Arg | Type |
|---|---|
| `appointment_id` | string |

Sets `status = cancelled` (never deletes the row — the demo dashboard shows
cancellations), then `connector.deleteEvent`. A 410 from the provider is success.

---

## 10. Agent Prompt & Dynamic Variables

### Config lives in git

The system prompt, first message, tool definitions, and voice settings live in
`src/services/agent/prompt/` and are pushed to ElevenLabs by
`scripts/sync-agent.ts`. Nobody edits the prompt in the dashboard — it would be
lost on the next sync and invisible in review.

### Dynamic variables

Injected per conversation by `/api/voice/init` (phone) or
`/api/voice/widget-token` (web):

| Variable | Example | Why it matters |
|---|---|---|
| `{{business_name}}` | `"Riverside Dental"` | Greeting |
| `{{today_date}}` | `"Saturday, September 20, 2026"` | **Essential.** Without it the model cannot resolve "next Tuesday" and will guess. |
| `{{current_time}}` | `"2:14 PM"` | Lets it say "later today" correctly |
| `{{timezone}}` | `"America/Toronto"` | |
| `{{appointment_duration}}` | `"30 minutes"` | |
| `{{business_hours}}` | `"Mon–Fri 9 to 5, Wed until 1"` | Answers hours questions with no tool call |
| `{{caller_name}}` | `"Sarah"` or `"there"` | Returning-caller recognition — the single most impressive beat in a demo |
| `{{is_returning_customer}}` | `"true"` | Branches the greeting |

Note: `system__` prefixed variables are reserved by ElevenLabs and cannot be set
from the initiation payload.

### Hard rules in the system prompt

1. **Never state a time as available without calling `check_availability` first.**
   You have no knowledge of the calendar. Guessing is the worst failure mode.
2. **Never say a `slot_id` aloud.** It is an internal token.
3. Offer **at most three** times at once.
4. Always speak an **absolute date** — "Tuesday, September 23rd", not "next
   Tuesday" alone. Confirm the day of week *and* the date.
5. Before calling `book_appointment`, read the full booking back and get an
   explicit yes: name, day, date, time.
6. On a `validation_error`, say `result` as a natural re-ask and call the tool
   again with corrected input. **Never end the call on a validation error.**
7. Collect `customer_name` always. On phone, `customer_phone` is pre-filled —
   don't ask for it unless booking for someone else.
8. If asked something outside booking (pricing, directions, clinical advice),
   answer briefly if it's in the prompt, otherwise offer to take a message.
9. Keep turns short. One or two sentences. This is a phone call.

### `scripts/sync-agent.ts`

Idempotent `PATCH` of the agent config via the ElevenLabs API: prompt, first
message, language, LLM, TTS voice and stability, turn-taking settings, and every
webhook tool definition with its URL and secret header. Run it after any prompt
change; diff-check in CI so the deployed agent never drifts from `main`.

---

## 11. Channels

### Inbound phone — Twilio native integration

1. Buy a Twilio number.
2. In the ElevenLabs dashboard → Phone Numbers → add the number with the Twilio
   Account SID and Auth Token.
3. Assign the agent to that number for inbound.

ElevenLabs rewrites the Twilio voice webhook itself. **We run no media server and
handle no audio.** Our only phone-path responsibility is `/api/voice/init`.

### Web widget

`src/app/page.tsx` — the client-facing demo page.

```tsx
const conversation = useConversation({
  onMessage: (m) => appendTranscript(m),
  onError:   (e) => setError(e),
})

async function start() {
  const { conversationToken } = await fetch("/api/voice/widget-token", {
    method: "POST",
  }).then((r) => r.json())
  await conversation.startSession({ conversationToken, connectionType: "webrtc" })
}
```

`POST /api/voice/widget-token` mints a short-lived conversation token server-side
and attaches the same dynamic variables the phone path gets (with
`caller_name: "there"`, since the browser has no caller ID). The agent ID and API
key never reach the browser.

The page shows a single "Talk to book an appointment" button, a live transcript,
and the appointments table updating underneath as the booking lands — the visual
that makes the demo land.

### Demo dashboard

`src/app/appointments/page.tsx` — upcoming appointments with customer, time,
source (📞 phone / 💻 web), sync status, a link to the calendar event, and a
drawer with the call transcript and summary. No auth; it's a demo.

---

## 12. Repository Layout

```
Booking/
├── SPEC.md                                 ← this file
├── CLAUDE.md                               conventions for future sessions
├── .env.example
├── docker-compose.yml                      postgres
├── prisma/
│   ├── schema.prisma
│   └── migrations/                         incl. raw SQL for btree_gist EXCLUDE
├── scripts/
│   ├── seed.ts                             business config + sample customers
│   ├── sync-agent.ts                       push agent config to ElevenLabs
│   └── google-check.ts                     verify SA access, print busy blocks
└── src/
    ├── app/
    │   ├── page.tsx                        web voice widget (demo landing)
    │   ├── appointments/page.tsx           demo dashboard
    │   └── api/
    │       ├── voice/
    │       │   ├── init/route.ts           conversation initiation webhook
    │       │   ├── tools/route.ts          POST ?tool=<name>
    │       │   ├── post-call/route.ts      HMAC-verified transcript sink
    │       │   └── widget-token/route.ts   mint web conversation token
    │       ├── appointments/route.ts       dashboard data
    │       └── cron/
    │           ├── reconcile/route.ts      retry pending_sync rows
    │           └── sync-calendar/route.ts  pull external changes
    ├── services/
    │   ├── calendar/                       ◄── THE SWAPPABLE LAYER
    │   │   ├── calendar-port.ts            the interface
    │   │   ├── errors.ts                   CalendarError + codes
    │   │   ├── get-connector.ts            factory, env-driven
    │   │   └── providers/
    │   │       ├── google/
    │   │       │   ├── google-calendar-connector.ts
    │   │       │   ├── google-client.ts    auth + retry/backoff
    │   │       │   └── mapping.ts          our types ⇄ Google types
    │   │       └── memory/
    │   │           └── in-memory-connector.ts
    │   ├── availability/
    │   │   ├── availability-engine.ts
    │   │   ├── slot-generation.ts
    │   │   ├── business-hours.ts
    │   │   └── busy-cache.ts
    │   ├── booking/
    │   │   ├── booking-service.ts          the SERIALIZABLE transaction
    │   │   ├── slot-hold-service.ts
    │   │   └── reconciler.ts
    │   ├── voice-tools/
    │   │   ├── tool-handlers.ts            TOOL_HANDLERS dispatch map
    │   │   ├── handlers/                   one file per tool
    │   │   └── shared/
    │   │       ├── types.ts                ToolArgs / ToolResponse
    │   │       ├── auth.ts                 secret-header verification
    │   │       ├── validation.ts           Zod → validation_error
    │   │       └── speech.ts               spoken-time formatting
    │   ├── agent/
    │   │   ├── prompt/system-prompt.ts
    │   │   ├── prompt/tools.ts             webhook tool definitions
    │   │   └── elevenlabs-client.ts
    │   └── service-factory.ts              DI — nothing news up a service
    └── lib/
        ├── env.ts                          ONLY file touching process.env
        ├── db.ts                           Prisma singleton
        ├── slot-id.ts                      HMAC opaque slot tokens
        ├── elevenlabs-webhook-auth.ts      elevenlabs-signature verification
        ├── time.ts                         IANA formatting, spoken times
        ├── phone.ts                        E.164 normalization
        ├── api-response.ts
        └── constants.ts
```

### Conventions (carried from `retell-ai-test`)

- All business logic in `src/services/`. Route handlers stay thin: authenticate,
  parse, delegate, respond.
- `src/lib/env.ts` is the **only** file that reads `process.env`, and it validates
  with Zod at startup so a missing secret fails the boot, not the call.
- Services are resolved through `service-factory.ts`, never instantiated inline —
  which is what makes swapping the connector in tests a one-liner.
- Imports use the `@/` alias.
- Enum-like strings come from `lib/constants.ts`.

---

## 13. Environment Variables

`.env.example`

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/booking"

# ElevenLabs
ELEVENLABS_API_KEY="sk_..."
ELEVENLABS_AGENT_ID="agent_..."
ELEVENLABS_WEBHOOK_SECRET="wsec_..."      # verifies elevenlabs-signature

# Our webhook auth — the shared secret ElevenLabs sends on every tool call
VOICE_TOOL_SECRET="<random 32+ chars>"

# Signs slot_id tokens. Must be >= 16 chars. Changing it invalidates
# every outstanding slot_id (they fail closed, which is correct).
SLOT_ID_HMAC_SECRET="<random 32+ chars>"

# Calendar connector selection — "google" | "memory"
CALENDAR_PROVIDER="memory"

# Google (only when CALENDAR_PROVIDER=google)
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
GOOGLE_CALENDAR_ID="you@gmail.com"

# Business
BUSINESS_TIMEZONE="America/Toronto"
BUSINESS_NAME="Riverside Dental"

# Public base URL for webhook registration (ngrok/cloudflared in dev)
PUBLIC_BASE_URL="https://booking.example.com"
```

---

## 14. Roadmap

### Phase 0 — Foundation *(no external services required)*

Scaffold Next.js + TypeScript + Tailwind. Prisma schema and migrations, including
the raw-SQL `btree_gist` exclusion constraint. `lib/env.ts`, `lib/time.ts`,
`lib/slot-id.ts`. The `CalendarConnector` port, `CalendarError`, and the
**in-memory connector**. The availability engine. Vitest suite over slot
generation, DST boundaries, and slot-id signing.

*Exit:* `pnpm test` green with no Google account, no ElevenLabs key, no network.

### Phase 1 — Google connector

`google-client.ts` (service-account auth, backoff), `google-calendar-connector.ts`
implementing every port method, `mapping.ts`, the base32hex event-id derivation,
the busy cache, and `scripts/google-check.ts`.

*Exit:* the shared connector conformance suite passes against both `memory` and
`google`, and `google-check.ts` prints real busy blocks from your calendar.

### Phase 2 — Booking core

`slot-hold-service.ts`, `booking-service.ts` with the `SERIALIZABLE` transaction,
the reconciler, and all six tool handlers behind `/api/voice/tools`.

*Exit:* curl scripts drive a full book → reschedule → cancel cycle, and the race
test (§15) passes.

### Phase 3 — Voice on the web

System prompt, tool definitions, `scripts/sync-agent.ts`, `/api/voice/widget-token`,
and the widget page.

*Exit:* **first end-to-end voice booking.** Talk into the browser, watch a row
appear in Postgres and an event appear in Google Calendar.

### Phase 4 — Phone

Twilio number imported into ElevenLabs, `/api/voice/init` with caller lookup,
`/api/voice/post-call` with HMAC verification and transcript storage.

*Exit:* phone the number, book by voice, read the transcript afterwards.

### Phase 5 — Demo polish

Appointments dashboard with transcript drawer, seed data, the cron routes, error
states, deploy behind a stable HTTPS URL.

*Exit:* you can hand a client a phone number and a link.

### Later (explicitly deferred)

- SMS confirmations + reminders via Twilio
- Email confirmations and real calendar invites *(revisit service-account
  attendee limits — see §5)*
- Google Meet links via `conferenceData`
- Outbound calling (confirmations, waitlist fill, recalls)
- Multiple staff / rooms — the port gains a `calendarId` or resource parameter
- Multiple service types with per-service duration and buffers
- Multi-tenant + authentication
- Additional connectors: Outlook/Graph, Cal.com, Cliniko, NexHealth
- Analytics: booking rate, containment rate, average handle time

---

## 15. Verification

### Unit and integration

```bash
docker compose up -d db
pnpm prisma migrate dev
pnpm test
```

Covers:

- **Slot generation** — business hours, buffers, lead time, horizon, blackouts.
- **DST boundaries** — a booking on the spring-forward and fall-back days lands
  at the correct wall-clock time. The bug this catches is the classic one.
- **Slot-id signing** — tampered payload rejected, wrong secret rejected, past
  slot rejected, valid round trip.
- **Connector conformance** — one shared suite (`calendar-port.contract.test.ts`)
  run against every connector: create → read busy → update → delete, plus
  double-create with the same `idempotencyKey` yielding exactly one event.
- **Boundary enforcement** — a test asserting no file outside
  `src/services/calendar/providers/google/` imports `googleapis`. This is what
  keeps the abstraction from quietly rotting.

### Concurrency

```bash
pnpm tsx scripts/test-race.ts
```

Fires 10 concurrent `book_appointment` calls against the same `slot_id`.
**Exactly one** must succeed; the other nine must get the spoken
"that time was just taken" response. Then assert one appointment row and one
calendar event.

### Idempotency

Replay the same `book_appointment` body twice. Assert one row, one calendar
event, and the same spoken confirmation both times. Then force a connector
failure, confirm the row sits at `pending_sync`, run the reconciler, and confirm
it reaches `confirmed` with one event.

### End to end, no credentials

```bash
CALENDAR_PROVIDER=memory pnpm dev
```

Open `/`, click the button, book by voice, see the row on `/appointments`.

### End to end, real calendar

```bash
pnpm tsx scripts/google-check.ts    # confirms the SA can see the calendar
CALENDAR_PROVIDER=google pnpm dev
```

Book by voice; confirm the event appears in the Google Calendar UI **at the right
wall-clock time in the business timezone**.

### Phone

```bash
cloudflared tunnel --url http://localhost:3000
# set PUBLIC_BASE_URL to the tunnel, then:
pnpm tsx scripts/sync-agent.ts
```

Call the Twilio number. Verify: the greeting uses your name if you've booked
before, availability is real, the booking lands, and the post-call webhook stored
a transcript and summary on the `Conversation` row.

### The connector-swap demo

The proof the architecture claim is true, and worth doing live in front of a
client: change `CALENDAR_PROVIDER` from `google` to `memory`, restart, and book
again. Nothing else changes. No code edited. That one flag is the whole argument
for the port.
