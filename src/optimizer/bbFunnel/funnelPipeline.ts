import type { AbilityTimingMode, BuildOptions, CreatureRuntime, TwoFacedMode } from "../../engine";
import { elderOptions } from "../../engine/buildData";
import type { CombatEventPhase } from "../../engine/eventOrdering";
import { enumerateAssignmentsCounts } from "../../shared/buildDomain";
import { buildResultKey } from "../../shared/buildEncoding";
import { buildResultKeyWithoutAscension } from "../runtimeHelpers";
import { memoizedApplyRulesAndBuild, setActiveTwoFacedMode } from "../bestBuildsOptimizations";
import type { BestBuildAggregateResult } from "../bestBuildsFlow";
import { rerankBestBuildsByCommonWinsData, type CommonWinsOutcomeRow } from "../bestBuildsCommonWinsRanking";
import { compareAggregate, type BestBuildAggregate, type BestBuildAggregateObjective } from "../ranking";
import { loadRustMatchupBridge } from "../rustMatchupLoader";
import { collectDiverseSkeletonShortlist, type OptimizerSkeleton } from "../stageSelection";
import type { BestBuildsPathCounts } from "../optimizerWorkerProtocol";
import { selectAnchorProbeBuilds, selectCoarseAnchors, type AnchorScore } from "./anchorSelection";
import { deduplicateBySignature, type CombatSignatureGroup, type FunnelCandidate } from "./combatSignature";
import {
  createFunnelWorkerCellRunner,
  createFunnelWorkerPool,
  funnelWorkerCount,
  planFunnelCells,
  type FunnelBattleSettings,
  type FunnelBuildRef,
  type FunnelCellRunner,
} from "./funnelCellRunner";
import { skylinePrune } from "./skylinePrune";

// ---------------------------------------------------------------------------
// Best Builds funnel pipeline.
//
// Replaces the two-stage (fast screen -> ideal shortlist) search with four
// passes. The screening ones run the gate-only mode; the completion runs
// `completionPolicy`, the caller's own setting, and it alone produces the
// displayed ranking - no build is ever RANKED on a substituted policy, because
// measurement showed a substituted opponent policy picks the wrong #1 for
// `survival` and `immortalDamage`.
//
//   PREPARE  every candidate build -> combat-signature dedup -> skyline prune.
//   PROBE    a few spread builds against every opponent. This is what the run
//            knows about its own pool: what each opponent COSTS THE ENGINE and
//            how well it separates builds.
//   COARSE   survivors x a handful of ANCHOR opponents, picked for
//            discrimination per work unit. This replaces the old pre-score cap,
//            which was lossy: true top-10 builds sat outside it.
//   MID      the coarse shortlist x the opponents the screen can afford at
//            shortlist volume. Which those are comes out of the probe's prices.
//   TOP      the leading band x the opponents that were too dear for MID - the
//            expensive fights, run only where they can change the answer.
//
// Every build that reaches the displayed ranking has been scored against the
// WHOLE pool by real fights; the funnel only decides which builds are worth
// finishing. Per-opponent outcomes come back from the workers, so the ranking
// reuses the existing common-wins machinery without the second full-pool
// re-simulation that used to run on the main thread.
//
// COST ADAPTATION. A fight's cost spans four orders of magnitude across the
// roster, and the difference is the defensive rollout: a source or opponent
// that re-plans Fortify at every tick spends ~92% of its engine work inside the
// planning fork. The screening stages therefore put every search-based ability
// on its gate, and only the leading band is then re-fought against the whole
// pool at the caller's policy. The displayed numbers all come from those
// fights; the screen only decides which builds are worth finishing. The run
// prices itself in the engine's own work unit (`workUnits` off each summary -
// iteration counts, identical on every machine). Nothing here asks what a
// creature carries.
// ---------------------------------------------------------------------------

/** The breath `ideal` policy replays the fight from every moment the breath
 * could fire - the same cost shape as the ability search, and affordable in the
 * same place: on the band the run completes, not across a screen. Screening
 * gets the setting stripped back to the creature's own default, so only the
 * fights the page shows pay for it. Returns the input untouched when neither
 * side asked for it, which is the common case. */
