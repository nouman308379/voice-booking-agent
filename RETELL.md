# The Retell Integration

How this project talks to Retell AI — what exists today, what the pieces are,
and what still has to be built.

> **Status.** The chat path is built and works. The voice paths are designed but
> not written. Every section below is tagged **BUILT** or **NOT BUILT** so you
> can tell the code from the plan at a glance.

---

## 1. The mental model

Retell splits an agent across **two objects**, and almost every confusion about
this API comes from not knowing which one holds what.

```
┌──────────────────────────────────────────────┐
│  Retell LLM            llm_xxxxxxxx          │
│  ───────────────────────────────────────     │
│  general_prompt        the system prompt     │
│  begin_message         first thing it says   │
│  model                 claude-5-sonnet       │
│  general_tools         the custom functions  │
└───────────────────┬──────────────────────────┘
                    │  referenced by llm_id
          │  both point at the same llm_id
   ┌──────┴───────────────┬─────────────────────┐
   ▼                      ▼                     │
┌──────────────────┐  ┌──────────────────────┐  │
│ Chat Agent       │  │ Voice Agent          │  │
│ /create-chat-    │  │ /create-agent        │  │
│   agent          │  │                      │  │
│ agent_xxxx       │  │ agent_xxxx (its own) │  │
│                  │  │ voice_id, language   │  │
│                  │  │ webhook_url          │  │
└────────┬─────────┘  └──────────┬───────────┘  │
         ▼                       ▼              │
   ┌──────────┐            ┌────────────┐       │
   │   Chat   │            │    Call    │       │
   │ chat_id  │            │  call_id   │       │
   └──────────┘            └────────────┘       │
     text, HTTP             voice, WebRTC/phone │
```

**Chat agents and voice agents are separate objects**, each created by its own
endpoint and each with its own `agent_id`. They are not two modes of one agent.
What they *can* share is the Retell LLM — write the prompt once, point both at
the same `llm_id`. `RETELL_AGENT_ID` in `.env` is the **chat** agent's id,
because the chat path is the one that's built.

**The rule to remember:** changing the prompt or the tools is a write to the
**LLM** object. Changing the voice or the webhook URL is a write to the
**Agent**. Sessions — chats and calls — are created per conversation and hold
the transcript.

### Control plane vs data plane

| | When it runs | What it touches |
|---|---|---|
| **Control plane** | Once at setup, then on every prompt change | Creates/updates the LLM and Agent. `scripts/create-agent.ts` today, `scripts/sync-agent.ts` later. |
| **Data plane** | Every conversation | Creates a chat or call against the existing `agent_id`. `POST /api/chat` today. |

Never create an agent from a request handler. Agents are durable objects; make
one, store its id in `.env`, and reference it forever.

---

## 2. What exists today — the chat flow  **[BUILT]**

```
  client                our server                      Retell
    │                       │                             │
    │  POST /api/chat       │                             │
    │  {"message":"..."}    │                             │
    ├──────────────────────►│                             │
    │                       │  POST /create-chat          │
    │                       │  {agent_id}                 │
    │                       ├────────────────────────────►│
    │                       │       {chat_id}             │
    │                       │◄────────────────────────────┤
    │                       │                             │
    │                       │  POST /create-chat-completion
    │                       │  {chat_id, content}         │
    │                       ├────────────────────────────►│
    │                       │       {messages: [...]}     │
    │                       │◄────────────────────────────┤
    │  {chatId, reply}      │                             │
    │◄──────────────────────┤                             │
```

Two Retell calls on the first message, one on every message after — pass the
`chatId` back and `create-chat` is skipped.

### Files

| File | Role |
|---|---|
| `src/services/retell/retell-client.ts` | The only file that knows Retell's wire format |
| `src/app/api/chat/route.ts` | The HTTP surface |
| `scripts/create-agent.ts` | One-shot setup: creates the LLM + both agents |
| `src/app/api/voice/web-call/route.ts` | Mints a browser voice-call token |
| `src/app/page.tsx` + `_components/` | Mode picker, chat panel, voice panel |

### Running it

```bash
# 1. Put your key in .env
RETELL_API_KEY="key_..."

# 2. Create the LLM + both agents — prints both ids
pnpm create-agent
#   ✓ llm           llm_abc123  (claude-5-sonnet)
#   ✓ chat agent    agent_xyz789
#   ✓ voice agent   agent_pqr456

# 3. Paste RETELL_AGENT_ID into .env, then talk to it
curl -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"I want to book an appointment Tuesday"}'

# {"chatId":"chat_abc","reply":"Sure — what time on Tuesday works for you?"}

# 4. Continue the conversation by passing chatId back
curl -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"chatId":"chat_abc","message":"2pm, name is Sarah"}'
```

### State lives on Retell, not here

We store nothing. Retell keeps the transcript against the `chat_id`, so the
conversation is resumed by sending that id back. This is why the route is
stateless and why there is no database dependency yet.

The consequence worth knowing: **the `chatId` is the conversation**. Lose it and
the history is gone from the caller's point of view, even though Retell still
has it.

