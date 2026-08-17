import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SPEC_CONSTANTS } from "./specConstants.generated";
import baselineJson from "./specConstantsBindings.baseline.json";

// Dead-bind + census gate for the spec-constants spine.
//
// The spine welds each magnitude's VALUE to its spec PROSE (gen_spec_constants
// prose-bind + specConstantsDrift). This gate closes the other half: it proves
// every generated constant is actually READ by a consumer, so perturbing it
// would red something - the cheap static form of a mutation gate (a full
// per-constant `cargo test` mutation run is ~8h and was rejected on cost). A
// constant referenced by nobody is a dead bind: its value could drift with no
// test reacting. Genuinely unwitnessable magnitudes (applied through a path
// that emits no observable event) live in the baseline with a written reason,
// keeping the census honest instead of silently over-claiming coverage.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git", "build"]);

// Files that DEFINE the constants (generated outputs + the referenceContent
// source of truth). A constant name appearing in these is a definition, not a
// load-bearing consumer, so they must not count as a reference.
const EXCLUDE = new Set(
  [
    "wasm-engine/src/spec_constants.rs",
    "src/engine/specConstants.generated.ts",
    "src/pages/referenceContent.ts",
    "src/engine/specConstantsBindings.test.ts",
  ].map((p) => p.split("/").join(sep)),
);

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

function consumerBlob(): string {
  const rsFiles = walk(join(REPO_ROOT, "wasm-engine", "src"), (n) => n.endsWith(".rs"));
  const tsFiles = walk(join(REPO_ROOT, "src"), (n) => n.endsWith(".ts") || n.endsWith(".tsx"));
  const parts: string[] = [];
  for (const f of [...rsFiles, ...tsFiles]) {
    if (EXCLUDE.has(relative(REPO_ROOT, f))) continue;
    parts.push(readFileSync(f, "utf8"));
  }
  return parts.join("\n");
}

function isReferenced(blob: string, key: string): boolean {
  // Rust reads `spec_constants::RUST_NAME`; TS reads `SPEC_CONSTANTS.key`.
  const rustName = key.toUpperCase();
  return new RegExp(`\\b${rustName}\\b`).test(blob) || new RegExp(`\\b${key}\\b`).test(blob);
}

type Baseline = Record<string, string>;

describe("spec-constants bindings gate", () => {
  const keys = Object.keys(SPEC_CONSTANTS);
  const baseline = baselineJson as Baseline;
  const blob = consumerBlob();
  const referenced = new Set(keys.filter((k) => isReferenced(blob, k)));
  const orphans = keys.filter((k) => !referenced.has(k));

  it("no dead binds - every spec constant is read by a consumer (or baselined as unwitnessable)", () => {
    const dead = orphans.filter((k) => !(k in baseline)).sort();
    expect(
      dead,
      `These spec constants are referenced by NO consumer (dead binds) - perturbing them would red nothing. Read each in a reference test / engine path, or, if genuinely unwitnessable through the test surface, add it to src/engine/specConstantsBindings.baseline.json with a reason:\n${dead.join("\n")}`,
    ).toEqual([]);
  });

  it("baseline is tight - a constant that became witnessed must leave the baseline", () => {
    const stale = Object.keys(baseline)
      .filter((k) => referenced.has(k))
      .sort();
    expect(
      stale,
      `These constants are now read by a consumer; remove them from src/engine/specConstantsBindings.baseline.json:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("every baseline key is a real spec constant", () => {
    const unknown = Object.keys(baseline)
      .filter((k) => !(k in SPEC_CONSTANTS))
      .sort();
    expect(unknown, `baseline references unknown constants:\n${unknown.join("\n")}`).toEqual([]);
  });

  it("census - constants partition exactly into witnessed + explicit orphans", () => {
    expect(
      referenced.size + orphans.length,
      `census: ${referenced.size}/${keys.length} witnessed, ${orphans.length} orphan(s): ${orphans.join(", ") || "none"}`,
    ).toBe(keys.length);
    expect(orphans.slice().sort()).toEqual(Object.keys(baseline).slice().sort());
  });
});
