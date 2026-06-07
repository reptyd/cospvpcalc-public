import type { BuildOptions } from "../engine";
import type { BestBuildAggregate, BestBuildAggregateObjective } from "./ranking";
import { applyWinRateGuard, compareAggregate } from "./bestBuildsEvaluation";
import { buildResultKeyWithoutAscension } from "./runtimeHelpers";
import { buildResultKey, plushiePairKey } from "../shared/buildEncoding";

export type BestBuildAggregateResult = {
  build: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  aggregate: BestBuildAggregate;
  opponentsCount: number;
};

export type BestBuildFlowSkeleton = {
  traits: string[];
  plushies: string[];
  venerationStage: number;
  elder?: BuildOptions["elder"];
  activesOn: boolean;
  breathOn: boolean;
  preScore: number;
  ascensionAssignments?: string[];
};

export { normalizeConstraintBuild } from "./constraintBuilds";

export function buildSkeletonsFromCandidates(
  candidates: Array<{ build: BuildOptions; activesOn: boolean; breathOn: boolean; preScore: number }>,
): BestBuildFlowSkeleton[] {
  const map = new Map<string, BestBuildFlowSkeleton>();
  for (const candidate of candidates) {
    const traits = [...candidate.build.traits].sort();
    const plushies = [...candidate.build.plushies];
    const hasLockedAscension = candidate.build.ascensionAssignments.some((a) => a !== "");
    const ascensionKey = hasLockedAscension ? `::${candidate.build.ascensionAssignments.join(",")}` : "";
    const elder = candidate.build.elder ?? "None";
    const key = `${candidate.build.venerationStage}::${elder}::${traits.join("+")}::${plushiePairKey(plushies)}::${candidate.activesOn ? 1 : 0}${candidate.breathOn ? 1 : 0}${ascensionKey}`;
    const existing = map.get(key);
    if (!existing || candidate.preScore > existing.preScore) {
      map.set(key, {
        traits,
        plushies,
        venerationStage: candidate.build.venerationStage,
        elder,
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        preScore: candidate.preScore,
        ascensionAssignments: hasLockedAscension ? candidate.build.ascensionAssignments : undefined,
      });
    }
  }
  return Array.from(map.values());
}

type RankedSkeletonAggregate = {
  skeleton: BestBuildFlowSkeleton;
  aggregate: BestBuildAggregate;
};

type ShortlistResult = {
  quickRanked: RankedSkeletonAggregate[];
  stage2Skeletons: BestBuildFlowSkeleton[];
};

function buildTraitPairKey(traits: string[]): string {
  return [...traits].sort().join("+");
}

function shortlistBuffer(limit: number, pct: number, minExtra: number, maxExtra: number): number {
  return Math.min(maxExtra, Math.max(minExtra, Math.ceil(limit * pct)));
}

function addUniqueRankedEntry(
  target: RankedSkeletonAggregate[],
  seen: Set<string>,
  entry: RankedSkeletonAggregate,
  limit: number,
): void {
  if (target.length >= limit) return;
  const key = buildSkeletonKey(entry);
  if (seen.has(key)) return;
  seen.add(key);
  target.push(entry);
}

function collectRankedShortlist(
  rankedEntries: RankedSkeletonAggregate[],
  primaryObjective: BestBuildAggregateObjective,
  supportObjectives: BestBuildAggregateObjective[],
  nominalLimit: number,
): RankedSkeletonAggregate[] {
  const limit = Math.min(rankedEntries.length, nominalLimit + shortlistBuffer(nominalLimit, 0.25, 6, 24));
  if (limit === 0) return [];
  const shortlist: RankedSkeletonAggregate[] = [];
  const seen = new Set<string>();
  const primaryQuota = Math.min(rankedEntries.length, Math.max(12, Math.floor(limit * 0.45)));
  const supportQuota = Math.max(4, Math.floor(limit * 0.08));
  const diversityQuota = Math.max(4, Math.floor(limit * 0.1));
  const challengerQuota = Math.max(3, Math.floor(limit * 0.08));

  const primaryRanked = [...rankedEntries].sort((a, b) => compareAggregate(a.aggregate, b.aggregate, primaryObjective));
  for (const entry of primaryRanked.slice(0, primaryQuota)) {
    addUniqueRankedEntry(shortlist, seen, entry, limit);
  }

  for (const supportObjective of supportObjectives) {
    const supportRanked = [...rankedEntries]
      .sort((a, b) => compareAggregate(a.aggregate, b.aggregate, supportObjective))
      .slice(0, Math.min(supportQuota, rankedEntries.length));
    for (const entry of supportRanked) {
      addUniqueRankedEntry(shortlist, seen, entry, limit);
    }
  }

  const bestByPlushPair = new Map<string, RankedSkeletonAggregate>();
  const bestByTraitPair = new Map<string, RankedSkeletonAggregate>();
  const bestByElder = new Map<string, RankedSkeletonAggregate>();
  for (const entry of primaryRanked) {
    const plushKey = plushiePairKey(entry.skeleton.plushies);
    const traitKey = buildTraitPairKey(entry.skeleton.traits);
    const elderKey = entry.skeleton.elder ?? "None";
    if (!bestByPlushPair.has(plushKey)) bestByPlushPair.set(plushKey, entry);
    if (!bestByTraitPair.has(traitKey)) bestByTraitPair.set(traitKey, entry);
    if (!bestByElder.has(elderKey)) bestByElder.set(elderKey, entry);
  }

  for (const entry of Array.from(bestByPlushPair.values()).slice(0, diversityQuota)) {
    addUniqueRankedEntry(shortlist, seen, entry, limit);
  }
  for (const entry of Array.from(bestByTraitPair.values()).slice(0, diversityQuota)) {
    addUniqueRankedEntry(shortlist, seen, entry, limit);
  }
  for (const entry of Array.from(bestByElder.values())) {
    addUniqueRankedEntry(shortlist, seen, entry, limit);
  }

  const challengerStart = Math.min(primaryRanked.length, nominalLimit);
  const challengerEnd = Math.min(primaryRanked.length, challengerStart + challengerQuota * 2);
  for (const entry of primaryRanked.slice(challengerStart, challengerEnd)) {
    addUniqueRankedEntry(shortlist, seen, entry, limit);
  }

  for (const entry of primaryRanked) {
    addUniqueRankedEntry(shortlist, seen, entry, limit);
  }

  return shortlist;
}

