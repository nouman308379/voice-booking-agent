/**
 * Phone normalization to E.164.
 *
 * Deliberately narrow: North American numbers, which is what the demo needs.
 * Swap in libphonenumber-js when the first non-NANP client appears.
 */
export function normalizePhone(raw: string): string | null {
  if (typeof raw !== "string") return null

  // Speech-to-text often renders a number as words-turned-digits with stray
  // punctuation: "(416) 555-1234", "416.555.1234", "+1 416 555 1234".
  const digits = raw.replace(/[^\d+]/g, "")

  if (digits.startsWith("+")) {
    return /^\+\d{8,15}$/.test(digits) ? digits : null
  }
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`

  return null
}

/** "+14165551234" → "416-555-1234", for the dashboard. Never spoken. */
export function formatPhoneForDisplay(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : e164
}
