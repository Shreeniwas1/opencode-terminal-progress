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
the command already prints:

- explicit `42%` readouts (pip, npm, curl, docker, …) — shown immediately;
- `12/200` style counters (test runners, scripts) — shown once seen
  *progressing*, which rejects dates, paths, and other static fractions.

Anything else keeps the spinner + elapsed-time display. A percentage is never
guessed.

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

## Layout

```
opencode-terminal-progress/
  index.ts       # server entry (standard server + TUI layout)
  tui.tsx        # TUI entry: sidebar section, detail panel, commands
  package.json   # "./tui" export for package installs
```

## License

MIT — see [LICENSE](LICENSE).
