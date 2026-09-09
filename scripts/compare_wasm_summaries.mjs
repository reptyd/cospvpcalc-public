// Diffs two wasm-freshness summary dumps (see src/optimizer/wasmFreshness.test.ts).
// Exits non-zero if the committed bundle's behaviour diverges from a fresh
// rebuild — i.e. src/rust-pkg is stale (engine edited without `npm run rust:build`).
//
// Winner must match exactly; numeric fields are compared within a tolerance that
// absorbs cross-OS float-lowering noise but not a real behavioural change — a
// stale-wasm bug moves HP / death-time by whole units, not ULPs. Tolerances match
// the engine's own fixture FLOAT_TOL.
import { readFileSync } from "node:fs";

const [, , committedPath, freshPath] = process.argv;
if (!committedPath || !freshPath) {
  console.error("usage: node scripts/compare_wasm_summaries.mjs <committed.json> <fresh.json>");
  process.exit(2);
}

const committed = JSON.parse(readFileSync(committedPath, "utf8"));
const fresh = JSON.parse(readFileSync(freshPath, "utf8"));

const TIME_TOL = 0.05; // seconds — matches the Rust fixture FLOAT_TOL
const HP_TOL = 0.5; // half an HP point

// A side that never died carries no death time, and JSON.stringify drops the
// key rather than writing null - so both dumps arrive with it absent. Treat
// absent and null alike, or every matchup anyone survives reads as a mismatch.
const near = (a, b, tol) => {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return Math.abs(a - b) <= tol;
};

const mismatches = [];
const names = new Set([...Object.keys(committed), ...Object.keys(fresh)]);
for (const name of names) {
  const c = committed[name];
  const f = fresh[name];
  if (!c || !f) {
    mismatches.push(`${name}: present in only one dump`);
    continue;
  }
  if (c.winner !== f.winner) mismatches.push(`${name}: winner ${c.winner} -> ${f.winner}`);
  if (!near(c.deathTimeA, f.deathTimeA, TIME_TOL)) mismatches.push(`${name}: deathTimeA ${c.deathTimeA} -> ${f.deathTimeA}`);
  if (!near(c.deathTimeB, f.deathTimeB, TIME_TOL)) mismatches.push(`${name}: deathTimeB ${c.deathTimeB} -> ${f.deathTimeB}`);
  if (!near(c.finalHpA, f.finalHpA, HP_TOL)) mismatches.push(`${name}: finalHpA ${c.finalHpA} -> ${f.finalHpA}`);
  if (!near(c.finalHpB, f.finalHpB, HP_TOL)) mismatches.push(`${name}: finalHpB ${c.finalHpB} -> ${f.finalHpB}`);
}

if (mismatches.length > 0) {
  console.error(
    `Committed src/rust-pkg is STALE — behaviour differs from a fresh \`npm run rust:build\`:\n` +
      `${mismatches.join("\n")}\n\nRebuild the bundle and commit src/rust-pkg.`,
  );
  process.exit(1);
}
console.log(`wasm freshness OK: ${names.size} matchups behaviourally identical (committed == fresh).`);
