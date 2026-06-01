import type { BuildOptions, SimulationSummary } from "../engine";
import { compareResult, scoreResult } from "./scoring";

type Candidate = { build: BuildOptions; activesOn: boolean; breathOn: boolean; preScore: number };

function pushTopK<T>(arr: T[], item: T, compare: (a: T, b: T) => number, k: number): void {
  arr.push(item);
  arr.sort(compare);
  if (arr.length > k) arr.length = k;
}

export function buildStage1Pool(candidates: Candidate[], topK: number): Candidate[] {
  const stage1: Candidate[] = [];
  const bestByPlush = new Map<string, Candidate>();
  const bestByTraits = new Map<string, Candidate>();

  for (const candidate of candidates) {
    pushTopK(stage1, candidate, (a, b) => b.preScore - a.preScore, topK);
    const plushKey = [...candidate.build.plushies].sort().join("+");
    const traitKey = candidate.build.traits.join("+");
    const prevPlush = bestByPlush.get(plushKey);
    if (!prevPlush || candidate.preScore > prevPlush.preScore) bestByPlush.set(plushKey, candidate);
    const prevTrait = bestByTraits.get(traitKey);
    if (!prevTrait || candidate.preScore > prevTrait.preScore) bestByTraits.set(traitKey, candidate);
  }

  for (const candidate of [...bestByPlush.values(), ...bestByTraits.values()]) {
    pushTopK(stage1, candidate, (a, b) => b.preScore - a.preScore, topK);
  }
  return stage1;
}

function buildAscensionBucketKey(candidate: { build: BuildOptions; activesOn: boolean; breathOn: boolean }): string {
  const plushKey = [...candidate.build.plushies].sort().join("+");
  const traitKey = [...candidate.build.traits].sort().join("+");
  return `${candidate.build.venerationStage}::${candidate.build.elder ?? "None"}::${traitKey}::${plushKey}::${candidate.activesOn ? 1 : 0}${candidate.breathOn ? 1 : 0}`;
}

export function reduceCandidatesByBucket(candidates: Candidate[]): Candidate[] {
  const bestByBucket = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const bucketKey = buildAscensionBucketKey(candidate);
    const existing = bestByBucket.get(bucketKey);
    if (!existing || candidate.preScore > existing.preScore) {
      bestByBucket.set(bucketKey, candidate);
    }
  }
  return Array.from(bestByBucket.values());
}

export function buildResultKeyWithoutAscension(build: BuildOptions, activesOn: boolean, breathOn: boolean): string {
  const plushKey = [...build.plushies].sort().join("+");
  const traitKey = [...build.traits].sort().join("+");
  return `${build.venerationStage}::${build.elder ?? "None"}::${traitKey}::${plushKey}::${activesOn ? 1 : 0}${breathOn ? 1 : 0}`;
}

export function pickBestBySkeleton(
  entries: Array<{ skeletonKey: string; summary: SimulationSummary; build: BuildOptions }>,
  perspective: "A" | "B",
): Map<string, { build: BuildOptions; summary: SimulationSummary }> {
  const bestBySkeleton = new Map<string, { build: BuildOptions; summary: SimulationSummary }>();
  for (const entry of entries) {
    const scored = scoreResult(entry.summary, perspective);
    const existing = bestBySkeleton.get(entry.skeletonKey);
    if (!existing) {
      bestBySkeleton.set(entry.skeletonKey, { build: entry.build, summary: entry.summary });
      continue;
    }
    const existingScore = scoreResult(existing.summary, perspective);
    if (compareResult(scored, existingScore) < 0) {
      bestBySkeleton.set(entry.skeletonKey, { build: entry.build, summary: entry.summary });
    }
  }
  return bestBySkeleton;
}
