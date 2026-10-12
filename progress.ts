/** Monotonic N/M counter state for one shell, used to reject stray fractions. */
export interface CounterMemory {
  total: number
  done: number
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, "0")}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`
}

export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function clip(value: string, max: number): string {
  const text = oneLine(value)
  if (max <= 1) return text.slice(0, Math.max(0, max))
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * Best-effort percentage sniffed from a shell's output tail.
 *
 * A true percentage is only knowable when the command prints its own progress
 * cues, so this never invents one:
 * - an explicit `NN%` (pip, npm, curl, docker, …) wins immediately;
 * - an `N/M` counter is only trusted once it is seen *progressing* (same total,
 *   larger done), which rejects dates, paths, and other static fractions;
 * - otherwise the previous value sticks (or null when nothing was ever seen).
 */
export function sniffProgress(
  tail: string,
  memory: CounterMemory | undefined,
  previous: number | null,
): { value: number | null; memory: CounterMemory | undefined } {
  const clean = tail
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\r/g, "\n")
  const percents = [...clean.matchAll(/(\d{1,3})\s*%/g)]
  if (percents.length > 0) {
    return { value: Math.min(100, parseInt(percents[percents.length - 1][1], 10)), memory }
  }
  const counters = [...clean.matchAll(/(?<!\d)(\d+)\s*\/\s*(\d+)(?!\d)/g)]
  for (let i = counters.length - 1; i >= 0; i--) {
    const done = parseInt(counters[i][1], 10)
    const total = parseInt(counters[i][2], 10)
    if (total <= 0 || done > total) continue
    if (memory && memory.total === total && done > memory.done) {
      memory.done = done
      return { value: Math.min(100, Math.round((done / total) * 100)), memory }
    }
    return { value: previous, memory: { total, done } }
  }
  return { value: previous, memory }
}

/** Ten-cell block bar, e.g. `██████░░░░` for 60%. */
export function progressBar(percent: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)))
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`
}

/** One-line status for a shell: spinner, live `%` + bar when known, command. */
export function headlineText(spin: string, percent: number | null, command: string, max: number): string {
  const clipped = clip(command, max)
  return percent !== null ? `${spin} ${percent}% ${progressBar(percent)} ${clipped}` : `${spin} ${clipped}`
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
