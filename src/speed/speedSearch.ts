import type { BuildOptions, CreatureRuntime, ElderVariant } from "../engine/types";
import { elderOptions, plushieByName } from "../engine/buildData";
import { baseChannels, LOWER_IS_BETTER, readChannel, type SpeedChannel, type SpeedReadout, type SpeedTarget } from "./speedChannels";
import { SEA_SCHOOL_CAP, SPEED_EFFECTS, type SpeedEffectContext } from "./speedEffects";
import { evaluateSpeed, type SpeedContribution } from "./speedMath";

export type { SpeedTarget };

export type SpeedSearchOptions = {
  creature: CreatureRuntime;
  /** The channel the ranking is built on. */
  target: SpeedTarget;
  /** Toggleable effects held for every candidate. */
  active?: Iterable<string>;
  fillPct?: number;
  /** Tier 1-2 packmates in range, for Sea School. */
  packmates?: number;
  /** Plushies the player will not use. */
  excludedPlushies?: readonly string[];
  /** A plushie the player always carries - rank only the pairs that hold it. */
  requiredPlushies?: string[];
  /** Pin the elder instead of letting the search choose. */
  lockedElder?: ElderVariant;
  /** Pin the trait loadout instead of letting the search choose. */
  lockedTraits?: readonly string[];
  /** How the veneration stages are split between the slotted traits, in the
   * shape `BuildOptions.ascensionAssignments` uses. Only two locked traits make
   * it matter: one trait soaks up the whole budget on its own. */
  lockedAscension?: readonly string[];
  venerationStage?: number;
  limit?: number;
};

export type SpeedCandidate = {
  build: BuildOptions;
  value: number;
  readout: SpeedReadout;
  contributions: SpeedContribution[];
};

export type SpeedSearchResult = {
  candidates: SpeedCandidate[];
  /** Builds actually evaluated - the honest size of the sweep. */
  evaluated: number;
};

/** Plushies that move a movement channel, by our display name. Sweeping the
 * other 69 is what fills a ranking with rows that differ only in a slot the
 * result cannot see: six ways to write "Bear plus something inert", all tied. */
export const SPEED_RELEVANT_PLUSHIES: readonly string[] = Object.freeze([
  ...new Set(SPEED_EFFECTS.map((effect) => effect.plushie).filter((name): name is string => Boolean(name))),
  // Bear carries no speed of its own; it strengthens the Cower buff, so it
  // belongs in the sweep even though no effect names it as its plushie.
  "Bear",
]);

/** Traits that move a movement channel, by the id a build slots. Derived from
 * the registry for the same reason the plushie shortlist is: a trait added later
 * widens the sweep on its own instead of waiting to be remembered here. */
export const SPEED_RELEVANT_TRAITS: readonly string[] = Object.freeze([
  ...new Set(SPEED_EFFECTS.map((effect) => effect.trait).filter((name): name is string => Boolean(name))),
]);

/** Channels worth ranking on: the ones at least one effect can actually move.
 * A creature has a turn stat, but nothing in the registry writes turn, so
 * offering it would sweep the whole space for a single repeated number.
 *
 * The two derived figures are movable when what they ride on is. The multiplier
 * behind ambush drops out - it is what the sweep changes, never what it ranks. */
export function optimizableChannels(): Set<SpeedTarget> {
  const moved = new Set<SpeedTarget>();
  for (const effect of SPEED_EFFECTS) {
    for (const channel of Object.keys(effect.resolve(PROBE_CONTEXT)) as SpeedChannel[]) moved.add(channel);
  }
  if (moved.has("fly")) moved.add("flySprint");
  if (moved.has("sprint") || moved.has("ambushFactor")) moved.add("ambush");
  moved.delete("ambushFactor");
  return moved;
}

/** Every effect resolved against a context as generous as the page can actually
 * get, so a channel only counts as movable if something can really move it. The
 * tier stays at 5 and the school at six mates: no creature meets both gates, but
 * this asks what any creature could move, not what this one can. */
const PROBE_CONTEXT: SpeedEffectContext = {
  tier: 5,
  packmates: SEA_SCHOOL_CAP,
  abilityValue: () => null,
  speedTraitAscension: 5,
  hasSpeedTrait: true,
  fillPct: 125,
  hasBear: true,
  eatsHerbivoreFood: true,
  isAquatic: true,
};

const BUNNY = "Bunny";

const countIn = (list: readonly string[], name: string) => list.filter((entry) => entry === name).length;

/** Every pair of plushie slots, unordered, empty slots and doubled plushies
 * included. Doubling matters: the game runs a repeated plushie's effect twice. */
export function plushiePairs(names: readonly string[]): string[][] {
  const slots = ["", ...names];
  const pairs: string[][] = [];
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i; j < slots.length; j += 1) {
      pairs.push([slots[i], slots[j]].filter(Boolean));
    }
  }
  return pairs;
}

/** Ranking key: bigger is better everywhere except take-off cost and turn time. */
function score(value: number, target: SpeedTarget): number {
  return LOWER_IS_BETTER.has(target) ? -value : value;
}

