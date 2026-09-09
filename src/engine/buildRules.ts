import { effectsCatalog } from "./data";
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
import { SPEC_CONSTANTS } from "./specConstants.generated";
import type { BuildOptions, CreatureRuntime, FinalStats } from "./types";
// Re-exported from a zero-import leaf so boot-reachable consumers can read the
// default without dragging this catalog-heavy module in. See twoFacedMode.ts.
import { DEFAULT_TWO_FACED_MODE, type TwoFacedMode } from "./twoFacedMode";
export { DEFAULT_TWO_FACED_MODE, type TwoFacedMode };
import { elderById } from "./elderData";

/** Seconds of held breath Agile Swimmer adds, per the ailment's Oxygen field. */
const AGILE_SWIMMER_OXYGEN_SEC = 45;

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
  const appliedTraits: string[] = [];
  const plushieStatusOnHit: Record<string, number> = {};
  const plushieStatusOnHitTaken: Record<string, number> = {};
  const plushieStatusBlockPct: Record<string, number> = {};
  const plushieGrantedOtherAbilities: Array<{ name: string; value: number | null; semantics: string }> = [];
  const breathRegenPctAccum = { value: 0 };
  const breathDamagePctAccum = { value: 0 };
  const appetiteDrainPctAccum = { hunger: 0, thirst: 0 };
  const appetiteCapacityPctAccum = { value: 0 };
  const plushieReflectAvgPctAccum = { value: 0 };
  const muddyStrengthBoostPctAccum = { value: 0 };
  const effects = effectsCatalog[creature.name] ?? {};
  const elder = buildOptions.elder ?? "None";
  const elderProfile = elder !== "None" ? elderById[elder] : undefined;
  const hasStubbornStacker = [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? [])].some(
    (ability) => ability.name === "Stubborn Stacker",
  );

  if (hasAbilityName(effects, "Two-Faced")) {
    // Tranquility: +60% damage, +60% bite cooldown. Madness: -37.5% damage,
    // -37.5% bite cooldown. Both multipliers apply to the same two stats. This
    // is the only place they are applied - the mode is a per-page toggle and the
    // Rust engine receives stats already scaled, with no Two-Faced flag of its own.
    const mult =
      twoFacedMode === "tranquility"
        ? SPEC_CONSTANTS.two_faced_tranquility_multiplier
        : SPEC_CONSTANTS.two_faced_madness_multiplier;
    stats.damage *= mult;
    if (typeof stats.damage2 === "number") stats.damage2 *= mult;
    stats.biteCooldown *= mult;
  }

  // Agile Swimmer deepens the breath the creature takes into water. Only the
  // underwater drain mode reads this pool, so the bonus is inert elsewhere.
  if (hasAbilityName(effects, "Agile Swimmer") && typeof stats.oxygenTime === "number") {
    stats.oxygenTime += AGILE_SWIMMER_OXYGEN_SEC;
  }

  const stage = clampVenerationStage(buildOptions.venerationStage);
  applyPctModifier(stats, "weight", elderProfile?.modifiers.weightPct);
  applyVenerationBonuses(stats, stage);

  const traitIds = normalizeTraitList(buildOptions.traits);
  const ascensionLevels = computeAscensionLevels(traitIds, buildOptions.ascensionAssignments, stage);
  for (const traitId of traitIds) {
    const ascensionLevel = ascensionLevels[traitId] ?? 0;
    const traitPercent = resolveTraitPercent(traitId, ascensionLevel);
    if (traitPercent === 0) continue;
    appliedTraits.push(traitId);
    applyTraitModifier(stats, traitId, traitPercent);
  }

  applyPlushies(
    stats,
    buildOptions.plushies ?? [],
    plushieStatusOnHit,
    plushieStatusOnHitTaken,
    plushieStatusBlockPct,
    plushieGrantedOtherAbilities,
    hasStubbornStacker,
    breathRegenPctAccum,
    breathDamagePctAccum,
    appetiteDrainPctAccum,
    appetiteCapacityPctAccum,
    plushieReflectAvgPctAccum,
    muddyStrengthBoostPctAccum,
  );

  let elderStatusBlockPct = 0;
  let activeCooldownMultiplier = 1;
  if (elderProfile) {
    applyPctModifier(stats, "damage", elderProfile.modifiers.damagePct);
    applyPctModifier(stats, "damage2", elderProfile.modifiers.damagePct);
    applyPctModifier(stats, "biteCooldown", elderProfile.modifiers.biteCooldownPct);
    applyPctModifier(stats, "healthRegen", elderProfile.modifiers.healthRegenPct);
    applyPctModifier(stats, "stamina", elderProfile.modifiers.staminaPct);
    applyPctModifier(stats, "stamRegen", elderProfile.modifiers.stamRegenPct);
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
    appliedTraits,
    elder,
    elderStatusBlockPct,
    plushieStatusOnHit,
    plushieStatusOnHitTaken,
    plushieStatusBlockPct,
    plushieGrantedOtherAbilities,
    breathRegenPct: breathRegenPctAccum.value || undefined,
    breathDamagePct: breathDamagePctAccum.value || undefined,
    hungerDrainPct: appetiteDrainPctAccum.hunger || undefined,
    thirstDrainPct: appetiteDrainPctAccum.thirst || undefined,
    appetiteCapacityPct: appetiteCapacityPctAccum.value || undefined,
    plushieReflectAvgPct: plushieReflectAvgPctAccum.value || undefined,
    muddyStrengthBoostPct: muddyStrengthBoostPctAccum.value || undefined,
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
