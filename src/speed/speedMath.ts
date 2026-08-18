import type { BuildOptions, CreatureRuntime } from "../engine/types";
import { elderById } from "../engine/elderData";
import { plushieByName } from "../engine/buildData";
import {
  ambushSpeed,
  baseChannels,
  flySprintFactor,
  SPEED_CHANNELS,
  type SpeedChannel,
  type SpeedReadout,
} from "./speedChannels";
import { SEA_SCHOOL_CAP, SPEED_EFFECTS, type SpeedEffect, type SpeedEffectContext, type SpeedOps } from "./speedEffects";

export type SpeedInput = {
  creature: CreatureRuntime;
  build: BuildOptions;
  /** Ids of the toggleable effects the player is holding right now. Plushie and
   * trait effects come from the build and are never listed here. */
  active?: Iterable<string>;
  /** Appetite fill, 100 = exactly full. Only Gourmandizer reads it. */
  fillPct?: number;
  /** Tier 1-2 packmates in range. Only Sea School reads it. */
  packmates?: number;
};

export type SpeedContribution = {
  effect: SpeedEffect;
  ops: SpeedOps;
  /** 2 when the same plushie fills both slots. */
  stacks: number;
};

export type SpeedResult = {
  base: SpeedReadout;
  final: SpeedReadout;
  contributions: SpeedContribution[];
};

function abilityNames(creature: CreatureRuntime): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const list of [creature.passiveAbilities, creature.activatedAbilities, creature.breathAbilities]) {
    for (const ability of list ?? []) {
      const value = ability.value;
      out.set(ability.name, typeof value === "number" && Number.isFinite(value) ? value : null);
    }
  }
  return out;
}

/** How many times an effect lands. Equipping the same plushie in both slots
 * makes the game run its `OnGet` twice (`ArePlushiesStacked` in CharacterData),
 * so two Chicks are 1.05 squared rather than 1.05. It doubles any plushie whose
 * own record lists the ailment, which is all of them; what stops a pair is the
 * roster's stackable column, carried here as `stackRule`. Anything that is not
 * plushie-bound lands at most once. */
export function effectStacks(effect: SpeedEffect, creature: CreatureRuntime, build: BuildOptions): number {
  if (effect.ability && !abilityNames(creature).has(effect.ability)) return 0;
  if (!effect.plushie) return 1;
  const copies = build.plushies.filter((name) => name === effect.plushie).length;
  if (copies === 0) return 0;
  return plushieByName[effect.plushie]?.stackRule === "unique" ? 1 : Math.min(2, copies);
}

/** Whether the creature can be offered this effect at all. */
export function isEffectAvailable(effect: SpeedEffect, creature: CreatureRuntime, build: BuildOptions): boolean {
  return effectStacks(effect, creature, build) > 0;
}

/** How many veneration stages reached one slotted trait. A single slotted trait
 * soaks up every stage; with two, the ascension assignments decide. Same rule
 * buildRules uses, and exported so the page can badge a trait with the number
 * the maths actually read off it. */
export function traitAscension(build: BuildOptions, trait: string): number {
  const traits = build.traits ?? [];
  if (!traits.includes(trait)) return 0;
  const stage = Math.max(0, Math.min(5, build.venerationStage ?? 0));
  if (traits.length === 1) return stage;
  return (build.ascensionAssignments ?? []).slice(0, stage).filter((slot) => slot === trait).length;
}

/** Diets that can put a plant in their mouth. Eating is gated on the creature's
 * food type against the food's category: an omnivore eats anything, everyone
 * else needs the two to match. Our diet label folds in the photovore flag, so
 * `Photovore` is a herbivore food type and `Photocarnivore` a carnivore one. */
const HERBIVORE_FOOD_EATERS = new Set(["herbivore", "omnivore", "photovore"]);

/** Whether the creature swims. The Aquatic Realm admits swimmers, and Sea School
 * exists nowhere else, so this is what decides whether the effect can reach a
 * creature at all. */
export function swimsForSchool(creature: CreatureRuntime): boolean {
  return /aquatic/i.test(String(creature.stats.type ?? ""));
}

/** Exported so the UI can caption an effect on the same terms the maths reads
 * it - Agile Swimmer and the event buffs scale off the creature, not a
 * constant. */
