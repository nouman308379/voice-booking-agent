/**
 * Create — or update — the booking agent on Retell.
 *
 *     pnpm create-agent
 *
 * With RETELL_LLM_ID set, this patches the existing Retell LLM in place, so a
 * prompt change keeps the same agent ids and .env needs no edits. Without it,
 * everything is created fresh and the ids are printed.
 */
import { env } from "@/lib/env"
import {
  RETELL_MODEL,
  RetellError,
  createChatAgent,
  createRetellLlm,
  createVoiceAgent,
  updateRetellLlm,
  type LlmConfig,
} from "@/services/retell/retell-client"

const BEGIN_MESSAGE = `Thanks for calling ${env.BUSINESS_NAME}. How can I help?`

const GENERAL_PROMPT = `You are the booking assistant for ${env.BUSINESS_NAME}, a dental clinic in the ${env.BUSINESS_TIMEZONE} timezone.

Your job is to take appointment requests over the phone. Find out what the caller needs, what day and time suits them, and their name.

Keep every turn to one or two sentences — this is a phone call, not a chat window. Be warm and get to the point.

You do not have access to the calendar yet, so never claim a specific time is free or confirm a booking as final. Collect what the caller wants and tell them the clinic will confirm shortly. When you say a date, say the day of the week and the date together, like "Tuesday the 23rd", so nobody turns up on the wrong day.`

const config: LlmConfig = {
  general_prompt: GENERAL_PROMPT,
  begin_message: BEGIN_MESSAGE,
  // No tools: the agent talks, it does not hang up or touch a calendar yet.
  general_tools: [],
}

async function main(): Promise<void> {
  if (!env.RETELL_API_KEY) {
    console.error("✗ RETELL_API_KEY is not set")
    process.exit(1)
  }

  // Update path — keeps existing agent ids valid.
  if (env.RETELL_LLM_ID) {
    await updateRetellLlm(env.RETELL_LLM_ID, config)
    console.log(`✓ updated llm  ${env.RETELL_LLM_ID}  (${RETELL_MODEL})`)
    console.log("  prompt pushed; agent ids unchanged.")
    return
  }

  const { llm_id } = await createRetellLlm(config)
  console.log(`✓ llm           ${llm_id}  (${RETELL_MODEL})`)

  // Two agent objects, one shared LLM — so the prompt is written once.
  const chat = await createChatAgent({
    llm_id,
    agent_name: `${env.BUSINESS_NAME} booking (chat)`,
  })
  console.log(`✓ chat agent    ${chat.agent_id}`)

  const voice = await createVoiceAgent({
    llm_id,
    agent_name: `${env.BUSINESS_NAME} booking (voice)`,
    voice_id: "retell-Cimo",
  })
  console.log(`✓ voice agent   ${voice.agent_id}`)

  console.log(
    `\nAdd to .env:\n\n` +
      `RETELL_AGENT_ID="${chat.agent_id}"\n` +
      `RETELL_VOICE_AGENT_ID="${voice.agent_id}"\n` +
      `RETELL_LLM_ID="${llm_id}"`,
  )
}

main().catch((e) => {
  console.error(e instanceof RetellError ? `\n✗ ${e.message}` : e)
  process.exit(1)
})
