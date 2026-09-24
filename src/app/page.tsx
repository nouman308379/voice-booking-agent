"use client"

import { useEffect, useRef, useState } from "react"

interface Turn {
  role: "you" | "agent"
  text: string
}

export default function Home() {
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
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-zinc-950">
      <main className="flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8 sm:py-12">
        <header>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Booking agent
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {chatId ? `chat ${chatId.slice(0, 16)}…` : "Not started yet"}
          </p>
        </header>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {turns.length === 0 && !pending && (
            <p className="m-auto text-sm text-zinc-400">
              Say something to start the conversation.
            </p>
          )}

          {turns.map((turn, i) => (
            <div
              key={i}
              className={turn.role === "you" ? "self-end" : "self-start"}
            >
              <span className="mb-1 block text-xs text-zinc-400">
                {turn.role}
              </span>
              <p
                className={`max-w-md whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  turn.role === "you"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {turn.text}
              </p>
            </div>
          ))}

          {pending && (
            <p className="self-start text-sm text-zinc-400">agent is typing…</p>
          )}
          <div ref={endRef} />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

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
      </main>
    </div>
  )
}
