// Counts simulation paths (composable_melee / composable_breath / ts_fallback
// / ts_fallback_skipped_ideal / ts_guarded_fallback / ts_emergency_fallback)
// for a single source creature vs a meta opponent pool under each policy.
//
// Goal: answer whether the BB `reallyFast` 2× regression is driven by
// policy-dependent fallback branching in bestBuildsRuntime.ts (reallyFast
// runs the full TS sim, ideal returns an instant Draw stub).
//
// Run:
//   npx tsx scripts/profile_bb_path_distribution.ts
//   PROFILE_CREATURE=Kendyll npx tsx scripts/profile_bb_path_distribution.ts

import { creatureByName } from "../src/engine/creatureData";
import type { AbilityTimingMode } from "../src/engine";
import { memoizedApplyRulesAndBuild } from "../src/optimizer/bestBuildsOptimizations";
import { simulateBestBuildMatchupWithPath } from "../src/optimizer/bestBuildsRuntime";
import { buildDefaultMetaPool } from "../src/optimizer/poolUtils";
import { loadRustMatchupBridge } from "../src/optimizer/rustMatchupLoader";

const SOURCE = process.env.PROFILE_CREATURE?.trim() || "Kendyll";
const POOL_SIZE = Number(process.env.PROFILE_POOL_SIZE ?? "60");
const POOL_SCOPE = process.env.PROFILE_POOL_SCOPE ?? "withinOneTier";

const SOURCE_BUILD = {
  venerationStage: 5,
  traits: ["Damage", "Bite"] as string[],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"] as string[],
  plushies: ["Void", "Void"] as string[],
  elder: "Powerful" as const,
};

async function main(): Promise<void> {
  const source = creatureByName[SOURCE];
  if (!source) throw new Error(`Unknown creature: ${SOURCE}`);
  await loadRustMatchupBridge().catch(() => null);

  const pool = buildDefaultMetaPool(SOURCE, POOL_SIZE, POOL_SCOPE);
  const finalA = memoizedApplyRulesAndBuild(source, SOURCE_BUILD);

  const policies: AbilityTimingMode[] = ["reallyFast", "fast", "semiIdeal", "ideal"];
  const paramSets = [
    { activesOn: true, breathOn: true, label: "actives+breath" },
    { activesOn: true, breathOn: false, label: "actives_only" },
    { activesOn: false, breathOn: true, label: "breath_only" },
    { activesOn: false, breathOn: false, label: "bare" },
  ];

  console.log(`Source: ${SOURCE}  Pool size: ${pool.length}`);
  for (const paramSet of paramSets) {
    console.log(`\n=== ${paramSet.label} (activesOn=${paramSet.activesOn} breathOn=${paramSet.breathOn}) ===`);
    for (const policy of policies) {
      const counts = new Map<string, number>();
      const start = performance.now();
      for (const opponentName of pool) {
        const opponent = creatureByName[opponentName];
        if (!opponent) continue;
        const result = simulateBestBuildMatchupWithPath({
          sourceCreature: source,
          finalA,
          opponentCreature: opponent,
          activesOn: paramSet.activesOn,
          breathOn: paramSet.breathOn,
          maxTimeSec: 90,
          abilityPolicy: policy,
        });
        counts.set(result.path, (counts.get(result.path) ?? 0) + 1);
      }
      const elapsed = performance.now() - start;
      const pathStr = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([path, n]) => `${path}=${n}`)
        .join(" ");
      console.log(`  ${policy.padStart(10)}  ${elapsed.toFixed(0).padStart(6)}ms  ${pathStr}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