export function buildContext(
  creature: CreatureRuntime,
  build: BuildOptions,
  fillPct = 100,
  packmates = 0,
): SpeedEffectContext {
  const abilities = abilityNames(creature);
  const traits = build.traits ?? [];

  return {
    tier: typeof creature.stats.tier === "number" ? creature.stats.tier : 1,
    packmates,
    abilityValue: (name) => abilities.get(name) ?? null,
    speedTraitAscension: traitAscension(build, "Speed"),
    hasSpeedTrait: traits.includes("Speed"),
    fillPct,
    hasBear: build.plushies.some((name) => name.trim().toLowerCase() === "bear"),
    eatsHerbivoreFood: HERBIVORE_FOOD_EATERS.has(String(creature.stats.diet ?? "").trim().toLowerCase()),
    isAquatic: swimsForSchool(creature),
  };
}

/** The elder's speed bonus, over the same three channels the Speed trait moves.
 * The elder is described as buffing "Speed" with no channel named, and that word
 * covers every kind of movement everywhere else in the game, so it is read
 * broadly. This is the only place it applies - the combat build path ignores
 * movement, so it does not read `speedPct` at all. */
function elderOps(build: BuildOptions): SpeedOps {
  const elder = build.elder && build.elder !== "None" ? elderById[build.elder] : undefined;
  const pct = elder?.modifiers.speedPct;
  if (!pct) return {};
  const op: SpeedOps[SpeedChannel] = { kind: "multiply", value: 1 + pct / 100 };
  return { speed: op, sprint: op, fly: op };
}

export function evaluateSpeed({ creature, build, active, fillPct = 100, packmates = 0 }: SpeedInput): SpeedResult {
  const base = baseChannels(creature);
  const ctx = buildContext(creature, build, fillPct, packmates);
  const activeIds = new Set(active ?? []);

  const contributions: SpeedContribution[] = [];
  const elder = elderOps(build);
  if (Object.keys(elder).length > 0) {
    contributions.push({
      effect: { id: "elder", label: `Elder: ${build.elder}`, source: "elder", polarity: "buff", resolve: () => elder },
      ops: elder,
      stacks: 1,
    });
  }

  for (const effect of SPEED_EFFECTS) {
    const isBuildBound = effect.source === "plushie" || effect.source === "trait";
    if (!isBuildBound && !activeIds.has(effect.id)) continue;
    const stacks = effectStacks(effect, creature, build);
    if (stacks === 0) continue;
    const ops = effect.resolve(ctx);
    if (Object.keys(ops).length === 0) continue;
    contributions.push({ effect, ops, stacks });
  }

  // Multiplies commute, additions do not - and the game folds its ailments in
  // `pairs()` order, which is unspecified. Three effects add rather than
  // multiply (Sky, Reindeer, Sugar Rush), so the order has to be chosen rather
  // than copied. Multiplies first, additions last: the flat bonus then reads as
  // a floor the build cannot dilute.
  const final: SpeedReadout = { ...base };
  for (const channel of SPEED_CHANNELS) {
    let value = base[channel];
    if (value === null) continue;
    for (const { ops, stacks } of contributions) {
      const op = ops[channel];
      if (op?.kind === "multiply") value *= op.value ** stacks;
    }
    for (const { ops, stacks } of contributions) {
      const op = ops[channel];
      if (op?.kind === "add") value += op.value * stacks;
    }
    final[channel] = value;
  }
  final.flySprint = final.fly === null ? null : final.fly * flySprintFactor(creature.stats.flySprintMultiplier);
  final.ambush = ambushSpeed(final.sprint, final.ambushFactor);

  return { base, final, contributions };
}

/** Appetite and packmates keep moving after the build is fixed, so an effect
 * that pays out only at one end of either range is still worth offering. The
 * ends are what matter; nothing in between turns an effect on and off again. */
const REACHABLE_CONTEXTS: readonly { fillPct: number; packmates: number }[] = [
  { fillPct: 100, packmates: 0 },
  { fillPct: 125, packmates: 0 },
  { fillPct: 100, packmates: SEA_SCHOOL_CAP },
];

/** Effects the player can actually turn on for this creature and build.
 *
 * Owning the ability is not enough - the effect also has to be able to do
 * something. Sea School is gated on tier and on swimming, so a land creature
 * or a tier 3 gets nothing from it however many packmates it claims, and a
 * switch that cannot move a number is worse than no switch. */
export function offeredEffects(creature: CreatureRuntime, build: BuildOptions): SpeedEffect[] {
  return SPEED_EFFECTS.filter((effect) => {
    if (effect.source === "plushie" || effect.source === "trait") return false;
    if (!isEffectAvailable(effect, creature, build)) return false;
    return REACHABLE_CONTEXTS.some(
      ({ fillPct, packmates }) =>
        Object.keys(effect.resolve(buildContext(creature, build, fillPct, packmates))).length > 0,
    );
  });
}

export type { SpeedChannel };
