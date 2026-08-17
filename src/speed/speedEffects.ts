import type { SpeedChannel } from "./speedChannels";

/** How one effect changes one channel. The game writes all of these as the
 * return value of an ailment's `OnGet`, and almost all of them are a plain
 * multiply - the three additive ones are the exception, not the rule. */
export type SpeedOp = { kind: "multiply"; value: number } | { kind: "add"; value: number };

export type SpeedOps = Partial<Record<SpeedChannel, SpeedOp>>;

export type SpeedEffectSource =
  /** Rides on an equipped plushie. */
  | "plushie"
  /** Rides on the veneration trait. */
  | "trait"
  /** Rides on the elder choice. */
  | "elder"
  /** The creature owns an ability that grants it. */
  | "ability"
  /** A posture or body state anyone can enter. */
  | "state"
  /** Weather, an event pickup, or a pack - nobody's ability, but it lands on
   * you and it lifts your speed. */
  | "world";

export type SpeedEffectContext = {
  /** Creature tier, 1-5. The event speed buffs pay more to bigger creatures. */
  tier: number;
  /** Tier 1-2 packmates in range, for Sea School. */
  packmates: number;
  /** Ability values off the creature, keyed by ability name. Agile Swimmer
   * scales off its own per-creature number rather than a constant. */
  abilityValue: (name: string) => number | null;
  /** Veneration levels poured into the Speed trait, 0-5. */
  speedTraitAscension: number;
  /** Whether the Speed trait is slotted at all. */
  hasSpeedTrait: boolean;
  /** Appetite fill, 100 = exactly full. Gourmandizer ramps from 100 to 125. */
  fillPct: number;
  /** Bear lifts Cower by a further 10%. Hunker carries no such branch. */
  hasBear: boolean;
  /** Whether the creature eats herbivore food. Momo's `OnEat` tests the food's
   * category, not the eater's, so anything that can put a plant in its mouth
   * gets Sugar Rush - a herbivore, an omnivore, or a photovore. */
  eatsHerbivoreFood: boolean;
  /** Whether the creature swims, which is what decides admission to the Aquatic
   * Realm and so whether Sea School can reach it at all. */
  isAquatic: boolean;
};

export type SpeedEffect = {
  id: string;
  label: string;
  source: SpeedEffectSource;
  /** Positive for the player, negative, or both depending on the channel. Drives
   * nothing in the maths - it is there so the UI can group and colour. */
  polarity: "buff" | "debuff";
  /** Plushie this effect rides on, by our display name. */
  plushie?: string;
  /** Veneration trait this effect rides on, by the id a build slots. */
  trait?: string;
  /** Ability the creature must own for this to be offered. */
  ability?: string;
  /** Held for as long as its condition holds rather than for a set time, so a
   * fight never outlasts it. Those count toward the sustained figure as well as
   * the peak one - the creature really is that fast for the whole fight. */
  lasting?: boolean;
  /** What the effect does here, in numbers: the channels it moves, then the
   * condition if there is one. What it costs elsewhere in the game stays out -
   * Speed Builds has no damage, weight or duration to spend. A function where
   * the number comes off the creature rather than being a constant. Display
   * only. */
  caption?: string | ((ctx: SpeedEffectContext) => string);
  resolve: (ctx: SpeedEffectContext) => SpeedOps;
};

const mul = (value: number): SpeedOp => ({ kind: "multiply", value });
const add = (value: number): SpeedOp => ({ kind: "add", value });

const formatPct = (value: number): string => `${Math.round(value * 10) / 10}%`;

/** Egg and Heart speed pay by tier: a quarter to the small, nearly half to a
 * tier 5. Indexed from tier 1. */
const EVENT_SPEED_BY_TIER = [1.25, 1.25, 1.25, 1.35, 1.45];

const eventSpeedPct = (tier: number): number => ((EVENT_SPEED_BY_TIER[tier - 1] ?? 1.25) - 1) * 100;
const SEA_SCHOOL_PER_MATE = 1.05;
/** GuardianChanneling's own `SpeedMultiplier`. The channel holds it open with an
 * unbounded value and the ability removes it on arrival, so its life is the
 * channel's six seconds rather than a stack count. */
const GUARDIAN_CHANNEL_SPEED_MULTIPLIER = 0.1;
export const SEA_SCHOOL_CAP = 6;
export const SEA_SCHOOL_MAX_TIER = 2;

