// Pure progress-detection helpers for the terminal-progress plugin.
//
// sniffProgress() reads a shell's output tail and returns a live percentage
// only when the command prints its own progress cues — a percentage is never
// guessed. Detectors run in priority order:
//
// 1. explicit percent, decimals allowed ("42%", "42.1%", "12.5 %") — pip, npm
//    bars, pytest "[ 40%]", phpunit "( 12%)", apt, brew, pacman, yt-dlp, …
// 2. TAP plan + sequence ("1..200" plus "ok 12"/"not ok 12" lines) — prove,
//    node-tap, and other Test-Anything-Protocol producers.
// 3. byte counters with units ("25.6MB/101.2MB", "18.2/18.2 MB",
//    "12.345 MBytes / 100.000 MBytes") — docker pull, pip, maven, aws, rclone.
// 4. labeled integer counters, trusted on first sight ("Step 4/8", "[12/200]",
//    "12 of 200", "12/200 Test #12", "Jobs: 12/235", rsync "to-check=10/200").
// 5. bare integer fractions ("12/200") — trusted once seen progressing with a
//    stable total, which rejects dates, paths, and other static fractions.
// 6. media transcode ratio (ffmpeg "Duration: HH:MM:SS" + growing "time=…").
//
// "deflated 42%"-style compression ratios are stripped first: they describe a
// file, not progress (e.g. `unzip -l` listings).

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

/** A ratio is usable only when both numbers are sane and ordered. */
function validRatio(done: number, total: number): boolean {
  return Number.isFinite(done) && Number.isFinite(total) && total > 0 && done >= 0 && done <= total
}

function ratioToPercent(done: number, total: number): number {
  return Math.min(100, Math.round((done / total) * 100))
}

/** Parse a possibly thousand-separated number ("1,234", "25.6"). */
function parseCount(raw: string): number {
  return parseFloat(raw.replace(/,/g, ""))
}

const SIZE_UNIT = String.raw`[KMGT]?(?:i)?[Bb](?:ytes?)?`

/** Normalize a size unit (B, KB/MB/GB/TB, KiB/MiB/GiB/TiB, "MBytes", …) to bytes. */
function unitToBytes(unit: string): number {
  const short = unit.toLowerCase().replace(/ytes$/, "").replace(/b$/, "")
  switch (short) {
    case "":
      return 1
    case "k":
    case "ki":
      return 1024
    case "m":
    case "mi":
      return 1024 ** 2
    case "g":
    case "gi":
      return 1024 ** 3
    case "t":
    case "ti":
      return 1024 ** 4
    default:
      return NaN
  }
}

/** Last integer N/M match of a global regex, or undefined. */
function lastIntPair(
  clean: string,
  pattern: RegExp,
): { done: number; total: number } | undefined {
  let found: { done: number; total: number } | undefined
  for (const match of clean.matchAll(pattern)) {
    found = { done: parseInt(match[1], 10), total: parseInt(match[2], 10) }
  }
  return found
}

/**
 * TAP result: total from the "1..N" plan line, done from the highest numbered
 * "ok K"/"not ok K" result line. Needs at least one result line, so stray
 * ranges (PowerShell "1..100 | ForEach-Object") never produce a percentage.
 */
function sniffTap(clean: string): { done: number; total: number } | undefined {
  const plan = clean.match(/(?:^|\n)1\.\.(\d+)(?=[ \t]*(?:\n|$))/)
  if (!plan) return undefined
  const total = parseInt(plan[1], 10)
  if (!(total > 0)) return undefined
  let done = 0
  for (const match of clean.matchAll(/^(?:not\s+)?ok\s+(\d+)\b/gm)) {
    done = Math.max(done, parseInt(match[1], 10))
  }
  if (done < 1 || !validRatio(done, total)) return undefined
  return { done, total }
}

/**
 * Byte counters ("25.6MB/101.2MB", "18.2/18.2 MB", "12.345 MBytes /
 * 100.000 MBytes"). Units are normalized, so cross-unit pairs (kB vs GB)
 * compare correctly. An optional trailing "/s" (rate context) is allowed.
 */
function sniffBytes(clean: string): { done: number; total: number } | undefined {
  const both = new RegExp(
    String.raw`(\d[\d,]*(?:\.\d+)?)[ \t]*(SIZE)[ \t]*\/[ \t]*(\d[\d,]*(?:\.\d+)?)[ \t]*(SIZE)(?:\/s)?(?![A-Za-z/])`.replaceAll(
      "SIZE",
      SIZE_UNIT,
    ),
    "gi",
  )
  let found: { done: number; total: number } | undefined
  for (const match of clean.matchAll(both)) {
    const scale = unitToBytes(match[2])
    const total = parseCount(match[3]) * unitToBytes(match[4])
    const done = parseCount(match[1]) * scale
    if (validRatio(done, total)) found = { done, total }
  }
  if (found) return found
  const shared = new RegExp(
    String.raw`(\d[\d,]*(?:\.\d+)?)[ \t]*\/[ \t]*(\d[\d,]*(?:\.\d+)?)[ \t]*(SIZE)(?:\/s)?(?![A-Za-z/])`.replaceAll(
      "SIZE",
      SIZE_UNIT,
    ),
    "gi",
  )
  for (const match of clean.matchAll(shared)) {
    const scale = unitToBytes(match[3])
    const total = parseCount(match[2]) * scale
    const done = parseCount(match[1]) * scale
    if (validRatio(done, total)) found = { done, total }
  }
  return found
}

