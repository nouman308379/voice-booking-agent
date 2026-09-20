# Voice Booking Agent — Product Requirements

An AI voice agent that answers the phone, has a real conversation, and books the
appointment. Built first as a **client-facing demo**; designed so the same
codebase becomes the product.

- **Status:** draft
- **Last updated:** 2026-09-20
- **Technical spec:** [`SPEC.md`](./SPEC.md)

> This document covers *what* we're building and *why*.
> `SPEC.md` covers *how*. Where they disagree, this one wins on scope and
> `SPEC.md` wins on implementation.

---

## 1. Summary

A customer calls a business. Instead of a receptionist, an AI agent answers,
understands what they want in natural speech, checks the real calendar, offers
genuine openings, and books the appointment — start to finish, no human, under
two minutes.

The same agent is also embeddable on a website as a click-to-talk widget, so the
business captures bookings from people who'd never pick up the phone.

**The deliverable for v1 is a demo we can put in front of prospective clients**:
a live phone number they can call from the meeting room, and a dashboard showing
the appointment appear in real time.

---

## 2. Problem

### For the business

Appointment-driven businesses — clinics, dental offices, salons, law practices,
trades — lose bookings in predictable ways:

| Failure | What it costs |
|---|---|
| Phone rings while staff are with a customer | Caller hangs up and calls a competitor |
| After-hours and weekend calls | Entire windows with zero booking capacity |
| Voicemail | Most callers won't leave one; those who do need a callback that may not connect |
| Booking is the front desk's job | Every call is an interruption to in-person service |
| Peak-hour call clustering | Monday mornings have more calls than staff to answer them |

The revenue impact is not hypothetical, but it *is* business-specific. Rather
than quote industry averages, the sales conversation should run the client's own
numbers:

```
missed calls / week  ×  % who would have booked  ×  average appointment value
=  weekly revenue currently going to voicemail
```

Most owners have never calculated this and the number surprises them. That
calculation is the pitch.

### For the caller

Booking by phone is the slowest option available and only works during business
hours. Booking online is faster but many people won't hunt through a booking
form — especially older customers, people driving, and anyone who just wants to
ask "when's your next opening?"

### Why now, and why voice

Online booking forms already exist and haven't solved this — they solve for
people willing to use a form. Voice AI has only recently crossed the threshold
where a caller doesn't immediately recognise it as a machine and hang up:
sub-second response latency, natural interruption handling, and reliable
understanding of messy speech ("uh, next Tuesday, afternoon if you've got it").

The differentiator is not the voice. It's that the agent is **connected to the
real calendar** and the booking is really made. A voice bot that takes a message
is a worse voicemail.

---

## 3. Goals & Success Metrics

### Product goals

| # | Goal |
|---|---|
| G1 | A caller can book an appointment end to end without human involvement |
| G2 | The agent never offers a time that isn't genuinely available |
| G3 | Two simultaneous bookings can never claim the same slot |
| G4 | The business sees the appointment in the calendar they already use |
| G5 | Switching calendar systems is a configuration change, not a rebuild |
| G6 | Every call leaves a readable transcript and summary |

### Demo success criteria (v1)

The demo succeeds if, in a client meeting, we can:

1. Hand them a phone, have them call, and watch them book an appointment.
2. Show the appointment appear in a real Google Calendar within seconds.
3. Have a second person book from the website widget *at the same time* and show
   that they cannot both take the same slot.
4. Show the transcript of the call they just made.
5. Change one environment variable and demonstrate the calendar backend swapping
   — the proof it isn't locked to Google.

### Measurable targets

| Metric | Target | Why this number |
|---|---|---|
| **Booking completion rate** | ≥ 80% of calls with booking intent end in a confirmed appointment | The headline metric. Below this, a human answering is better. |
| **Containment rate** | ≥ 90% of calls handled with no human escalation | |
| **Response latency** | < 1.5s from end of caller speech to agent speech | Above ~2s callers start talking over the agent |
| **Availability accuracy** | 100% — zero offered slots that are actually taken | A single wrong offer destroys trust in a demo |
| **Double-bookings** | 0, under concurrent load | Enforced at the database level, not just in code |
| **Average handle time** | < 2 minutes for a straightforward booking | |
| **Calendar sync latency** | < 10 seconds from confirmation to visible event | |

