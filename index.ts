import { Plugin } from "@opencode/plugin"

/**
 * Server-side entry for the terminal-progress plugin.
 *
 * The live UI lives in `tui.tsx`. This entry exists so the plugin uses the
 * standard "server + TUI entrypoints kept together" layout, and gives us a
 * place to hang server-only behavior later (for example, emitting a
 * notification when a terminal finishes).
 */
export default Plugin.define({
  id: "terminal-progress",
  setup() {},
})
