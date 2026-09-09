#!/usr/bin/env node
/**
 * One-shot (idempotent) cleanup script that strips unused presentational
 * fields from the runtime JSON sources in `data/`.
 *
 * Without this, ~70 kB of human-readable descriptions and
 * wiki-scraping artifacts that no code reads would be bundled.
 * The biggest offender is the parsed.rawDescription field on
 * the Unbridled Rage Status entry — 24.9 kB of Sonaria fandom wiki page
 * markup ("Trending pages Codes Plushies ..." + nav HTML noise).
 *
 * Fields removed:
 *   - `data/status_effects.runtime.json`: drop `parsed.rawDescription`.
 *     Declared optional in `engine/types.ts` but never read.
 *   - `data/plushies.runtime.json`: drop `rawDescription` and `snippet`.
 *     Both declared optional, neither read.
 *   - `data/traits.runtime.json`: drop `raw` (long verbose form). The
 *     short `effectText` is kept — used by the trait analysis surface.
 *   - `data/breath_specs.runtime.json` is INTENTIONALLY untouched —
 *     `raw` there is parsed by `breathHelpersRuntime.parseBreathAilments`
 *     and `optimizerContextStatuses.parseBreathAilmentsRaw`. Removing it
 *     would break the optimizer's status-effect ingest path.
 *
 * Running this twice is a no-op: the script checks for field presence
 * before deletion and only writes back when something changed.
 *
 * Usage: `node scripts/strip_unused_data_fields.mjs`
 *
 * If we re-scrape these JSONs from the wiki later, run the script on
 * the fresh files before committing — keeps the source clean.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dataDir = resolve(here, "..", "data");

function loadJson(name) {
  return JSON.parse(readFileSync(resolve(dataDir, name), "utf-8"));
}

function saveJson(name, value) {
  // Match the existing pretty-print style: 2-space indent + trailing newline.
  writeFileSync(resolve(dataDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function stripStatusEffects() {
  const file = "status_effects.runtime.json";
  const data = loadJson(file);
  let changed = 0;
  for (const entry of data) {
    const parsed = entry?.parsed;
    if (parsed && typeof parsed === "object" && "rawDescription" in parsed) {
      delete parsed.rawDescription;
      changed += 1;
    }
  }
  if (changed > 0) {
    saveJson(file, data);
    console.log(`${file}: stripped parsed.rawDescription from ${changed} entries`);
  } else {
    console.log(`${file}: already clean`);
  }
}

function stripPlushies() {
  const file = "plushies.runtime.json";
  const data = loadJson(file);
  let changed = 0;
  for (const entry of data.plushies ?? []) {
    if ("rawDescription" in entry) {
      delete entry.rawDescription;
      changed += 1;
    }
    if ("snippet" in entry) {
      delete entry.snippet;
      changed += 1;
    }
  }
  if (changed > 0) {
    saveJson(file, data);
    console.log(`${file}: stripped rawDescription/snippet from plushies (${changed} field removals)`);
  } else {
    console.log(`${file}: already clean`);
  }
}

function stripTraits() {
  const file = "traits.runtime.json";
  const data = loadJson(file);
  let changed = 0;
  for (const entry of data.traits ?? []) {
    if ("raw" in entry) {
      delete entry.raw;
      changed += 1;
    }
  }
  if (changed > 0) {
    saveJson(file, data);
    console.log(`${file}: stripped raw from ${changed} traits`);
  } else {
    console.log(`${file}: already clean`);
  }
}

stripStatusEffects();
stripPlushies();
stripTraits();
