import type { BuildOptions } from "../engine";
import { plushiePairKey } from "../shared/buildEncoding";
import { compareResult, scoreResult } from "./scoring";

export type OptimizerSkeleton = {
  traits: string[];
  plushies: string[];
  venerationStage: number;
  elder?: BuildOptions["elder"];
  activesOn: boolean;
  breathOn: boolean;
  preScore: number;
  ascensionAssignments?: string[];
};

export type QuickEvaluatedSkeleton = {
  skeleton: OptimizerSkeleton;
  bestBuild: BuildOptions;
  score: ReturnType<typeof scoreResult>;
};

function buildSkeletonIdentityKey(skeleton: OptimizerSkeleton): string {
  const asc = skeleton.ascensionAssignments?.join(",") ?? "";
  return `${skeleton.venerationStage}::${skeleton.elder ?? "None"}::${[...skeleton.traits].sort().join("+")}::${plushiePairKey(skeleton.plushies)}::${skeleton.activesOn ? 1 : 0}${skeleton.breathOn ? 1 : 0}::${asc}`;
}

function buildQuickSkeletonIdentityKey(entry: QuickEvaluatedSkeleton): string {
  return buildSkeletonIdentityKey(entry.skeleton);
}

function buildTraitPairKey(traits: string[]): string {
  return [...traits].sort().join("+");
}

function stageBuffer(limit: number, pct: number, minExtra: number, maxExtra: number): number {
  return Math.min(maxExtra, Math.max(minExtra, Math.ceil(limit * pct)));
}

function addUniqueByKey<T>(
  target: T[],
  seen: Set<string>,
  item: T,
  getKey: (value: T) => string,
  limit: number,
): void {
  if (target.length >= limit) return;
  const key = getKey(item);
  if (seen.has(key)) return;
  seen.add(key);
  target.push(item);
}

function collectDiverseSkeletonShortlist(
  sorted: OptimizerSkeleton[],
  nominalTopK: number,
): OptimizerSkeleton[] {
  const limit = Math.min(sorted.length, nominalTopK + stageBuffer(nominalTopK, 0.25, 6, 24));
  const shortlist: OptimizerSkeleton[] = [];
  const seen = new Set<string>();
  const primaryQuota = Math.min(sorted.length, Math.max(10, Math.floor(limit * 0.5)));
  const diversityQuota = Math.max(4, Math.floor(limit * 0.12));
  const challengerQuota = Math.max(3, Math.floor(limit * 0.1));

  for (const skeleton of sorted.slice(0, primaryQuota)) {
    addUniqueByKey(shortlist, seen, skeleton, buildSkeletonIdentityKey, limit);
  }

  const bestByPlush = new Map<string, OptimizerSkeleton>();
  const bestByTraits = new Map<string, OptimizerSkeleton>();
  const bestByElder = new Map<string, OptimizerSkeleton>();
  for (const skeleton of sorted) {
    const plushKey = plushiePairKey(skeleton.plushies);
    const traitKey = buildTraitPairKey(skeleton.traits);
    const elderKey = skeleton.elder ?? "None";
    if (!bestByPlush.has(plushKey)) bestByPlush.set(plushKey, skeleton);
    if (!bestByTraits.has(traitKey)) bestByTraits.set(traitKey, skeleton);
    if (!bestByElder.has(elderKey)) bestByElder.set(elderKey, skeleton);
  }

  for (const skeleton of Array.from(bestByPlush.values()).slice(0, diversityQuota)) {
    addUniqueByKey(shortlist, seen, skeleton, buildSkeletonIdentityKey, limit);
  }
  for (const skeleton of Array.from(bestByTraits.values()).slice(0, diversityQuota)) {
    addUniqueByKey(shortlist, seen, skeleton, buildSkeletonIdentityKey, limit);
  }
  for (const skeleton of Array.from(bestByElder.values())) {
    addUniqueByKey(shortlist, seen, skeleton, buildSkeletonIdentityKey, limit);
  }

  const challengerStart = Math.min(sorted.length, nominalTopK);
  const challengerEnd = Math.min(sorted.length, challengerStart + challengerQuota * 2);
  for (const skeleton of sorted.slice(challengerStart, challengerEnd)) {
    addUniqueByKey(shortlist, seen, skeleton, buildSkeletonIdentityKey, limit);
  }

  for (const skeleton of sorted) {
    addUniqueByKey(shortlist, seen, skeleton, buildSkeletonIdentityKey, limit);
  }

  return shortlist;
}

