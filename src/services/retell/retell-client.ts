/**
 * Minimal Retell AI client — the only file that knows their wire format.
 *
 * Auth is `Authorization: Bearer <key>`. Endpoints are flat POSTs off the
 * base URL (create-web-call is the exception, living under /v3).
 */
import { env } from "@/lib/env"

export class RetellError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "RetellError"
  }
}

/** One of Retell's supported models — their enum, not the provider's ids. */
export const RETELL_MODEL = "claude-5-sonnet"

export interface RetellMessage {
  role: string
  content?: string
}

async function retell<T>(
  path: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<T> {
  const apiKey = env.RETELL_API_KEY
  if (!apiKey) throw new RetellError("RETELL_API_KEY is not set")

  let res: Response
  try {
    res = await fetch(`${env.RETELL_BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })
  } catch (e) {
    throw new RetellError(`Retell ${path} unreachable: ${(e as Error).message}`)
  }

  const text = await res.text()
  if (!res.ok) {
    throw new RetellError(`Retell ${path} failed: ${res.status} ${text.slice(0, 300)}`, res.status)
  }
  return (text ? JSON.parse(text) : undefined) as T
}

// ── Agent setup (run once, by scripts/create-agent.ts) ────────────────────

/** Built-in Retell tools need no URL — the platform implements them. */
export type GeneralTool = { type: string; name: string; description: string }

export interface LlmConfig {
  general_prompt: string
  begin_message: string
  general_tools?: GeneralTool[]
  model?: string
}

export function createRetellLlm(input: LlmConfig): Promise<{ llm_id: string }> {
  return retell("/create-retell-llm", { model: RETELL_MODEL, ...input })
}

/** Patch an existing LLM so agent ids stay stable across prompt changes. */
export function updateRetellLlm(
  llmId: string,
  input: LlmConfig,
): Promise<{ llm_id: string }> {
  return retell(
    `/update-retell-llm/${llmId}`,
    { model: RETELL_MODEL, ...input },
    "PATCH",
  )
}

/**
 * Chat and voice are separate agent objects in Retell, each with its own
 * agent_id, but both can point at the same Retell LLM — so the prompt is
 * written once and shared.
 */
export function createChatAgent(input: {
  llm_id: string
  agent_name: string
}): Promise<{ agent_id: string }> {
  return retell("/create-chat-agent", {
    response_engine: { type: "retell-llm", llm_id: input.llm_id },
    agent_name: input.agent_name,
  })
}

/** Not used yet — the voice path is unbuilt. Same llm_id as the chat agent. */
export function createVoiceAgent(input: {
  llm_id: string
  agent_name: string
  voice_id: string
  language?: string
}): Promise<{ agent_id: string }> {
  return retell("/create-agent", {
    response_engine: { type: "retell-llm", llm_id: input.llm_id },
    agent_name: input.agent_name,
    voice_id: input.voice_id,
    language: input.language ?? "en-US",
  })
}

// ── Web call (voice in the browser) ───────────────────────────────────────

export interface WebCall {
  access_token: string
  call_id: string
  /**
   * "gateway" | "livekit". MUST be forwarded to the browser SDK: its default
   * is "livekit", so dropping this field makes it dial the wrong transport
   * and fail with a misleading "invalid API key".
   */
  transport?: string
  url?: string
  ice_servers?: unknown[]
  /** Unix ms. The token is short-lived by design. */
  expires_at?: number
}

/** Note the /v3 prefix — web-call creation is the one versioned endpoint. */
export function createWebCall(
  agentId: string,
  dynamicVariables?: Record<string, string>,
): Promise<WebCall> {
  return retell("/v3/create-web-call", {
    agent_id: agentId,
    ...(dynamicVariables
      ? { retell_llm_dynamic_variables: dynamicVariables }
      : {}),
  })
}

// ── Chat (what the API route uses) ────────────────────────────────────────

export function createChat(agentId: string): Promise<{ chat_id: string }> {
  return retell("/create-chat", { agent_id: agentId })
}

export function createChatCompletion(
  chatId: string,
  content: string,
): Promise<{ messages: RetellMessage[] }> {
  return retell("/create-chat-completion", { chat_id: chatId, content })
}
