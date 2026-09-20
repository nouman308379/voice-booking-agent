/** Enum-like strings live here, never inline. */

/** How long a verbally-accepted slot is reserved before the hold expires. */
export const SLOT_HOLD_TTL_MINUTES = 5

/** Never offer more than this many options at once — more is unlistenable. */
export const MAX_SLOTS_OFFERED = 3

/** Clock-skew grace when rejecting slot_ids that point into the past. */
export const SLOT_ID_PAST_GRACE_MS = 60_000

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

export const TOOL_NAMES = [
  "check_availability",
  "hold_slot",
  "book_appointment",
  "lookup_appointment",
  "reschedule_appointment",
  "cancel_appointment",
] as const
export type ToolName = (typeof TOOL_NAMES)[number]
