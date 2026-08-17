import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ABILITY_POLICY_REFERENCE_DRAFTS,
  BATTLE_SETTING_REFERENCE_DRAFTS,
  KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  MODELED_ABILITY_REFERENCE_DRAFTS,
  MOVEMENT_SPEED_REFERENCE_DRAFTS,
  PLUSHIE_REFERENCE_DRAFTS,
  STATUS_REFERENCE_DRAFTS,
} from "./referenceContent";

// What counts as coverage for a Reference entry, shared by the gate
// (referenceCoverage.test.ts) and the baseline generator so there is one
// definition rather than two that drift.
//
// One source: a marker in a file that asserts. The marker names the entry; the
// assertion is what makes the file more than a comment. A test body whose only
// content is the marker proves nothing, so it does not count.

type Entry = { id: string; mechanics?: string[] };

const ALL_ENTRIES: Entry[] = [
  ...MODELED_ABILITY_REFERENCE_DRAFTS,
  ...STATUS_REFERENCE_DRAFTS,
  ...MOVEMENT_SPEED_REFERENCE_DRAFTS,
  ...BATTLE_SETTING_REFERENCE_DRAFTS,
  ...KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  ...ABILITY_POLICY_REFERENCE_DRAFTS,
  ...PLUSHIE_REFERENCE_DRAFTS,
];

const ENTRY_IDS = ALL_ENTRIES.map((e) => e.id);

/** Only entries that state mechanics can be verified, so only those are gated. */
export const GATED_ENTRY_IDS: string[] = ALL_ENTRIES
  .filter((e) => Array.isArray(e.mechanics) && e.mechanics.length > 0)
  .map((e) => e.id);

export const DUPLICATE_ENTRY_IDS: string[] = ENTRY_IDS.filter((id, i) => ENTRY_IDS.indexOf(id) !== i);

const REF_MARKER = /\[REF:([a-z0-9_]+)\]/g;
// The `assert*!` macros, and a call to a helper named `assert_*`. A body that
// hands its check to a named helper is asserting; reading only the macro would
// count it as silent.
const RUST_ASSERTION = /\bassert\w*\s*[!(]|\bpanic!|\bmatches!/;
const TS_ASSERTION = /\bexpect\s*\(/;
const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git", "build"]);

function walk(dir: string, predicate: (name: string) => boolean, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, predicate, out);
    else if (predicate(name)) out.push(p);
  }
  return out;
}

/** Where a test body starts: the `{` that opens a `#[test] fn`, an `it(` or a `test(`. */
const RUST_TEST_HEAD = /#\[test\][\s\S]*?\bfn\b[^{]*\{/g;
const TS_TEST_HEAD = /\b(?:it|test)(?:\.\w+)*\s*\([\s\S]*?\{/g;

/** Half-open `[start, end)` of each test body, in source order. */
function testBodyRanges(path: string, text: string): Array<[number, number]> {
  const head = path.endsWith(".rs") ? RUST_TEST_HEAD : TS_TEST_HEAD;
  head.lastIndex = 0;
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(head)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      i += 1;
    }
    ranges.push([start, i]);
  }
  return ranges;
}

function asserts(path: string, text: string): boolean {
  return path.endsWith(".rs") ? RUST_ASSERTION.test(text) : TS_ASSERTION.test(text);
}

/**
 * Ids this file verifies.
 *
 * A marker sitting inside a test body only counts when that body asserts
 * something. A body carrying nothing but the marker used to ride on the
 * assertions of the test beside it, which is the one shape this whole gate
 * exists to refuse.
 *
 * A marker outside every body - the block comment some suites use to list the
 * entries they cover in a loop - still counts on the file asserting somewhere,
 * because there is no single body that owns it. Those blocks are expected to be
 * kept honest by a case in the same file that diffs the list against the
 * entries; nothing here can check that for them.
 *
 * A fixture is a declarative expectation, so a marker anywhere in it counts.
 */
function markedIdsIn(path: string, text: string): string[] {
  if (path.endsWith(".json")) {
    return [...text.matchAll(REF_MARKER)].map((m) => m[1]);
  }
  const ranges = testBodyRanges(path, text);
  const bodyAsserts = ranges.map(([from, to]) => asserts(path, text.slice(from, to)));
  const fileAsserts = asserts(path, text);
  const ids: string[] = [];
  for (const match of text.matchAll(REF_MARKER)) {
    const at = match.index ?? 0;
    const inside = ranges.findIndex(([from, to]) => at >= from && at < to);
    if (inside === -1 ? fileAsserts : bodyAsserts[inside]) ids.push(match[1]);
  }
  return ids;
}

export type CoverageSources = {
  /** Ids named by a marker in a file that also asserts. */
  markers: Set<string>;
};

export function collectCoverage(repoRoot: string): CoverageSources {
  const files = [
    ...walk(join(repoRoot, "src"), (n) => n.endsWith(".test.ts")),
    ...walk(join(repoRoot, "wasm-engine", "src"), (n) => n.endsWith(".rs")),
    ...walk(join(repoRoot, "wasm-engine", "fixtures"), (n) => n.endsWith(".json")),
  ];
  const markers = new Set<string>();
  for (const f of files) {
    for (const id of markedIdsIn(f, readFileSync(f, "utf8"))) markers.add(id);
  }
  return { markers };
}

export function uncoveredEntryIds(repoRoot: string): string[] {
  const { markers } = collectCoverage(repoRoot);
  return GATED_ENTRY_IDS.filter((id) => !markers.has(id)).sort();
}
