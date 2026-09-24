"use client"

import { useEffect, useRef, useState } from "react"
import type { RetellWebClient } from "retell-client-js-sdk"

import { Bubble, ErrorBar, Transcript } from "./ui"

type Status = "idle" | "connecting" | "live" | "ended"

interface Line {
  role: "you" | "agent"
  text: string
}

export function VoicePanel() {
  const [status, setStatus] = useState<Status>("idle")
  const [lines, setLines] = useState<Line[]>([])
  const [agentTalking, setAgentTalking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [soundBlocked, setSoundBlocked] = useState(false)
  const clientRef = useRef<RetellWebClient | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [lines])

  // Hang up if the tab closes mid-call, so the call doesn't linger on Retell.
  useEffect(() => {
    return () => {
      clientRef.current?.stopCall()
    }
  }, [])

  /**
   * The agent's audio plays through an <audio> element and the SDK swallows
   * its own play() rejection. Browsers suspend playback unless play() runs in
   * a user gesture, so this can fail — the button below retries inside a real
   * click, which is what the autoplay policy wants.
   */
  async function resume(client: RetellWebClient) {
    try {
      await client.startAudioPlayback()
      setSoundBlocked(false)
    } catch {
      setSoundBlocked(true)
    }
  }

  async function start() {
    setError(null)
    setSoundBlocked(false)
    setLines([])
    setStatus("connecting")

    try {
      const res = await fetch("/api/voice/web-call", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`)
        setStatus("idle")
        return
      }

      // The modern RetellClient wants an API key in the browser. This
      // deprecated class is the only one that accepts a server-minted token,
      // which is why we use it — see RETELL.md.
      const { RetellWebClient } = await import("retell-client-js-sdk")
      const client = new RetellWebClient()
      clientRef.current = client

      client.on("call_started", () => setStatus("live"))
      client.on("call_ready", () => {
        void resume(client)
      })
      client.on("call_ended", () => {
        setStatus("ended")
        setAgentTalking(false)
      })
      client.on("agent_start_talking", () => setAgentTalking(true))
      client.on("agent_stop_talking", () => setAgentTalking(false))

      // Retell re-sends the whole transcript on every update, so replace
      // rather than append — appending duplicates every line.
      client.on(
        "update",
        (update: { transcript?: { role: string; content: string }[] }) => {
          if (!update.transcript) return
          setLines(
            update.transcript.map((u) => ({
              role: u.role === "agent" ? "agent" : "you",
              text: u.content,
            })),
          )
        },
      )

      client.on("error", (e: unknown) => {
        setError(e instanceof Error ? e.message : "Call error")
        client.stopCall()
        setStatus("ended")
      })

      await client.startCall({
        accessToken: data.accessToken,
        callId: data.callId,
        // Retell answers "gateway"; without this the SDK defaults to livekit
        // and fails with "invalid API key".
        transport: data.transport,
        url: data.url,
        iceServers: data.iceServers,
      })

      void resume(client)
    } catch (e) {
      // Almost always a denied microphone permission.
      setError(e instanceof Error ? e.message : "Could not start the call.")
      setStatus("idle")
    }
  }

  function stop() {
    clientRef.current?.stopCall()
    setStatus("ended")
  }

  async function enableSound() {
    const client = clientRef.current
    if (client) await resume(client)
  }

  const live = status === "live" || status === "connecting"

  return (
    <>
      <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            status === "live"
              ? agentTalking
                ? "animate-pulse bg-emerald-500"
                : "bg-emerald-500"
              : status === "connecting"
                ? "animate-pulse bg-amber-500"
                : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        />
        {status === "idle" && "Not connected"}
        {status === "connecting" && "Connecting…"}
        {status === "live" && (agentTalking ? "Agent is speaking" : "Listening")}
        {status === "ended" && "Call ended"}
      </p>

      <Transcript>
        {lines.length === 0 && (
          <p className="m-auto max-w-xs text-center text-sm text-zinc-400">
            {status === "idle"
              ? "Press Start call and talk. The transcript appears here as you speak."
              : status === "connecting"
                ? "Waiting for the agent…"
                : "No speech yet."}
          </p>
        )}
        {lines.map((line, i) => (
          <Bubble key={i} role={line.role} text={line.text} />
        ))}
        <div ref={endRef} />
      </Transcript>

      {soundBlocked && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <span className="text-xs text-amber-800 dark:text-amber-300">
            The browser blocked audio playback.
          </span>
          <button
            onClick={enableSound}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
          >
            🔊 Enable sound
          </button>
        </div>
      )}

      {error && <ErrorBar message={error} />}

      <div className="flex gap-2">
        {!live ? (
          <button
            onClick={start}
            className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {status === "ended" ? "Start new call" : "Start call"}
          </button>
        ) : (
          <button
            onClick={stop}
            className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            End call
          </button>
        )}
      </div>
    </>
  )
}
