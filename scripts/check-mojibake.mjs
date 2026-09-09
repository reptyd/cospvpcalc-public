#!/usr/bin/env node
// Repo-wide mojibake guard. Fails (exit 1) if any tracked text file
// contains UTF-8->CP1251 double-encode artifacts.
//
// Background: editing a UTF-8 file through a tool that round-trips it as
// CP1251 (Windows shell copies/renames — see the windows
// file-encoding gotcha) turns punctuation into multi-byte garbage. Every
// char in the general-punctuation block (E2-prefixed in UTF-8 — em-dash,
// arrows, smart quotes, ...) mojibakes to U+0432 followed by a CP1251
// control-range glyph. We match the two lead digraphs that have actually
// occurred here, plus the Unicode replacement char:
//   U+0432 U+0402  (em-dash / en-dash / smart-quote family lead)
//   U+0432 U+2020  (arrow family lead)
//   U+FFFD         (replacement char)
// These sequences never appear in legitimate Russian (the docs ARE
// Cyrillic) or English — U+0402 / U+2020 do not follow U+0432 in real
// words — so the check is false-positive-free without excluding Cyrillic.
//
// The patterns are built from code points via String.fromCharCode so this
// file stays ASCII-clean and passes its own guard (no self-exclusion).
//
// Run: `node scripts/check-mojibake.mjs` (or `npm run check:mojibake`).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const cp = (...codes) => String.fromCharCode(...codes);
const MOJIBAKE = new RegExp(
  [cp(0x0432, 0x0402), cp(0x0432, 0x2020), cp(0xfffd)].join("|"),
);

// Only scan text we author. Binary/generated/vendored paths are skipped.
const TEXT_EXT = new Set([
  "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "md", "json", "html", "css", "yml", "yaml", "toml", "txt",
]);

// No path prefixes are excluded — every tracked text file is gated.
const EXCLUDE_PREFIXES = [];

const tracked = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .map((p) => p.trim())
  .filter(Boolean)
  .filter((p) => TEXT_EXT.has(p.split(".").pop()?.toLowerCase() ?? ""))
  .filter((p) => !EXCLUDE_PREFIXES.some((pre) => p.startsWith(pre)));

const hits = [];
for (const path of tracked) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue; // unreadable / disappeared between ls-files and read
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (MOJIBAKE.test(lines[i])) hits.push(`${path}:${i + 1}: ${lines[i].trim()}`);
  }
}

if (hits.length > 0) {
  console.error(`Mojibake detected in ${hits.length} line(s):\n`);
  for (const h of hits) console.error(`  ${h}`);
  console.error(
    "\nA UTF-8 file was corrupted to CP1251 mojibake. Recover the intended " +
      "characters from git history and re-save via a UTF-8-safe editor " +
      "(Write/Edit), not a shell copy/rename.",
  );
  process.exit(1);
}

console.log(`check-mojibake: clean (${tracked.length} tracked text files scanned).`);
