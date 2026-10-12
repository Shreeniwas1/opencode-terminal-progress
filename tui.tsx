import type { ShellInfo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createMemo, createSignal } from "solid-js"

/** Braille spinner frames, advanced by the shared clock signal. */
const SPINNER = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"]

/** Slot name used to select this plugin's session panel contribution. */
const PANEL = "terminal-progress.panel"

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, "0")}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function clip(value: string, max: number): string {
  const text = oneLine(value)
  if (max <= 1) return text.slice(0, Math.max(0, max))
  return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`
}

/** Monotonic N/M counter state for one shell, used to reject stray fractions. */
interface CounterMemory {
  total: number
  done: number
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
function sniffProgress(
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
function progressBar(percent: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)))
  return `${"\u2588".repeat(filled)}${"\u2591".repeat(10 - filled)}`
}

/** One-line status for a shell: spinner, live `%` + bar when known, command. */
function headlineText(spin: string, percent: number | null, command: string, max: number): string {
  const clipped = clip(command, max)
  return percent !== null ? `${spin} ${percent}% ${progressBar(percent)} ${clipped}` : `${spin} ${clipped}`
}

/**
 * Shows what the agent's terminals are doing, live, in the TUI.
 *
 * - A live section pinned to the sidebar while any terminal runs, with a
 *   percentage and bar per command when progress cues are detected.
 * - A detail panel (`/terminals`, the palette, or `terminal-progress.open`)
 *   listing each running command with elapsed time, pid, and working directory.
 *
 * When a command prints its own progress cues (`42%`, `12/200`, …), the sidebar
 * and the panel show a live percentage instead of just elapsed time. Anything
 * else keeps the elapsed-time display — a percentage is never guessed.
 *
 * Running shells are tracked from the server's event stream and reconciled
 * against `GET /api/shell` so the view recovers from missed events and from the
 * plugin loading while a command is already in flight.
 */
export default Plugin.define({
  id: "terminal-progress",
  setup(context) {
    const location = context.location ?? context.data.location.default()

    // Source of truth for the UI: shellID -> ShellInfo.
    const shells = new Map<string, ShellInfo>()
    // shellID -> sessionID, learned from `session.shell.started` events.
    const owners = new Map<string, string>()
    // Live percentage cues per shell: shellID -> percent (null = none seen).
    // Plain maps are fine here — the 500ms clock re-renders the UI anyway.
    const progress = new Map<string, number | null>()
    // Incremental output polling state per shell.
    const cursors = new Map<string, number>()
    const tails = new Map<string, string>()
    const counters = new Map<string, CounterMemory>()

    const [revision, setRevision] = createSignal(0)
    const [now, setNow] = createSignal(Date.now())
    const bump = () => setRevision((value) => value + 1)

    const track = (info: ShellInfo, sessionID?: string) => {
      shells.set(info.id, info)
      if (sessionID) owners.set(info.id, sessionID)
      bump()
    }

    const drop = (id: string) => {
      if (!shells.delete(id)) return
      owners.delete(id)
      progress.delete(id)
      cursors.delete(id)
      tails.delete(id)
      counters.delete(id)
      bump()
    }

    const refresh = async () => {
      try {
        await context.data.shell.sync(location)
      } catch {
        // A transient sync failure should not tear down the UI; events keep us current.
      }
      const list = context.data.shell.list(location)
      if (!list) return
      shells.clear()
      for (const info of list) {
        if (info.status !== "running") continue
        // Recover the session owner the same way live events do. Without this
        // the session-scoped footer stays empty after a (re)load or a missed
        // event, even though the panel (which is unfiltered) lists the shell.
        track(info, asString(info.metadata?.sessionID))
      }
      for (const id of owners.keys()) if (!shells.has(id)) owners.delete(id)
      bump()
    }

    const running = createMemo(() => {
      revision()
      return [...shells.values()]
        .filter((info) => info.status === "running")
        .sort((left, right) => left.time.started - right.time.started)
    })

    const runningFor = (sessionID?: string) => {
      const all = running()
      if (!sessionID) return all
      return all.filter((info) => owners.get(info.id) === sessionID)
    }

    const spinner = () => SPINNER[Math.floor(now() / 120) % SPINNER.length]

    // Instant updates from the event stream.
    const stops = [
      context.data.on("shell.created", (event) => {
        track(event.data.info, asString(event.data.info.metadata?.sessionID))
      }),
      context.data.on("shell.exited", (event) => drop(event.data.id)),
      context.data.on("shell.deleted", (event) => drop(event.data.id)),
      context.data.on("session.shell.started", (event) => {
        track(event.data.shell, event.data.sessionID)
      }),
      context.data.on("session.shell.ended", (event) => drop(event.data.shell.id)),
    ]

    // Shared clock: drives the spinner and the elapsed-time labels.
    const clock = setInterval(() => setNow(Date.now()), 500)
    // Reconcile with the server every few seconds to recover from missed events.
    const reconcile = setInterval(() => void refresh(), 5000)
    // Poll live output of running shells for percentage cues (`42%`, `12/200`).
    const poll = setInterval(() => void pollOutputs(), 1000)

    async function pollOutputs(): Promise<void> {
      const active = running()
      if (active.length === 0) return
      for (const info of active) {
        try {
          const response = await context.client.shell.output({
            id: info.id,
            location,
            cursor: cursors.get(info.id),
            limit: 4000,
          })
          cursors.set(info.id, response.data.cursor)
          const chunk = response.data.output
          if (!chunk) continue
          tails.set(info.id, `${tails.get(info.id) ?? ""}${chunk}`.slice(-2000))
          const found = sniffProgress(
            tails.get(info.id) ?? "",
            counters.get(info.id),
            progress.get(info.id) ?? null,
          )
          if (found.memory) counters.set(info.id, found.memory)
          else counters.delete(info.id)
          progress.set(info.id, found.value)
        } catch {
          // The shell may have exited between list and read; the event stream
          // and the reconciler drop it shortly.
        }
      }
    }

    void refresh()

    // Live progress section pinned to the side of the session view.
    // Visible while any terminal runs, or while our detail panel is open
    // (even with zero terminals) — closing the panel restores the default view.
    const stopSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (input) => {
        const items = () => runningFor(input.sessionID)
        const panelOpen = () => {
          const current = context.ui.panel.current()
          return current !== undefined && current.name === PANEL && current.sessionID === input.sessionID
        }
        return (
          <Show when={items().length > 0 || panelOpen()}>
            <box flexDirection="column">
              <text fg={context.theme.text.base}>
                {items().length > 0 ? `Running terminals (${items().length})` : "Running terminals"}
              </text>
              <Show when={items().length === 0}>
                <text fg={context.theme.text.muted}>No terminals are running.</text>
              </Show>
              <For each={items()}>
                {(info) => (
                  <box flexDirection="column">
                    <text fg={context.theme.text.feedback.info.base} truncate wrapMode="none">
                      {headlineText(spinner(), progress.get(info.id) ?? null, info.command, 24)}
                    </text>
                    <text fg={context.theme.text.muted} truncate wrapMode="none">
                      {`  ${formatElapsed(now() - info.time.started)} \u00b7 pid ${info.pid ?? "-"}`}
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        )
      },
    })

    // Full detail panel, opened from the palette or the `/terminals` slash command.
    // NOTE: this CLI build cannot register `bind` keys from plugins (setup
    // fails with "Keymap.Provider is missing"), so panel dismissal is left to
    // the host's native keys. The hint line below advertises Escape.
    const stopPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL}>
          <box flexDirection="column" gap={1} padding={1}>
            <text fg={context.theme.text.base}>{`Running terminals (${running().length})`}</text>
            <Show when={running().length === 0}>
              <text fg={context.theme.text.muted}>No terminals are running.</text>
            </Show>
            <For each={running()}>
              {(info) => (
                <box flexDirection="column">
                  <text fg={context.theme.text.feedback.info.base} truncate wrapMode="none">
                    {headlineText(spinner(), progress.get(info.id) ?? null, info.command, Math.max(12, panel.width - 6))}
                  </text>
                  <text fg={context.theme.text.muted} truncate wrapMode="none">
                    {`  ${formatElapsed(now() - info.time.started)} \u00b7 pid ${info.pid ?? "-"} \u00b7 ${clip(
                      info.cwd,
                      Math.max(12, panel.width - 6),
                    )}`}
                  </text>
                </box>
              )}
            </For>
            <text fg={context.theme.text.muted}>esc / ← back to typing</text>
          </box>
        </Show>
      ),
    })

    // Closes our panel and hands focus back to the prompt. Returns false so the
    // key behaves exactly as before whenever our panel is not open.
    const backToTyping = (): false | void => {
      if (context.ui.panel.current()?.name !== PANEL) return false
      context.ui.panel.close()
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "terminal-progress.open",
          title: "Terminal progress",
          description: "Show terminals currently running",
          group: "Terminal",
          palette: true,
          slash: { name: "terminals" },
          run: () => {
            context.ui.panel.open(PANEL)
          },
        },
        {
          id: "terminal-progress.back",
          title: "Back to typing",
          description: "Close the terminals panel and return to the prompt",
          bind: "escape",
          run: () => backToTyping(),
        },
        {
          id: "terminal-progress.left",
          title: "Back to typing",
          description: "Close the terminals panel and return to the prompt",
          bind: "left",
          run: () => backToTyping(),
        },
      ],
    }))

    // setup() does not run inside a Solid owner, so onCleanup would be a
    // silent no-op here. Return the cleanup instead: it runs when the plugin
    // unloads, which prevents duplicate sidebars, panels, and timers after a
    // hot reload.
    return () => {
      for (const stop of stops) stop()
      clearInterval(clock)
      clearInterval(reconcile)
      clearInterval(poll)
      stopSidebar()
      stopPanel()
    }
  },
})

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
