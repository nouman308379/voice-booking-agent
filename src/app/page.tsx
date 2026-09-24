"use client"

import { useState } from "react"

import { ChatPanel } from "./_components/chat-panel"
import { VoicePanel } from "./_components/voice-panel"

type Mode = "chat" | "voice"

export default function Home() {
  const [mode, setMode] = useState<Mode | null>(null)

  if (mode === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 font-sans dark:bg-zinc-950">
        <main className="flex w-full max-w-md flex-col items-center gap-8">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Booking agent
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Book an appointment by typing or talking.
            </p>
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-2">
            <button
              onClick={() => setMode("chat")}
              className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white px-6 py-8 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <span className="text-2xl">💬</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                Chat
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Type your messages
              </span>
            </button>

            <button
              onClick={() => setMode("voice")}
              className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white px-6 py-8 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <span className="text-2xl">🎙️</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                Voice
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Talk out loud
              </span>
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-zinc-950">
      <main className="flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8 sm:py-12">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {mode === "chat" ? "Chat" : "Voice"}
          </h1>
          {/* Remounts the panel, so switching modes ends whatever was running. */}
          <button
            onClick={() => setMode(null)}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            ← Back
          </button>
        </header>

        {mode === "chat" ? <ChatPanel /> : <VoicePanel />}
      </main>
    </div>
  )
}
