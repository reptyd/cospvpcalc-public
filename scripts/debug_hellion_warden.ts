import { applyRulesAndBuild } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { loadRustMatchupBridge } from "../src/optimizer/rustMatchupLoader";
import { buildBestBuildsOpponentFinal } from "../src/optimizer/bestBuildsRuntime";
import { simulateFight } from "../src/engine";

const BUILD = {
  venerationStage: 5,
  traits: ["Damage", "Bite"] as [string, string],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"] as [string, string, string, string, string],
  plushies: ["Void", "Void"] as [string, string],
};

async function main() {
  await loadRustMatchupBridge();

  const source = "Kendyll";
  const sourceCreature = creatureByName[source]!;
  const finalA = applyRulesAndBuild(sourceCreature, BUILD);

  const opponentName = "Hellion Warden";
  const opponentCreature = creatureByName[opponentName]!;
  const finalB = buildBestBuildsOpponentFinal(opponentCreature);

  console.log("FinalB health:", finalB.health, "damage:", finalB.damage);

  for (const policy of ["fast", "ideal"] as const) {
    console.log(`\n=== TS ${policy} policy ===`);
    const result = simulateFight(finalA, finalB, {
      activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: policy,
      badOmenOutcome: "skip" as any, compareNoMoveFacetank: true,
    });
    console.log("winner:", result.winner, "deathA:", result.deathTimeA?.toFixed(2), "deathB:", result.deathTimeB?.toFixed(2));

    // Access ability timing events - they're on the state objects
    if ((result as any).abilityTimingEventsB) {
      const eventsB = (result as any).abilityTimingEventsB as string[];
      const wardenEvents = eventsB.filter(e => e.includes("Warden") || e.includes("Rewind"));
      if (wardenEvents.length > 0) {
        console.log(`B ability timing events (${wardenEvents.length} Warden/Rewind):`);
        wardenEvents.slice(0, 20).forEach(e => console.log("  ", e));
      }
    }
  }

  // Now let's check what properties finalB has around Rewind and WR
  const bKeys = Object.keys(finalB);
  console.log("\nFinalB relevant keys:", bKeys.filter(k =>
    k.toLowerCase().includes("rewind") || k.toLowerCase().includes("warden") ||
    k.toLowerCase().includes("has") || k.toLowerCase().includes("active")
  ));
}

main().catch(console.error);
