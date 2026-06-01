/**
 * Scaffold a Rust test file for one Reference entry.
 *
 *   npx tsx tools/scaffold_reference_test.ts <entry_id>
 *
 * Looks up the entry in src/pages/referenceContent.ts, creates
 * wasm-engine/src/composable/reference_tests/<short>.rs from a template
 * (where <short> strips the type prefix: ability_acid_breath -> acid_breath),
 * and registers `mod <short>;` in reference_tests/mod.rs.
 *
 * Idempotent: refuses to overwrite an existing file.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABILITY_POLICY_REFERENCE_DRAFTS,
  COMPARE_ONLY_REFERENCE_DRAFTS,
  KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  MODELED_ABILITY_REFERENCE_DRAFTS,
  PLUSHIE_REFERENCE_DRAFTS,
  STATUS_REFERENCE_DRAFTS,
} from "../src/pages/referenceContent";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const REF_TESTS_DIR = join(REPO_ROOT, "wasm-engine", "src", "composable", "reference_tests");
const REF_TESTS_MOD = join(REF_TESTS_DIR, "mod.rs");

const PREFIXES = ["ability_", "status_", "compare_", "approx_", "policy_", "plushie_"];

function shortName(id: string): string {
  for (const p of PREFIXES) {
    if (id.startsWith(p)) return id.slice(p.length);
  }
  return id;
}

function locateEntry(id: string): { id: string; name: string; mechanics?: string[] } | null {
  const all = [
    ...MODELED_ABILITY_REFERENCE_DRAFTS,
    ...STATUS_REFERENCE_DRAFTS,
    ...COMPARE_ONLY_REFERENCE_DRAFTS,
    ...KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
    ...ABILITY_POLICY_REFERENCE_DRAFTS,
    ...PLUSHIE_REFERENCE_DRAFTS,
  ];
  return (all as { id: string; name: string; mechanics?: string[] }[]).find((e) => e.id === id) ?? null;
}

function template(entryId: string, name: string, mechanicsCount: number): string {
  const stub = (idx: number) => `#[test]
fn claim_${idx + 1}_TODO_rename_to_match_bullet() {
    // [REF:${entryId}]
    // Bullet ${idx + 1}: TODO paste mechanics text here.
    todo!("assert against engine");
}
`;
  const stubs = mechanicsCount > 0
    ? Array.from({ length: mechanicsCount }, (_, i) => stub(i)).join("\n")
    : `// No mechanics bullets to test. Either remove this file (and re-run\n// the scaffolder if mechanics get added later) or convert the entry's\n// notes into testable mechanics first.\n`;
  return `//! Reference: ${entryId}
//!
//! Covers every testable bullet in the "${name}" entry. Each test body
//! must contain the [REF:${entryId}] marker so the vitest coverage gate
//! sees it.

#![allow(unused_imports)]

use super::{applied_status, default_breath, default_combatant};
use crate::contracts::{SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

${stubs}`;
}

function registerMod(short: string): void {
  const src = readFileSync(REF_TESTS_MOD, "utf8");
  const line = `mod ${short};`;
  if (src.includes(line)) return;
  // Insert into the existing alphabetical list at the bottom of the file.
  const lines = src.split("\n");
  const modLines: { idx: number; name: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^mod\s+(\w+);$/);
    if (m) modLines.push({ idx: i, name: m[1] });
  }
  if (modLines.length === 0) {
    // append at end
    lines.push(line, "");
    writeFileSync(REF_TESTS_MOD, lines.join("\n"), "utf8");
    return;
  }
  let insertIdx = modLines[modLines.length - 1].idx + 1;
  for (const ml of modLines) {
    if (short < ml.name) { insertIdx = ml.idx; break; }
  }
  lines.splice(insertIdx, 0, line);
  writeFileSync(REF_TESTS_MOD, lines.join("\n"), "utf8");
}

function main(): number {
  const entryId = process.argv[2];
  if (!entryId) {
    console.error("usage: npx tsx tools/scaffold_reference_test.ts <entry_id>");
    return 1;
  }
  const entry = locateEntry(entryId);
  if (!entry) {
    console.error(`entry id not found in any *_REFERENCE_DRAFTS array: ${entryId}`);
    return 1;
  }
  const short = shortName(entryId);
  const file = join(REF_TESTS_DIR, `${short}.rs`);
  if (existsSync(file)) {
    console.error(`refuse to overwrite existing file: ${file}`);
    return 1;
  }
  const mechanicsCount = entry.mechanics?.length ?? 0;
  writeFileSync(file, template(entryId, entry.name, mechanicsCount), "utf8");
  registerMod(short);
  console.log(`created ${file} (${mechanicsCount} test stubs) and registered mod ${short};`);
  console.log("Next: edit the file, replace TODOs, then remove the entry id from src/pages/referenceCoverage.baseline.json.");
  return 0;
}

process.exit(main());
