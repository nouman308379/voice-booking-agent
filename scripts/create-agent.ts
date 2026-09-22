/**
 * Create the minimal booking agent on Retell. Run once:
 *
 *     pnpm tsx scripts/create-agent.ts
 *
 * Prints the agent id to put in .env as RETELL_AGENT_ID.
 */
import { env } from "@/lib/env"
import {
  RETELL_MODEL,
  RetellError,
  createChatAgent,
  createRetellLlm,
} from "@/services/retell/retell-client"

const BEGIN_MESSAGE = `Thanks for calling ${env.BUSINESS_NAME}. How can I help?`

const GENERAL_PROMPT = `You are the booking assistant for ${env.BUSINESS_NAME}, a dental clinic in the ${env.BUSINESS_TIMEZONE} timezone.

Your job is to take appointment requests over the phone. Find out what the caller needs, what day and time suits them, and their name.

Keep every turn to one or two sentences — this is a phone call, not a chat window. Be warm and get to the point.

You do not have access to the calendar yet, so never claim a specific time is free or confirm a booking as final. Collect what the caller wants and tell them the clinic will confirm shortly. When you say a date, say the day of the week and the date together, like "Tuesday the 23rd", so nobody turns up on the wrong day.`

async function main(): Promise<void> {
  if (!env.RETELL_API_KEY) {
    console.error("✗ RETELL_API_KEY is not set")
    process.exit(1)
  }

  const { llm_id } = await createRetellLlm({
    general_prompt: GENERAL_PROMPT,
    begin_message: BEGIN_MESSAGE,
  })
  console.log(`✓ llm    ${llm_id}  (${RETELL_MODEL})`)

  const { agent_id } = await createChatAgent({
    llm_id,
    agent_name: `${env.BUSINESS_NAME} booking agent`,
  })
  console.log(`✓ chat agent  ${agent_id}`)

  console.log(`\nAdd to .env:\n\nRETELL_AGENT_ID="${agent_id}"`)
}

main().catch((e) => {
  console.error(e instanceof RetellError ? `\n✗ ${e.message}` : e)
  process.exit(1)
})
