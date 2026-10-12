import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  asString,
  clip,
  formatElapsed,
  headlineText,
  oneLine,
  progressBar,
  sniffProgress,
} from "./progress.ts"

describe("formatElapsed", () => {
  it("shows seconds under a minute", () => {
    assert.equal(formatElapsed(0), "0s")
    assert.equal(formatElapsed(12_000), "12s")
    assert.equal(formatElapsed(59_999), "59s")
  })
  it("clamps negative input to 0s", () => {
    assert.equal(formatElapsed(-5000), "0s")
  })
  it("shows minutes and seconds under an hour", () => {
    assert.equal(formatElapsed(60_000), "1m00s")
    assert.equal(formatElapsed(61_000), "1m01s")
    assert.equal(formatElapsed(10 * 60_000 + 5_000), "10m05s")
  })
  it("shows hours and minutes beyond an hour", () => {
    assert.equal(formatElapsed(3_600_000), "1h00m")
    assert.equal(formatElapsed(3_600_000 + 5 * 60_000), "1h05m")
  })
})

describe("oneLine / clip", () => {
  it("collapses whitespace", () => {
    assert.equal(oneLine("  npm   run\n  build\t"), "npm run build")
  })
  it("leaves short text alone", () => {
    assert.equal(clip("npm install", 24), "npm install")
  })
  it("truncates long commands with an ellipsis", () => {
    assert.equal(clip("1..100 | ForEach-Object { Do-Thing }", 24), "1..100 | ForEach-Object…")
  })
  it("handles tiny max values without the ellipsis", () => {
    assert.equal(clip("abcdef", 1), "a")
    assert.equal(clip("abcdef", 0), "")
  })
})

describe("progressBar", () => {
  it("renders ten cells", () => {
    assert.equal(progressBar(0), "░░░░░░░░░░")
    assert.equal(progressBar(100), "██████████")
    assert.equal(progressBar(42), "████░░░░░░")
    assert.equal(progressBar(60), "██████░░░░")
  })
  it("clamps out-of-range input", () => {
    assert.equal(progressBar(142), "██████████")
    assert.equal(progressBar(-5), "░░░░░░░░░░")
  })
})

describe("sniffProgress", () => {
  it("reads an explicit percentage immediately", () => {
    const found = sniffProgress("Download 42% complete", undefined, null)
    assert.equal(found.value, 42)
  })
  it("takes the last percentage and caps at 100", () => {
    const found = sniffProgress("10% ... 55% ... 142%", undefined, null)
    assert.equal(found.value, 100)
  })
  it("sees percentages through ANSI color codes and carriage returns", () => {
    const found = sniffProgress("\x1b[32m73%\x1b[0m done\r73%", undefined, null)
    assert.equal(found.value, 73)
  })
  it("returns null when output has no progress cues", () => {
    const found = sniffProgress("compiling foo.c\nlinking bar", undefined, null)
    assert.equal(found.value, null)
  })
  it("sticks to the previous value when cues disappear", () => {
    const found = sniffProgress("still working...", undefined, 42)
    assert.equal(found.value, 42)
  })
  it("does not trust an N/M counter on first sight", () => {
    const first = sniffProgress("test 12/200", undefined, null)
    assert.equal(first.value, null)
    assert.deepEqual(first.memory, { total: 200, done: 12 })
  })
  it("trusts an N/M counter once it progresses with the same total", () => {
    const first = sniffProgress("test 12/200", undefined, null)
    const second = sniffProgress("test 12/200\ntest 100/200", first.memory, first.value)
    assert.equal(second.value, 50)
  })
  it("rejects static fractions like dates and paths", () => {
    // 2024 > 01, so done > total is skipped every poll; value never appears.
    const first = sniffProgress("run on 2024/01/15", undefined, null)
    assert.equal(first.value, null)
    const second = sniffProgress("run on 2024/01/15", first.memory, first.value)
    assert.equal(second.value, null)
  })
  it("rejects zero totals and done > total", () => {
    assert.equal(sniffProgress("0/0 done", undefined, null).value, null)
    assert.equal(sniffProgress("7/3 done", undefined, null).value, null)
  })
  it("prefers an explicit percent over a counter", () => {
    const found = sniffProgress("5/10 at 80%", undefined, null)
    assert.equal(found.value, 80)
  })
})

describe("headlineText", () => {
  it("shows spinner, percent, and bar when progress is known", () => {
    assert.equal(headlineText("⠋", 42, "npm install", 24), "⠋ 42% ████░░░░░░ npm install")
  })
  it("shows only spinner and command when progress is unknown", () => {
    assert.equal(headlineText("⠋", null, "npm install", 24), "⠋ npm install")
  })
  it("clips long commands", () => {
    const line = headlineText("⠋", null, "1..100 | ForEach-Object { Do-Thing }", 10)
    assert.ok(line.endsWith("…"))
  })
})

describe("asString", () => {
  it("passes strings through and maps anything else to undefined", () => {
    assert.equal(asString("abc"), "abc")
    assert.equal(asString(undefined), undefined)
    assert.equal(asString(42), undefined)
  })
})
