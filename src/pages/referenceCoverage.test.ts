import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { collectCoverage, DUPLICATE_ENTRY_IDS, GATED_ENTRY_IDS } from "./referenceCoverage";
import baselineJson from "./referenceCoverage.baseline.json";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// An entry counts as covered when a marker naming it sits in a file that
// asserts. A marker in a body that only carries the marker is a comment, and a
// comment proves nothing - the rule that let a scaffolded stub satisfy this gate
// is the rule it exists to catch.
//
// Everything left over is listed in referenceCoverage.baseline.json with a
// reason saying which layer holds the mechanic and what would have to be built
// to check it there.

const baseline = baselineJson as Record<string, string>;

// "Not checkable in Rust" hides the layer. Every mechanic is applied somewhere,
// so a reason has to point at that somewhere before it says what a check needs.
const NAMES_A_LAYER = /\b(?:src|wasm-engine|data|tools|scripts)\//;

describe("Reference coverage gate", () => {
  const coverage = collectCoverage(REPO_ROOT);
  const uncovered = GATED_ENTRY_IDS.filter((id) => !coverage.markers.has(id));

  it("no new uncovered entries - verify it somewhere, or record it in the baseline with a reason", () => {
    const added = uncovered.filter((id) => !(id in baseline)).sort();
    expect(
      added,
      `These Reference entries state mechanics that nothing verifies. Either assert them (a Rust reference test or a TS test carrying the entry marker), or - if the mechanic genuinely lives outside anything testable today - add each to src/pages/referenceCoverage.baseline.json with a reason naming the layer it runs in and what a check would need:\n  npx tsx tools/generate_reference_coverage_baseline.ts\nIDs:\n${added.join("\n")}`,
    ).toEqual([]);
  });

  it("baseline is tight - an entry that became verified must leave the baseline", () => {
    const stale = Object.keys(baseline)
      .filter((id) => !uncovered.includes(id))
      .sort();
    expect(
      stale,
      `These IDs are verified now. Remove them from src/pages/referenceCoverage.baseline.json:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("every baseline key is a real Reference entry that states mechanics", () => {
    const unknown = Object.keys(baseline)
      .filter((id) => !GATED_ENTRY_IDS.includes(id))
      .sort();
    expect(
      unknown,
      `baseline lists ids that are not gated entries (renamed, deleted, or carrying no mechanics):\n${unknown.join("\n")}`,
    ).toEqual([]);
  });

  it("every baseline reason names the layer the mechanic runs in", () => {
    const vague = Object.entries(baseline)
      .filter(([, reason]) => reason.trim().length < 40 || !NAMES_A_LAYER.test(reason))
      .map(([id]) => id)
      .sort();
    expect(
      vague,
      `These baseline reasons say nothing a reader can act on. Point at the file or directory that applies the mechanic, then say what a check would have to read:\n${vague.join("\n")}`,
    ).toEqual([]);
  });

  it("census - gated entries partition into verified and baselined", () => {
    const verified = GATED_ENTRY_IDS.filter((id) => coverage.markers.has(id));
    expect(
      verified.length + uncovered.length,
      `census: ${verified.length}/${GATED_ENTRY_IDS.length} gated entries verified `
      + `by an asserting test carrying the marker, ${uncovered.length} baselined`,
    ).toBe(GATED_ENTRY_IDS.length);
    expect(uncovered.slice().sort()).toEqual(Object.keys(baseline).slice().sort());
  });

  it("every reference test file is registered in mod.rs", () => {
    // A file the module tree does not name never compiles, so its assertions
    // never run - but the marker scan reads it as text and counts it. Cocoon
    // sat that way and its entry read as verified by a test nothing executed.
    const dir = join(REPO_ROOT, "wasm-engine", "src", "composable", "reference_tests");
    const declared = new Set(
      [...readFileSync(join(dir, "mod.rs"), "utf8").matchAll(/^\s*(?:pub )?mod\s+(\w+)\s*;/gm)].map((m) => m[1]),
    );
    const orphans = readdirSync(dir)
      .filter((name) => name.endsWith(".rs") && name !== "mod.rs")
      .map((name) => name.replace(/\.rs$/, ""))
      .filter((name) => !declared.has(name));
    expect(
      orphans,
      `These files sit in reference_tests/ without a mod line, so nothing in them runs: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("a marker only counts when the body holding it asserts", () => {
    // The gate's own check. It used to read assertions per FILE, so a body
    // carrying nothing but the marker rode on the test beside it and the entry
    // read as verified. Written against a synthetic tree so it says the same
    // thing whatever the real suites happen to look like today.
    const root = mkdtempSync(join(tmpdir(), "reference-coverage-gate-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "wasm-engine", "src"), { recursive: true });
    mkdirSync(join(root, "wasm-engine", "fixtures"), { recursive: true });
    writeFileSync(
      join(root, "wasm-engine", "src", "probe.rs"),
      [
        "#[test]",
        "fn asserts_something() {",
        "    // [REF:probe_asserting_body]",
        "    assert!(true);",
        "}",
        "",
        "#[test]",
        "fn asserts_nothing() {",
        "    // [REF:probe_silent_body]",
        "    let _ = 1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "src", "probe.test.ts"),
      [
        "// [REF:probe_module_comment]",
        'it("real", () => { expect(1).toBe(1); });',
        'it("silent", () => { /* [REF:probe_silent_ts_body] */ const x = 1; });',
        "",
      ].join("\n"),
      "utf8",
    );

    const { markers } = collectCoverage(root);
    expect(markers.has("probe_asserting_body"), "a body that asserts covers its marker").toBe(true);
    expect(markers.has("probe_silent_body"), "a Rust body with no assertion covers nothing").toBe(false);
    expect(markers.has("probe_silent_ts_body"), "a TS body with no assertion covers nothing").toBe(false);
    // A suite that lists its entries in a block comment and checks them in a
    // loop has no single body to attach them to, so those still count.
    expect(markers.has("probe_module_comment"), "a marker outside every body still counts").toBe(true);
  });

  it("every entry has a unique id", () => {
    expect(DUPLICATE_ENTRY_IDS, `duplicate Reference ids:\n${DUPLICATE_ENTRY_IDS.join("\n")}`).toEqual([]);
  });
});
