/**
 * POST /api/voice/web-call — mint a short-lived token for a browser voice call.
 *
 * The Retell API key never reaches the browser; only this token does, and it
 * carries its own expiry.
 */
import { env } from "@/lib/env"
import { RetellError, createWebCall } from "@/services/retell/retell-client"

export async function POST(): Promise<Response> {
  const agentId = env.RETELL_VOICE_AGENT_ID
  if (!agentId) {
    return Response.json(
      { error: "RETELL_VOICE_AGENT_ID is not set — run: pnpm create-agent" },
      { status: 500 },
    )
  }

  try {
    const call = await createWebCall(agentId)
    // transport/url/iceServers must be forwarded — the SDK defaults to
    // "livekit" and dialling the wrong transport fails with a misleading
    // "invalid API key". Keeping only the token silently breaks the call.
    return Response.json({
      accessToken: call.access_token,
      callId: call.call_id,
      transport: call.transport,
      url: call.url,
      iceServers: call.ice_servers,
      expiresAt: call.expires_at,
    })
  } catch (e) {
    if (e instanceof RetellError) {
      console.error("[api/voice/web-call]", e.message)
      return Response.json({ error: "Agent unavailable" }, { status: 502 })
    }
    console.error("[api/voice/web-call] unexpected", e)
    return Response.json({ error: "Internal error" }, { status: 500 })
  }
}
