import { applyRulesAndBuild } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { loadRustMatchupBridge } from "../src/optimizer/rustMatchupLoader";
import { simulateBestBuildMatchupWithPath, buildBestBuildsOpponentFinal } from "../src/optimizer/bestBuildsRuntime";
import { simulateBestBuildsMatchupContract } from "../src/optimizer/bestBuildsMatchupContract";

const BUILD = {
  venerationStage: 5,
  traits: ["Damage", "Bite"] as [string, string],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"] as [string, string, string, string, string],
  plushies: ["Void", "Void"] as [string, string],
};
const NO_OP = new Set(["Geoptxina", "Mag'Masta", "Yohsog", "Lotremum", "Aidoneiscus", "Irizah"]);

async function main() {
  await loadRustMatchupBridge();
  const source = "Kendyll";
  const sourceCreature = creatureByName[source]!;
  const finalA = applyRulesAndBuild(sourceCreature, BUILD);

  let total = 0, composable = 0, fallback = 0, wrong = 0;
  const wrongDetails: string[] = [];
  const fallbackDetails: string[] = [];

  for (const opponentName of Object.keys(creatureByName)) {
    if (opponentName === source) continue;
    total++;
    const opponentCreature = creatureByName[opponentName]!;
    const result = simulateBestBuildMatchupWithPath({
      sourceCreature, finalA, opponentCreature,
      activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
    });
    if (result.path.includes("fallback") || result.path.includes("guarded")) {
      fallback++;
      fallbackDetails.push(`  ${opponentName}: path=${result.path}`);
      continue;
    }
    composable++;

    let finalB = buildBestBuildsOpponentFinal(opponentCreature);
    const strip = NO_OP.has(opponentName) && !finalA.hasBreath && finalB.hasBreath;
    if (strip) finalB = { ...finalB, hasBreath: false, breathType: null };

    const tsSummary = simulateBestBuildsMatchupContract({
      finalA, finalB,
      activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
    });
    if (tsSummary.winner !== result.summary.winner) {
      wrong++;
      wrongDetails.push(`  ${opponentName}: TS=${tsSummary.winner} Rust=${result.summary.winner}`);
    }
  }

  console.log(`total=${total} composable=${composable} fallback=${fallback} wrongWinner=${wrong}`);
  if (fallbackDetails.length > 0) { console.log("Fallbacks:"); for (const d of fallbackDetails) console.log(d); }
  if (wrongDetails.length > 0) { console.log("Wrong winners:"); for (const d of wrongDetails) console.log(d); }
}
main().catch(console.error);
