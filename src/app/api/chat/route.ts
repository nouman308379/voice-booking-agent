/**
 * POST /api/chat — send a message, get the agent's reply.
 *
 *   curl -X POST localhost:3000/api/chat \
 *     -H 'content-type: application/json' \
 *     -d '{"message":"I want to book an appointment Tuesday"}'
 *
 * Omit `chatId` to start a new conversation; pass back the one you get to
 * continue it — Retell keeps the history server-side, so we hold no state.
 */
import { z } from "zod"

import { env } from "@/lib/env"
import {
  RetellError,
  createChat,
  createChatCompletion,
} from "@/services/retell/retell-client"

const bodySchema = z.object({
  message: z.string().min(1),
  chatId: z.string().optional(),
})

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json(
      { error: 'Body must be {"message": "...", "chatId"?: "..."}' },
      { status: 400 },
    )
  }

  const agentId = env.RETELL_AGENT_ID
  if (!agentId) {
    return Response.json(
      { error: "RETELL_AGENT_ID is not set — run: pnpm tsx scripts/create-agent.ts" },
      { status: 500 },
    )
  }

  try {
    const chatId = parsed.data.chatId ?? (await createChat(agentId)).chat_id
    const { messages } = await createChatCompletion(chatId, parsed.data.message)

    // Retell returns every message it generated this turn, tool calls
    // included. The spoken reply is the last one that actually has text.
    const reply = [...messages]
      .reverse()
      .find((m) => typeof m.content === "string" && m.content.trim())?.content

    return Response.json({ chatId, reply: reply ?? "" })
  } catch (e) {
    if (e instanceof RetellError) {
      console.error("[api/chat]", e.message)
      return Response.json({ error: "Agent unavailable" }, { status: 502 })
    }
    console.error("[api/chat] unexpected", e)
    return Response.json({ error: "Internal error" }, { status: 500 })
  }
}