/**
 * Labeled integer counters, trusted on first sight because the label makes
 * the meaning unambiguous: docker "Step 4/8", yarn/ninja/waf/bazel/buildx
 * "[12/200]", cabal "[12 of 200]", cypress "(1 of 3)", ctest "12/200 Test",
 * buck2 "Jobs: 12/235", rsync "to-check=10/200" (remaining counts down, so
 * the ratio is inverted).
 */
function sniffLabeled(clean: string): { done: number; total: number } | undefined {
  const step = lastIntPair(clean, /step[ \t]+(\d+)[ \t]*(?:of|\/)[ \t]*(\d+)/gi)
  if (step && validRatio(step.done, step.total)) return step
  const bracket = lastIntPair(clean, /\[(\d+)[ \t]*\/[ \t]*(\d+)\]/g)
  if (bracket && validRatio(bracket.done, bracket.total)) return bracket
  const of = lastIntPair(clean, /(\d+)[ \t]+of[ \t]+(\d+)/gi)
  if (of && validRatio(of.done, of.total)) return of
  const kind = lastIntPair(
    clean,
    /(\d+)[ \t]*\/[ \t]*(\d+)[ \t]+(?:tests?|files?|steps?|packages?|modules?|shards?|suites?|targets?|actions?|objects?|deltas?)\b/gi,
  )
  if (kind && validRatio(kind.done, kind.total)) return kind
  const jobs = lastIntPair(clean, /jobs?[ \t]*:[ \t]*(\d+)[ \t]*\/[ \t]*(\d+)/gi)
  if (jobs && validRatio(jobs.done, jobs.total)) return jobs
  const toCheck = lastIntPair(clean, /to-check=(\d+)[ \t]*\/[ \t]*(\d+)/gi)
  if (toCheck && validRatio(toCheck.done, toCheck.total)) {
    return { done: toCheck.total - toCheck.done, total: toCheck.total }
  }
  return undefined
}

/** Media transcode ratio from ffmpeg-style "Duration:" + growing "time=" stamps. */
function sniffMedia(clean: string): { done: number; total: number } | undefined {
  const duration = clean.match(/duration:\s*(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)/i)
  if (!duration) return undefined
  const total = +duration[1] * 3600 + +duration[2] * 60 + parseFloat(duration[3])
  if (!(total > 0)) return undefined
  const times = [...clean.matchAll(/time=(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)/gi)]
  if (times.length === 0) return undefined
  const last = times[times.length - 1]
  const done = +last[1] * 3600 + +last[2] * 60 + parseFloat(last[3])
  if (!validRatio(done, total)) return undefined
  return { done, total }
}

/**
 * Best-effort percentage sniffed from a shell's output tail.
 *
 * A true percentage is only knowable when the command prints its own progress
 * cues, so this never invents one: every value traces to numbers the tool
 * printed together (a percent, a labeled or byte fraction, a TAP plan plus
 * result sequence, or ffmpeg Duration/time stamps). Anything else keeps the
 * previous value (or null when nothing was ever seen).
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
  // Compression ratios describe a file, not progress (`zip` "deflated 42%"
  // notes, `unzip -l`-style "42% deflated" columns).
  const work = clean
    .replace(/deflated?\s+\d+(?:\.\d+)?\s*%/gi, "")
    .replace(/\d+(?:\.\d+)?\s*%\s*deflated?/gi, "")
  const percents = [...work.matchAll(/(\d{1,3}(?:\.\d+)?)[ \t]*%/g)]
  if (percents.length > 0) {
    const raw = parseFloat(percents[percents.length - 1][1])
    return { value: Math.min(100, Math.round(raw)), memory }
  }
  const tap = sniffTap(work)
  if (tap) {
    return { value: ratioToPercent(tap.done, tap.total), memory: { ...tap } }
  }
  const bytes = sniffBytes(work)
  if (bytes) {
    const seen = { total: Math.round(bytes.total), done: Math.round(bytes.done) }
    return { value: ratioToPercent(bytes.done, bytes.total), memory: seen }
  }
  const labeled = sniffLabeled(work)
  if (labeled) {
    return { value: ratioToPercent(labeled.done, labeled.total), memory: { ...labeled } }
  }
  const counters = [...work.matchAll(/(?<!\d)(\d+)[ \t]*\/[ \t]*(\d+)(?!\d)/g)]
  for (let i = counters.length - 1; i >= 0; i--) {
    const done = parseInt(counters[i][1], 10)
    const total = parseInt(counters[i][2], 10)
    if (!validRatio(done, total)) continue
    if (memory && memory.total === total && done > memory.done) {
      memory.done = done
      return { value: Math.min(100, Math.round((done / total) * 100)), memory }
    }
    return { value: previous, memory: { total, done } }
  }
  const media = sniffMedia(work)
  if (media) {
    return { value: ratioToPercent(media.done, media.total), memory: { ...media } }
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
