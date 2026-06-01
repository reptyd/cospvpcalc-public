import { applyRulesAndBuild } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";
import { simulateBestBuildMatchupWithPath } from "../src/optimizer/bestBuildsRuntime";

const BUILD = {
  venerationStage: 5,
  traits: ["Damage", "Bite"] as [string, string],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"] as [string, string, string, string, string],
  plushies: ["Void", "Void"] as [string, string],
};
const THRESHOLD = 0.3;

async function main() {
  await loadRustMatchupBridge();

  const source = "Kendyll";
  const sourceCreature = creatureByName[source]!;
  const finalA = applyRulesAndBuild(sourceCreature, BUILD);
  const opponents = Object.keys(creatureByName).filter((n) => n !== source);

  // TS run (bridge disabled → falls through to TS fallback path)
  setRustMatchupBridgeForceDisabled(true);
  const tsRows = new Map<string, { winner: string; ttk: number; survival: number; path: string }>();
  for (const name of opponents) {
    const opp = creatureByName[name]!;
    const { summary, path } = simulateBestBuildMatchupWithPath({
      sourceCreature, finalA, opponentCreature: opp,
      activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
    });
    tsRows.set(name, { winner: summary.winner, ttk: summary.ttkAtoB, survival: summary.deathTimeA ?? summary.maxTimeSec, path });
  }

  // Rust run
  setRustMatchupBridgeForceDisabled(false);
  const rustRows = new Map<string, { winner: string; ttk: number; survival: number; path: string }>();
  for (const name of opponents) {
    const opp = creatureByName[name]!;
    const { summary, path } = simulateBestBuildMatchupWithPath({
      sourceCreature, finalA, opponentCreature: opp,
      activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
    });
    rustRows.set(name, { winner: summary.winner, ttk: summary.ttkAtoB, survival: summary.deathTimeA ?? summary.maxTimeSec, path });
  }

  const diffs: Array<{
    name: string; metric: string; ts: number; rust: number; diff: number;
    tsWinner: string; rustWinner: string; rustPath: string;
  }> = [];
  const tsOnly = 0;
  let bothFallback = 0;

  for (const name of opponents) {
    const ts = tsRows.get(name)!;
    const rust = rustRows.get(name)!;
    // When bridge is disabled, TS always returns "ts_emergency_fallback" — that's the expected TS path, keep it.
    // Skip only when Rust itself falls back to TS (guarded/ts_fallback) — that means Rust doesn't cover this matchup.
    const rustFallback = rust.path === "ts_guarded_fallback" || rust.path === "ts_fallback";
    if (rustFallback) { bothFallback++; continue; }

    const ttkDiff = Math.abs(ts.ttk - rust.ttk);
    if (ttkDiff > THRESHOLD) {
      diffs.push({ name, metric: "ttkAtoB", ts: ts.ttk, rust: rust.ttk, diff: ttkDiff, tsWinner: ts.winner, rustWinner: rust.winner, rustPath: rust.path });
    }
    const survDiff = Math.abs(ts.survival - rust.survival);
    if (survDiff > THRESHOLD) {
      diffs.push({ name, metric: "survival", ts: ts.survival, rust: rust.survival, diff: survDiff, tsWinner: ts.winner, rustWinner: rust.winner, rustPath: rust.path });
    }
  }

  diffs.sort((a, b) => b.diff - a.diff);
  const winnerMismatches = diffs.filter((d) => d.tsWinner !== d.rustWinner);

  console.log(`Threshold: ${THRESHOLD}s | Total opponents: ${opponents.length}`);
  console.log(`Rust fallbacks (skipped): ${bothFallback} | TS path anomalies: ${tsOnly}`);
  console.log(`Timing diffs > ${THRESHOLD}s: ${diffs.length} (${winnerMismatches.length} with winner mismatch)`);

  if (diffs.length === 0) {
    console.log("All composable matchups within 0.3s — timing parity OK.");
    return;
  }
  console.log("\nTop timing divergences:");
  for (const d of diffs.slice(0, 40)) {
    const wNote = d.tsWinner !== d.rustWinner ? ` [WINNER: TS=${d.tsWinner} Rust=${d.rustWinner}]` : ` [winner=${d.tsWinner}]`;
    console.log(`  ${d.name}: ${d.metric} TS=${d.ts.toFixed(2)}s Rust=${d.rust.toFixed(2)}s diff=${d.diff.toFixed(2)}s${wNote}`);
  }
}

main().catch((e) => { setRustMatchupBridgeForceDisabled(false); console.error(e); process.exitCode = 1; });