/** The three channels an ailment that means "all your speed" targets: Speed,
 * SprintSpeed and FlySpeed, plus the two swim names we fold away. Every effect
 * below that reaches for this helper declares all five. */
function overall(value: number): SpeedOps {
  return { speed: mul(value), sprint: mul(value), fly: mul(value) };
}

/** Every ailment in the game that writes a movement channel, bar the
 * ones named below. `GetWithModifiers` matches target names literally, so an
 * ailment whose `OnGet` branches on a name its `AilmentTargets` never carries is
 * a branch the live game never runs.
 *
 * The hostile slows are absent because no build reaches them: Stolen Speed,
 * Injury, Sticky Trap, Sticky Tar, Inked, Tangled Kelp, Gale, Slowed, Torn
 * Ligaments, Freeze, Flash Freeze and Chilled all arrive from someone else's
 * ability, a trap or a mob. Cause Fear arrives the same way and is here anyway:
 * it halves your damage, but on speed it is the largest single buff in the game.
 *
 * Serpent is absent for a different reason. Its ailment targets `TurnSpeed`
 * while its `OnGet` tests for `Turn`, so neither branch matches and the plushie
 * does nothing to turning in the live game. Nothing else writes turn either.
 *
 * Pack Scout is absent because it does nothing: its description promises
 * movement speed, its `AilmentTargets` is empty and it has no `OnGet`. */
