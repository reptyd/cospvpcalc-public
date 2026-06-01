/**
 * Compare TS simulateFight vs Rust composable for the SAME finalA/finalB.
 * Shows first divergence point in timeline.
 * Usage: node --experimental-wasm-modules --import tsx scripts/parity_timeline.ts SourceName OpponentName
 */
import { applyRulesAndBuild, simulateFight } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";
import { simulateBestBuildMatchupWithPath, BEST_BUILDS_BAD_OMEN_OUTCOME, buildBestBuildsOpponentFinal } from "../src/optimizer/bestBuildsRuntime";

const SOURCE = process.argv[2] || "Kendyll";
const OPPONENT = process.argv[3] || "Boreal Warden";

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

  // TS simulateFight (same as Compare would call)
  const tsSim = simulateFight(finalA, finalB, {
    activesOn: true,
    breathOn: true,
    maxTimeSec: 180,
    abilityPolicy: "ideal",
    compareNoMoveFacetank: true,
    badOmenOutcome: BEST_BUILDS_BAD_OMEN_OUTCOME,
    enableCombatLog: true,
  });

  // Rust composable (through simulateBestBuildMatchupWithPath)
  setRustMatchupBridgeForceDisabled(false);
  const rustResult = simulateBestBuildMatchupWithPath({
    sourceCreature: source, finalA, opponentCreature: opp,
    activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
  });
  const r = rustResult.summary;

  console.log(`=== ${SOURCE} vs ${OPPONENT} ===`);
  console.log(`Rust path: ${rustResult.path}`);
  console.log();
  console.log(`            TS            Rust          Delta`);
  console.log(`winner:     ${tsSim.winner.padEnd(14)}${r.winner.padEnd(14)}${tsSim.winner === r.winner ? "OK" : "MISMATCH!"}`);
  console.log(`ttkAtoB:    ${tsSim.ttkAtoB.toFixed(4).padEnd(14)}${r.ttkAtoB.toFixed(4).padEnd(14)}${Math.abs(tsSim.ttkAtoB - r.ttkAtoB).toFixed(4)}`);
  console.log(`deathTimeA: ${(tsSim.deathTimeA?.toFixed(4) ?? "null").padEnd(14)}${(r.deathTimeA?.toFixed(4) ?? "null").padEnd(14)}${Math.abs((tsSim.deathTimeA ?? 180) - (r.deathTimeA ?? 180)).toFixed(4)}`);
  console.log(`dpsAtoB:    ${tsSim.dpsAtoB.toFixed(4).padEnd(14)}${r.dpsAtoB.toFixed(4).padEnd(14)}${Math.abs(tsSim.dpsAtoB - r.dpsAtoB).toFixed(4)}`);
  console.log(`damageA:    ${tsSim.damageDealtA.toFixed(0).padEnd(14)}${r.damageDealtA.toFixed(0).padEnd(14)}${Math.abs(tsSim.damageDealtA - r.damageDealtA).toFixed(0)}`);

  // TS ability timing events
  const tsEvents = [...(tsSim.abilityTimingEventsA || []), ...(tsSim.abilityTimingEventsB || [])];
  if (tsEvents.length > 0) {
    console.log(`\n--- TS Ability Events (${tsEvents.length}) ---`);
    for (const e of tsEvents.slice(0, 20)) console.log(`  ${e}`);
    if (tsEvents.length > 20) console.log(`  ... and ${tsEvents.length - 20} more`);
  }

  // TS combat log — show all events around death time
  const tsLog = tsSim.combatLog || [];
  if (tsLog.length > 0) {
    const deathTime = tsSim.deathTimeA ?? tsSim.deathTimeB ?? 180;
    const windowStart = deathTime - 5;
    const windowEnd = deathTime + 2;
    const deathWindow = tsLog.filter((e: any) => e.time >= windowStart && e.time <= windowEnd);
    if (deathWindow.length > 0) {
      console.log(`\n--- TS Combat Log around death (t=${windowStart.toFixed(2)} to ${windowEnd.toFixed(2)}) ---`);
      for (const e of deathWindow) {
        const side = (e as any).hpSide || (e as any).attacker || "?";
        console.log(`  t=${(e as any).time?.toFixed(4)} [${side}] hp=${(e as any).hpAfter?.toFixed(2)} ${(e as any).type}: ${(e as any).description} ${(e as any).detail || ""}`);
      }
    }

    // Show regen events
    const regenEvents = tsLog.filter((e: any) => e.description?.includes("regen") || e.description?.includes("Regen"));
    if (regenEvents.length > 0) {
      console.log(`\n--- TS Regen Events (${regenEvents.length}) ---`);
      for (const e of regenEvents) {
        console.log(`  t=${(e as any).time?.toFixed(4)} hp=${(e as any).hpAfter?.toFixed(2)} ${(e as any).description} healing=${(e as any).healing?.toFixed(2)}`);
      }
    } else {
      console.log(`\n--- No TS Regen events (likely blocked by Bleed disablesHpRegen) ---`);
    }
  }

  // Show opponent abilities for context
  console.log(`\n--- Context ---`);
  console.log(`${SOURCE}: hp=${source.stats.health} dmg=${source.stats.damage} cd=${source.stats.biteCooldown} breath=${source.stats.breath}`);
  console.log(`${SOURCE} actives: ${source.activatedAbilities?.map((a: any) => a.name).join(", ") || "none"}`);
  console.log(`${OPPONENT}: hp=${opp.stats.health} dmg=${opp.stats.damage} cd=${opp.stats.biteCooldown} breath=${opp.stats.breath}`);
  console.log(`${OPPONENT} actives: ${opp.activatedAbilities?.map((a: any) => a.name).join(", ") || "none"}`);
  console.log(`${OPPONENT} passives: ${opp.passiveAbilities?.map((a: any) => a.name).join(", ") || "none"}`);
}

main().catch((e) => { setRustMatchupBridgeForceDisabled(false); console.error(e); process.exitCode = 1; });