export function searchSpeedBuilds({
  creature,
  target,
  active,
  fillPct = 100,
  packmates = 0,
  excludedPlushies = [],
  requiredPlushies = [],
  lockedElder,
  lockedTraits,
  lockedAscension,
  venerationStage = 5,
  limit = 25,
}: SpeedSearchOptions): SpeedSearchResult {
  const excluded = new Set(excludedPlushies);
  const ascensionAssignments = [...(lockedAscension ?? ["", "", "", "", ""])];
  const roster = SPEED_RELEVANT_PLUSHIES.filter(
    (name) => !excluded.has(name) && plushieByName[name] !== undefined,
  );
  // A required plushie narrows the sweep rather than the roster: an unpinned
  // slot is still free to hold anything, including a second copy of the pinned
  // one. Pinning the same plushie twice therefore leaves exactly one pair.
  const required = requiredPlushies.filter(Boolean).slice(0, 2);
  const pairs = plushiePairs(roster).filter((pair) =>
    required.every((name) => pair.filter((entry) => entry === name).length >= countIn(required, name)),
  );

  // Elder and trait are chosen, not searched. One elder moves speed and one
  // trait moves each channel, so every other choice is strictly worse on every
  // channel - enumerating them only fills the ranking with degraded copies of
  // the winner that differ in a column the reader is not looking at. Pick each
  // by measurement rather than by name, so a channel no elder touches picks the
  // harmless one instead of a hardcoded favourite.
  const traits = lockedTraits
    ? [...lockedTraits]
    : bestOf([...SPEED_RELEVANT_TRAITS.map((name) => [name]), []], (value) => ({ traits: value }));
  const elder = lockedElder ?? bestOf([...elderOptions], (value) => ({ elder: value }));

  function bestOf<T>(choices: readonly T[], toBuild: (choice: T) => Partial<BuildOptions>): T {
    let best = choices[0];
    let bestScore = -Infinity;
    for (const choice of choices) {
      const probe: BuildOptions = {
        venerationStage,
        traits: [],
        ascensionAssignments,
        plushies: [],
        elder: "None",
        ...toBuild(choice),
      };
      const value = readChannel(evaluateSpeed({ creature, build: probe, active: [...(active ?? [])], fillPct, packmates }).final, target);
      if (value === null) continue;
      const scored = score(value, target);
      if (scored > bestScore) {
        bestScore = scored;
        best = choice;
      }
    }
    return best;
  }

  const held = [...(active ?? [])];
  let evaluated = 0;
  const candidates: SpeedCandidate[] = [];

  for (const pair of pairs) {
    const build: BuildOptions = {
      venerationStage,
      traits,
      ascensionAssignments,
      plushies: pair,
      elder,
    };
    const { final, contributions } = evaluateSpeed({ creature, build, active: held, fillPct, packmates });
    evaluated += 1;
    const value = readChannel(final, target);
    if (value === null) continue;
    candidates.push({ build, value, readout: final, contributions });
  }

  candidates.sort((a, b) => {
    const delta = score(b.value, target) - score(a.value, target);
    if (Math.abs(delta) > 1e-9) return delta;
    // Same speed: prefer the build that carries less, then settle it by name so
    // repeated runs list the same rows.
    const carried = a.build.plushies.length - b.build.plushies.length;
    if (carried !== 0) return carried;
    return a.build.plushies.join("|").localeCompare(b.build.plushies.join("|"));
  });

  // A slot the sweep left empty is a slot nothing could pay for, and Bunny
  // lifts ambush - so on a creature that ambushes it is free value there
  // whatever the ranking is measuring.
  //
  // Only where it really is free: an ambush ranking is ordered on the very
  // figure Bunny moves, so filling a row there would re-price it after the
  // sort and hand two rows the same build. The row keeps its spare slot unless
  // the fill leaves the ranked figure exactly where it was.
  function fillSpareSlot(candidate: SpeedCandidate): SpeedCandidate {
    if (candidate.build.plushies.length >= 2) return candidate;
    const build: BuildOptions = { ...candidate.build, plushies: [...candidate.build.plushies, BUNNY] };
    const { final, contributions } = evaluateSpeed({ creature, build, active: held, fillPct, packmates });
    const value = readChannel(final, target);
    if (value === null || Math.abs(value - candidate.value) > 1e-9) return candidate;
    return { build, value, readout: final, contributions };
  }

  const ambushes = (baseChannels(creature).ambushFactor ?? 0) > 0;
  const bunnyFree = ambushes && !excluded.has(BUNNY) && plushieByName[BUNNY] !== undefined;
  const ranked = collapseRedundant(candidates);
  return {
    candidates: (bunnyFree ? ranked.map(fillSpareSlot) : ranked).slice(0, limit),
    evaluated,
  };
}

/** Drop any build a smaller one already matches.
 *
 * A plushie can move speed in general and still do nothing here - Bear only pays
 * out while Cower is held, Horned Beetlefly is take-off only, Knox is walk only.
 * Carrying one of those alongside Chick scores exactly what Chick scores alone,
 * so the ranking fills with rows that say the same thing and, worse, implies an
 * order between them. Keeping only the smallest loadout at each value leaves the
 * spare slot honestly empty. Builds that merely tie without being subsets - Mylo
 * against Succulant, both a flat 2.5% - are genuine alternatives and both stay. */
function collapseRedundant(sorted: readonly SpeedCandidate[]): SpeedCandidate[] {
  const kept: SpeedCandidate[] = [];
  for (const candidate of sorted) {
    const plushies = [...candidate.build.plushies].sort();
    const subsumed = kept.some(
      (earlier) =>
        Math.abs(earlier.value - candidate.value) < 1e-9 &&
        earlier.build.elder === candidate.build.elder &&
        earlier.build.traits.join("|") === candidate.build.traits.join("|") &&
        earlier.build.plushies.length < plushies.length &&
        isSubMultiset(earlier.build.plushies, plushies),
    );
    if (!subsumed) kept.push(candidate);
  }
  return kept;
}

function isSubMultiset(inner: readonly string[], outer: readonly string[]): boolean {
  const remaining = [...outer];
  for (const name of inner) {
    const at = remaining.indexOf(name);
    if (at < 0) return false;
    remaining.splice(at, 1);
  }
  return true;
}
