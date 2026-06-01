/**
 * Debug survival divergence: compares TS per-event HP trajectory with calculated Rust damage.
 * Focus: why does Rust-Kendyll survive longer than TS-Kendyll?
 * Usage: node --experimental-wasm-modules --import tsx scripts/debug_survival_divergence.ts SourceName OpponentName
 */
import { applyRulesAndBuild, simulateFight } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";
import { simulateBestBuildMatchupWithPath, BEST_BUILDS_BAD_OMEN_OUTCOME, buildBestBuildsOpponentFinal } from "../src/optimizer/bestBuildsRuntime";
const SOURCE = process.argv[2] || "Kendyll";
const OPPONENT = process.argv[3] || "Ghalgeya";

const BUILD = {
  venerationStage: 5,
  traits: ["Damage", "Bite"] as [string, string],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"] as [string, string, string, string, string],
  plushies: ["Void", "Void"] as [string, string],
};

async function main() {
  await loadRustMatchupBridge();

  const source = creatureByName[SOURCE]!;
  const opp = creatureByName[OPPONENT]!;
  const finalA = applyRulesAndBuild(source, BUILD);
  const finalB = buildBestBuildsOpponentFinal(opp);

  // Run TS with combat log
  const tsSim = simulateFight(finalA, finalB, {
    activesOn: true,
    breathOn: true,
    maxTimeSec: 180,
    abilityPolicy: "ideal",
    compareNoMoveFacetank: true,
    badOmenOutcome: BEST_BUILDS_BAD_OMEN_OUTCOME,
    enableCombatLog: true,
  });

  // Get Rust result
  setRustMatchupBridgeForceDisabled(false);
  const rustResult = simulateBestBuildMatchupWithPath({
    sourceCreature: source, finalA, opponentCreature: opp,
    activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
  });
  const r = rustResult.summary;

  console.log(`=== ${SOURCE} vs ${OPPONENT} — Survival divergence debug ===`);
  console.log(`TS deathTimeA=${tsSim.deathTimeA?.toFixed(4)} Rust deathTimeA=${r.deathTimeA?.toFixed(4)} delta=${Math.abs((tsSim.deathTimeA ?? 180) - (r.deathTimeA ?? 180)).toFixed(4)}`);
  console.log();

  // Extract TS melee damage from logs
  const tsLog = tsSim.combatLog || [];

  // Track HP after each hit on A (source), showing melee damage
  const hitsOnA = tsLog.filter((e: any) => e.hpSide === "A" && e.type === "bite");
  const dotsOnA = tsLog.filter((e: any) => e.hpSide === "A" && e.type === "dot");

  console.log(`--- Melee hits on A (${SOURCE}) — total ${hitsOnA.length} ---`);
  const prevHpA = finalA.health;
  for (let i = 0; i < hitsOnA.length; i++) {
    const e = hitsOnA[i] as any;
    // Find preceding HP (from previous bite or dot, whichever is latest before this event)
    const allAEvents = tsLog.filter((ev: any) => ev.hpSide === "A" && ev.time <= e.time);
    const prevEvent = allAEvents[allAEvents.indexOf(e) - 1];
    const hpBefore = prevEvent ? (prevEvent as any).hpAfter : finalA.health;
    const damage = hpBefore - e.hpAfter;
    if (i >= hitsOnA.length - 10) { // Show last 10 hits
      console.log(`  hit#${i} t=${e.time.toFixed(4)} hpBefore=${hpBefore.toFixed(2)} hpAfter=${e.hpAfter.toFixed(2)} meleeDmg=${damage.toFixed(2)}`);
    }
  }

  console.log(`\n--- DOT ticks on A (${SOURCE}) — total ${dotsOnA.length} ---`);
  for (const e of dotsOnA as any[]) {
    console.log(`  t=${e.time.toFixed(4)} hp=${e.hpAfter.toFixed(2)} dmg=${e.damage.toFixed(4)} status=${e.statusId} stacks=${e.detail}`);
  }

  // Show FinalStats
  console.log(`\n--- Stats check ---`);
  console.log(`A (${SOURCE}): health=${finalA.health} damage=${finalA.damage} cd=${finalA.biteCooldown} weight=${finalA.weight} healthRegen=${finalA.healthRegen}`);
  console.log(`A effects.resistStatus:`, JSON.stringify(finalA.effects?.resistStatus));
  console.log(`A plushieStatusBlockPct:`, JSON.stringify(finalA.plushieStatusBlockPct));
  console.log(`A elderStatusBlockPct:`, finalA.elderStatusBlockPct);
  console.log(`B (${OPPONENT}): health=${finalB.health} damage=${finalB.damage} cd=${finalB.biteCooldown} weight=${finalB.weight} healthRegen=${finalB.healthRegen}`);
  console.log(`B effects.applyStatusOnHit:`, JSON.stringify(finalB.effects?.applyStatusOnHit));
  console.log(`B plushieStatusBlockPct:`, JSON.stringify(finalB.plushieStatusBlockPct));
  console.log(`B elderStatusBlockPct:`, finalB.elderStatusBlockPct);
  console.log(`B passives:`, opp.passiveAbilities?.map((a: any) => `${a.name}(${JSON.stringify(a.value)})`).join(", "));
  console.log(`A passives:`, source.passiveAbilities?.map((a: any) => `${a.name}(${JSON.stringify(a.value)})`).join(", "));
  console.log(`A effects:`, JSON.stringify(finalA.effects));

  // Check regen timing: at t=15, how much HP does regen add?
  const regenPct = finalA.healthRegen ?? 0;
  const regenHeal = (finalA.health * regenPct) / 100;
  console.log(`A regen: ${regenPct}% = ${regenHeal} HP per tick (every 15s, at t=15,30,...)`);

  // Simulate Bleed accumulation: 0.9 stacks per hit, decay -1 every 3s
  // Check for float divergence
  const hitInterval = finalB.biteCooldown;
  const bleedPerHit = 0.9;
  let bleedStacks = 0;
  let hitCount = 0;
  let lastDecay = 0;
  for (let t = 0; t <= 21.01; t = (hitCount + 1) * hitInterval) {
    hitCount++;
    bleedStacks += bleedPerHit;
    // Check decay at 3s boundaries
    while (lastDecay + 3 <= t + 1e-9) {
      lastDecay += 3;
      bleedStacks -= 1;
      if (bleedStacks <= 0) break;
    }
  }
  console.log(`\nBleed accumulation sim: after ${hitCount} hits at interval ${hitInterval}, stacks=${bleedStacks} (expected ~34.5 before final decay at t=21)`);
}

main().catch((e) => { setRustMatchupBridgeForceDisabled(false); console.error(e); process.exitCode = 1; });
