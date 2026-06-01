import type { BuildOptions } from "../engine";
import { plushieByName, plushies, traits, veneration } from "../engine/buildData";

export const DEFAULT_BUILD: BuildOptions = {
  venerationStage: 0,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

export function blockStatToStatusId(stat: string): string | null {
  switch (stat) {
    case "blockBleedPct":
      return "Bleed_Status";
    case "blockBurnPct":
      return "Burn_Status";
    case "blockPoisonPct":
      return "Poison_Status";
    case "blockFrostbitePct":
      return "Frostbite_Status";
    case "blockNecropoisonPct":
      return "Necropoison_Status";
    default:
      return null;
  }
}

export function parsePercentValue(text: string): number {
  const match = text.match(/-?\d+(\.\d+)?%/);
  if (!match) return 0;
  return Number(match[0].replace("%", ""));
}

export function traitNameFromId(traitId: string): string {
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

export function resolveTraitPercent(traitId: string, build: BuildOptions): number {
  const ascensionLevels = computeAscensionLevels(build.traits, build.ascensionAssignments, build.venerationStage);
  const level = ascensionLevels[traitId] ?? 0;
  const traitName = traitNameFromId(traitId);
  const ascension = veneration.traitAscension[traitName];
  if (ascension?.sequence?.length) {
    const idx = Math.min(level, ascension.sequence.length - 1);
    return parsePercentValue(ascension.sequence[idx]);
  }
  const trait = traits.find((item) => item.id === traitId);
  if (trait?.effectText) return parsePercentValue(trait.effectText);
  return 0;
}

export function enumerateAssignmentsCounts(traitsSelection: string[], stage: number): string[][] {
  if (traitsSelection.length !== 2) return [];
  const [trait1, trait2] = traitsSelection;
  const results: string[][] = [];
  for (let n1 = 0; n1 <= stage; n1 += 1) {
    const n2 = stage - n1;
    const assignment = Array.from({ length: veneration.stages }, (_, idx) => {
      if (idx < n1) return trait1;
      if (idx < n1 + n2) return trait2;
      return "";
    });
    results.push(assignment);
  }
  return results;
}

export function isPlushiePurelyHarmful(plushie: (typeof plushies)[number]): boolean {
  const mods = plushie.modifiersParsed ?? [];
  if (mods.length === 0) return true;
  let hasPositiveRelevant = false;
  let hasRelevant = false;

  for (const mod of mods) {
    if (["bleedStacks", "burnStacks", "poisonStacks", "necropoisonStacks", "frostbiteStacks"].includes(mod.stat)) {
      if (mod.value > 0) hasPositiveRelevant = true;
      hasRelevant = true;
      continue;
    }
    if (
      ["blockBleedPct", "blockBurnPct", "blockPoisonPct", "blockNecropoisonPct", "blockFrostbitePct"].includes(mod.stat)
    ) {
      if (mod.value > 0) hasPositiveRelevant = true;
      hasRelevant = true;
      continue;
    }
    if (mod.stat === "movementSpeedPct") continue;
    if (["damagePct", "hpPct", "healthPct", "weightPct", "stamRegenPct", "hpRegenPct"].includes(mod.stat)) {
      hasRelevant = true;
      if (mod.value > 0) hasPositiveRelevant = true;
    }
  }
  return hasRelevant && !hasPositiveRelevant;
}

export function generatePlushieCombosFromNames(names: string[], quality: "fast" | "balanced" | "quality"): string[][] {
  const stackablePairs: string[][] = [];
  const mixedPairs: string[][] = [];
  for (let i = 0; i < names.length; i += 1) {
    const first = plushieByName[names[i]];
    if (!first) continue;
    if (first.stackRule === "stackable") {
      stackablePairs.push([names[i], names[i]]);
    }
    for (let j = i + 1; j < names.length; j += 1) {
      mixedPairs.push([names[i], names[j]]);
    }
  }
  const combos = [...stackablePairs, ...mixedPairs];
  const limit = quality === "fast" ? 60 : quality === "balanced" ? 120 : 200;
  return combos.slice(0, limit);
}