export const SPEED_EFFECTS: readonly SpeedEffect[] = [
  // ---- plushies ----
  { id: "plushie_chick", label: "Chick", source: "plushie", polarity: "buff", plushie: "Chick", caption: "speed +5%", resolve: () => overall(1.05) },
  { id: "plushie_sea", label: "Sea", source: "plushie", polarity: "buff", plushie: "Sea", caption: "walk / swim +10%, beached +10%", resolve: () => ({ speed: mul(1.1), beached: mul(1.1) }) },
  // Sky reads as +7.5% from its fields, but the body returns `p2 + 2`; the
  // multiplier field is never used for speed.
  { id: "plushie_sky", label: "Sky", source: "plushie", polarity: "buff", plushie: "Sky", caption: "fly +2", resolve: () => ({ fly: add(2) }) },
  { id: "plushie_knox", label: "Knox", source: "plushie", polarity: "buff", plushie: "Knox", caption: "walk / swim +5%", resolve: () => ({ speed: mul(1.05) }) },
  { id: "plushie_mylo", label: "Mylo", source: "plushie", polarity: "buff", plushie: "Mylo", caption: "speed +2.5%", resolve: () => overall(1.025) },
  { id: "plushie_succulant", label: "Succulant", source: "plushie", polarity: "buff", plushie: "Succulant", caption: "speed +2.5%", resolve: () => overall(1.025) },
  { id: "plushie_reindeer", label: "Reindeer", source: "plushie", polarity: "buff", plushie: "Reindeer", caption: "fly +2.5%", resolve: () => ({ fly: mul(1.025) }) },
  { id: "plushie_astral_quetzal", label: "Astral Quetzal", source: "plushie", polarity: "debuff", plushie: "Astral Quetzal", caption: "speed -5%", resolve: () => overall(0.95) },
  { id: "plushie_void", label: "Void", source: "plushie", polarity: "debuff", plushie: "Void", caption: "speed -2.5%", resolve: () => overall(0.975) },
  { id: "plushie_partridge", label: "Partridge", source: "plushie", polarity: "debuff", plushie: "Partridge", caption: "speed -2%", resolve: () => overall(0.98) },
  // Bunny returns `max(1.1, base * 1.075)`, so it is a floor as well as a
  // multiplier. The floor cannot bind: the smallest ambush multiplier in the
  // roster is 1.2, and 1.2 x 1.075 already clears 1.1.
  { id: "plushie_bunny", label: "Bunny", source: "plushie", polarity: "buff", plushie: "Bunny", caption: "ambush +7.5%", resolve: () => ({ ambushFactor: mul(1.075) }) },

  // ---- veneration ----
  {
    id: "trait_speed",
    label: "Speed trait",
    source: "trait",
    polarity: "buff",
    trait: "Speed",
    // Reads the ailment's own base and per-stage constants rather than the
    // scraped percentage table.
    resolve: (ctx) => (ctx.hasSpeedTrait ? overall(1.035 + ctx.speedTraitAscension * 0.015) : {}),
  },

  // ---- abilities ----
  { id: "speed_blitz", label: "Speed Blitz", source: "ability", polarity: "buff", ability: "Speed Blitz", caption: "speed +25%", resolve: () => overall(1.25) },
  { id: "escape_area", label: "Escape Area", source: "ability", polarity: "buff", ability: "Escape Area", caption: "speed +75%", resolve: () => overall(1.75) },
  // Ink Cloud hands the caster the same Escape Area ailment alongside the
  // invisibility, so its owners reach +75% too - a separate entry rather than a
  // second ability on the one above, because it stakes two of the ailment where
  // Escape Area stakes ten, and it takes no health for them.
  { id: "ink_cloud_escape", label: "Ink Cloud", source: "ability", polarity: "buff", ability: "Ink Cloud", caption: "speed +75%", resolve: () => overall(1.75) },
  { id: "tail_drop", label: "Tail Drop", source: "ability", polarity: "buff", ability: "Tail Drop", caption: "speed +35%, tail dropped", resolve: () => overall(1.35) },
  { id: "self_destruct", label: "Self-Destruct", source: "ability", polarity: "buff", ability: "Self-Destruct", caption: "speed +25%, fuse burning", resolve: () => overall(1.25) },
  { id: "adrenaline", label: "Adrenaline", source: "ability", polarity: "buff", ability: "Adrenaline", caption: "speed +20%", resolve: () => overall(1.2) },
  {
    id: "agile_swimmer",
    lasting: true,
    label: "Agile Swimmer",
    source: "ability",
    polarity: "buff",
    ability: "Agile Swimmer",
    caption: (ctx) => `speed +${formatPct(ctx.abilityValue("Agile Swimmer") ?? 75)}, in water`,
    // The constant in the ailment is only a fallback: when the creature carries
    // its own Agile Swimmer number the game uses `1 + value / 100` instead.
    resolve: (ctx) => {
      const value = ctx.abilityValue("Agile Swimmer");
      const factor = value === null ? 1.75 : 1 + value / 100;
      return { speed: mul(factor), sprint: mul(factor) };
    },
  },
  { id: "harden", label: "Harden", source: "ability", polarity: "debuff", ability: "Harden", caption: "speed -20%", resolve: () => overall(0.8) },
  { id: "cocooning", label: "Cocooning", source: "ability", polarity: "debuff", ability: "Cocoon", caption: "speed -70%, beached -70%", resolve: () => ({ ...overall(0.3), beached: mul(0.3) }) },
  {
    id: "gourmandizer",
    label: "Gourmandizer",
    source: "ability",
    polarity: "debuff",
    ability: "Gourmandizer",
    caption: "speed -7.5% at 125% fill",
    // Ramps linearly with appetite fill from 100% to 125%, exactly as the weight
    // side already modelled in compareHungerMath.
    resolve: (ctx) => {
      const progress = Math.min(1, Math.max(0, (ctx.fillPct - 100) / 25));
      return progress === 0 ? {} : overall(1 + (0.925 - 1) * progress);
    },
  },
  // The game hands Swift Scales to Guardian Dragons standing in the Land of
  // Monsters. No creature in our roster lists it, so the entry offers itself to
  // nobody; it is here so that it does when one does.
  {
    id: "swift_scales",
    label: "Swift Scales",
    source: "ability",
    polarity: "buff",
    ability: "Swift Scales",
    caption: "speed +40%, fly +75%",
    resolve: () => ({ speed: mul(1.4), sprint: mul(1.4), fly: mul(1.75) }),
  },
  {
    // Momo grants Sugar Rush through eating, and a creature eats constantly, so
    // carrying the plushie is the condition in practice - there is no separate
    // thing to switch on.
    id: "sugar_rush",
    label: "Sugar Rush",
    source: "plushie",
    polarity: "buff",
    plushie: "Momo",
    caption: "fly +1, plant eaters only",
    resolve: (ctx) => (ctx.eatsHerbivoreFood ? { fly: add(1) } : {}),
  },

  // Cower and Hunker read like opposites but they are not exclusive. The client
  // fires the state remote once the pose has been held ten seconds, and the
  // ailment it grants carries `HealsAfterMoving`, so its decay does not start
  // until the creature moves - the buff therefore lasts past the posture that
  // granted it and can still be running while Hunker is up. Hunker is granted
  // afresh every tick the creature has been strafing five seconds, at a stack
  // count nothing can decay through.
  {
    id: "posture_cower",
    label: "Cower",
    source: "state",
    polarity: "buff",
    caption: "speed +25%, until you move",
    resolve: (ctx) => {
      const factor = 1.25 * (ctx.hasBear ? 1.1 : 1);
      return { speed: mul(factor), sprint: mul(factor) };
    },
  },
  // Speed Steal splits in two: the ailment lands on everyone in range, and the
  // caster keeps Speed Gift. Only the gift is ours - the theft is something an
  // opponent does to us.
  {
    id: "speed_gift",
    label: "Speed Gift",
    source: "ability",
    polarity: "buff",
    ability: "Speed Steal",
    caption: "speed +20%",
    resolve: () => overall(1.2),
  },
  // Cause Fear is cast by someone else and lands on everyone nearby. It halves
  // their damage, which is why it reads as a debuff - but on speed it is the
  // largest single buff in the game.
  {
    id: "fear",
    label: "Fear",
    source: "world",
    polarity: "buff",
    caption: "speed +35%",
    resolve: () => overall(1.35),
  },
  {
    id: "windstorm",
    lasting: true,
    label: "Windstorm",
    source: "world",
    polarity: "buff",
    caption: "speed +15%",
    resolve: () => overall(1.15),
  },
  {
    id: "event_speed",
    label: "Egg Speed",
    source: "world",
    polarity: "buff",
    caption: (ctx) => `speed +${formatPct(eventSpeedPct(ctx.tier))}, scales with tier`,
    resolve: (ctx) => overall(EVENT_SPEED_BY_TIER[ctx.tier - 1] ?? 1.25),
  },
  {
    id: "heart_speed",
    label: "Heart Speed",
    source: "world",
    polarity: "buff",
    caption: (ctx) => `speed +${formatPct(eventSpeedPct(ctx.tier))}, scales with tier`,
    resolve: (ctx) => overall(EVENT_SPEED_BY_TIER[ctx.tier - 1] ?? 1.25),
  },
  // The weekly Speed boost falls on twenty creatures drawn from a seed. Alone
  // among the "overall speed" effects it pays walking and sprinting different
  // amounts, and it leaves flight alone entirely.
  {
    id: "creature_speed_boost",
    lasting: true,
    label: "Speed Boost",
    source: "world",
    polarity: "buff",
    caption: "walk / swim +10%, sprint +5%",
    resolve: () => ({ speed: mul(1.1), sprint: mul(1.05) }),
  },
  // Amped lifts every channel by a tenth except swim sprint, which its map pins
  // at 1. Swim sprint is a stat of its own in game - AilmentTargets names it and
  // StatUtils formats it as "Swim Sprint Speed" - but swimming folds into the
  // land channels here, so a creature sprinting in water reads a tenth high.
  {
    id: "amped",
    label: "Amped",
    source: "ability",
    ability: "Overcharged",
    polarity: "buff",
    caption: "speed +10%",
    resolve: () => overall(1.1),
  },
  {
    id: "sea_school",
    lasting: true,
    label: "Sea School",
    source: "world",
    polarity: "buff",
    caption: "speed +5% per packmate, up to 6, swimmers only",
    // Two gates before the count matters. The ailment pays only a tier 1 or 2
    // creature, and it only exists in the Aquatic Realm, which admits swimmers -
    // so a tier 2 land creature never meets it however large its pack.
    resolve: (ctx) => {
      if (!ctx.isAquatic || ctx.tier > SEA_SCHOOL_MAX_TIER) return {};
      const packmates = Math.min(SEA_SCHOOL_CAP, Math.max(0, ctx.packmates));
      if (packmates < 1) return {};
      const factor = 1 + (SEA_SCHOOL_PER_MATE - 1) * packmates;
      return { speed: mul(factor), sprint: mul(factor) };
    },
  },
  {
    id: "posture_hunker",
    label: "Hunker",
    source: "ability",
    polarity: "debuff",
    ability: "Hunker",
    caption: "speed -25%",
    resolve: () => ({ speed: mul(0.75), sprint: mul(0.75) }),
  },
  // The channel that carries Guardian's Passage. Unlike the buffs above it
  // reaches every channel the game names, swim sprint included, so nothing is
  // folded away here.
  {
    id: "guardians_passage_channel",
    label: "Guardians Passage",
    source: "ability",
    polarity: "debuff",
    ability: "Guardians Passage",
    caption: "speed -90%, while channeling",
    resolve: () => overall(GUARDIAN_CHANNEL_SPEED_MULTIPLIER),
  },
];

export const speedEffectById: ReadonlyMap<string, SpeedEffect> = new Map(SPEED_EFFECTS.map((e) => [e.id, e]));
