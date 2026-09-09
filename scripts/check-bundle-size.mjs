#!/usr/bin/env node
// Initial-paint bundle-size guard. Fails (exit 1) if the assets the app
// loads on first paint exceed a committed ceiling.
//
// "Initial paint" is defined precisely and reproducibly as the JS/CSS
// assets referenced directly by dist/index.html — the entry chunk, the
// vendor chunk, the eagerly-imported data chunks, and the stylesheets
// (i.e. <script src>, <link rel=modulepreload>, <link rel=stylesheet>).
// Route-split pages, workers, fonts, the WASM blob, and lazy data chunks
// are NOT counted — they load on demand, not on first paint.
//
// Intent (per the bundle backlog item): keep the ~451 kB initial budget
// and guard against accidental doubling — e.g. a route that stops being
// lazy-loaded, or a heavy dependency landing in the vendor/entry chunk.
// It is a ceiling, not an exact match: normal growth is fine until it
// approaches the ceiling, at which point bump BUDGET_BYTES in the same
// commit (with justification) or split the offending code out.
//
// Run after `npm run build`: `node scripts/check-bundle-size.mjs`
// (or `npm run check:bundle`).

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const INDEX_HTML = join(DIST, "index.html");

// Raw (uncompressed) byte ceiling for the initial-paint JS+CSS. Current
// measured total is ~473 kB (entry+vendor JS ~360 kB, index CSS ~94 kB,
// eager data chunks ~12 kB). The headroom catches a regression on the
// order of an un-lazied route or a large dep in vendor, well below a
// doubling (~924 kB).
const BUDGET_BYTES = 600_000;

let html;
try {
  html = readFileSync(INDEX_HTML, "utf8");
} catch {
  console.error(
    `check-bundle: ${INDEX_HTML} not found. Run \`npm run build\` first.`,
  );
  process.exit(1);
}

// Match <script src="/assets/..."> and <link href="/assets/..."> for js/css.
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)]
  .map((m) => m[1].replace(/^\//, ""));

if (assets.length === 0) {
  console.error("check-bundle: no initial-paint assets found in index.html — parser stale?");
  process.exit(1);
}

let total = 0;
const rows = [];
for (const rel of assets) {
  const size = statSync(join(DIST, rel)).size;
  total += size;
  rows.push([size, rel]);
}

rows.sort((a, b) => b[0] - a[0]);
for (const [size, rel] of rows) {
  console.log(`  ${String(size).padStart(8)}  ${rel}`);
}
const kib = (n) => (n / 1024).toFixed(1);
console.log(`  -------- initial paint total: ${total} bytes (${kib(total)} KiB)`);

if (total > BUDGET_BYTES) {
  console.error(
    `\ncheck-bundle: initial paint ${total} bytes (${kib(total)} KiB) exceeds ` +
      `budget ${BUDGET_BYTES} (${kib(BUDGET_BYTES)} KiB).\n` +
      "A route may have stopped being lazy-loaded, or a heavy dependency " +
      "landed in the entry/vendor chunk. Investigate the largest asset above; " +
      "if the growth is intentional, bump BUDGET_BYTES in this commit with a reason.",
  );
  process.exit(1);
}

console.log(
  `check-bundle: OK (${kib(total)} / ${kib(BUDGET_BYTES)} KiB budget, ${assets.length} assets).`,
);