function collectDiverseStage2Shortlist(
  quickRanked: QuickEvaluatedSkeleton[],
  stage2Cap: number,
): QuickEvaluatedSkeleton[] {
  const limit = Math.min(quickRanked.length, stage2Cap + stageBuffer(stage2Cap, 0.2, 4, 16));
  const shortlist: QuickEvaluatedSkeleton[] = [];
  const seen = new Set<string>();
  const primaryQuota = Math.min(quickRanked.length, Math.max(8, Math.floor(limit * 0.55)));
  const diversityQuota = Math.max(3, Math.floor(limit * 0.12));
  const challengerQuota = Math.max(2, Math.floor(limit * 0.08));

  for (const entry of quickRanked.slice(0, primaryQuota)) {
    addUniqueByKey(shortlist, seen, entry, buildQuickSkeletonIdentityKey, limit);
  }

  const bestByPlush = new Map<string, QuickEvaluatedSkeleton>();
  const bestByTraits = new Map<string, QuickEvaluatedSkeleton>();
  const bestByElder = new Map<string, QuickEvaluatedSkeleton>();
  for (const entry of quickRanked) {
    const plushKey = plushiePairKey(entry.skeleton.plushies);
    const traitKey = buildTraitPairKey(entry.skeleton.traits);
    const elderKey = entry.skeleton.elder ?? "None";
    if (!bestByPlush.has(plushKey)) bestByPlush.set(plushKey, entry);
    if (!bestByTraits.has(traitKey)) bestByTraits.set(traitKey, entry);
    if (!bestByElder.has(elderKey)) bestByElder.set(elderKey, entry);
  }

  for (const entry of Array.from(bestByPlush.values()).slice(0, diversityQuota)) {
    addUniqueByKey(shortlist, seen, entry, buildQuickSkeletonIdentityKey, limit);
  }
  for (const entry of Array.from(bestByTraits.values()).slice(0, diversityQuota)) {
    addUniqueByKey(shortlist, seen, entry, buildQuickSkeletonIdentityKey, limit);
  }
  for (const entry of Array.from(bestByElder.values())) {
    addUniqueByKey(shortlist, seen, entry, buildQuickSkeletonIdentityKey, limit);
  }

  const challengerStart = Math.min(quickRanked.length, stage2Cap);
  const challengerEnd = Math.min(quickRanked.length, challengerStart + challengerQuota * 2);
  for (const entry of quickRanked.slice(challengerStart, challengerEnd)) {
    addUniqueByKey(shortlist, seen, entry, buildQuickSkeletonIdentityKey, limit);
  }

  for (const entry of quickRanked) {
    addUniqueByKey(shortlist, seen, entry, buildQuickSkeletonIdentityKey, limit);
  }

  return shortlist;
}

export function uniquePlushiePairKeys(skeletons: OptimizerSkeleton[]): string[] {
  const keys = new Set<string>();
  for (const skeleton of skeletons) keys.add(plushiePairKey(skeleton.plushies));
  return Array.from(keys);
}

export function buildSkeletonsFromCandidates(
  candidates: Array<{ build: BuildOptions; activesOn: boolean; breathOn: boolean; preScore: number }>,
): OptimizerSkeleton[] {
  const map = new Map<string, OptimizerSkeleton>();
  for (const candidate of candidates) {
    const traits = [...candidate.build.traits].sort();
    const plushies = [...candidate.build.plushies];
    const hasLockedAscension = candidate.build.ascensionAssignments.some((a) => a !== "");
    const ascensionKey = hasLockedAscension ? `::${candidate.build.ascensionAssignments.join(",")}` : "";
    const key = `${candidate.build.venerationStage}::${candidate.build.elder ?? "None"}::${traits.join("+")}::${plushiePairKey(plushies)}::${candidate.activesOn ? 1 : 0}${candidate.breathOn ? 1 : 0}${ascensionKey}`;
    const existing = map.get(key);
    if (!existing || candidate.preScore > existing.preScore) {
      map.set(key, {
        traits,
        plushies,
        venerationStage: candidate.build.venerationStage,
        elder: candidate.build.elder ?? "None",
        activesOn: candidate.activesOn,
        breathOn: candidate.breathOn,
        preScore: candidate.preScore,
        ascensionAssignments: hasLockedAscension ? candidate.build.ascensionAssignments : undefined,
      });
    }
  }
  return Array.from(map.values());
}

export function selectSkeletonsForStage1(
  skeletons: OptimizerSkeleton[],
  topK: number,
  diversifyPlushiePairs: boolean,
): OptimizerSkeleton[] {
  const sorted = [...skeletons].sort((a, b) => b.preScore - a.preScore);
  if (!diversifyPlushiePairs) return sorted.slice(0, topK);
  return collectDiverseSkeletonShortlist(sorted, topK);
}

export function selectStage2Skeletons(
  quickEvaluated: QuickEvaluatedSkeleton[],
  stage2Cap: number,
): QuickEvaluatedSkeleton[] {
  const quickRanked = [...quickEvaluated].sort((a, b) => compareResult(a.score, b.score));
  return collectDiverseStage2Shortlist(quickRanked, stage2Cap);
}

export function containsSkeleton(
  entries: Array<{ skeleton: OptimizerSkeleton }>,
  expected: { traits: string[]; plushies: string[]; activesOn: boolean; breathOn: boolean; stage: number },
): boolean {
  const wantedTraits = [...expected.traits].sort().join("+");
  const wantedPlush = plushiePairKey(expected.plushies);
  return entries.some(({ skeleton }) => {
    const traits = [...skeleton.traits].sort().join("+");
    const plush = plushiePairKey(skeleton.plushies);
    return (
      skeleton.venerationStage === expected.stage &&
      skeleton.activesOn === expected.activesOn &&
      skeleton.breathOn === expected.breathOn &&
      traits === wantedTraits &&
      plush === wantedPlush
    );
  });
}