Booking completion rate and containment are only measurable once real calls
happen (Phase 4+). Until then, latency, accuracy, and zero double-bookings are
the gates.

---

## 4. Non-Goals

Explicitly **not** in v1, with the reasoning:

| Not building | Why not now |
|---|---|
| User accounts / authentication | Nobody logs in to a demo. Adding auth adds surface area and zero demo value. |
| Multi-tenant (many businesses) | One business proves the concept. The data model is shaped so tenancy is an auth change later, not a migration. |
| SMS / email confirmations | Valuable, but it's plumbing — it doesn't change whether the core booking works. |
| Outbound calling | A different product shape (campaigns, consent, compliance). |
| Multiple staff, rooms, or resources | Multiplies availability complexity without proving anything new. |
| Multiple service types | Same reasoning. One fixed-length appointment type. |
| Payments and deposits | Out of scope for booking. |
| Clinical or legal advice | The agent books appointments. It does not advise. |
| Languages other than English | v1 is English. The platform supports more; it's a config change. |

Each of these has a return path in §11.

---

## 5. Users

### Primary: the caller

**Persona — "Sarah", returning customer.** Has been to the business before.
Wants a specific time, doesn't want to browse. Calls on the way home from work.

- Wants: the next convenient opening, confirmed, in under two minutes
- Hates: hold music, voicemail, being asked for information the business already has
- Success: hangs up knowing exactly when they're expected

**Persona — "Marcus", first-time caller.** Found the business online. Doesn't
know how it works, may ask questions before booking ("do you take walk-ins?",
"how long does it take?").

- Wants: a quick answer, then a booking
- Hates: a rigid phone tree, being forced down a script
- Success: gets their question answered *and* books in the same call

**Persona — "Dana", web visitor.** On the site at 11 PM. Would never call. Would
click a button that talks.

- Wants: zero-friction booking without filling in a form
- Success: books after hours, from the page they were already on

### Secondary: the business owner

**Persona — "Priya", practice owner.** Buys the product. Doesn't want to change
how their office works.

- Wants: more booked appointments, fewer front-desk interruptions, no new system to learn
- Fears: the AI embarrassing them in front of a customer; double-bookings; losing control
- Success: appointments appear in the calendar they already open every morning,
  and they can read exactly what the agent said to anyone

Priya's fear is the product's main design constraint. It's why §3/G2 and G3 are
hard requirements rather than quality targets, and why every call is
transcripted.

### Tertiary: front-desk staff

Not the buyer, but can kill adoption. The agent must reduce their workload and
never create cleanup work — no phantom bookings, no appointments they have to
verify by hand.

---

## 6. User Journeys

### J1 — Happy path: returning customer books by phone *(P0)*

```
Sarah dials the business number.

Agent   "Thanks for calling Riverside Dental, this is Alex. Is this Sarah?"
Sarah   "Yeah, hi. I need to come in next week sometime."
Agent   "Sure. Any day work better for you?"
Sarah   "Tuesday afternoon if you've got it."
Agent   "Let me check... I have Tuesday the 23rd at 2 PM, Tuesday at 4:30,
         or Wednesday at 10 AM."
Sarah   "2 o'clock is good."
Agent   "Great — Tuesday, September 23rd at 2 PM, 30 minutes, under Sarah Chen.
         Shall I lock that in?"
Sarah   "Yes please."
Agent   "You're all set. See you Tuesday."
```

**Why the agent recognises Sarah:** the caller's phone number is matched against
existing customers before the call connects, and their name is handed to the
agent as context. This is the single most impressive beat in a live demo.

**Why it reads back the full booking:** an explicit confirmation before writing
is a hard requirement, not a nicety. It's the caller's last chance to catch a
misheard day.

### J2 — First-time caller with a question first *(P0)*

