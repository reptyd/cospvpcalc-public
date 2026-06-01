import { creatureByName } from "../src/engine/data";
import { buildDefaultMetaPool, buildAdaptiveQuickOpponents, type DefaultPoolScope } from "../src/optimizer/poolUtils";
import { generateBuildCandidates } from "../src/optimizer/candidateGeneration";
import { buildOptimizerContext } from "../src/optimizer/contextAndCompare";
import { memoizedApplyRulesAndBuild, clearBuildCache } from "../src/optimizer/bestBuildsOptimizations";
import { buildBestBuildsOpponentFinal } from "../src/optimizer/bestBuildsRuntime";
import {
  isDeferredAbility,
  isModeledOtherAbility,
  isOutOfModelAbility,
  normalizeAbilityName,
} from "../src/optimizer/abilityCoverageRegistry";
import {
  isRustActiveMeleeEligible,
  isRustBreathEligible,
  isRustCursedSigilBreathEligible,
  isRustCursedSigilStatusMeleeEligible,
  isRustFortifyBreathEligible,
  isRustRadiationBreathEligible,
  isRustFortifyStatusMeleeEligible,
  isRustLifeLeechBreathEligible,
  isRustAdrenalineBreathEligible,
  isRustDrowsyAreaBreathEligible,
  isRustHuntersCurseBreathEligible,
  isRustRewindBreathEligible,
  isRustUnbridledRageBreathEligible,
  isRustLifeLeechMeleeEligible,
  isRustSimpleMeleeEligible,
  isRustStatusMeleeEligible,
  getRustBlockingActivatedAbilityNamesForPassiveContours,
  getRustBreathIneligibilityReasons,
  getRustActiveMeleeIneligibilityReasons,
  getRustLifeLeechMeleeIneligibilityReasons,
  getRustSimpleMeleeIneligibilityReasons,
  getRustStatusMeleeIneligibilityReasons,
  getRustUnsupportedPassiveAbilityNamesForBreath,
  getRustUnsupportedActivatedAbilityNamesForActiveMelee,
  getRustUnsupportedPassiveAbilityNamesForActiveMelee,
} from "../src/optimizer/rustBestBuildsRuntime";

type CliConfig = {
  sourceName: string;
  poolMode: "meta40" | "meta60" | "meta80";
  poolScope: DefaultPoolScope;
};

function parseArgs(): CliConfig {
  const sourceName = process.argv[2] ?? "Kendyll";
  const poolModeArg = process.argv[3] ?? "meta80";
  const poolScopeArg = process.argv[4] ?? "withinOneTier";

  if (!["meta40", "meta60", "meta80"].includes(poolModeArg)) {
    throw new Error(`Unsupported pool mode: ${poolModeArg}`);
  }
  if (!["sameOrHigher", "sameOrLower", "withinOneTier"].includes(poolScopeArg)) {
    throw new Error(`Unsupported pool scope: ${poolScopeArg}`);
  }

  return {
    sourceName,
    poolMode: poolModeArg as CliConfig["poolMode"],
    poolScope: poolScopeArg as DefaultPoolScope,
  };
}

function buildCounterMap() {
  return new Map<string, number>();
}

function buildReasonStats() {
  return new Map<string, number>();
}

function incrementReasonStats(
  reasonStats: Map<string, number>,
  reasons: string[],
) {
  for (const reason of reasons) {
    reasonStats.set(reason, (reasonStats.get(reason) ?? 0) + 1);
  }
}

function report(label: string, eligible: number, total: number, reasonStats: Map<string, number>) {
  console.log(`${label}: ${eligible}/${total} eligible (${((eligible / Math.max(1, total)) * 100).toFixed(2)}%)`);
  const sorted = Array.from(reasonStats.entries()).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sorted) {
    console.log(`  - ${reason}: ${count}`);
  }
}

function incrementNames(stats: Map<string, number>, names: string[], weight = 1) {
  for (const name of names) {
    stats.set(name, (stats.get(name) ?? 0) + weight);
  }
}

function reportCounterMap(label: string, stats: Map<string, number>) {
  const sorted = Array.from(stats.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    console.log(`${label}: none`);
    return;
  }
  console.log(label);
  for (const [name, count] of sorted.slice(0, 12)) {
    console.log(`  - ${name}: ${count}`);
  }
}

type AbilityCoverageClass = "modeled" | "partial" | "deferred" | "out-of-model" | "not-modeled";

