import type { BuildOptions } from "../engine";
import { elderById, plushieByName } from "../engine/buildData";
import { blockStatToStatusId, resolveTraitPercent } from "../shared/buildDomain";
import type { OptimizerContext } from "./contextAndCompare";

export function preScoreBuild(
  build: BuildOptions,
  goal: "lexicographic" | "effectiveDamage" | "dps",
  context?: OptimizerContext,
): number {
  const traitIds = build.traits;
  let score = 0;
  for (const traitId of traitIds) {
    if (!["Damage", "Bite", "Weight", "Health"].includes(traitId)) continue;
    if (traitId === "Health" && context?.healthRelevant === false) continue;
    const val = resolveTraitPercent(traitId, build);
    if (goal === "dps") {
      if (traitId === "Damage") score += val * 3;
      if (traitId === "Bite") score += val * 2;
      if (traitId === "Weight") score += val * 0.2;
      continue;
    }
    if (goal === "effectiveDamage") {
      if (traitId === "Damage" || traitId === "Bite") score += val * 1.5;
      if (traitId === "Weight" || traitId === "Health") score += val * 0.8;
      continue;
    }
    score += val;
  }
  const elder = build.elder ?? "None";
  if (elder !== "None") {
    const elderProfile = elderById[elder];
    if (elderProfile) {
      const { modifiers } = elderProfile;
      if (goal === "dps") {
        score += (modifiers.damagePct ?? 0) * 2.5;
        score -= (modifiers.biteCooldownPct ?? 0) * 2;
        score += (modifiers.weightPct ?? 0) * 0.25;
      } else if (goal === "effectiveDamage") {
        score += (modifiers.damagePct ?? 0) * 1.5;
        score += (modifiers.weightPct ?? 0) * 0.9;
        score += (modifiers.healthRegenPct ?? 0) * 0.4;
        score -= (modifiers.biteCooldownPct ?? 0) * 1.25;
      } else {
        score += (modifiers.damagePct ?? 0) * 0.9;
        score += (modifiers.weightPct ?? 0) * 0.8;
        score += (modifiers.healthRegenPct ?? 0) * 0.7;
        score += (modifiers.ailmentBlockPct ?? 0) * 0.35;
        score += (modifiers.speedPct ?? 0) * 0.2;
        score -= (modifiers.biteCooldownPct ?? 0) * 0.8;
      }
    }
  }
  if (goal !== "dps") score += build.venerationStage * 2;
  for (const plushieName of build.plushies) {
    const plushie = plushieByName[plushieName];
    if (!plushie?.modifiersParsed) continue;
    for (const mod of plushie.modifiersParsed) {
      if (["damagePct", "hpPct", "healthPct", "weightPct"].includes(mod.stat)) {
        if (goal === "dps") {
          if (mod.stat === "damagePct") score += mod.value * 3;
          if (mod.stat === "weightPct") score += mod.value * 0.2;
        } else if (goal === "effectiveDamage") {
          score += mod.value * (mod.stat === "damagePct" ? 1.5 : 0.8);
        } else {
          score += mod.value;
        }
      }
      if (mod.stat === "biteCooldownPct") {
        const penalty = goal === "dps" ? 2.5 : goal === "effectiveDamage" ? 2.0 : 1.5;
        score -= mod.value * penalty;
      }
      if (["bleedStacks", "burnStacks", "poisonStacks", "necropoisonStacks", "frostbiteStacks"].includes(mod.stat)) {
        const note = (mod.note ?? "").toLowerCase();
        const defensive = note.includes("defensive");
        const base = defensive ? 0.2 : 1;
        score += mod.value * (goal === "dps" ? 0 : base);
      }
      if (
        ["blockBleedPct", "blockBurnPct", "blockPoisonPct", "blockNecropoisonPct", "blockFrostbitePct"].includes(mod.stat)
      ) {
        const statusId = blockStatToStatusId(mod.stat);
        if (context && statusId && !context.opponentStatusIds.has(statusId)) continue;
        const blockScore = goal === "dps" ? 0 : mod.value * 0.3;
        score += blockScore;
      }
    }
  }
  return score;
}
