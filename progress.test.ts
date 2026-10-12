// Unit tests for the pure helpers in progress.ts (percentage sniffing, bar
// rendering, and text formatting used by the sidebar/panel). These run on
// stock Node with no dependencies: `npm test`.
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

// Elapsed-time label under each sidebar row (e.g. "12s · pid 14440").
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

// Command-line cleanup so long commands fit on one sidebar/panel row.
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

// Ten-cell bar shown next to the percent (e.g. "42% ████░░░░░░").
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

// Core rule: a percentage is only shown when the command prints its own cues
// ("42%", or an N/M counter seen progressing). Otherwise the result stays at
// the previous value (or null), so the UI never guesses.
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
    // Poll 1 only records the counter; a static fraction (date, path) never
    // reaches poll 2, so no percentage ever appears for it.
    const first = sniffProgress("test 12/200", undefined, null)
    assert.equal(first.value, null)
    assert.deepEqual(first.memory, { total: 200, done: 12 })
  })
  it("trusts an N/M counter once it progresses with the same total", () => {
    // Poll 2 sees the same total with a larger done count: real progress.
    // The label word must sit on the SAME line: the trailing "test" of the
    // next line must not leak into this fraction (would read 12/200 → 6%).
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

// Full one-line status per shell: spinner + optional "% + bar" + command.
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

// Narrowing helper used to read the session owner off shell metadata.
describe("asString", () => {
  it("passes strings through and maps anything else to undefined", () => {
    assert.equal(asString("abc"), "abc")
    assert.equal(asString(undefined), undefined)
    assert.equal(asString(42), undefined)
  })
})

// Decimal percentages printed by downloaders and encoders (yt-dlp "42.1%",
// brew/curl bars "100.0%", azcopy "12.5 %", HandBrake "42.12 %").
describe("decimal percentages", () => {
  it("rounds a decimal percent", () => {
    assert.equal(sniffProgress("[download]  42.1% of 10.00MiB", undefined, null).value, 42)
  })
  it("caps a decimal percent at 100", () => {
    assert.equal(sniffProgress("#### 100.0%", undefined, null).value, 100)
  })
  it("allows a space before the percent sign", () => {
    assert.equal(sniffProgress("12.5 %, 1 Done, 0 Failed", undefined, null).value, 13)
  })
})

// Compression ratios look like progress but describe a file, not a task:
// `unzip -l` listings must never drive the bar.
describe("compression-ratio guard", () => {
  it("ignores deflated percentages in listings", () => {
    assert.equal(sniffProgress("file1.txt  1000  580  42% deflated", undefined, null).value, null)
    assert.equal(sniffProgress("inflating: big.iso (deflated 42%)", undefined, null).value, null)
  })
})

// TAP (Test Anything Protocol): the "1..N" plan plus numbered "ok K" lines
// is authoritative — prove, node-tap, and other TAP producers print both.
describe("TAP plan + sequence", () => {
  it("computes progress from plan and highest result number", () => {
    const tail = "TAP version 13\n1..4\nok 1 - opened\nnot ok 2 - valid"
    assert.equal(sniffProgress(tail, undefined, null).value, 50)
  })
  it("shows nothing from a plan alone", () => {
    assert.equal(sniffProgress("1..4\n", undefined, null).value, null)
  })
  it("ignores shell ranges without result lines", () => {
    assert.equal(sniffProgress("1..100 | ForEach-Object { $_ }", undefined, null).value, null)
  })
  it("ignores result numbers past the plan", () => {
    assert.equal(sniffProgress("1..2\nok 1\nok 2\nok 3\n", undefined, null).value, null)
  })
})

// Byte fractions with units (docker pull, pip, maven, aws, rclone, pacman).
// Units normalize, so cross-unit pairs like kB/GB compare correctly.
describe("byte counters", () => {
  it("reads same-unit byte fractions", () => {
    const tail = "e5d15cca206c: Downloading [=========>]  25.6MB/101.2MB"
    assert.equal(sniffProgress(tail, undefined, null).value, 25)
  })
  it("reads cross-unit byte fractions", () => {
    assert.equal(sniffProgress("Extracting  1.2GB/3.4GB", undefined, null).value, 35)
  })
  it("reads fractions sharing one trailing unit", () => {
    assert.equal(sniffProgress("18.2/18.2 MB 12.5 MB/s eta 0:00:00", undefined, null).value, 100)
    assert.equal(sniffProgress("Progress (1): 2.3/5.1 MB", undefined, null).value, 45)
  })
  it("reads long unit names", () => {
    const tail = "Transferred: 12.345 MBytes / 100.000 MBytes, 1.234 MBytes/s"
    assert.equal(sniffProgress(tail, undefined, null).value, 12)
  })
  it("reads aws-style completed fractions", () => {
    const tail = "Completed 1.2 MiB/10.0 MiB (1.2 MiB/s) with 1 file(s) remaining"
    assert.equal(sniffProgress(tail, undefined, null).value, 12)
  })
})

// Labels make a counter unambiguous, so these are trusted on first sight:
// no two-poll warmup needed (docker steps, yarn/ninja/bazel brackets,
// cabal "of", ctest "Test", buck2 "Jobs:", rsync "to-check").
describe("labeled counters", () => {
  it("reads docker build steps", () => {
    assert.equal(sniffProgress("Step 4/8 : FROM ubuntu:22.04", undefined, null).value, 50)
  })
  it("reads bracketed step fractions", () => {
    assert.equal(sniffProgress("[2/4] Fetching packages...", undefined, null).value, 50)
    assert.equal(sniffProgress("[12/200] CC build/foo.o", undefined, null).value, 6)
    assert.equal(sniffProgress("[12 / 235] Compiling src/foo.cc", undefined, null).value, 5)
    assert.equal(sniffProgress("#5 [2/4] RUN pip install -r req.txt", undefined, null).value, 50)
  })
  it("reads N-of-M counters", () => {
    assert.equal(sniffProgress("[12 of 200] Compiling Foo.Bar", undefined, null).value, 6)
    assert.equal(sniffProgress("Running: foo.cy.js  (1 of 3)", undefined, null).value, 33)
  })
  it("reads counters with unit words", () => {
    assert.equal(sniffProgress("12/200 Test #12: barTest ... Passed", undefined, null).value, 6)
  })
  it("reads buck2 job counts", () => {
    assert.equal(sniffProgress("Jobs: 12/235 completed", undefined, null).value, 5)
  })
  it("inverts rsync to-check remaining counts", () => {
    // to-check=10/200 means 10 of 200 files remain, so 190 are done.
    assert.equal(sniffProgress("(xfr#5, to-check=10/200)", undefined, null).value, 95)
  })
  it("still rejects impossible labeled ratios", () => {
    assert.equal(sniffProgress("Step 9/8 : oops", undefined, null).value, null)
  })
})

// ffmpeg prints a Duration once plus a growing time= stamp per update.
describe("media duration/time", () => {
  it("computes the transcode ratio", () => {
    const tail =
      "Duration: 00:01:00.00, start: 0.000000, bitrate: 1000 kb/s\n" +
      "frame= 1234 fps= 60 q=28.0 size= 5120kB time=00:00:42.12 bitrate= 997.1kbits/s"
    assert.equal(sniffProgress(tail, undefined, null).value, 70)
  })
  it("shows nothing without a duration", () => {
    assert.equal(sniffProgress("frame= 10 time=00:00:01.00", undefined, null).value, null)
    assert.equal(sniffProgress("Duration: N/A, bitrate: N/A", undefined, null).value, null)
  })
})

// Priority between detectors, and memory handoff from an immediate-trust
// hit to later bare-fraction polls.
describe("detector priority + memory", () => {
  it("prefers percent over every counter", () => {
    assert.equal(sniffProgress("5/10 at 80%", undefined, null).value, 80)
    assert.equal(sniffProgress("5 / 42 ( 12%)", undefined, null).value, 12)
    assert.equal(sniffProgress("Receiving objects:  42% (123/456)", undefined, null).value, 42)
    assert.equal(sniffProgress("tests/test_a.py ..F [ 40%]", undefined, null).value, 40)
  })
  it("hands labeled memory to later bare polls", () => {
    const first = sniffProgress("[12/200] CC foo.o", undefined, null)
    assert.equal(first.value, 6)
    const second = sniffProgress("100/200", first.memory, first.value)
    assert.equal(second.value, 50)
  })
})
