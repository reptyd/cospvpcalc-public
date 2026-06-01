/**
 * Parity check: Rust BB vs TS BB for a single source creature.
 * Usage: node --experimental-wasm-modules --import tsx scripts/parity_check.ts [CreatureName]
 */
import { applyRulesAndBuild, simulateFight } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";
import { simulateBestBuildMatchupWithPath, BEST_BUILDS_BAD_OMEN_OUTCOME, buildBestBuildsOpponentFinal } from "../src/optimizer/bestBuildsRuntime";

const BUILD = {
  venerationStage: 5,
  traits: ["Damage", "Bite"] as [string, string],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"] as [string, string, string, string, string],
  plushies: ["Void", "Void"] as [string, string],
};

const SOURCE = process.argv[2] || "Kendyll";

async function main() {
  await loadRustMatchupBridge();
  const source = creatureByName[SOURCE];
  if (!source) { console.error("Unknown creature:", SOURCE); process.exit(1); }
  const finalA = applyRulesAndBuild(source, BUILD);
  const opponents = Object.keys(creatureByName).filter((n) => n !== SOURCE);

  let wrongWinners = 0;
  let ttkGt1 = 0;
  let ttkGt01 = 0;
  let survGt1 = 0;
  const issues: Array<{ name: string; type: string; detail: string }> = [];

  for (const name of opponents) {
    const opp = creatureByName[name]!;

    let rust, tsSim;
    try {
      rust = simulateBestBuildMatchupWithPath({
        sourceCreature: source, finalA, opponentCreature: opp,
        activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
      });

      if (rust.path.includes("fallback") || rust.path.includes("skipped")) continue;

      // Run TS through the same routing (NO_OP breath strip, etc.) by
      // disabling Rust bridge temporarily and calling the same entry point.
      setRustMatchupBridgeForceDisabled(true);
      const tsResult = simulateBestBuildMatchupWithPath({
        sourceCreature: source, finalA, opponentCreature: opp,
        activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
      });
      setRustMatchupBridgeForceDisabled(false);
      tsSim = tsResult.summary;
    } catch (e) {
      setRustMatchupBridgeForceDisabled(false);
      continue;
    }

    const r = rust.summary;
    const ttkDiff = Math.abs(r.ttkAtoB - tsSim.ttkAtoB);
    const survDiff = Math.abs((r.deathTimeA ?? 180) - (tsSim.deathTimeA ?? 180));

    if (r.winner !== tsSim.winner) {
      wrongWinners++;
      issues.push({ name, type: "WRONG_WINNER", detail: `Rust=${r.winner} TS=${tsSim.winner} ttkR=${r.ttkAtoB.toFixed(2)} ttkT=${tsSim.ttkAtoB.toFixed(2)}` });
    }
    if (ttkDiff > 1.0) {
      ttkGt1++;
      issues.push({ name, type: "TTK>1s", detail: `diff=${ttkDiff.toFixed(2)} R=${r.ttkAtoB.toFixed(2)} T=${tsSim.ttkAtoB.toFixed(2)} path=${rust.path}` });
    } else if (ttkDiff > 0.1) {
      ttkGt01++;
    }
    if (survDiff > 1.0) {
      survGt1++;
    }
  }
  console.log(`=== Parity: ${SOURCE} vs ${opponents.length} opponents (ideal) ===`);
  console.log(`Wrong winners: ${wrongWinners}`);
  console.log(`ttkAtoB >1s: ${ttkGt1} | >0.1s: ${ttkGt01 + ttkGt1}`);
  console.log(`Survival >1s: ${survGt1}`);

  if (issues.length > 0) {
    console.log(`\nIssues (${issues.length}):`);
    issues.sort((a, b) => (a.type === "WRONG_WINNER" ? -1 : 1) - (b.type === "WRONG_WINNER" ? -1 : 1));
    for (const i of issues.slice(0, 30)) {
      console.log(`  [${i.type}] ${i.name}: ${i.detail}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