export function withoutIdealBreath(
  extras: FunnelBattleSettings | undefined,
): FunnelBattleSettings | undefined {
  const config = extras?.extraAbilityConfig;
  if (!config) return extras;
  if (config.attackerBreathPolicy !== "ideal" && config.defenderBreathPolicy !== "ideal") return extras;
  const screened = { ...config };
  if (screened.attackerBreathPolicy === "ideal") delete screened.attackerBreathPolicy;
  if (screened.defenderBreathPolicy === "ideal") delete screened.defenderBreathPolicy;
  return { ...extras, extraAbilityConfig: screened };
}

export type FunnelPipelineTuning = {
  /** Opponents in the coarse screen. */
  anchorCount: number;
  /** Spread builds used to measure anchor cost and discrimination. */
  probeBuilds: number;
  /** Builds that survive the first coarse pass and go on to the remaining
   * anchors. The wide pass is one fight per build; only what leads there is
   * worth five. */
  coarseFirstCut: number;
  /** Nominal size of the coarse shortlist (diversity quotas add a buffer). */
  coarseShortlist: number;
  /** Size of the displayed list, and the yardstick the screening budget is
   * derived from. */
  honestBand: number;
  /** Leading builds re-fought against the WHOLE pool at the caller's policy -
   * the fights every displayed number comes from, and the run's dominant cost.
   * Each one is 80 search-policy fights, so this tracks the displayed list
   * rather than carrying spares: a wider band buys a better tie order at the
   * bottom of the list for a linear amount of time. */
  completionBand: number;
  /** Leading builds whose elder / ascension family is re-expanded and rescored.
   * 0 disables the re-check. */
  refineBand: number;
};

export const FUNNEL_TUNING: FunnelPipelineTuning = {
  anchorCount: 5,
  probeBuilds: 3,
  coarseFirstCut: 2500,
  coarseShortlist: 350,
  honestBand: 8,
  completionBand: 8,
  refineBand: 10,
};

export type FunnelPipelineTimings = {
  prepareMs: number;
  anchorMs: number;
  coarseMs: number;
  midMs: number;
  refineMs: number;
  topMs: number;
  rankMs: number;
  totalMs: number;
};

export type FunnelPipelineTelemetry = {
  candidates: number;
  distinctSignatures: number;
  survivors: number;
  anchors: string[];
  anchorScores: AnchorScore[];
  /** Opponents too dear to run at shortlist volume; they wait for the band. */
  dearOpponents: number;
  midOpponents: number;
  /** Builds that cleared the first coarse pass onto the remaining anchors. */
  coarseFirstCut: number;
  shortlist: number;
  refinedBuilds: number;
  completedBuilds: number;
  /** Configured honest band. Builds inside it are ranked on the WHOLE pool at
   * true `ideal`; builds outside it never reach the displayed list. */
  honestBand: number;
  /** Opponents that decided band membership. The dear ones sit outside this
   * subset, so a build that loses the band race lost it on partial evidence -
   * the boundary the band size buys down. */
  bandSelectionOpponents: number;
  coarseFights: number;
  midFights: number;
  refineFights: number;
  topFights: number;
  probeFights: number;
  totalFights: number;
  workerCount: number;
  /** Engine work the whole run charged, restarts included. */
  workUnits: number;
  /** The screening stages ran Fortify on its fast gate rather than the
   * caller's policy. The displayed builds are re-fought either way. */
  screenedFast: boolean;
};

export type FunnelPipelineResult = {
  results: BestBuildAggregateResult[];
  timings: FunnelPipelineTimings;
  telemetry: FunnelPipelineTelemetry;
  pathCounts: BestBuildsPathCounts;
};

type EvaluatedBuild = {
  key: string;
  ref: FunnelBuildRef;
  rows: Map<string, CommonWinsOutcomeRow>;
};