function classifyAbility(name: string): AbilityCoverageClass {
  const normalized = normalizeAbilityName(name);
  if (normalized === normalizeAbilityName("Lich Mark")) return "partial";
  if (isOutOfModelAbility(name)) return "out-of-model";
  if (isDeferredAbility(name)) return "deferred";
  if (isModeledOtherAbility(name)) return "modeled";
  return "not-modeled";
}

function splitCounterMapByCoverage(stats: Map<string, number>) {
  const modeled = new Map<string, number>();
  const partial = new Map<string, number>();
  const deferred = new Map<string, number>();
  const unresolved = new Map<string, number>();
  for (const [name, count] of stats.entries()) {
    const status = classifyAbility(name);
    const bucket =
      status === "modeled"
        ? modeled
        : status === "partial"
          ? partial
          : status === "deferred"
            ? deferred
            : unresolved;
    bucket.set(name, count);
  }
  return { modeled, partial, deferred, unresolved };
}

async function main() {
  const config = parseArgs();
  const creature = creatureByName[config.sourceName];
  if (!creature) {
    throw new Error(`Unknown creature: ${config.sourceName}`);
  }

  clearBuildCache();

  const poolSize = config.poolMode === "meta40" ? 40 : config.poolMode === "meta80" ? 80 : 60;
  const activePool = buildDefaultMetaPool(config.sourceName, poolSize, config.poolScope);
  const quickPool = buildAdaptiveQuickOpponents(activePool, Math.min(20, activePool.length));
  const context = buildOptimizerContext(creature, creature, "solo");
  context.soloMode = "dummy";
  const candidates = generateBuildCandidates({
    soloMode: "dummy",
    quality: "quality",
    optimizePlushies: true,
    searchAllVeneration: false,
    fixedVenerationStage: 5,
    searchToggles: false,
    goal: "lexicographic",
    context,
  });

  const opponentFinals = new Map<string, ReturnType<typeof buildBestBuildsOpponentFinal>>();
  for (const opponentName of activePool) {
    const opponentCreature = creatureByName[opponentName];
    if (!opponentCreature) continue;
    opponentFinals.set(opponentName, buildBestBuildsOpponentFinal(opponentCreature));
  }

  const stage1ReasonStats = buildReasonStats();
  const stage2ReasonStats = buildReasonStats();
  const activeStage1ReasonStats = buildReasonStats();
  const activeStage2ReasonStats = buildReasonStats();
  const breathStage1ReasonStats = buildReasonStats();
  const breathStage2ReasonStats = buildReasonStats();
  const lifeLeechStage1ReasonStats = buildReasonStats();
  const lifeLeechStage2ReasonStats = buildReasonStats();
  const statusStage1ReasonStats = buildReasonStats();
  const statusStage2ReasonStats = buildReasonStats();
  const activeStage2SourcePassiveBlockers = buildCounterMap();
  const activeStage2SourceActivatedBlockers = buildCounterMap();
  const activeStage2DefenderPassiveBlockers = buildCounterMap();
  const activeStage2DefenderActivatedBlockers = buildCounterMap();
  const breathStage2DefenderPassiveBlockers = buildCounterMap();
  const breathStage2DefenderActivatedBlockers = buildCounterMap();
  const breathStage2DefenderUnsupportedBreaths = buildCounterMap();
  const statusStage2DefenderActivatedBlockers = buildCounterMap();
  const runtimeStage1PathStats = buildCounterMap();
  const runtimeStage2PathStats = buildCounterMap();
  let stage1Eligible = 0;
  let stage1Total = 0;
  let stage2Eligible = 0;
  let stage2Total = 0;
  let activeStage1Eligible = 0;
  let activeStage1Total = 0;
  let activeStage2Eligible = 0;
  let activeStage2Total = 0;
  let breathStage1Eligible = 0;
  let breathStage1Total = 0;
  let breathStage2Eligible = 0;
  let breathStage2Total = 0;
  let lifeLeechStage1Eligible = 0;
  let lifeLeechStage1Total = 0;
  let lifeLeechStage2Eligible = 0;
  let lifeLeechStage2Total = 0;
  let statusStage1Eligible = 0;
  let statusStage1Total = 0;
  let statusStage2Eligible = 0;
  let statusStage2Total = 0;
  let runtimeStage1Eligible = 0;
  let runtimeStage1Total = 0;
  let runtimeStage2Eligible = 0;
  let runtimeStage2Total = 0;

  function classifyRuntimePath({
    sourceCreature,
    opponentCreature,
    finalA,
    finalB,
    activesOn,
    breathOn,
    abilityPolicy,
  }: {
    sourceCreature: typeof creature;
    opponentCreature: NonNullable<typeof creature>;
    finalA: FinalStats;
    finalB: FinalStats;
    activesOn: boolean;
    breathOn: boolean;
    abilityPolicy: "fast" | "semiIdeal";
  }): string {
    if (
      isRustSimpleMeleeEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        breathOn,
        abilityPolicy,
      })
    ) return "simple_melee";
    if (
      isRustStatusMeleeEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        breathOn,
        abilityPolicy,
      })
    ) return "status_melee";
    if (
      isRustFortifyStatusMeleeEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        breathOn,
        maxTimeSec: 180,
      })
    ) return "fortify_status_melee";
    if (
      isRustCursedSigilStatusMeleeEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        breathOn,
        maxTimeSec: 180,
      })
    ) return "cursed_sigil_status_melee";
    if (
      isRustLifeLeechMeleeEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        breathOn,
        abilityPolicy,
      })
    ) return "life_leech_melee";
    if (
      isRustActiveMeleeEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        breathOn,
        abilityPolicy,
      })
    ) return "active_melee";
    if (
      isRustBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
      })
    ) return "breath";
    if (
      isRustRadiationBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        maxTimeSec: 180,
      })
    ) return "radiation_breath";
    if (
      isRustFortifyBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        maxTimeSec: 180,
      })
    ) return "fortify_breath";
    if (
      isRustLifeLeechBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        abilityPolicy,
      })
    ) return "life_leech_breath";
    if (
      isRustUnbridledRageBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        abilityPolicy,
      })
    ) return "unbridled_rage_breath";
    if (
      isRustAdrenalineBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        abilityPolicy,
      })
    ) return "adrenaline_breath";
    if (
      isRustHuntersCurseBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        abilityPolicy,
      })
    ) return "hunters_curse_breath";
    if (
      isRustDrowsyAreaBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
      })
    ) return "drowsy_area_breath";
    if (
      isRustRewindBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        abilityPolicy,
      })
    ) return "rewind_breath";
    if (
      isRustCursedSigilBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn,
        maxTimeSec: 180,
      })
    ) return "cursed_sigil_breath";
    return "ts_fallback";
  }

  for (const candidate of candidates) {
    const finalA = memoizedApplyRulesAndBuild(creature, candidate.build);

    for (const opponentName of quickPool) {
      const opponentCreature = creatureByName[opponentName];
      const finalB = opponentFinals.get(opponentName);
      if (!opponentCreature || !finalB) continue;
      stage1Total += 1;
      const reasons = getRustSimpleMeleeIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "fast",
      });
      if (reasons.length === 0) stage1Eligible += 1;
      else incrementReasonStats(stage1ReasonStats, reasons);

      activeStage1Total += 1;
      const activeReasons = getRustActiveMeleeIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "fast",
      });
      if (activeReasons.length === 0) activeStage1Eligible += 1;
      else incrementReasonStats(activeStage1ReasonStats, activeReasons);

      breathStage1Total += 1;
      const breathReasons = getRustBreathIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
      });
      if (breathReasons.length === 0) breathStage1Eligible += 1;
      else incrementReasonStats(breathStage1ReasonStats, breathReasons);

      lifeLeechStage1Total += 1;
      const lifeLeechReasons = getRustLifeLeechMeleeIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "fast",
      });
      if (lifeLeechReasons.length === 0) lifeLeechStage1Eligible += 1;
      else incrementReasonStats(lifeLeechStage1ReasonStats, lifeLeechReasons);

      statusStage1Total += 1;
      const statusReasons = getRustStatusMeleeIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "fast",
      });
      if (statusReasons.length === 0) statusStage1Eligible += 1;
      else incrementReasonStats(statusStage1ReasonStats, statusReasons);

      runtimeStage1Total += 1;
      const runtimeStage1Path = classifyRuntimePath({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "fast",
      });
      incrementNames(runtimeStage1PathStats, [runtimeStage1Path]);
      if (runtimeStage1Path !== "ts_fallback") runtimeStage1Eligible += 1;
    }

    for (const opponentName of activePool) {
      const opponentCreature = creatureByName[opponentName];
      const finalB = opponentFinals.get(opponentName);
      if (!opponentCreature || !finalB) continue;
      stage2Total += 1;
      const reasons = getRustSimpleMeleeIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "semiIdeal",
      });
      if (reasons.length === 0) stage2Eligible += 1;
      else incrementReasonStats(stage2ReasonStats, reasons);

      activeStage2Total += 1;
      const activeReasons = getRustActiveMeleeIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "semiIdeal",
      });
      if (activeReasons.length === 0) activeStage2Eligible += 1;
      else {
        incrementReasonStats(activeStage2ReasonStats, activeReasons);
        if (activeReasons.includes("attacker-has-unsupported-passive-ability")) {
          incrementNames(activeStage2SourcePassiveBlockers, getRustUnsupportedPassiveAbilityNamesForActiveMelee(creature));
        }
        if (activeReasons.includes("attacker-has-unsupported-activated-ability")) {
          incrementNames(activeStage2SourceActivatedBlockers, getRustUnsupportedActivatedAbilityNamesForActiveMelee(creature));
        }
        if (activeReasons.includes("defender-has-unsupported-passive-ability")) {
          incrementNames(
            activeStage2DefenderPassiveBlockers,
            getRustUnsupportedPassiveAbilityNamesForActiveMelee(opponentCreature),
          );
        }
        if (activeReasons.includes("defender-has-unsupported-activated-ability")) {
          incrementNames(
            activeStage2DefenderActivatedBlockers,
            getRustUnsupportedActivatedAbilityNamesForActiveMelee(opponentCreature),
          );
        }
      }

      breathStage2Total += 1;
      const breathReasons = getRustBreathIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
      });
      if (breathReasons.length === 0) breathStage2Eligible += 1;
      else {
        incrementReasonStats(breathStage2ReasonStats, breathReasons);
        if (breathReasons.includes("opponent-has-activated-abilities")) {
          incrementNames(
            breathStage2DefenderActivatedBlockers,
            getRustBlockingActivatedAbilityNamesForPassiveContours(opponentCreature),
          );
        }
        if (breathReasons.includes("defender-has-unsupported-passive-ability")) {
          incrementNames(
            breathStage2DefenderPassiveBlockers,
            getRustUnsupportedPassiveAbilityNamesForBreath(opponentCreature),
          );
        }
        if (breathReasons.includes("defender-has-unsupported-breath") && finalB.breathType) {
          incrementNames(breathStage2DefenderUnsupportedBreaths, [finalB.breathType]);
        }
      }

      lifeLeechStage2Total += 1;
      const lifeLeechReasons = getRustLifeLeechMeleeIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "semiIdeal",
      });
      if (lifeLeechReasons.length === 0) lifeLeechStage2Eligible += 1;
      else incrementReasonStats(lifeLeechStage2ReasonStats, lifeLeechReasons);

      statusStage2Total += 1;
      const statusReasons = getRustStatusMeleeIneligibilityReasons({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "semiIdeal",
      });
      if (statusReasons.length === 0) statusStage2Eligible += 1;
      else {
        incrementReasonStats(statusStage2ReasonStats, statusReasons);
        if (statusReasons.includes("opponent-has-activated-abilities")) {
          incrementNames(
            statusStage2DefenderActivatedBlockers,
            getRustBlockingActivatedAbilityNamesForPassiveContours(opponentCreature),
          );
        }
      }

      runtimeStage2Total += 1;
      const runtimeStage2Path = classifyRuntimePath({
        sourceCreature: creature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        abilityPolicy: "semiIdeal",
      });
      incrementNames(runtimeStage2PathStats, [runtimeStage2Path]);
      if (runtimeStage2Path !== "ts_fallback") runtimeStage2Eligible += 1;
    }
  }

  console.log(`Creature: ${config.sourceName}`);
  console.log(`Pool mode: ${config.poolMode}`);
  console.log(`Pool scope: ${config.poolScope}`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Quick pool: ${quickPool.length}`);
  console.log(`Active pool: ${activePool.length}`);
  report("Stage1 eligibility", stage1Eligible, stage1Total, stage1ReasonStats);
  report("Stage2 eligibility", stage2Eligible, stage2Total, stage2ReasonStats);
  report("Status stage1 eligibility", statusStage1Eligible, statusStage1Total, statusStage1ReasonStats);
  report("Status stage2 eligibility", statusStage2Eligible, statusStage2Total, statusStage2ReasonStats);
  report("Runtime stage1 coverage", runtimeStage1Eligible, runtimeStage1Total, new Map());
  reportCounterMap("Runtime stage1 selected paths", runtimeStage1PathStats);
  report("Runtime stage2 coverage", runtimeStage2Eligible, runtimeStage2Total, new Map());
  reportCounterMap("Runtime stage2 selected paths", runtimeStage2PathStats);
  report("Active stage1 eligibility", activeStage1Eligible, activeStage1Total, activeStage1ReasonStats);
  report("Active stage2 eligibility", activeStage2Eligible, activeStage2Total, activeStage2ReasonStats);
  report("Breath stage1 eligibility", breathStage1Eligible, breathStage1Total, breathStage1ReasonStats);
  report("Breath stage2 eligibility", breathStage2Eligible, breathStage2Total, breathStage2ReasonStats);
  report("Life Leech stage1 eligibility", lifeLeechStage1Eligible, lifeLeechStage1Total, lifeLeechStage1ReasonStats);
  report("Life Leech stage2 eligibility", lifeLeechStage2Eligible, lifeLeechStage2Total, lifeLeechStage2ReasonStats);
  reportCounterMap("Active stage2 source passive blockers", activeStage2SourcePassiveBlockers);
  reportCounterMap("Active stage2 source activated blockers", activeStage2SourceActivatedBlockers);
  const activePassiveSplit = splitCounterMapByCoverage(activeStage2DefenderPassiveBlockers);
  const activeActivatedSplit = splitCounterMapByCoverage(activeStage2DefenderActivatedBlockers);
  const statusActivatedSplit = splitCounterMapByCoverage(statusStage2DefenderActivatedBlockers);
  const breathPassiveSplit = splitCounterMapByCoverage(breathStage2DefenderPassiveBlockers);
  const breathActivatedSplit = splitCounterMapByCoverage(breathStage2DefenderActivatedBlockers);
  reportCounterMap("Active stage2 defender passive blockers (TS-modeled)", activePassiveSplit.modeled);
  reportCounterMap("Active stage2 defender passive blockers (TS-partial)", activePassiveSplit.partial);
  reportCounterMap("Active stage2 defender passive blockers (TS-deferred)", activePassiveSplit.deferred);
  reportCounterMap("Active stage2 defender passive blockers (TS-unresolved)", activePassiveSplit.unresolved);
  reportCounterMap("Active stage2 defender activated blockers (TS-modeled)", activeActivatedSplit.modeled);
  reportCounterMap("Active stage2 defender activated blockers (TS-partial)", activeActivatedSplit.partial);
  reportCounterMap("Active stage2 defender activated blockers (TS-deferred)", activeActivatedSplit.deferred);
  reportCounterMap("Active stage2 defender activated blockers (TS-unresolved)", activeActivatedSplit.unresolved);
  reportCounterMap("Status stage2 defender activated blockers (TS-modeled)", statusActivatedSplit.modeled);
  reportCounterMap("Status stage2 defender activated blockers (TS-partial)", statusActivatedSplit.partial);
  reportCounterMap("Status stage2 defender activated blockers (TS-deferred)", statusActivatedSplit.deferred);
  reportCounterMap("Status stage2 defender activated blockers (TS-unresolved)", statusActivatedSplit.unresolved);
  reportCounterMap("Breath stage2 defender passive blockers (TS-modeled)", breathPassiveSplit.modeled);
  reportCounterMap("Breath stage2 defender passive blockers (TS-partial)", breathPassiveSplit.partial);
  reportCounterMap("Breath stage2 defender passive blockers (TS-deferred)", breathPassiveSplit.deferred);
  reportCounterMap("Breath stage2 defender passive blockers (TS-unresolved)", breathPassiveSplit.unresolved);
  reportCounterMap("Breath stage2 defender activated blockers (TS-modeled)", breathActivatedSplit.modeled);
  reportCounterMap("Breath stage2 defender activated blockers (TS-partial)", breathActivatedSplit.partial);
  reportCounterMap("Breath stage2 defender activated blockers (TS-deferred)", breathActivatedSplit.deferred);
  reportCounterMap("Breath stage2 defender activated blockers (TS-unresolved)", breathActivatedSplit.unresolved);
  reportCounterMap("Breath stage2 defender unsupported breaths", breathStage2DefenderUnsupportedBreaths);
}

void main();
