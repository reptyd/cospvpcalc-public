import { effectsCatalog } from "./data";
import { addApproximationNote } from "./approximationNotes";
import {
  applyTraitModifier,
  applyVenerationBonuses,
  clampVenerationStage,
  computeAscensionLevels,
  normalizeTraitList,
  resolveTraitPercent,
} from "./buildProgressionRuntime";
import { applyPlushies } from "./plushieBuildRuntime";
import { hasAbilityName } from "./runtimeHelpers";
import { getRawPlushieBlockFraction } from "./statusBlockMath";
import type { BuildOptions, CreatureRuntime, FinalStats } from "./types";

export type TwoFacedMode = "tranquility" | "madness";
export const DEFAULT_TWO_FACED_MODE: TwoFacedMode = "madness";
import { elderById } from "./elderData";

const defaultBuildOptions: BuildOptions = {
  venerationStage: 0,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

export function applyRulesAndBuild(
  creature: CreatureRuntime,
  buildOptions: BuildOptions = defaultBuildOptions,
  twoFacedMode: TwoFacedMode = DEFAULT_TWO_FACED_MODE,
): FinalStats {
  const stats = { ...creature.stats };
  const approxNotes: string[] = [];
  const appliedTraits: string[] = [];
  const plushieStatusOnHit: Record<string, number> = {};
  const plushieStatusOnHitTaken: Record<string, number> = {};
  const plushieStatusBlockPct: Record<string, number> = {};
  const plushieGrantedOtherAbilities: Array<{ name: string; value: number | null; semantics: string }> = [];
  const breathRegenPctAccum = { value: 0 };
  const breathDamagePctAccum = { value: 0 };
  const appetiteDrainPctAccum = { value: 0 };
  const appetiteCapacityPctAccum = { value: 0 };
  const plushieReflectAvgPctAccum = { value: 0 };
  const effects = effectsCatalog[creature.name] ?? {};
  const elder = buildOptions.elder ?? "None";
  const elderProfile = elder !== "None" ? elderById[elder] : undefined;
  const hasStubbornStacker = [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? [])].some(
    (ability) => ability.name === "Stubborn Stacker",
  );

  if (hasAbilityName(effects, "Two-Faced")) {
    // Tranquility: +60% damage, +60% bite cooldown. Madness: -37.5% damage,
    // -37.5% bite cooldown. Both multipliers apply to the same two stats.
    const mult = twoFacedMode === "tranquility" ? 1.6 : 0.625;
    stats.damage *= mult;
    stats.biteCooldown *= mult;
  }

  if (hasAbilityName(effects, "Adrenaline")) {
    addApproximationNote(approxNotes, "ADRENALINE_COOLDOWN_APPROX");
  }

  const stage = clampVenerationStage(buildOptions.venerationStage);
  applyPctModifier(stats, "weight", elderProfile?.modifiers.weightPct);
  applyVenerationBonuses(stats, stage);

  const traitIds = normalizeTraitList(buildOptions.traits);
  const ascensionLevels = computeAscensionLevels(traitIds, buildOptions.ascensionAssignments, stage);
  for (const traitId of traitIds) {
    const ascensionLevel = ascensionLevels[traitId] ?? 0;
    const traitPercent = resolveTraitPercent(traitId, ascensionLevel, approxNotes);
    if (traitPercent === 0) continue;
    appliedTraits.push(traitId);
    applyTraitModifier(stats, traitId, traitPercent, approxNotes);
  }

  applyPlushies(
    stats,
    buildOptions.plushies ?? [],
    approxNotes,
    plushieStatusOnHit,
    plushieStatusOnHitTaken,
    plushieStatusBlockPct,
    plushieGrantedOtherAbilities,
    creature.name,
    hasStubbornStacker,
    breathRegenPctAccum,
    breathDamagePctAccum,
    appetiteDrainPctAccum,
    appetiteCapacityPctAccum,
    plushieReflectAvgPctAccum,
  );

  let elderStatusBlockPct = 0;
  let activeCooldownMultiplier = 1;
  if (elderProfile) {
    applyPctModifier(stats, "damage", elderProfile.modifiers.damagePct);
    applyPctModifier(stats, "biteCooldown", elderProfile.modifiers.biteCooldownPct);
    applyPctModifier(stats, "healthRegen", elderProfile.modifiers.healthRegenPct);
    applyPctModifier(stats, "stamina", elderProfile.modifiers.staminaPct);
    applyPctModifier(stats, "stamRegen", elderProfile.modifiers.stamRegenPct);
    applyPctModifier(stats, "walkAndSwimSpeed", elderProfile.modifiers.speedPct);
    applyPctModifier(stats, "sprintSpeed", elderProfile.modifiers.speedPct);
    elderStatusBlockPct = elderProfile.modifiers.ailmentBlockPct ?? 0;
    if (typeof elderProfile.modifiers.activeCooldownPct === "number") {
      activeCooldownMultiplier *= 1 + elderProfile.modifiers.activeCooldownPct / 100;
    }
  }

  const hasBreath = Boolean(stats.breath && stats.breath !== "N/A");
  const breathType = hasBreath ? stats.breath ?? null : null;

  return {
    ...stats,
    name: creature.name,
    hasBreath,
    breathType,
    customBreathProfile: creature.customBreathProfile ?? null,
    activeCooldownMultiplier,
    approxNotes,
    appliedTraits,
    elder,
    elderStatusBlockPct,
    plushieStatusOnHit,
    plushieStatusOnHitTaken,
    plushieStatusBlockPct,
    plushieGrantedOtherAbilities,
    breathRegenPct: breathRegenPctAccum.value || undefined,
    breathDamagePct: breathDamagePctAccum.value || undefined,
    appetiteDrainPct: appetiteDrainPctAccum.value || undefined,
    appetiteCapacityPct: appetiteCapacityPctAccum.value || undefined,
    plushieReflectAvgPct: plushieReflectAvgPctAccum.value || undefined,
  };
}

function applyPctModifier(stats: Record<string, number | string | undefined>, key: string, pct?: number): void {
  if (!pct) return;
  const current = stats[key];
  if (typeof current !== "number") return;
  stats[key] = current * (1 + pct / 100);
}

export function getPlushieBlockFraction(finalStats: FinalStats, statusId: string): number {
  return getRawPlushieBlockFraction(finalStats, statusId);
}
