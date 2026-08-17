import { traitById, veneration } from "./data";
import type { CreatureRuntime } from "./types";

// Fraction of the stage-5 veneration bonus (health + weight) granted at each
// stage. Deliberately non-linear: no bonus at stage 0-1, then 1/6, 2/6, 3/6 of
// the full value at stages 2/3/4, and the full value at stage 5 (which jumps
// straight to full, not 5/6). Indexed by stage.
const VENERATION_BONUS_FRACTION_BY_STAGE = [0, 0, 1 / 6, 2 / 6, 3 / 6, 1];

export function applyVenerationBonuses(stats: CreatureRuntime["stats"], stage: number): void {
  const tierKey = String(Math.round(stats.tier));
  const tierBonus = veneration.tierBonusesAtStage5[tierKey];
  if (!tierBonus) return;

  const idx = Math.min(Math.max(0, Math.round(stage)), VENERATION_BONUS_FRACTION_BY_STAGE.length - 1);
  const fraction = VENERATION_BONUS_FRACTION_BY_STAGE[idx];
  stats.health += tierBonus.extraHealthAt5 * fraction;
  stats.weight += tierBonus.extraWeightAt5 * fraction;
}

export function clampVenerationStage(stage: number): number {
  if (Number.isNaN(stage)) return 0;
  return Math.min(Math.max(0, Math.round(stage)), veneration.stages);
}

export function normalizeTraitList(traits: string[]): string[] {
  const unique = traits.filter(Boolean).filter((value, idx, arr) => arr.indexOf(value) === idx);
  return unique.slice(0, 2);
}

export function computeAscensionLevels(
  traitIds: string[],
  assignments: string[],
  stage: number,
): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const id of traitIds) levels[id] = 0;

  if (traitIds.length === 1) {
    levels[traitIds[0]] = stage;
    return levels;
  }

  for (let i = 0; i < stage; i += 1) {
    const assignment = assignments[i];
    if (!assignment || levels[assignment] === undefined) continue;
    levels[assignment] += 1;
  }
  return levels;
}

export function resolveTraitPercent(traitId: string, ascensionLevel: number): number {
  const traitName = traitNameFromId(traitId);
  const ascension = veneration.traitAscension[traitName];
  if (ascension?.sequence?.length) {
    const idx = Math.min(ascensionLevel, ascension.sequence.length - 1);
    return parsePercent(ascension.sequence[idx]);
  }

  const trait = traitById[traitId];
  if (trait?.effectText) {
    return parsePercent(trait.effectText);
  }

  return 0;
}

export function applyTraitModifier(
  stats: CreatureRuntime["stats"],
  traitId: string,
  percent: number,
): void {
  const multiplier = 1 + percent / 100;
  switch (traitId) {
    case "Bite":
      stats.biteCooldown = Math.max(0.05, stats.biteCooldown * (1 - percent / 100));
      break;
    case "Damage":
      stats.damage *= multiplier;
      if (typeof stats.damage2 === "number") stats.damage2 *= multiplier;
      break;
    case "Health":
      stats.healthRegen = (stats.healthRegen ?? 0) * multiplier;
      break;
    case "Weight":
      stats.weight *= multiplier;
      break;
    case "Speed":
    case "Max_Stamina":
    case "Stamina_Regen":
    case "Healing":
      // Speed, stamina and healing traits move nothing a fight reads.
      break;
    default:
      break;
  }
}

function traitNameFromId(traitId: string): string {
  switch (traitId) {
    case "Health":
      return "Health Regen";
    case "Max_Stamina":
      return "Max Stamina";
    case "Stamina_Regen":
      return "Stamina/Glide Regen";
    default:
      return traitId.replace(/_/g, " ");
  }
}

function parsePercent(text: string): number {
  const match = text.match(/-?\d+(\.\d+)?%/);
  if (!match) return 0;
  return Number(match[0].replace("%", ""));
}
