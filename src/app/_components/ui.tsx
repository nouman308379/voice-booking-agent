/** Shared bits so the two panels look like one product. */
export function Bubble({
  role,
  text,
}: {
  role: "you" | "agent"
  text: string
}) {
  const mine = role === "you"
  return (
    <div className={mine ? "self-end" : "self-start"}>
      <span className="mb-1 block text-xs text-zinc-400">{role}</span>
      <p
        className={`max-w-md whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
          mine
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        {text}
      </p>
    </div>
  )
}

export function Transcript({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </div>
  )
}

export function ErrorBar({ message }: { message: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {message}
    </p>
  )
}
