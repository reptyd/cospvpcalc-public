import { applyRulesAndBuild, simulateFight } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";
import { simulateBestBuildMatchupWithPath } from "../src/optimizer/bestBuildsRuntime";
import { BEST_BUILDS_BAD_OMEN_OUTCOME } from "../src/optimizer/bestBuildsRuntime";

const BUILD = {
  venerationStage: 5,
  traits: ["Damage", "Bite"] as [string, string],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"] as [string, string, string, string, string],
  plushies: ["Void", "Void"] as [string, string],
};

const TARGET = process.argv[2] || "Moluna";

async function main() {
  await loadRustMatchupBridge();

  const source = "Kendyll";
  const sourceCreature = creatureByName[source]!;
  const finalA = applyRulesAndBuild(sourceCreature, BUILD);
  const opp = creatureByName[TARGET]!;

  // TS run
  setRustMatchupBridgeForceDisabled(true);
  const tsResult = simulateBestBuildMatchupWithPath({
    sourceCreature, finalA, opponentCreature: opp,
    activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
  });

  // Rust run
  setRustMatchupBridgeForceDisabled(false);
  const rustResult = simulateBestBuildMatchupWithPath({
    sourceCreature, finalA, opponentCreature: opp,
    activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
  });

  console.log(`=== ${source} vs ${TARGET} at ideal policy ===`);
  console.log(`\nTS path: ${tsResult.path}`);
  console.log(`Rust path: ${rustResult.path}`);

  console.log(`\n--- TS Summary ---`);
  const ts = tsResult.summary;
  console.log(`  winner: ${ts.winner}`);
  console.log(`  ttkAtoB: ${ts.ttkAtoB.toFixed(4)}`);
  console.log(`  deathTimeA: ${ts.deathTimeA?.toFixed(4) ?? "null"}`);
  console.log(`  dpsAtoB: ${ts.dpsAtoB.toFixed(4)}`);
  console.log(`  damageDealtA: ${ts.damageDealtA.toFixed(4)}`);
  console.log(`  damageDealtAAtBDeath: ${ts.damageDealtAAtBDeath.toFixed(4)}`);
  console.log(`  extendedDamagePotentialA: ${ts.extendedDamagePotentialA.toFixed(4)}`);

  console.log(`\n--- Rust Summary ---`);
  const r = rustResult.summary;
  console.log(`  winner: ${r.winner}`);
  console.log(`  ttkAtoB: ${r.ttkAtoB.toFixed(4)}`);
  console.log(`  deathTimeA: ${r.deathTimeA?.toFixed(4) ?? "null"}`);
  console.log(`  dpsAtoB: ${r.dpsAtoB.toFixed(4)}`);
  console.log(`  damageDealtA: ${r.damageDealtA.toFixed(4)}`);
  console.log(`  damageDealtAAtBDeath: ${r.damageDealtAAtBDeath.toFixed(4)}`);
  console.log(`  extendedDamagePotentialA: ${r.extendedDamagePotentialA.toFixed(4)}`);

  console.log(`\n--- Deltas ---`);
  console.log(`  ttkAtoB: ${Math.abs(ts.ttkAtoB - r.ttkAtoB).toFixed(4)}`);
  console.log(`  deathTimeA: ${Math.abs((ts.deathTimeA ?? ts.maxTimeSec) - (r.deathTimeA ?? r.maxTimeSec)).toFixed(4)}`);
  console.log(`  dpsAtoB: ${Math.abs(ts.dpsAtoB - r.dpsAtoB).toFixed(4)}`);
  console.log(`  damageDealtA: ${Math.abs(ts.damageDealtA - r.damageDealtA).toFixed(4)}`);

  // Also run raw TS simulateFight to get full combat log
  const fullSim = simulateFight(finalA, applyRulesAndBuild(opp, { venerationStage: 5, traits: opp.traits?.slice(0, 2) as any ?? ["Damage", "Bite"], ascensionAssignments: ["Damage","Damage","Damage","Damage","Damage"] as any, plushies: ["Void","Void"] as any }), {
    activesOn: true,
    breathOn: true,
    maxTimeSec: 180,
    abilityPolicy: "ideal",
    compareNoMoveFacetank: true,
    badOmenOutcome: BEST_BUILDS_BAD_OMEN_OUTCOME,
  });

  // Print ability timing events from TS
  const timingEvents = [...(fullSim.abilityTimingEventsA || []), ...(fullSim.abilityTimingEventsB || [])].sort();
  if (timingEvents.length > 0) {
    console.log(`\n--- TS Ability Timing Events (first 30) ---`);
    for (const e of timingEvents.slice(0, 30)) {
      console.log(`  ${e}`);
    }
  }
}

main().catch((e) => { setRustMatchupBridgeForceDisabled(false); console.error(e); process.exitCode = 1; });
