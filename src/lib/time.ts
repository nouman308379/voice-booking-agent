/**
 * Timezone and speech formatting.
 *
 * Two rules this file exists to enforce:
 *   1. All wall-clock reasoning happens in the business's IANA zone, never in
 *      the server's local zone and never in a fixed UTC offset (which breaks
 *      across DST).
 *   2. No ISO string ever reaches the caller's ears. Everything spoken goes
 *      through `toSpoken*`.
 */
import { DateTime } from "luxon"

import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/constants"

/** "09:00" → { hour: 9, minute: 0 } */
export function parseWallClock(hhmm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) throw new Error(`Invalid wall-clock time: "${hhmm}" (expected "HH:mm")`)
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Wall-clock time out of range: "${hhmm}"`)
  }
  return { hour, minute }
}

/**
 * Build an absolute instant from a calendar date + wall-clock time in a zone.
 * This is the DST-correct way to say "9 AM on March 8th in Toronto".
 */
export function zonedDateTime(
  isoDate: string,
  hhmm: string,
  timeZone: string,
): Date {
  const { hour, minute } = parseWallClock(hhmm)
  const dt = DateTime.fromISO(isoDate, { zone: timeZone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  })
  if (!dt.isValid) {
    throw new Error(`Invalid date/zone: ${isoDate} ${hhmm} ${timeZone} — ${dt.invalidReason}`)
  }
  return dt.toJSDate()
}

/** "2026-09-23" for the given instant, in the business zone. */
export function isoDateInZone(instant: Date, timeZone: string): string {
  return DateTime.fromJSDate(instant, { zone: timeZone }).toISODate()!
}

/** Which weekday key an instant falls on, in the business zone. */
export function weekdayKeyInZone(instant: Date, timeZone: string): WeekdayKey {
  // Luxon weekday: 1 = Monday … 7 = Sunday. WEEKDAY_KEYS is Sunday-first.
  const luxonWeekday = DateTime.fromJSDate(instant, { zone: timeZone }).weekday
  return WEEKDAY_KEYS[luxonWeekday % 7]
}

/** Walk calendar dates from `from` to `to` inclusive, in the business zone. */
export function eachIsoDateInZone(from: Date, to: Date, timeZone: string): string[] {
  const start = DateTime.fromJSDate(from, { zone: timeZone }).startOf("day")
  const end = DateTime.fromJSDate(to, { zone: timeZone }).startOf("day")
  const out: string[] = []
  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    out.push(d.toISODate()!)
  }
  return out
}

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** "2 PM", "4:30 PM", "10 AM" — no ":00", because nobody says "two oh clock PM". */
export function toSpokenTime(instant: Date, timeZone: string): string {
  const dt = DateTime.fromJSDate(instant, { zone: timeZone })
  const meridiem = dt.hour < 12 ? "AM" : "PM"
  const hour12 = dt.hour % 12 === 0 ? 12 : dt.hour % 12
  return dt.minute === 0
    ? `${hour12} ${meridiem}`
    : `${hour12}:${String(dt.minute).padStart(2, "0")} ${meridiem}`
}

/**
 * "Tuesday the 23rd" — day of week AND date, because a relative-only phrase
 * is how people end up showing up on the wrong day (SPEC.md §10, hard rule 4).
 */
export function toSpokenDate(instant: Date, timeZone: string): string {
  const dt = DateTime.fromJSDate(instant, { zone: timeZone })
  return `${dt.toFormat("cccc")} the ${ordinal(dt.day)}`
}

/** "Tuesday, September 23rd" — used when the month is not obvious from context. */
export function toSpokenFullDate(instant: Date, timeZone: string): string {
  const dt = DateTime.fromJSDate(instant, { zone: timeZone })
  return `${dt.toFormat("cccc")}, ${dt.toFormat("LLLL")} ${ordinal(dt.day)}`
}

/** "Tuesday the 23rd at 2 PM" */
export function toSpokenDateTime(instant: Date, timeZone: string): string {
  return `${toSpokenDate(instant, timeZone)} at ${toSpokenTime(instant, timeZone)}`
}

/** "Tuesday, September 23rd at 2 PM" — for final booking confirmations. */
export function toSpokenFullDateTime(instant: Date, timeZone: string): string {
  return `${toSpokenFullDate(instant, timeZone)} at ${toSpokenTime(instant, timeZone)}`
}

/** "Saturday, September 20, 2026" — injected as the {{today_date}} variable. */
export function todayForAgent(now: Date, timeZone: string): string {
  return DateTime.fromJSDate(now, { zone: timeZone }).toFormat("cccc, LLLL d, yyyy")
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid
}
