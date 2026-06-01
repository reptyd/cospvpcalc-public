import { plushieByName, plushies } from "../engine/buildData";
import { blockStatToStatusId, generatePlushieCombosFromNames, isPlushiePurelyHarmful } from "../shared/buildDomain";
import type { OptimizerContext } from "./optimizerContextTypes";

export function isPlushieRelevantForMatchup(plushie: (typeof plushies)[number], context: OptimizerContext): boolean {
  const mods = plushie.modifiersParsed ?? [];
  if (mods.length === 0) return false;
  let hasRelevant = false;
  for (const mod of mods) {
    if (mod.stat.includes("hunger") || mod.stat.includes("thirst")) continue;
    if (mod.stat === "movementSpeedPct" || mod.stat === "takeoffStaminaCostPct") continue;
    if (
      ["blockBleedPct", "blockBurnPct", "blockPoisonPct", "blockNecropoisonPct", "blockFrostbitePct"].includes(mod.stat)
    ) {
      const status = blockStatToStatusId(mod.stat);
      if (!status || !context.opponentStatusIds.has(status)) continue;
      hasRelevant = true;
      continue;
    }
    if (["bleedStacks", "burnStacks", "poisonStacks", "necropoisonStacks", "frostbiteStacks"].includes(mod.stat)) {
      hasRelevant = true;
      continue;
    }
    if (["damagePct", "hpPct", "healthPct", "weightPct", "stamRegenPct", "hpRegenPct"].includes(mod.stat)) {
      hasRelevant = true;
      continue;
    }
  }
  return hasRelevant;
}

export function generateRelevantPlushieCombos(
  quality: "fast" | "balanced" | "quality",
  context?: OptimizerContext,
): string[][] {
  const names = plushies
    .filter((p) => p.modifiersParsed && p.modifiersParsed.length > 0)
    .filter((p) => p.name !== "Chick" && p.name !== "Serpent")
    .filter((p) => !isPlushiePurelyHarmful(p))
    .filter((p) => (context?.relevantPlushies ? context.relevantPlushies.has(p.name) : true))
    .filter((p) => (context ? isPlushieRelevantForMatchup(p, context) : true))
    .map((p) => p.name)
    .filter(Boolean);

  return generatePlushieCombosFromNames(names, quality);
}

export function expandForcedPlushieCombos(firstPlushie: string): string[][] {
  const pairs: string[][] = [];
  for (const plushie of plushies) {
    const second = plushie.name;
    if (firstPlushie === second && plushieByName[firstPlushie]?.stackRule !== "stackable") continue;
    pairs.push([firstPlushie, second]);
  }
  return pairs;
}