function buildSkeletonKey(entry: RankedSkeletonAggregate): string {
  const asc = entry.skeleton.ascensionAssignments?.join(",") ?? "";
  return `${entry.skeleton.venerationStage}::${entry.skeleton.elder ?? "None"}::${entry.skeleton.traits.join("+")}::${plushiePairKey(entry.skeleton.plushies)}::${entry.skeleton.activesOn ? 1 : 0}${entry.skeleton.breathOn ? 1 : 0}::${asc}`;
}

export function buildStageShortlists({
  quickScored,
  objective,
  winRateGuardPct: _winRateGuardPct,
  stage1TopK,
  stage2Cap,
}: {
  quickScored: RankedSkeletonAggregate[];
  objective: BestBuildAggregateObjective;
  winRateGuardPct: number;
  stage1TopK: number;
  stage2Cap: number;
}): ShortlistResult {
  const stage1PrimaryObjective = objective;
  const stage1SupportObjectives: BestBuildAggregateObjective[] = ["avgDps", "winRate", "survival", "immortalDamage", "avgTtk"];
  const stage1Objectives: BestBuildAggregateObjective[] = [
    stage1PrimaryObjective,
    ...stage1SupportObjectives.filter((item) => item !== stage1PrimaryObjective),
  ];
  const quickRanked = collectRankedShortlist(
    quickScored,
    stage1PrimaryObjective,
    stage1Objectives.filter((item) => item !== stage1PrimaryObjective),
    stage1TopK,
  ).sort((a, b) => compareAggregate(a.aggregate, b.aggregate, stage1PrimaryObjective));

  const stage2PrimaryObjective = objective;
  const stage2SupportObjectives: BestBuildAggregateObjective[] = ["avgDps", "winRate", "survival", "immortalDamage", "avgTtk"];
  const stage2Objectives: BestBuildAggregateObjective[] = [
    stage2PrimaryObjective,
    ...stage2SupportObjectives.filter((item) => item !== stage2PrimaryObjective),
  ];
  const stage2Skeletons = collectRankedShortlist(
    quickRanked,
    stage2PrimaryObjective,
    stage2Objectives.filter((item) => item !== stage2PrimaryObjective),
    stage2Cap,
  )
    .sort((a, b) => compareAggregate(a.aggregate, b.aggregate, stage2PrimaryObjective))
    .map((x) => x.skeleton);

  return { quickRanked, stage2Skeletons };
}

export function buildRefinementSkeletons(
  results: BestBuildAggregateResult[],
  {
    unlockAscension,
    unlockElder,
  }: {
    unlockAscension: boolean;
    unlockElder: boolean;
  },
): BestBuildFlowSkeleton[] {
  const uniqueCombos = new Map<string, BestBuildFlowSkeleton>();
  for (const result of results) {
    const traits = [...result.build.traits].sort();
    const plushies = [...result.build.plushies];
    const familyElder = unlockElder ? "" : result.build.elder ?? "None";
    const key = `${result.build.venerationStage}::${traits.join("+")}::${plushiePairKey(plushies)}::${familyElder}::${result.activesOn ? 1 : 0}${result.breathOn ? 1 : 0}`;
    if (uniqueCombos.has(key)) continue;
    uniqueCombos.set(key, {
      traits,
      plushies,
      venerationStage: result.build.venerationStage,
      elder: unlockElder ? undefined : result.build.elder ?? "None",
      activesOn: result.activesOn,
      breathOn: result.breathOn,
      preScore: 0,
      ascensionAssignments: unlockAscension ? undefined : result.build.ascensionAssignments,
    });
  }

  return Array.from(uniqueCombos.values());
}

export function dedupeAndRankBestBuildResults({
  results,
  objective,
  winRateGuardPct,
  showAllAscensionDistributions,
}: {
  results: BestBuildAggregateResult[];
  objective: BestBuildAggregateObjective;
  winRateGuardPct: number;
  showAllAscensionDistributions: boolean;
}): BestBuildAggregateResult[] {
  const bestByKey = new Map<string, BestBuildAggregateResult>();
  for (const result of results) {
    const key = showAllAscensionDistributions
      ? buildResultKey(result.build, result.activesOn, result.breathOn)
      : buildResultKeyWithoutAscension(result.build, result.activesOn, result.breathOn);
    const existing = bestByKey.get(key);
    if (!existing || compareAggregate(result.aggregate, existing.aggregate, objective) < 0) {
      bestByKey.set(key, result);
    }
  }

  return applyWinRateGuard(Array.from(bestByKey.values()), objective, winRateGuardPct / 100)
    .sort((a, b) => compareAggregate(a.aggregate, b.aggregate, objective))
    .slice(0, 10);
}
