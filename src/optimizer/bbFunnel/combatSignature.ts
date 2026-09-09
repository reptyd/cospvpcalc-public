import type { BuildOptions, CreatureRuntime, FinalStats } from "../../engine";
import { memoizedApplyRulesAndBuild } from "../bestBuildsOptimizations";

// ---------------------------------------------------------------------------
// Combat-signature dedup (funnel layer 1).
//
// Two candidate builds that project to the SAME combat signature drive a
// bit-identical fight against every opponent: the composable engine is
// deterministic, and a build reaches the fight ONLY through the FinalStats
// fields that `toRustStatusMeleeStats` / `toRustBreathProfile` read plus the
// per-source ability config (build-independent) and the activesOn/breathOn
// toggles. Anything a build changes that those marshallers never read - the
// stamina / speed / turn / appetite stats, cosmetic plushies - is invisible to
// the stand-and-fight engine, so collapsing on the signature is exact.
//
// The signature is deliberately the projection of FinalStats onto exactly the
// fields the marshallers consume. Adding a field the engine ignores would only
// suppress a legitimate collapse; dropping a field the engine reads would fold
// two genuinely different fights together, so the set below is kept in lockstep
// with rustBestBuildsRuntime.ts (see the field-by-field notes there).
// ---------------------------------------------------------------------------

export type FunnelCandidate = {
  build: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  preScore: number;
};

export type CombatSignatureGroup = {
  signature: string;
  /** Highest-preScore member; the label carried forward for display/ranking. */
  representative: FunnelCandidate;
  finalStats: FinalStats;
  members: FunnelCandidate[];
};

export type DeduplicateResult = {
  groups: CombatSignatureGroup[];
  total: number;
  distinct: number;
};

/** Stable string for a number so equal values serialise identically and
 * distinct floats (even by one ULP) never collide. `-0` folds to `0`. */
export function canonicalNumber(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return "";
  return Object.is(value, -0) ? "0" : String(value);
}

/** Sorted `id:value` list for a status map, so key order can't perturb the
 * signature. Empty/zero entries are dropped - they are engine no-ops. */
export function canonicalStatusMap(map: Record<string, number> | undefined): string {
  if (!map) return "";
  return Object.entries(map)
    .filter(([, stacks]) => Number.isFinite(stacks) && stacks !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, stacks]) => `${id}=${canonicalNumber(stacks)}`)
    .join(",");
}

/** The source's ability surface. Build-independent (a build never adds or
 * removes an ability), so it is constant across one source's candidates, but it
 * is folded in so a signature is self-describing and can never collide across
 * different sources. */
export function sourceAbilitySignature(source: CreatureRuntime): string {
  const names = [
    ...(source.activatedAbilities ?? []).map((a) => `act:${a.name}`),
    ...(source.passiveAbilities ?? []).map((a) => `pas:${a.name}`),
    ...(source.breathAbilities ?? []).map((a) => `bre:${a.name}`),
    ...((source.userAbilityIds ?? []).map((id) => `usr:${id}`)),
  ].sort();
  return names.join("|");
}

/**
 * Canonical combat signature for a single (finalStats, activesOn, breathOn)
 * against a fixed source. Same string => identical Rust fight inputs.
 */
export function computeCombatSignature(
  source: CreatureRuntime,
  finalStats: FinalStats,
  activesOn: boolean,
  breathOn: boolean,
): string {
  const parts: string[] = [
    // toggles - gate selfDestruct + the whole config-vs-empty choice
    `A${activesOn ? 1 : 0}`,
    `B${breathOn ? 1 : 0}`,
    // core melee stats read by toRustSimpleStats
    `hp${canonicalNumber(finalStats.health)}`,
    `wt${canonicalNumber(finalStats.weight)}`,
    `dmg${canonicalNumber(finalStats.damage)}`,
    `bcd${canonicalNumber(finalStats.biteCooldown)}`,
    `dmg2${canonicalNumber(finalStats.damage2)}`,
    `hreg${canonicalNumber(finalStats.healthRegen)}`,
    `acm${canonicalNumber(finalStats.activeCooldownMultiplier)}`,
    `bres${canonicalNumber(finalStats.breathResistance)}`,
    `refl${canonicalNumber(finalStats.plushieReflectAvgPct)}`,
    // build-varying identity (elder) + creature-fixed identity read-vars
    `eld${finalStats.elder ?? "None"}`,
    `typ${finalStats.type ?? ""}`,
    `dt${finalStats.diet ?? ""}`,
    `tr${canonicalNumber(finalStats.tier)}`,
    `ox${canonicalNumber(finalStats.oxygenTime)}`,
    `mo${canonicalNumber(finalStats.moistureTime)}`,
    // breath channel read by toRustBreathProfile
    `hb${finalStats.hasBreath ? 1 : 0}`,
    `bt${finalStats.breathType ?? ""}`,
    `bdmg${canonicalNumber(finalStats.breathDamagePct)}`,
    `breg${canonicalNumber(finalStats.breathRegenPct)}`,
    `cb${finalStats.customBreathProfile ? JSON.stringify(finalStats.customBreathProfile) : ""}`,
    // status classes + block, sorted
    `oh${canonicalStatusMap(finalStats.plushieStatusOnHit)}`,
    `oht${canonicalStatusMap(finalStats.plushieStatusOnHitTaken)}`,
    `blk${canonicalStatusMap(finalStats.plushieStatusBlockPct)}`,
    `ebl${canonicalNumber(finalStats.elderStatusBlockPct)}`,
    // plushie-granted abilities (e.g. Frosty) affect the weather branch
    `ga${(finalStats.plushieGrantedOtherAbilities ?? [])
      .map((a) => a.name)
      .sort()
      .join(",")}`,
    // source ability surface (constant per source, folded for self-containment)
    `ab${sourceAbilitySignature(source)}`,
  ];
  return parts.join("␟");
}

/**
 * Collapse candidate builds to distinct combat signatures. Each group keeps its
 * highest-preScore member as the representative (any member drives the same
 * fight; preScore just picks a canonical label). `finalStats` is memoised
 * through the same cache the live BB flow uses, so the dedup is free of extra
 * build math.
 */
export function deduplicateBySignature(
  candidates: readonly FunnelCandidate[],
  source: CreatureRuntime,
): DeduplicateResult {
  const groups = new Map<string, CombatSignatureGroup>();
  for (const candidate of candidates) {
    const finalStats = memoizedApplyRulesAndBuild(source, candidate.build);
    const signature = computeCombatSignature(source, finalStats, candidate.activesOn, candidate.breathOn);
    const existing = groups.get(signature);
    if (!existing) {
      groups.set(signature, { signature, representative: candidate, finalStats, members: [candidate] });
      continue;
    }
    existing.members.push(candidate);
    if (candidate.preScore > existing.representative.preScore) {
      existing.representative = candidate;
    }
  }
  return {
    groups: Array.from(groups.values()),
    total: candidates.length,
    distinct: groups.size,
  };
}