function expandSkeleton(skeleton: {
  traits: string[];
  plushies: string[];
  venerationStage: number;
  elder?: BuildOptions["elder"];
  activesOn: boolean;
  breathOn: boolean;
  preScore: number;
  ascensionAssignments?: string[];
}): FunnelCandidate[] {
  const elders = skeleton.elder ? [skeleton.elder] : elderOptions;
  const splits = skeleton.ascensionAssignments
    ? [skeleton.ascensionAssignments]
    : enumerateAssignmentsCounts(skeleton.traits, skeleton.venerationStage);
  const candidates: FunnelCandidate[] = [];
  for (const elder of elders) {
    for (const ascensionAssignments of splits) {
      candidates.push({
        build: {
          venerationStage: skeleton.venerationStage,
          traits: skeleton.traits,
          ascensionAssignments,
          plushies: skeleton.plushies,
          elder,
        },
        activesOn: skeleton.activesOn,
        breathOn: skeleton.breathOn,
        preScore: skeleton.preScore,
      });
    }
  }
  return candidates;
}

function groupToRef(group: CombatSignatureGroup): FunnelBuildRef {
  const candidate = group.representative;
  return {
    key: buildResultKey(candidate.build, candidate.activesOn, candidate.breathOn),
    build: candidate.build,
    activesOn: candidate.activesOn,
    breathOn: candidate.breathOn,
  };
}

function refToSkeleton(ref: FunnelBuildRef): OptimizerSkeleton {
  return {
    traits: ref.build.traits,
    plushies: ref.build.plushies,
    venerationStage: ref.build.venerationStage,
    elder: ref.build.elder,
    activesOn: ref.activesOn,
    breathOn: ref.breathOn,
    preScore: 0,
    ascensionAssignments: ref.build.ascensionAssignments,
  };
}

export function aggregateFromRows(
  rows: Iterable<CommonWinsOutcomeRow>,
  opponentCount: number,
): BestBuildAggregate {
  let wins = 0;
  let draws = 0;
  let sumSurvival = 0;
  let sumDps = 0;
  let sumTtk = 0;
  let sumImmortal = 0;
  for (const row of rows) {
    if (row.winner === "A") wins += 1;
    else if (row.winner === "Draw") draws += 1;
    sumSurvival += row.survival;
    sumDps += row.dps;
    sumTtk += row.ttk;
    sumImmortal += row.effective;
  }
  const count = Math.max(1, opponentCount);
  return {
    winRate: (wins + draws) / count,
    drawRate: draws / count,
    avgSurvival: sumSurvival / count,
    avgDps: sumDps / count,
    avgTtkWin: sumTtk / count,
    avgImmortalDamage: sumImmortal / count,
  };
}

function mergePathCounts(target: BestBuildsPathCounts, incoming: BestBuildsPathCounts): void {
  for (const [path, count] of Object.entries(incoming)) {
    target[path] = (target[path] ?? 0) + count;
  }
}

/**
 * Split the pool into the opponents the mid stage can afford at shortlist volume
 * and the ones that have to wait for the leading band. Cheapest first, taking
 * everything that fits one stage's share of the budget; at least half the pool
 * regardless, so band membership is never decided on a minority of the evidence.
 */
function splitByAffordability(
  scores: readonly AnchorScore[],
  shortlistSize: number,
  stageBudget: number,
): { mid: string[]; dear: string[] } {
  const ordered = [...scores].sort(
    (a, b) => a.workPerFight - b.workPerFight || a.name.localeCompare(b.name),
  );
  const floor = Math.ceil(ordered.length / 2);
  const mid: string[] = [];
  const dear: string[] = [];
  let spent = 0;
  for (const entry of ordered) {
    const cost = entry.workPerFight * Math.max(1, shortlistSize);
    if (mid.length < floor || spent + cost <= stageBudget) {
      mid.push(entry.name);
      spent += cost;
    } else {
      dear.push(entry.name);
    }
  }
  return { mid, dear };
}