Marcus asks "how long does a cleaning take?" before booking. The agent answers
from its configured knowledge — no tool call, no delay — then moves to booking.
A rigid booking-only flow would lose this caller.

### J3 — Preferred time unavailable *(P0)*

```
Marcus  "Do you have anything Monday morning?"
Agent   "Monday's fully booked, I'm afraid. My next opening is Tuesday
         at 11 AM — would that work?"
```

Never a dead end. An empty availability result is a conversational move: offer
the nearest alternative immediately. Never make the caller ask twice.

### J4 — Web widget booking *(P0)*

Dana clicks "Talk to book an appointment" on the site. Browser mic, same agent,
same calendar. Because there's no caller ID, the agent asks for a name and phone
number — the only difference from the phone flow.

### J5 — The race *(P0 — this is a demo centrepiece)*

Sarah (phone) and Dana (web) both go for Tuesday 2 PM within seconds of each
other. One gets it. The other hears:

> "Ah — that time just got taken. I have 2:30 or 4 PM instead."

No double-booking, no error message, no dropped call. The loser of the race has
a normal conversation and books a different slot.

### J6 — Reschedule *(P1)*

Caller is identified by phone number, their upcoming appointment is found, a new
time is booked, and only then is the old one released — so a failure mid-way
never leaves them with nothing.

### J7 — Cancel *(P1)*

Appointment is marked cancelled and removed from the calendar. The record is
retained, not deleted, so cancellations are visible in the dashboard.

### J8 — Out of scope request *(P1)*

Caller asks something the agent can't handle ("I think I chipped a tooth, is that
an emergency?"). The agent answers briefly if configured to, otherwise offers to
take a message rather than improvising. **The agent must never give clinical,
legal, or financial advice.**

### J9 — Misheard input *(P1)*

The agent mishears a phone number or date. It re-asks naturally — "I didn't catch
that number, can you give me the ten digits again?" — and retries. A validation
failure must never end a call.

---

## 7. Functional Requirements

Priority: **P0** = required for the demo · **P1** = required before a paying
client · **P2** = later.

### Conversation

| ID | Requirement | Pri |
|---|---|---|
| C1 | Answer inbound calls and greet by business name | P0 |
| C2 | Understand natural date/time speech — "next Tuesday", "tomorrow afternoon", "the 23rd", "in two weeks" | P0 |
| C3 | Recognise returning callers by phone number and greet by name | P0 |
| C4 | Offer **at most 3** options at a time | P0 |
| C5 | Read the full booking back and require explicit confirmation before writing | P0 |
| C6 | Re-ask naturally on misheard or invalid input; never end a call on a validation error | P0 |
| C7 | Always speak absolute dates — "Tuesday, September 23rd", never "next Tuesday" alone | P0 |
| C8 | Answer configured business questions (hours, location, duration) without a booking detour | P1 |
| C9 | Handle interruption / barge-in mid-sentence | P1 |
| C10 | Offer to take a message for anything out of scope | P1 |
| C11 | Refuse to give clinical, legal, or financial advice | P0 |

### Booking

| ID | Requirement | Pri |
|---|---|---|
| B1 | Offer only genuinely available times, checked live against the calendar | P0 |
| B2 | Hold a slot the moment the caller verbally accepts it | P0 |
| B3 | Guarantee no double-booking under concurrent load | P0 |
| B4 | Create the appointment in the business's calendar within 10 seconds | P0 |
| B5 | Respect business hours, buffers, minimum lead time, booking horizon, blackout dates | P0 |
| B6 | Look up a caller's existing appointment | P1 |
| B7 | Reschedule an existing appointment | P1 |
| B8 | Cancel an existing appointment | P1 |
| B9 | Confirm the booking even if the calendar write fails, and reconcile in the background | P1 |
| B10 | Respect events a human adds directly to the calendar | P1 |

### Channels

| ID | Requirement | Pri |
|---|---|---|
| H1 | Inbound phone via a real phone number | P0 |
| H2 | Click-to-talk web widget | P0 |
| H3 | Live transcript visible in the widget during the call | P1 |
| H4 | Outbound calling | P2 |
| H5 | SMS | P2 |

