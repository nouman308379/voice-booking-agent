# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
pnpm dev          # dev server (Turbopack) on :3000
pnpm build        # production build
pnpm lint         # ESLint (flat config, eslint-config-next)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm test:watch   # vitest
pnpm vitest run src/lib/slot-id.test.ts          # single test file
pnpm vitest run -t "rejects a tampered payload"  # single test by name
```

`pnpm typecheck` fails on a fresh clone until `pnpm build` has run once — Next.js 16
generates the global route types (`LayoutProps`, `PageProps`) into `.next/types` at
build time. Node 22+, pnpm only (`packageManager` is pinned).

No test files exist yet. Vitest collects `src/**/*.test.ts` and `tests/**/*.test.ts`,
so colocating a test next to its subject works. Tests run in the `node` environment and
get their env from `vitest.config.ts` (`test.env`), not from `.env` — add any new
required var there too, or `src/lib/env.ts` will throw at import time in tests.

## Status: docs run ahead of code

This repo is **Phase 0 (scaffold)** plus a minimal Retell AI spike. `src/lib/` holds
finished primitives; `src/services/retell/` + `POST /api/chat` prove the agent
connection end to end. There is still no database, no calendar connector, and no
availability or booking logic — the agent can hold a conversation but cannot see or
write a calendar, and its prompt says so.

- `PRD.md` — product requirements, user journeys, demo script. Vendor-neutral.
- `SPEC.md` — the target architecture. Read the relevant section before building a
  phase; it is the design of record, including the roadmap (§14) and the verification
  plan (§15). Updated for Retell throughout.
- `RETELL.md` — how the Retell integration actually works, with each section tagged
  BUILT or NOT BUILT. **Read this before touching anything under
  `src/services/retell/`.**

Treat PRD and SPEC as specifications of what to build, not descriptions of what exists;
`RETELL.md` is the one that tracks reality. Where SPEC disagrees with itself, ask: the
stack table (§2) says Drizzle while the data model (§8) and repo layout (§12) say
Prisma — that choice is still open.

`src/lib/env.ts` and `.env.example` currently declare only the Phase 0 surface. The
vars SPEC §13 needs — `DATABASE_URL`, `CALENDAR_PROVIDER`, the `GOOGLE_*` credentials,
and the voice-platform credentials — do not exist yet in either file; extend both
together when the phase that needs them lands.

## Architecture

Three layers with one hard boundary, all in a single Next.js deployable:

1. **Voice layer** — Retell AI (`src/services/retell/`). Speech, turn-taking, LLM,
   tool selection. Knows nothing about our storage.
2. **Application layer** — this server. Owns all truth and all decisions: availability,
   slot holds, the booking transaction, customers, transcripts.
3. **Calendar layer** — pure I/O behind `CalendarConnector`, swappable by one env var
   (`CALENDAR_PROVIDER=google|memory`).

The rule that keeps the seam honest: nothing outside
`src/services/calendar/providers/google/` may import `googleapis`, and no provider type
crosses `calendar-port.ts` (it speaks `Date`, IANA zone strings, and opaque
`externalId`/`etag`). SPEC §15 calls for a test enforcing this.

### Why the existing `src/lib/` files look the way they do

- **`slot-id.ts`** — a `slot_id` is an HMAC-signed token, issued only by
  `check_availability`, that the agent passes back to `hold_slot`/`book_appointment`.
  It is signed because an LLM asked for a slot id will otherwise invent one. It is a
  token rather than a DB row because a single availability check mints dozens.
  `decodeSlotId` returns `null` and never throws — a rejection is a conversational
  outcome ("that time just got taken"), not an error — and logs a non-PII reason so a
  failed live booking is diagnosable from logs alone. Outside production it falls back
  to a fixed dev secret so tokens survive a restart; production boots refuse to start
  without a real `SLOT_ID_HMAC_SECRET`.
- **`time.ts`** — all wall-clock reasoning goes through the business's IANA zone via
  Luxon, never the server zone and never a fixed UTC offset (DST). No ISO string ever
  reaches a caller's ears: anything spoken goes through `toSpoken*`.
- **`env.ts`** — the only file in the codebase that reads `process.env`, Zod-validated
  at import time so a missing secret fails the boot rather than a live phone call.
  Server-only; never import it from a client component.
- **`phone.ts`** — E.164 normalization, deliberately NANP-only because that is what the
  demo needs; swap in `libphonenumber-js` at the first non-NANP client. It strips the
  punctuation speech-to-text tends to produce (`(416) 555-1234`, `416.555.1234`).
- **`constants.ts`** — enum-like strings and tunables; never inline them.

### The Retell layer (`src/services/retell/`)

`retell-client.ts` is the only file that knows Retell's wire format: `Authorization:
Bearer`, flat POSTs off `RETELL_BASE_URL` (web-call creation is the exception, under
`/v3`). Their model names are their own enum (`claude-5-sonnet`), not the providers'
ids.

Retell splits an agent across two objects: the **LLM** holds prompt, model and tools;
the **Agent** holds voice, language and webhook URL and points at the LLM by `llm_id`.
Prompt changes patch the LLM, not the agent — see `RETELL.md` §1.

`scripts/create-agent.ts` creates the LLM + agent once and prints the id for
`RETELL_AGENT_ID`. `POST /api/chat` holds no state — Retell keeps the history, so pass
back the `chatId` it returns to continue a conversation. A completion returns every
message generated that turn (tool calls included), so the route takes the last one with
actual text.

### Double-booking defense (SPEC §7)

Five independent layers, so no single failure double-books: signed slot ids → 5-minute
slot holds → a `SERIALIZABLE` booking transaction → a Postgres `EXCLUDE USING gist`
constraint on overlapping non-cancelled appointments → calendar write *after* commit,
with a reconciler retrying `pending_sync` rows using the same idempotency key.

Postgres is the source of truth. If the calendar write fails the caller is still
correctly told they are booked.

## Conventions

- Business logic lives in `src/services/`. Route handlers stay thin: authenticate,
  parse, delegate, respond.
- Services are resolved through `service-factory.ts`, never instantiated inline — that
  is what makes swapping the connector in tests a one-liner.
- Imports use the `@/` alias (`@/lib/time`), wired in both `tsconfig.json` and
  `vitest.config.ts`.
- Zod validates every webhook body and tool argument.
- Every provider normalizes its failures into `CalendarError` with a
  `CalendarErrorCode` and a `retryable` flag; callers branch on those, never on an HTTP
  status or a provider message.

### Writing tool responses

A voice tool returns `{ result, data?, validation_error? }`. `result` is spoken aloud,
so write it for the ear: no ISO timestamps, no error codes, no more than three options
at once (`MAX_SLOTS_OFFERED`), and a failure phrased as a next step ("Sorry, that time
just got taken. Want me to find another?"). A server tool blocks the conversation —
budget under 1.5s end to end.

When the agent config lands, keep the system prompt, first message, and tool definitions
in git rather than in a vendor dashboard — dashboard edits are invisible in review and
lost on the next sync (SPEC §10).