### Reading the reply

`create-chat-completion` returns **every message the agent generated that turn**,
which can include tool-call invocations and their results — not just the
sentence to show the user. The route takes the last message that has actual
text:

```ts
const reply = [...messages].reverse()
  .find((m) => typeof m.content === "string" && m.content.trim())?.content
```

Once custom functions are wired up, this array gets longer and this line is the
one that keeps working.

---

## 3. Errors and failure modes  **[BUILT]**

`retell-client.ts` throws `RetellError` with an optional `status`. The route
maps everything to one of three outcomes:

| Situation | Response |
|---|---|
| Body isn't `{message: string}` | `400` with the expected shape |
| `RETELL_AGENT_ID` unset | `500` naming the script to run |
| Anything from Retell (401, 5xx, network) | `502 {"error":"Agent unavailable"}` |

Upstream status codes and bodies are logged, never returned — a Retell error
message can carry account detail that shouldn't reach a browser.

A bad key surfaces as `401 {"status":"error","message":"Invalid API Key."}` in
the server log. That is also the quickest way to confirm the connection reaches
Retell at all.

---

## 4. The voice paths

### Web call  **[BUILT — browser-untested]**

```
browser          our server                  Retell
   │  POST /api/voice/web-call    │
   ├────────────────►│            │
   │                 │ POST /v3/create-web-call
   │                 │ {agent_id, retell_llm_dynamic_variables}
   │                 ├───────────►│
   │                 │ {access_token, call_id, expires_at}
   │                 │◄───────────┤
   │ {accessToken}   │            │
   │◄────────────────┤            │
   │                              │
   │  join with the web SDK, audio flows browser ↔ Retell
   ├─────────────────────────────►│
```

Note the version: **web call creation is `/v3/create-web-call`**, while chat and
agent management are flat paths off the base URL. Easy to get wrong.

The API key never reaches the browser — only the short-lived `access_token`,
which carries its own `expires_at`.

#### Which browser class to use — this one bites

`retell-client-js-sdk` v3 exports two ways in, and they have different security
models:

| Class | Auth | Status |
|---|---|---|
| `RetellClient` | needs a **key in the browser**; calls `create-web-call` itself | current |
| `RetellWebClient` | takes a **server-minted `accessToken`** | **deprecated, removed in 4.0** |

We use `RetellWebClient`, because it is the only one that accepts a token
minted server-side and so keeps `RETELL_API_KEY` off the client. The published
docs show the `RetellClient` form with a *public* key — a different, also-valid
model, which would need a public key from the dashboard.

When 4.0 lands, either obtain a Retell public key and move to `RetellClient`,
or check whether a token-consuming path has returned to the supported API.

#### Transcript events

`client.on("update", …)` fires with the **entire transcript each time**, not a
delta. Replace state, don't append, or every line duplicates. The other events
worth binding: `call_started`, `call_ended`, `agent_start_talking`,
`agent_stop_talking`, `error`.

### Inbound phone  **[NOT BUILT]**

1. Buy a number from Retell, or import an existing Twilio/SIP number.
2. Bind the agent to that number for the inbound direction. **A number routes
   calls only once an agent is bound to it.**
3. Point the inbound call webhook at `/api/voice/init`.

Retell POSTs:

```jsonc
{ "event": "call_inbound",
  "call_inbound": { "call_id": "...", "agent_id": "...",
                    "from_number": "+1...", "to_number": "+1..." } }
```

and we answer with the caller's context:

```jsonc
{ "call_inbound": { "dynamic_variables": { "caller_name": "Sarah", ... } } }
```

Every field of that response is optional, so the webhook is an enhancement, not
a dependency — without it the agent still answers, just without knowing who is
calling. `override_agent_id` and `reject` are also available here.

**We run no media server and handle no audio.** That is the whole point of using
Retell.

---

## 5. Custom functions — how the booking tools attach  **[NOT BUILT]**

The six tools in SPEC §9 become Retell **custom functions**, configured on the
LLM object as `general_tools`. Retell calls our URL mid-conversation and reads
whatever comes back to the caller.

### What Retell sends us

```jsonc
{
  "name": "check_availability",
  "call": {
    "call_id": "call_abc",
    "retell_llm_dynamic_variables": { "today_date": "..." },
    "transcript": "…everything said so far…"
  },
  "args": { "date_preference": "next Tuesday" }
}
```

Our arguments are nested under **`args`**; `call` is context. Retell offers an
"args only" payload mode that flattens `args` to the top level and drops `call`
— **don't enable it.** We need `call.call_id` as the conversation key for slot
hold ownership and `book_appointment` idempotency.

### What we send back

Retell stringifies whatever we return — string, JSON, buffer — and hands it to
the model as text. So the `result` field must already be phrased for the ear:

> `"I have Tuesday the 23rd at 2 PM, Tuesday at 4:30, or Wednesday at 10."`

not `"3 slots available"` and never an ISO timestamp. Results are capped at
15,000 characters, which we are nowhere near.

### Configuration that matters

