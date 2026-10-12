# opencode-terminal-progress

Live terminal progress for the [OpenCode](https://opencode.ai) TUI — real
percentages, not just a spinner.

While a shell command runs, the plugin shows what it's doing:

- **Sidebar section** — a `Running terminals` block with a live percentage and
  bar per command, plus elapsed time and pid:
  ```
  Running terminals (1)
  ⠋ 42% ████░░░░░░ 1..100 | ForEach-Obj…
    12s · pid 14440
  ```
- **Detail panel** — the same per command with working directory. Open it with
  the `/terminals` slash command, the command palette (`Terminal progress`),
  or by dispatching `terminal-progress.open`. Dismiss it with `Escape` or `←`,
  which close the panel and return focus to the prompt (both are inert while
  the panel is closed).

## How the percentage works

A true percentage needs a known total, which only the command itself knows.
The plugin polls each running shell's live output and reads the progress cues
the command already prints — every value traces to numbers the tool printed
together, so a percentage is never guessed:

| Cue | Example | Who prints it |
| --- | --- | --- |
| Explicit `%` (decimals ok) | `42%`, `42.1%`, `[ 40%]`, `( 12%)` | pip, pytest, phpunit, apt, brew, pacman, yt-dlp, curl bars, composer, cmake |
| Byte fractions (units normalize, even `kB` vs `GB`) | `25.6MB/101.2MB`, `18.2/18.2 MB` | docker pull, pip, maven, aws, rclone, gcloud, pacman |
| Labeled counters (trusted immediately) | `Step 4/8`, `[12/200]`, `12 of 200`, `12/200 Test #12`, `Jobs: 12/235` | docker build, yarn, ninja, waf, bazel, buildx, cabal, cypress, ctest, buck2 |
| Inverted remaining | `to-check=10/200` (10 remain → 95%) | rsync `--info=progress2` |
| TAP plan + results | `1..200` plus `ok 12` lines | prove, node-tap, TAP producers |
| Duration + timestamp | `Duration: 00:01:00` plus `time=00:00:42` | ffmpeg |
| Bare `12/200` fractions | shown once seen *progressing* with a stable total | test runners, scripts, kubectl `1/2` |

Rejected on purpose: `deflated 42%` compression ratios (describe a file, not
a task), dates/paths/static fractions, and tools that never print a
co-located total — pnpm's aggregated counts, cargo/playwright's declared
total plus countable lines, jest/vitest/mocha summaries, npm/uv/poetry,
`make`, `go build`. Those keep the spinner + elapsed-time display instead.

Anything else keeps the spinner + elapsed-time display. A percentage is never
guessed.

## How this differs from the default terminal view

By default, OpenCode shows running shells inline in the session transcript as
`bash` tool parts (`!cmd` output arrives as a tool result, details toggled with
`/details`). There is no dedicated terminal list: the built-in slash list has
no `/terminals` command, and a tool entry shows command text plus output when
done — no pid, cwd, elapsed timer, or percentage while it runs. Interruption is
via `escape`, completion awareness via optional `attention` notifications
(see [TUI](https://opencode.ai/docs/tui/) and
[bash tool](https://opencode.ai/docs/tools/#bash) docs).

This plugin adds a persistent, glanceable layer on top of that:

| Default | This plugin |
| --- | --- |
| Buried in transcript, scroll to find | Always-visible `Running terminals (N)` sidebar section while anything runs |
| Spinner / output only | Live `42% ████░░░░░░` + bar when the command prints its own cues (`42%`, progressing `12/200`) |
| No pid / cwd / elapsed while running | Per-command elapsed time + pid in sidebar, plus cwd in `/terminals` detail panel |
| No terminal command | `/terminals` slash command + `Terminal progress` palette entry (`terminal-progress.open`) |

Why use it: for long builds, test suites, migrations, or `docker`/`npm`/`pip`
runs, you get at-a-glance progress without scrolling the transcript or toggling
details. For short foreground commands the default inline view is fine — install
this when percent, pid/cwd, and an always-visible status matter.

## Install

Requires OpenCode 2.x.

```sh
opencode plugin add github:Shreeniwas1/opencode-terminal-progress
```

Or clone it into the global plugin directory:

```sh
git clone https://github.com/Shreeniwas1/opencode-terminal-progress.git \
  ~/.config/opencode/plugins/terminal-progress
```

Or per project, under `<project>/.opencode/plugins/terminal-progress/`.

Restart the TUI (or the OpenCode service) after adding it.

## Notes

- The sidebar section needs the sidebar visible (`session.sidebar.toggle`,
  `ctrl+x b` by default).
- The sidebar follows the detail panel: opening `/terminals` shows the section
  even with zero terminals running; closing the panel restores the default view.
- Output is polled once per second per running shell (last ~4KB), so overhead
  is negligible.

## Tests

Pure helpers live in `progress.ts` so they can be unit-tested without the TUI
runtime. Runs on stock Node, no dependencies to install:

```sh
npm test   # node --test progress.test.ts
```

Covers `sniffProgress` (explicit `%`, progressing `N/M`, ANSI/`\r` handling,
date/path rejection, percent-over-counter priority), `progressBar`,
`formatElapsed`, `clip`/`oneLine`, `headlineText`, and `asString`.

## Layout

```
opencode-terminal-progress/
  index.ts         # server entry (standard server + TUI layout)
  tui.tsx          # TUI entry: sidebar section, detail panel, commands
  progress.ts      # pure helpers (percentage sniffing, bars, formatting)
  progress.test.ts # unit tests (node:test, zero dependencies)
  package.json     # "./tui" export for package installs
```

## License

MIT — see [LICENSE](LICENSE).