### Visibility

| ID | Requirement | Pri |
|---|---|---|
| V1 | Dashboard listing upcoming appointments with customer, time, and source | P0 |
| V2 | Store a full transcript and summary for every call | P0 |
| V3 | View the transcript for any appointment | P1 |
| V4 | Show calendar sync status per appointment | P1 |
| V5 | Booking-rate and containment analytics | P2 |

### Configuration

| ID | Requirement | Pri |
|---|---|---|
| F1 | Business hours per weekday, in one timezone | P0 |
| F2 | Appointment duration, buffers, lead time, horizon | P0 |
| F3 | Blackout dates | P1 |
| F4 | Agent prompt and voice managed in version control, not a dashboard | P0 |
| F5 | Calendar provider selectable by configuration | P0 |

---

## 8. Non-Functional Requirements

### Latency — the requirement most likely to sink the product

| Stage | Budget |
|---|---|
| End of caller speech → start of agent speech | **< 1.5s** |
| Availability lookup (tool call) | < 1.5s |
| Booking write (tool call) | < 2s |

A server call blocks the conversation — the caller hears silence. Where a wait is
unavoidable, the agent fills it naturally ("let me check the calendar…") rather
than going quiet.

### Correctness

Availability accuracy and zero double-bookings are **correctness requirements,
not quality targets**. A single double-booking in a demo ends the meeting.

### Reliability

- The booking survives a calendar outage: it's recorded first and synced after,
  so a caller is never told "yes" for an appointment that doesn't exist.
- Repeating the same booking request never creates two appointments.

### Privacy & data handling

- Calls are transcripted and stored. For a real deployment the business must
  disclose recording where their jurisdiction requires it — **a legal
  requirement on the client, and a Phase-4 gate before live customer calls.**
- Personal data stored: name, phone, optional email, appointment times,
  transcripts. Nothing else.
- Slot tokens and internal identifiers are never spoken aloud.
- No payment or health data is collected.

### Accessibility

The web widget must be usable by keyboard, show a live transcript for anyone who
can't rely on audio, and offer a visible fallback to a phone number.

---

## 9. Conversation Design Principles

These drive prompt design and are what separate a demo that lands from one that
feels like a phone tree.

1. **Never guess availability.** The agent has no knowledge of the calendar and
   must check. A confidently wrong offer is the worst possible failure.
2. **Three options, maximum.** More than three is unlistenable on a phone.
3. **Confirm before writing.** Name, day, date, time, read back, explicit yes.
4. **Short turns.** One or two sentences. This is a conversation, not a webpage.
5. **Absolute dates.** "Tuesday, September 23rd." Relative-only phrasing is how
   people show up on the wrong day.
6. **Never dead-end.** No availability → offer the nearest. Misheard → re-ask.
   Out of scope → take a message.
7. **Don't ask for what you already know.** Phone number is known on inbound.
8. **Sound like the business, not like software.** Named agent, business
   greeting, natural phrasing.
9. **Stay in scope.** Booking is the job. Advice is not.

---

## 10. Demo Script

The recommended sequence for a client meeting, ordered so each step answers the
objection raised by the previous one.

| # | Do | Answers the objection |
|---|---|---|
| 1 | Run their numbers: missed calls × booking rate × appointment value | "Is this actually a problem for me?" |
| 2 | Hand them your phone. Let *them* call and book. | "Will it work with a real person?" |
| 3 | Switch to the calendar. The appointment is already there. | "Does it really book, or just take a message?" |
| 4 | Book from the web widget while they watch | "What about people who won't call?" |
| 5 | Both of you go for the same slot at once | "What if two people call at the same time?" |
| 6 | Open the transcript of the call they just made | "How do I know what it told my customer?" |
| 7 | Call back from the same number — the agent greets them by name | "Will it feel impersonal?" |
| 8 | Change one config value; the calendar backend swaps | "Am I locked in? I don't use Google." |