| Field | Set it to | Why |
|---|---|---|
| `url` | `{PUBLIC_BASE_URL}/api/voice/tools?tool=<name>` | One dispatch route, tool chosen by query param |
| custom headers | `X-Voice-Tool-Secret: <VOICE_TOOL_SECRET>` | Retell supports static or dynamic header values; this is how the route authenticates the caller |
| `speak_during_execution` | `true` | Otherwise the caller hears silence while we hit Google Calendar |
| timeout | ~10s | **Retell's default is 120,000 ms.** On a phone call that is an eternity; a hung dependency should end the turn, not the call |

Custom function URLs are absolute and stored on Retell's side, so **re-sync
after the tunnel URL changes.**

---

## 6. Dynamic variables  **[PARTIALLY BUILT]**

`{{variable_name}}` in the prompt, substituted per conversation. Values must all
be strings — `"42"`, `"true"`.

Where they come from depends on the channel:

| Channel | How |
|---|---|
| Inbound phone | `dynamic_variables` in the inbound-call webhook response |
| Web call | `retell_llm_dynamic_variables` at call creation |
| Chat | `retell_llm_dynamic_variables` on `create-chat` |
| Fallback | `default_dynamic_variables` on the LLM object |

Retell supplies built-ins free: `{{current_time}}`, `{{call_id}}`,
`{{direction}}`, `{{user_number}}`, and others.

**We still mint our own `{{today_date}}` in the business timezone.** The
built-in clock variables are not guaranteed to be in the zone the clinic books
in, and a date resolved in the wrong zone is exactly the bug that puts someone
on the wrong day. `src/lib/time.ts` exists for this.

The prompt today is written with the clinic details inlined at creation time
rather than as variables — fine for one clinic, wrong the moment there are two.
Converting it is Phase 3 work.

---

## 7. Webhooks and signature verification  **[NOT BUILT]**

Events: `call_started`, `call_ended`, `call_analyzed`, plus `transcript_updated`
and the transfer events. Chat has `chat_started` / `chat_ended` /
`chat_analyzed`.

Body is `{ event, call }`, where `call` is the full call object.

Configure the URL at **account level** in the dashboard (applies to every
agent), or per-agent via `webhook_url`, which takes precedence.

### Verification

```
Header:  x-retell-signature
```

**Retell signs with your API key**, not a separate webhook secret — one fewer
secret to manage, but it means the API key is also a verification key, so it
must never reach a browser. Their Node SDK exposes `Retell.verify(rawBody,
apiKey, signature)`.

Verify the **raw body string**. Re-serializing parsed JSON changes the bytes and
the signature will never match. In a Next.js route that means `await req.text()`
and parsing afterwards.

For booking, `call_analyzed` is the interesting one — it arrives after Retell
has produced the summary and analysis, so it's where the transcript gets
persisted and any unconsumed slot hold gets released.

---

## 8. Environment

| Variable | Needed for | Notes |
|---|---|---|
| `RETELL_API_KEY` | everything | Also verifies `x-retell-signature`. Server-only. |
| `RETELL_AGENT_ID` | chat | The **chat** agent. Printed by `pnpm create-agent` |
| `RETELL_VOICE_AGENT_ID` | voice | The **voice** agent, a separate object |
| `RETELL_BASE_URL` | — | Defaults to `https://api.retellai.com` |
| `VOICE_TOOL_SECRET` | custom functions | Shared secret Retell sends back on every tool call |
| `PUBLIC_BASE_URL` | custom functions, webhooks | Must be publicly reachable — a tunnel in dev, not localhost |

`src/lib/env.ts` is the only file that reads `process.env`, and it validates at
import time, so a missing key fails the boot rather than a live call.

---

## 9. Gotchas

- **Two objects, not one.** Prompt and tools live on the LLM; voice and webhook
  URL live on the Agent. Patch the wrong one and nothing changes.
- **Chat agents ≠ voice agents.** `/create-chat-agent` and `/create-agent` make
  different objects with different ids. Passing a voice `agent_id` to
  `/create-chat` is a mistake that only shows up at runtime. Share the `llm_id`,
  not the `agent_id`.
- **`/v3` only for web calls.** Everything else is flat off the base URL.
- **Model names are Retell's enum**, not the providers' ids — `claude-5-sonnet`,
  not `claude-sonnet-5`. Their list lags upstream releases.
- **The default function timeout is 120s.** Always override it.
- **Don't enable "args only"** on custom functions — it drops `call_id`.
- **Absolute URLs are stored server-side.** New tunnel means a re-sync.
- **Verify raw bytes**, not re-serialized JSON.
- **A number without a bound agent silently does nothing.**

---

## 10. What's next

| | |
|---|---|
| Phase 2 | Availability engine + booking transaction — the tools need something real to call |
| Phase 3 | `scripts/sync-agent.ts`, the six custom functions, `/api/voice/web-call`, the widget page |
| Phase 4 | Number bound to the agent, `/api/voice/init`, `/api/voice/post-call` with signature verification |

See [`SPEC.md`](./SPEC.md) §14 for the full roadmap and §9 for the tool
contracts these custom functions will implement.
