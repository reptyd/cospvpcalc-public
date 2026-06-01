import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABILITY_POLICY_REFERENCE_DRAFTS,
  COMPARE_ONLY_REFERENCE_DRAFTS,
  KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  MODELED_ABILITY_REFERENCE_DRAFTS,
  PLUSHIE_REFERENCE_DRAFTS,
  STATUS_REFERENCE_DRAFTS,
} from "./referenceContent";
import baselineJson from "./referenceCoverage.baseline.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

const REF_MARKER = /\[REF:([a-z0-9_]+)\]/g;
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

function collectMarkers(): Set<string> {
  const tsTests = walk(join(REPO_ROOT, "src"), (n) => n.endsWith(".test.ts"));
  const rsFiles = walk(join(REPO_ROOT, "wasm-engine", "src"), (n) => n.endsWith(".rs"));
  const fixtureFiles = walk(join(REPO_ROOT, "wasm-engine", "fixtures"), (n) => n.endsWith(".json"));
  const markers = new Set<string>();
  for (const f of [...tsTests, ...rsFiles, ...fixtureFiles]) {
    const text = readFileSync(f, "utf8");
    for (const match of text.matchAll(REF_MARKER)) markers.add(match[1]);
  }
  return markers;
}

type Entry = { id: string; mechanics?: string[] };

const ALL_ENTRIES: Entry[] = [
  ...MODELED_ABILITY_REFERENCE_DRAFTS,
  ...STATUS_REFERENCE_DRAFTS,
  ...COMPARE_ONLY_REFERENCE_DRAFTS,
  ...KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  ...ABILITY_POLICY_REFERENCE_DRAFTS,
  ...PLUSHIE_REFERENCE_DRAFTS,
];

describe("Reference coverage gate", () => {
  const markers = collectMarkers();
  const baseline = new Set<string>(baselineJson as string[]);
  const uncovered = new Set(
    ALL_ENTRIES
      .filter((e) => Array.isArray(e.mechanics) && e.mechanics.length > 0)
      .filter((e) => !markers.has(e.id))
      .map((e) => e.id),
  );

  it("no new uncovered entries — add a test with [REF:<id>] or extend the baseline", () => {
    const added = [...uncovered].filter((id) => !baseline.has(id)).sort();
    expect(added, `New uncovered Reference entries detected. Either add a test name containing [REF:<id>] for each, or — if intentional — regenerate the baseline via:\n  npx tsx tools/generate_reference_coverage_baseline.ts\nIDs:\n${added.join("\n")}`).toEqual([]);
  });

  it("baseline is tight — entries newly covered must be removed from referenceCoverage.baseline.json", () => {
    const stale = [...baseline].filter((id) => !uncovered.has(id)).sort();
    expect(stale, `These IDs are now covered by tests. Remove them from src/pages/referenceCoverage.baseline.json:\n${stale.join("\n")}`).toEqual([]);
  });

  it("every entry has a unique id", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of ALL_ENTRIES) {
      if (seen.has(e.id)) dupes.push(e.id);
      seen.add(e.id);
    }
    expect(dupes, `duplicate Reference ids:\n${dupes.join("\n")}`).toEqual([]);
  });
});
