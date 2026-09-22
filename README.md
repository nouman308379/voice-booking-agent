# Voice Booking Agent

A voice agent that books appointments over the phone and on the web.

A caller dials a number (or clicks a button on a web page), talks to an AI agent
in natural speech, and ends the conversation with a real appointment on a real
calendar. No human involved.

Built on **Retell AI**, with calendar writes behind a swappable connector —
Google Calendar is the first implementation, not the design.

---

## Status

**Scaffold + a working Retell agent.** You can talk to the agent over HTTP
today. The booking system underneath it is not built yet — the agent can hold a
conversation but cannot see or write a calendar, and its prompt says so.

| | |
|---|---|
| [`PRD.md`](./PRD.md) | Product requirements — what we're building and why |
| [`SPEC.md`](./SPEC.md) | Technical spec — architecture, data model, roadmap |
| [`RETELL.md`](./RETELL.md) | How the Retell integration works, end to end |

> ⚠️ PRD and SPEC describe the **target** architecture, including a Postgres
> data layer and the calendar connector. Neither is implemented yet, so those
> two documents run ahead of the code. `RETELL.md` describes what actually
> exists and marks clearly what doesn't.

### What's in the repo right now

```
src/app/
  api/chat/route.ts        POST a message, get the agent's reply
src/lib/
  env.ts        the only file that reads process.env, Zod-validated at boot
  constants.ts  enum-like strings and tunables
  time.ts       IANA timezone handling + speech formatting ("Tuesday the 23rd at 2 PM")
  slot-id.ts    HMAC-signed opaque slot tokens
  phone.ts      E.164 normalization
src/services/retell/
  retell-client.ts         the only file that knows Retell's wire format
scripts/
  create-agent.ts          run once — creates the LLM + chat agent, prints the id
```

`slot-id.ts` is worth a look — it's the mechanism that stops the language model
inventing an appointment slot it was never offered.

### Talk to the agent

```bash
# one-time: put RETELL_API_KEY in .env, then
pnpm tsx scripts/create-agent.ts     # prints RETELL_AGENT_ID → paste into .env

curl -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"I want to book an appointment Tuesday"}'
```

Pass the returned `chatId` back on the next request to continue the
conversation. See [`RETELL.md`](./RETELL.md) for the full flow.

---

## Getting started

Requires **Node 22+** and **pnpm**.

```bash
pnpm install
cp .env.example .env

# generate the two secrets
openssl rand -hex 32   # → SLOT_ID_HMAC_SECRET
openssl rand -hex 32   # → VOICE_TOOL_SECRET

# add your Retell key to .env to talk to the agent
# RETELL_API_KEY="key_..."   → then: pnpm tsx scripts/create-agent.ts

pnpm dev               # http://localhost:3000
```

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest |

> `pnpm typecheck` fails on a fresh clone until you've run `pnpm build` once —
> Next.js 16 generates global route types (`LayoutProps`, `PageProps`) into
> `.next/types` during the build. Not a bug, just ordering.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 24, TypeScript 5.9 (strict) |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind 4 |
| Validation | Zod 4 |
| Time | Luxon (IANA zones, DST-correct wall-clock math) |
| Voice | Retell AI |
| Tests | Vitest |

---

## Roadmap

See [`SPEC.md` §14](./SPEC.md) for detail.

- [x] **Phase 0** — project scaffold
- [ ] **Phase 1** — data layer + calendar connector (Google + in-memory)
- [ ] **Phase 2** — availability engine, slot holds, booking transaction
- [ ] **Phase 3** — Retell custom functions + web voice widget *(first end-to-end booking)*
- [ ] **Phase 4** — inbound phone calls, transcripts
- [ ] **Phase 5** — demo dashboard, deploy