Step 5 is the one that closes. Do it live, not in slides.

---

## 11. Release Plan

Mapped to the engineering phases in [`SPEC.md` §14](./SPEC.md).

| Release | Contains | Demoable milestone |
|---|---|---|
| **R0** Foundation | Data model, availability engine, calendar abstraction, test calendar | Tests pass with no external accounts |
| **R1** Calendar | Google Calendar connected | Real availability from a real calendar |
| **R2** Booking core | Holds, booking transaction, all booking operations | Full book → reschedule → cancel cycle |
| **R3** Voice on web | Agent configured, click-to-talk widget | **First end-to-end voice booking** |
| **R4** Phone | Phone number live, caller recognition, transcripts | **Callable demo number** |
| **R5** Polish | Dashboard, transcripts UI, deployment | Client-ready |

### After the demo, in likely priority order

1. **SMS confirmation and reminders** — the most-requested feature and the
   clearest reduction in no-shows
2. **Multiple staff and service types** — the most common disqualifier in sales
   conversations
3. **Multi-tenant + authentication** — required before a second paying client
4. **Additional calendar connectors** — Outlook, Cal.com, and practice-management
   systems; this is what the connector architecture was built for
5. **Outbound calling** — confirmations, waitlist fill, recalls
6. **Analytics** — booking rate, containment, handle time
7. **Additional languages**

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Agent offers a taken slot | Fatal to trust | Live availability check on every offer; re-validated again inside the booking transaction |
| Two callers take one slot | Fatal to trust | Slot holds, a serializable transaction, and a database constraint that makes overlap impossible regardless of application bugs |
| Response latency too high | Callers talk over the agent, quality collapses | Latency budgets per stage; cached availability lookups; natural filler speech during unavoidable waits |
| Agent mishears a date or phone number | Wrong booking, or a lost caller | Mandatory read-back before writing; structured re-ask on validation failure |
| Agent goes off-script or gives advice | Reputational and potentially legal | Explicit prompt restrictions; message-taking fallback; every call transcripted and reviewable |
| Calendar API outage | Bookings fail mid-call | Appointment is committed locally first and synced after; background reconciliation |
| Client doesn't use Google Calendar | Deal blocker | Connector architecture — swapping the backend is a new module, not a rewrite. Demonstrated live in step 8. |
| Caller wants a human | Frustration, lost booking | Message-taking fallback in v1; live transfer is a fast follow |
| Recording disclosure requirements | Legal exposure for the client | Flagged as a Phase-4 gate; disclosure is configurable in the greeting |
| Voice platform dependency | Vendor risk | The voice layer never touches business logic — all booking rules live in our code, so the platform is replaceable |

---

## 13. Open Questions

Decisions not needed to start, but needed before a real client:

1. **Escalation.** Does v2 transfer to a human mid-call, or only take messages?
2. **Recording disclosure.** Announced in the greeting, or handled by the
   client's own signage and policy?
3. **After-hours.** Does the agent answer 24/7 and book into business hours, or
   only during business hours? *(v1 assumption: answers 24/7, books only into
   configured hours.)*
4. **Unknown numbers.** If a caller's number doesn't match a customer, do we
   trust the number they speak, or the number they called from?
5. **No-show policy.** Does the agent mention one? Does it enforce anything?
6. **Cancellation window.** Can a caller cancel an appointment starting in 20
   minutes?
7. **Voice and persona.** Named agent or anonymous? Whose voice? This is more
   commercially significant than it sounds — clients have strong opinions.
8. **Pricing model.** Per minute, per booking, or flat monthly? Affects whether
   handle time is a cost or a non-issue.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **Slot** | A specific bookable start time of fixed duration |
| **Hold** | A short-lived reservation taken when a caller verbally accepts a time, before the booking is confirmed |
| **Connector** | The swappable module that talks to a calendar system |
| **Containment** | Share of calls handled with no human involvement |
| **Barge-in** | The caller interrupting the agent mid-sentence |
| **Handle time** | Total call duration from answer to hang-up |
