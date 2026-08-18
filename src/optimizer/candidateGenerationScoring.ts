import type { BuildOptions } from "../engine";
import { elderById, plushieByName } from "../engine/buildData";
import { blockStatToStatusId, resolveTraitPercent } from "../shared/buildDomain";
import type { OptimizerContext } from "./contextAndCompare";
import type { BestBuildAggregateObjective } from "./ranking";

// How well a build's composition expresses a given ranking objective, reusing
// the SAME heuristic as the candidate pre-score (single source of truth for
// "build fits goal"). Used as a deterministic tiebreak when builds tie on the
// objective's combat metric, so e.g. a damage/bite build wins a DPS tie while a
// regen build wins a survival tie - instead of regen (which only helps win-rate
// / survival) silently winning every objective's ties.
// Maps a ranking objective to the candidate-generation goal that shapes BOTH
// the pre-score heuristic AND the trait pool. avgDps/avgTtk are pure
// rate/speed objectives -> "dps"; immortalDamage rewards a surviving winner's
// extended damage -> "effectiveDamage"; survival -> "survival"; winRate keeps the
// generic "lexicographic" mix.
export function candidateGoalForObjective(
  objective: BestBuildAggregateObjective,
): "lexicographic" | "effectiveDamage" | "dps" | "survival" {
  if (objective === "survival") return "survival";
  if (objective === "immortalDamage") return "effectiveDamage";
  if (objective === "winRate") return "lexicographic";
  return "dps"; // avgDps / avgTtk
}

export function objectiveBuildFit(build: BuildOptions, objective: BestBuildAggregateObjective): number {
  return preScoreBuild(build, candidateGoalForObjective(objective));
}

export function preScoreBuild(
  build: BuildOptions,
  goal: "lexicographic" | "effectiveDamage" | "dps" | "survival",
  context?: OptimizerContext,
): number {
  const traitIds = build.traits;
  let score = 0;
  for (const traitId of traitIds) {
    if (!["Damage", "Bite", "Weight", "Health"].includes(traitId)) continue;
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
    if (goal === "survival") {
      // Pure durability: max HP is king, weight adds bulk; offence is
      // irrelevant to staying alive, so Damage/Bite contribute nothing.
      if (traitId === "Health") score += val * 2.5;
      if (traitId === "Weight") score += val * 0.8;
      continue;
    }
    // winRate / lexicographic: a kill-oriented tiebreak. Offence wins; Weight
    // adds a little bulk; the Health trait scores ZERO. Health is pure HP-regen
    // (+12.5%), and its only edge is SURVIVAL - exactly what must not decide a
    // win-rate tie (rewarding it is what let the regen Health trait ride ties to
    // the top). Mirrors how the dps/ttk goals already ignore Health. NB: Health
    // resolves to a fixed 12.5% via effectText, so a plain `val` weight would
    // out-score Weight's 5% and keep Health winning - it must be zeroed.
    if (traitId === "Damage" || traitId === "Bite") score += val * 1.5;
    else if (traitId === "Weight") score += val * 0.5;
    // Health: no contribution (regen is irrelevant to a win-rate tiebreak).
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
      } else if (goal === "survival") {
        // Sustain + mitigation + bulk win the lifespan race; offence ignored.
        // (Gentle's +HP-regen / +ailment-block scores high, Powerful's
        // -HP-regen / -stamina scores low - matching real survival picks.)
        score += (modifiers.healthRegenPct ?? 0) * 1.4;
        score += (modifiers.ailmentBlockPct ?? 0) * 0.9;
        score += (modifiers.staminaPct ?? 0) * 0.3;
        score += (modifiers.weightPct ?? 0) * 0.6;
        score += (modifiers.speedPct ?? 0) * 0.1;
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
        } else if (goal === "survival") {
          // Bulk (hp/weight) helps; raw damage does nothing for survival.
          if (mod.stat !== "damagePct") score += mod.value * 0.8;
        } else {
          score += mod.value;
        }
      }
      // Regen plushies (e.g. Heart = +30% HP regen) are the BACKBONE of a
      // survival build, but the offence/lexicographic scorers ignore them
      // entirely - which is why a Heart/Heart tank used to be pre-pruned
      // before it was ever simulated. Score them heavily for survival.
      if (goal === "survival") {
        if (mod.stat === "hpRegenPct") score += mod.value * 1.0;
        else if (mod.stat === "breathRegenPct") score += mod.value * 0.4;
      }
      if (mod.stat === "biteCooldownPct") {
        // Bite cadence is an offence stat - irrelevant to survival, so no
        // penalty there.
        const penalty = goal === "dps" ? 2.5 : goal === "effectiveDamage" ? 2.0 : goal === "survival" ? 0 : 1.5;
        score -= mod.value * penalty;
      }
      if (["bleedStacks", "burnStacks", "poisonStacks", "necropoisonStacks", "frostbiteStacks"].includes(mod.stat)) {
        const note = (mod.note ?? "").toLowerCase();
        const defensive = note.includes("defensive");
        const base = defensive ? 0.2 : 1;
        // Offensive stacks help you KILL, not survive; only defensive stacks
        // (e.g. Broodwatcher) matter a little for a survival build.
        const survivalWeight = defensive ? 0.3 : 0;
        score += mod.value * (goal === "dps" ? 0 : goal === "survival" ? survivalWeight : base);
      }
      if (
        ["blockBleedPct", "blockBurnPct", "blockPoisonPct", "blockNecropoisonPct", "blockFrostbitePct"].includes(mod.stat)
      ) {
        const statusId = blockStatToStatusId(mod.stat);
        if (context && statusId && !context.opponentStatusIds.has(statusId)) continue;
        // Ailment mitigation is doubly valuable when the goal is to outlast.
        const blockScore = goal === "dps" ? 0 : mod.value * (goal === "survival" ? 0.6 : 0.3);
        score += blockScore;
      }
    }
  }
  return score;
}
