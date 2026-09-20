/**
 * Opaque, HMAC-signed slot tokens.
 *
 * `check_availability` is the only issuer. The agent receives a slot_id and
 * passes it back to `hold_slot` / `book_appointment` without ever seeing the
 * structured fields.
 *
 * Why a signed token and not a database row: slot_ids are minted after the
 * engine computes candidates but before the caller commits to anything. We
 * don't want a row per offered slot (dozens per availability check). The HMAC
 * makes the token unforgeable — an LLM cannot conjure a slot_id for a time the
 * engine never offered, and asked for one it will otherwise happily invent it.
 *
 * Ported from the same pattern in retell-ai-test/lib/slot-id.ts.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

import { SLOT_ID_PAST_GRACE_MS } from "@/lib/constants"
import { env } from "@/lib/env"

interface SlotPayload {
  /** start time, epoch ms */
  st: number
  /** end time, epoch ms */
  et: number
}

export interface DecodedSlot {
  startTime: Date
  endTime: Date
}

function getSecret(): string {
  const s = env.SLOT_ID_HMAC_SECRET
  if (!s || s.length < 16) {
    if (env.NODE_ENV === "production") {
      throw new Error("SLOT_ID_HMAC_SECRET must be set (>=16 chars) in production")
    }
    // Deterministic dev fallback so slot_ids stay valid across restarts.
    return "dev-only-slot-id-secret-do-not-use-in-prod"
  }
  return s
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)
  return Buffer.from(padded, "base64")
}

/** Returns `<payload>.<signature>`, both base64url. */
export function encodeSlotId(slot: { startTime: Date; endTime: Date }): string {
  const payload: SlotPayload = {
    st: slot.startTime.getTime(),
    et: slot.endTime.getTime(),
  }
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"))
  const sig = createHmac("sha256", getSecret()).update(payloadB64).digest()
  return `${payloadB64}.${b64urlEncode(sig)}`
}

/**
 * Verify and decode. Returns `null` — never throws — when the signature is
 * invalid, the format is wrong, end <= start, or the slot is already in the
 * past. Callers treat null as "that time is no longer available", which is a
 * conversational outcome rather than an error.
 *
 * Every rejection path logs a non-PII reason so a failed live booking is
 * diagnosable from the logs without redeploying. slot_ids contain only
 * timestamps, so logging the value itself is safe.
 */
export function decodeSlotId(slotId: unknown, now: Date = new Date()): DecodedSlot | null {
  if (typeof slotId !== "string" || !slotId.includes(".")) {
    console.warn(
      "[decodeSlotId] reject: not-string-or-no-dot",
      "typeof:", typeof slotId,
      "value:", typeof slotId === "string" ? slotId : "(non-string)",
    )
    return null
  }

  const [payloadB64, sigB64] = slotId.split(".")
  if (!payloadB64 || !sigB64) {
    console.warn(
      "[decodeSlotId] reject: empty-half-after-split",
      "payloadLen:", payloadB64?.length ?? 0,
      "sigLen:", sigB64?.length ?? 0,
    )
    return null
  }

  let expected: Buffer
  let provided: Buffer
  try {
    expected = createHmac("sha256", getSecret()).update(payloadB64).digest()
    provided = b64urlDecode(sigB64)
  } catch (e) {
    console.warn("[decodeSlotId] reject: crypto-threw", (e as Error).message?.slice(0, 100))
    return null
  }

  if (expected.length !== provided.length) {
    console.warn(
      "[decodeSlotId] reject: sig-length-mismatch",
      "expected:", expected.length, "got:", provided.length,
    )
    return null
  }
  if (!timingSafeEqual(expected, provided)) {
    console.warn(
      "[decodeSlotId] reject: sig-mismatch — encoding secret differs from runtime secret",
      "secret_len:", (env.SLOT_ID_HMAC_SECRET ?? "").length,
      "slot_id_first20:", slotId.slice(0, 20),
    )
    return null
  }

  let payload: SlotPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as SlotPayload
  } catch (e) {
    console.warn("[decodeSlotId] reject: payload-parse-failed", (e as Error).message?.slice(0, 100))
    return null
  }

  if (typeof payload.st !== "number" || typeof payload.et !== "number") {
    console.warn("[decodeSlotId] reject: payload-missing-fields", JSON.stringify(payload).slice(0, 100))
    return null
  }
  if (payload.et <= payload.st) {
    console.warn("[decodeSlotId] reject: et-lte-st", "st:", payload.st, "et:", payload.et)
    return null
  }
  // Guards against an agent replaying a slot_id from earlier in a long call.
  // A separate concern from forgery.
  if (payload.st < now.getTime() - SLOT_ID_PAST_GRACE_MS) {
    console.warn(
      "[decodeSlotId] reject: slot-in-past",
      "st:", new Date(payload.st).toISOString(),
      "now:", now.toISOString(),
    )
    return null
  }

  return {
    startTime: new Date(payload.st),
    endTime: new Date(payload.et),
  }
}
