"use client"

import { useEffect, useRef, useState } from "react"

import { Bubble, ErrorBar, Transcript } from "./ui"

interface Turn {
  role: "you" | "agent"
  text: string
}

export function ChatPanel() {
  const [input, setInput] = useState("")
  const [turns, setTurns] = useState<Turn[]>([])
  const [chatId, setChatId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [turns, pending])

  async function send() {
    const message = input.trim()
    if (!message || pending) return

    setInput("")
    setError(null)
    setTurns((t) => [...t, { role: "you", text: message }])
    setPending(true)

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // chatId is omitted on the first turn; the server starts a chat and
        // returns one, and Retell keeps the history against it from then on.
        body: JSON.stringify(chatId ? { message, chatId } : { message }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`)
        return
      }

      setChatId(data.chatId)
      setTurns((t) => [...t, { role: "agent", text: data.reply || "…" }])
    } catch {
      setError("Could not reach the server.")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {chatId ? `chat ${chatId.slice(0, 16)}…` : "Not started yet"}
      </p>

      <Transcript>
        {turns.length === 0 && !pending && (
          <p className="m-auto text-sm text-zinc-400">
            Say something to start the conversation.
          </p>
        )}
        {turns.map((turn, i) => (
          <Bubble key={i} role={turn.role} text={turn.text} />
        ))}
        {pending && (
          <p className="self-start text-sm text-zinc-400">agent is typing…</p>
        )}
        <div ref={endRef} />
      </Transcript>

      {error && <ErrorBar message={error} />}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send()
          }}
          placeholder="I'd like to book an appointment…"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          onClick={send}
          disabled={pending || !input.trim()}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </>
  )
}
