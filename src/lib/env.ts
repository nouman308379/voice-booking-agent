/**
 * The ONLY file in the codebase that reads `process.env`.
 *
 * Everything is validated at import time, so a missing secret fails the boot
 * rather than failing a live phone call. Server-side only — never import this
 * from a client component.
 */
import { z } from "zod"

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ── Business ──────────────────────────────────────────────────────────
  BUSINESS_NAME: z.string().min(1).default("Riverside Dental"),
  BUSINESS_TIMEZONE: z.string().min(1).default("America/Toronto"),

  // ── Secrets ───────────────────────────────────────────────────────────
  /** Signs slot_id tokens. */
  SLOT_ID_HMAC_SECRET: z.string().optional(),
  /** Shared secret the voice platform sends on every tool call. */
  VOICE_TOOL_SECRET: z.string().optional(),

  // ── Retell ────────────────────────────────────────────────────────────
  RETELL_API_KEY: z.string().optional(),
  /** Printed by `pnpm tsx scripts/create-agent.ts`. */
  RETELL_AGENT_ID: z.string().optional(),
  RETELL_BASE_URL: z.string().default("https://api.retellai.com"),

  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
})

function load() {
  const parsed = schema.safeParse(process.env)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  const e = parsed.data

  if (e.NODE_ENV === "production") {
    if (!e.SLOT_ID_HMAC_SECRET || e.SLOT_ID_HMAC_SECRET.length < 16) {
      throw new Error("SLOT_ID_HMAC_SECRET must be set (>=16 chars) in production")
    }
    if (!e.VOICE_TOOL_SECRET || e.VOICE_TOOL_SECRET.length < 16) {
      throw new Error("VOICE_TOOL_SECRET must be set (>=16 chars) in production")
    }
  }

  return e
}

export const env = load()

export type Env = typeof env