export async function runBestBuildsFunnelPipeline({
  creature,
  activePool,
  uniqueSkeletons,
  objective,
  maxTimeSec,
  combatEventOrder,
  opponentBaselineBuild,
  twoFacedMode,
  unlockAscension,
  unlockElder,
  onProgress,
  cancelRef,
  tuning,
  exactScreening,
  completionPolicy = "ideal",
  extras,
  runner,
}: {
  creature: CreatureRuntime;
  activePool: string[];
  uniqueSkeletons: OptimizerSkeleton[];
  objective: BestBuildAggregateObjective;
  maxTimeSec: number;
  combatEventOrder?: CombatEventPhase[];
  opponentBaselineBuild?: BuildOptions;
  twoFacedMode?: TwoFacedMode;
  unlockAscension: boolean;
  unlockElder: boolean;
  onProgress: (value: number) => void;
  cancelRef: { current: boolean };
  tuning?: FunnelPipelineTuning;
  /** Runs the screening stages at the caller's real policy instead of the fast
   * gate. Only the measurement harness sets it, to price what the screen saves. */
  exactScreening?: boolean;
  /** Timing mode the completion runs, and the only stage the setting reaches:
   * the screen has to stay on the gate to be affordable, and its ordering is
   * discarded anyway once the band is re-fought. */
  completionPolicy?: AbilityTimingMode;
  /** Per-side battle settings. Carried through every stage, so a run with
   * settings on searches the same way - it just pays the per-matchup path. */
  extras?: FunnelBattleSettings;
  /** Injectable so the node measurement harness can run the same pipeline
   * on one thread. Defaults to the Best Builds worker pool. */
  runner?: (base: { screenFortifyFast: boolean }) => FunnelCellRunner;
}): Promise<FunnelPipelineResult> {
  const startedAt = performance.now();
  if (twoFacedMode) setActiveTwoFacedMode(twoFacedMode);
  await loadRustMatchupBridge().catch(() => null);

  const resolved = tuning ?? FUNNEL_TUNING;
  const screenFast = !exactScreening;
  // What the screen costs is set by the policy it runs, not by the number of
  // builds: every search-based ability re-plans against a forked projection at
  // every decision point. The screen only has to keep the right builds in the
  // band, so it runs the gate-only mode; the completion below re-fights that
  // band at `ideal`, and every displayed number comes from those fights.
  const screenPolicy: AbilityTimingMode = screenFast ? "reallyFast" : completionPolicy;

  const timings: FunnelPipelineTimings = {
    prepareMs: 0,
    anchorMs: 0,
    coarseMs: 0,
    midMs: 0,
    refineMs: 0,
    topMs: 0,
    rankMs: 0,
    totalMs: 0,
  };
  const pathCounts: BestBuildsPathCounts = {};

  // --- prepare -------------------------------------------------------------
  const prepareStartedAt = performance.now();
  const candidates: FunnelCandidate[] = [];
  for (const skeleton of uniqueSkeletons) candidates.push(...expandSkeleton(skeleton));
  const dedup = deduplicateBySignature(candidates, creature);
  const survivorGroups = skylinePrune(dedup.groups, { source: creature, pool: activePool }).kept;
  const survivorRefs = survivorGroups.map(groupToRef);
  timings.prepareMs = performance.now() - prepareStartedAt;

  const telemetry: FunnelPipelineTelemetry = {
    candidates: candidates.length,
    distinctSignatures: dedup.distinct,
    survivors: survivorRefs.length,
    anchors: [],
    anchorScores: [],
    dearOpponents: 0,
    midOpponents: 0,
    coarseFirstCut: 0,
    shortlist: 0,
    refinedBuilds: 0,
    completedBuilds: 0,
    honestBand: resolved.honestBand,
    bandSelectionOpponents: 0,
    coarseFights: 0,
    midFights: 0,
    refineFights: 0,
    topFights: 0,
    probeFights: 0,
    totalFights: 0,
    workerCount: 0,
    workUnits: 0,
    screenedFast: true,
  };

  // One pool for the whole run: every stage reuses the same workers instead of
  // paying a fresh WASM instantiation per stage.
  const workerPool = createFunnelWorkerPool();

  const emptyResult = (): FunnelPipelineResult => {
    workerPool.dispose();
    timings.totalMs = performance.now() - startedAt;
    return { results: [], timings, telemetry, pathCounts };
  };

  if (survivorRefs.length === 0 || activePool.length === 0) return emptyResult();

  const probes = selectAnchorProbeBuilds(
    survivorGroups.map((group) => ({
      build: group.representative.build,
      finalA: group.finalStats,
      activesOn: group.representative.activesOn,
      breathOn: group.representative.breathOn,
    })),
    resolved.probeBuilds,
  );

  let results: BestBuildAggregateResult[] = [];

  const screeningExtras = withoutIdealBreath(extras);

  const makeRunner = (screenFortifyFast: boolean): FunnelCellRunner =>
    runner?.({ screenFortifyFast }) ??
    createFunnelWorkerCellRunner(
      {
        sourceCreatureName: creature.name,
        objective,
        maxTimeSec,
        combatEventOrder,
        opponentBaselineBuild,
        twoFacedMode,
        abilityPolicy: screenFortifyFast ? screenPolicy : completionPolicy,
        screenFortifyFast,
        extras: screenFortifyFast ? screeningExtras : extras,
      },
      workerPool,
    );

  {
    const cellRunner = makeRunner(screenFast);
    telemetry.screenedFast = screenFast;
    const report = (value: number) => onProgress(Math.min(1, value));

    // --- probe -------------------------------------------------------------
    const anchorStartedAt = performance.now();
    const anchorSelection = selectCoarseAnchors({
      sourceCreature: creature,
      pool: activePool,
      probes,
      anchorCount: resolved.anchorCount,
      opponentBaselineBuild,
      combatEventOrder,
      maxTimeSec,
      abilityPolicy: screenPolicy,
      screenFortifyFast: screenFast,
      extras,
    });
    timings.anchorMs = performance.now() - anchorStartedAt;
    telemetry.anchors = anchorSelection.anchors;
    telemetry.anchorScores = anchorSelection.scores;
    telemetry.probeFights = anchorSelection.probeFights;
    telemetry.workUnits += anchorSelection.workUnits;
    report(0.05);
    if (cancelRef.current) return emptyResult();

    // The screen's own share of the run. The completion stage is the answer and
    // cannot be cut, so the split is priced against what screening may spend
    // before it stops being a screen.
    const poolWork = anchorSelection.scores.reduce((sum, score) => sum + score.workPerFight, 0);
    const stageBudget = resolved.honestBand * poolWork;

    const { mid: midOpponents, dear: dearOpponents } = splitByAffordability(
      anchorSelection.scores,
      resolved.coarseShortlist,
      stageBudget,
    );
    telemetry.midOpponents = midOpponents.length;
    telemetry.dearOpponents = dearOpponents.length;
    telemetry.bandSelectionOpponents = midOpponents.length;

    // Dispatch order for the completion stage. The probe measured every
    // opponent's engine work; scheduling the dear ones first is what keeps the
    // last one from finishing alone after the pool has drained. Scoring reads
    // `activePool` order regardless, so this only moves work between workers.
    const costByOpponent = new Map(
      anchorSelection.scores.map((score) => [score.name, score.workPerFight]),
    );
    const costOrderedPool = [...activePool].sort(
      (a, b) =>
        (costByOpponent.get(b) ?? 0) - (costByOpponent.get(a) ?? 0) || a.localeCompare(b),
    );

    // --- coarse screen -----------------------------------------------------
    // Cascaded, so the widest pass is also the cheapest: every survivor fights
    // the single most discriminating anchor, and only the leaders of that pass
    // pay for the remaining four. Flat, this stage was the run's biggest cost -
    // it is the one place where the build count is still five figures.
    const coarseStartedAt = performance.now();
    const runCoarse = async (
      builds: readonly FunnelBuildRef[],
      opponents: readonly string[],
      progressFrom: number,
      progressSpan: number,
    ) => {
      const run = await cellRunner({
        cells: planFunnelCells({
          builds,
          opponents,
          workerCount: funnelWorkerCount(builds.length),
        }),
        wantPerOpponent: false,
        onProgress: (value) => report(progressFrom + value * progressSpan),
        cancelRef,
      });
      mergePathCounts(pathCounts, run.pathCounts);
      telemetry.workerCount = Math.max(telemetry.workerCount, run.workerCount);
      telemetry.coarseFights += builds.length * opponents.length;
      telemetry.workUnits += run.workUnits;
      const byKey = new Map<string, BestBuildAggregate>();
      for (const outcome of run.outcomes) byKey.set(outcome.buildKey, outcome.result.aggregate);
      return byKey;
    };

    const leadAnchors = anchorSelection.anchors.slice(0, 1);
    const restAnchors = anchorSelection.anchors.slice(1);
    const firstPass = await runCoarse(survivorRefs, leadAnchors, 0.05, 0.2);
    if (cancelRef.current) return emptyResult();
    const firstCut = survivorRefs
      .filter((ref) => firstPass.has(ref.key))
      .sort((a, b) => compareAggregate(firstPass.get(a.key)!, firstPass.get(b.key)!, objective))
      .slice(0, Math.max(resolved.coarseShortlist, resolved.coarseFirstCut));
    telemetry.coarseFirstCut = firstCut.length;

    const coarseByKey =
      restAnchors.length > 0 && firstCut.length > 0
        ? await runCoarse(firstCut, restAnchors, 0.25, 0.15)
        : firstPass;
    timings.coarseMs = performance.now() - coarseStartedAt;
    if (cancelRef.current) return emptyResult();

    const coarseRanked = firstCut
      .filter((ref) => coarseByKey.has(ref.key))
      .sort((a, b) => compareAggregate(coarseByKey.get(a.key)!, coarseByKey.get(b.key)!, objective));

    // Diversity / challenger quotas from the existing shortlist builder, so a
    // specialist build is not squeezed out by a cluster of near-identical leaders.
    const refBySkeleton = new Map<OptimizerSkeleton, FunnelBuildRef>();
    const coarseSkeletons = coarseRanked.map((ref) => {
      const skeleton = refToSkeleton(ref);
      refBySkeleton.set(skeleton, ref);
      return skeleton;
    });
    const shortlist = collectDiverseSkeletonShortlist(
      coarseSkeletons,
      Math.min(resolved.coarseShortlist, coarseSkeletons.length),
    )
      .map((skeleton) => refBySkeleton.get(skeleton))
      .filter((ref): ref is FunnelBuildRef => ref !== undefined);
    const shortlistByKey = new Map(shortlist.map((ref) => [ref.key, ref]));
    telemetry.shortlist = shortlist.length;

    const evaluated = new Map<string, EvaluatedBuild>();
    const track = (ref: FunnelBuildRef): EvaluatedBuild => {
      const existing = evaluated.get(ref.key);
      if (existing) return existing;
      const entry: EvaluatedBuild = { key: ref.key, ref, rows: new Map() };
      evaluated.set(ref.key, entry);
      return entry;
    };

    // --- mid: shortlist x the affordable opponents -------------------------
    const midStartedAt = performance.now();
    const midRun = await runAgainst({
      builds: shortlist,
      opponents: midOpponents,
      cellRunner,
      cancelRef,
      onProgress: (value) => report(0.4 + value * 0.3),
    });
    mergePathCounts(pathCounts, midRun.pathCounts);
    telemetry.workerCount = Math.max(telemetry.workerCount, midRun.workerCount);
    telemetry.midFights = shortlist.length * midOpponents.length;
    telemetry.workUnits += midRun.workUnits;
    for (const outcome of midRun.outcomes) {
      const ref = shortlistByKey.get(outcome.buildKey);
      if (!ref) continue;
      const entry = track(ref);
      for (const row of outcome.result.perOpponent ?? []) entry.rows.set(row.opponentName, row);
    }
    timings.midMs = performance.now() - midStartedAt;
    if (cancelRef.current) return emptyResult();

    const midAggregate = (entry: EvaluatedBuild) =>
      aggregateFromRows(subsetRows(entry, midOpponents), midOpponents.length);
    const rankOnMid = (): EvaluatedBuild[] =>
      [...evaluated.values()].sort((a, b) =>
        compareAggregate(midAggregate(a), midAggregate(b), objective),
      );

    /** The ranking the band is drawn from. Ascension splits of one build collapse
     * to their best member, matching what the displayed list has always shown
     * (`finalizeBestBuildsResults` dedups on the same key): without it the list
     * fills with one build under shuffled points and pushes genuinely different
     * builds off the bottom, and the completion wastes its exact fights on them. */
    const rankForDisplay = (): EvaluatedBuild[] => {
      const ranked = rankOnMid();
      const bestByFamily = new Map<string, EvaluatedBuild>();
      for (const entry of ranked) {
        const key = buildResultKeyWithoutAscension(
          entry.ref.build,
          entry.ref.activesOn,
          entry.ref.breathOn,
        );
        const seen = bestByFamily.get(key);
        if (!seen || compareAggregate(midAggregate(entry), midAggregate(seen), objective) < 0) {
          bestByFamily.set(key, entry);
        }
      }
      return [...bestByFamily.values()].sort((a, b) =>
        compareAggregate(midAggregate(a), midAggregate(b), objective),
      );
    };

    // --- elder / ascension re-check on the leading band --------------------
    const refineStartedAt = performance.now();
    if (resolved.refineBand > 0 && (unlockAscension || unlockElder)) {
      const families: FunnelBuildRef[] = [];
      const seen = new Set(evaluated.keys());
      for (const entry of rankOnMid().slice(0, resolved.refineBand)) {
        for (const variant of expandFamily(entry.ref, { unlockAscension, unlockElder })) {
          if (seen.has(variant.key)) continue;
          seen.add(variant.key);
          families.push(variant);
        }
      }
      telemetry.refinedBuilds = families.length;
      if (families.length > 0) {
        const refineRun = await runAgainst({
          builds: families,
          opponents: midOpponents,
          cellRunner,
          cancelRef,
          onProgress: (value) => report(0.7 + value * 0.1),
        });
        mergePathCounts(pathCounts, refineRun.pathCounts);
        telemetry.refineFights = families.length * midOpponents.length;
        telemetry.workUnits += refineRun.workUnits;
        const familyByKey = new Map(families.map((ref) => [ref.key, ref]));
        for (const outcome of refineRun.outcomes) {
          const ref = familyByKey.get(outcome.buildKey);
          if (!ref) continue;
          const entry = track(ref);
          for (const row of outcome.result.perOpponent ?? []) entry.rows.set(row.opponentName, row);
        }
      }
    }
    timings.refineMs = performance.now() - refineStartedAt;
    if (cancelRef.current) return emptyResult();

    // --- honest completion: the leading band x the WHOLE pool at grid 0 ----
    // Screening rows never enter the ranking - they were fought on a coarser
    // grid and only exist to pick the band. Every displayed number below comes
    // from these full-resolution fights.
    const topStartedAt = performance.now();
    const completionBand = rankForDisplay().slice(
      0,
      Math.max(resolved.honestBand, resolved.completionBand),
    );
    const completionRows = new Map<string, Map<string, CommonWinsOutcomeRow>>();
    if (completionBand.length > 0) {
      const exactRunner = screenFast ? makeRunner(false) : cellRunner;
      const topRun = await runAgainst({
        builds: completionBand.map((entry) => entry.ref),
        opponents: costOrderedPool,
        cellRunner: exactRunner,
        cancelRef,
        // This stage is the run's wall clock, and it is the one place where a
        // single fight can run for seconds. One fight per cell, dearest
        // opponent first: the band is too narrow to leave any slack on the
        // build axis, and the probe already priced every opponent, so the pull
        // queue gets longest-processing-time-first ordering for free.
        opponentsPerCell: 1,
        maxBuildsPerCell: 1,
        onProgress: (value) => report(0.8 + value * 0.18),
      });
      mergePathCounts(pathCounts, topRun.pathCounts);
      telemetry.workerCount = Math.max(telemetry.workerCount, topRun.workerCount);
      telemetry.topFights = completionBand.length * activePool.length;
      telemetry.workUnits += topRun.workUnits;
      for (const outcome of topRun.outcomes) {
        let rows = completionRows.get(outcome.buildKey);
        if (!rows) {
          rows = new Map();
          completionRows.set(outcome.buildKey, rows);
        }
        for (const row of outcome.result.perOpponent ?? []) rows.set(row.opponentName, row);
      }
    }
    timings.topMs = performance.now() - topStartedAt;
    if (cancelRef.current) return emptyResult();

    // --- rank --------------------------------------------------------------
    const rankStartedAt = performance.now();
    const complete = completionBand.filter(
      (entry) => (completionRows.get(entry.key)?.size ?? 0) >= activePool.length,
    );
    telemetry.completedBuilds = complete.length;
    const rankInput = complete.map((entry) => {
      const byOpponent = completionRows.get(entry.key)!;
      // Read the rows back in pool order, not in the order the workers happened
      // to answer: the aggregate is a float sum, so a varying order made the
      // displayed numbers - and any tie between two builds - depend on worker
      // scheduling.
      const rows = activePool
        .map((name) => byOpponent.get(name))
        .filter((row): row is CommonWinsOutcomeRow => row !== undefined);
      return {
        result: {
          build: entry.ref.build,
          activesOn: entry.ref.activesOn,
          breathOn: entry.ref.breathOn,
          aggregate: aggregateFromRows(rows, activePool.length),
          opponentsCount: activePool.length,
        } satisfies BestBuildAggregateResult,
        rows,
      };
    });
    results = rerankBestBuildsByCommonWinsData(rankInput, objective);
    timings.rankMs = performance.now() - rankStartedAt;

  }

  workerPool.dispose();
  telemetry.totalFights =
    telemetry.probeFights +
    telemetry.coarseFights +
    telemetry.midFights +
    telemetry.refineFights +
    telemetry.topFights;
  timings.totalMs = performance.now() - startedAt;
  onProgress(1);
  return { results, timings, telemetry, pathCounts };

  function subsetRows(entry: EvaluatedBuild, opponents: readonly string[]): CommonWinsOutcomeRow[] {
    const rows: CommonWinsOutcomeRow[] = [];
    for (const name of opponents) {
      const row = entry.rows.get(name);
      if (row) rows.push(row);
    }
    return rows;
  }

  function expandFamily(
    ref: FunnelBuildRef,
    { unlockAscension: ascension, unlockElder: elder }: { unlockAscension: boolean; unlockElder: boolean },
  ): FunnelBuildRef[] {
    const elders = elder ? elderOptions : [ref.build.elder];
    const splits = ascension
      ? enumerateAssignmentsCounts(ref.build.traits, ref.build.venerationStage)
      : [ref.build.ascensionAssignments];
    const variants: FunnelBuildRef[] = [];
    for (const elderOption of elders) {
      for (const ascensionAssignments of splits) {
        const build: BuildOptions = {
          venerationStage: ref.build.venerationStage,
          traits: ref.build.traits,
          ascensionAssignments,
          plushies: ref.build.plushies,
          elder: elderOption,
        };
        // Skip variants the engine cannot tell apart from one already scored.
        memoizedApplyRulesAndBuild(creature, build);
        variants.push({
          key: buildResultKey(build, ref.activesOn, ref.breathOn),
          build,
          activesOn: ref.activesOn,
          breathOn: ref.breathOn,
        });
      }
    }
    return variants;
  }
}

async function runAgainst({
  builds,
  opponents,
  cellRunner,
  cancelRef,
  onProgress,
  opponentsPerCell,
  maxBuildsPerCell,
}: {
  builds: FunnelBuildRef[];
  opponents: readonly string[];
  cellRunner: FunnelCellRunner;
  cancelRef: { current: boolean };
  onProgress: (value: number) => void;
  opponentsPerCell?: number;
  maxBuildsPerCell?: number;
}) {
  if (builds.length === 0 || opponents.length === 0) {
    return { outcomes: [], pathCounts: {} as BestBuildsPathCounts, workerCount: 0, workUnits: 0 };
  }
  const cells = planFunnelCells({
    builds,
    opponents,
    workerCount: funnelWorkerCount(builds.length * (opponentsPerCell ? opponents.length : 1)),
    opponentsPerCell,
    maxBuildsPerCell,
  });
  return cellRunner({ cells, wantPerOpponent: true, onProgress, cancelRef });
}
