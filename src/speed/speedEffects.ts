import type { SpeedChannel, StaminaChannel } from "./speedChannels";
import { STRENGTH_IN_NUMBERS_MAX_ALLIES } from "../engine/types";

/** How one effect changes one channel. Almost every effect multiplies the
 * channel it writes - the three additive ones are the exception, not the
 * rule. */
export type SpeedOp = { kind: "multiply"; value: number } | { kind: "add"; value: number };

/** What one effect does, keyed by the channel it writes. Movement and stamina
 * share the shape and the pass; only the names differ. */
export type SpeedOps = Partial<Record<SpeedChannel | StaminaChannel, SpeedOp>>;

export type SpeedEffectSource =
  /** Granted by an equipped plushie. */
  | "plushie"
  /** Granted by the veneration trait. */
  | "trait"
  /** Granted by the elder choice. */
  | "elder"
  /** The creature owns an ability that grants it. */
  | "ability"
  /** A posture or body state anyone can enter. */
  | "state"
  /** Weather, an event pickup, or a pack - nobody's ability, but it lands on
   * you and it lifts your speed. */
  | "world";

export type SpeedEffectContext = {
  /** Creature tier, 1-5. The event speed buffs give more to bigger creatures. */
  tier: number;
  /** Tier 1-2 packmates in range, for Sea School. */
  packmates: number;
  /** Packmates of the creature's own species, for Strength In Numbers. A
   * different count from `packmates`: that one is any species below tier 3,
   * this one is the same species at any tier. */
  sameSpeciesPackmates: number;
  /** Ability values off the creature, keyed by ability name. Agile Swimmer
   * scales off its own per-creature number rather than a constant. */
  abilityValue: (name: string) => number | null;
  /** Veneration levels poured into one slotted trait, 0-5, or `null` when the
   * build does not slot it. A slotted trait at zero ascensions still gives its
   * base, so the two cases cannot share a number. */
  traitAscension: (trait: string) => number | null;
  /** Appetite fill, 100 = exactly full. Gourmandizer ramps from 100 to 125. */
  fillPct: number;
  /** Bear lifts Cower by a further 10%. Hunker carries no such branch. */
  hasBear: boolean;
  /** The creature's diet label, lower-cased. Day Time and Night Time reach
   * photovores and photocarnivores only, and Spring Water is drunk as a
   * photovore, so the label itself is the gate rather than a flag per effect. */
  diet: string;
  /** Whether the creature eats herbivore food. Momo reads what was eaten
   * rather than what ate it, so anything that can put a plant in its mouth
   * gets Sugar Rush - a herbivore, an omnivore, or a photovore. */
  eatsHerbivoreFood: boolean;
  /** Whether the creature swims, which is what decides admission to the Aquatic
   * Realm and so whether Sea School can reach it at all. */
  isAquatic: boolean;
  /** Whether the creature can leave the ground at all - a Flier or a Glider.
   * Monsoon reads the same two flags and reaches nobody else. */
  leavesTheGround: boolean;
};

export type SpeedEffect = {
  id: string;
  label: string;
  source: SpeedEffectSource;
  /** Positive for the player, negative, or both depending on the channel. Drives
   * nothing in the maths - it is there so the UI can group and colour. */
  polarity: "buff" | "debuff";
  /** An effect this one only holds alongside. Eclipse changes the rate while
   *  it is night and changes nothing otherwise, so the plushie is carried only
   *  where Night Time is in force. Checked for build-bound effects as well,
   *  which are otherwise always carried. */
  requires?: string;
  /** Plushie that grants this effect, by our display name. */
  plushie?: string;
  /** Veneration trait that grants this effect, by the id a build slots. */
  trait?: string;
  /** Ability the creature must own for this to be offered. */
  ability?: string;
  /** The Reference entry that describes this effect, when its name differs from
   * the label. Two ailments can share one entry - Day Time and Night Time are
   * both the Day / Night setting - and an entry is one card per object, so the
   * figures go there rather than into a second card named after the ailment. */
  entryName?: string;
  /** Held for as long as its condition holds rather than for a set time, so a
   * fight never outlasts it. Those count toward the sustained figure as well as
   * the peak one - the creature really is that fast for the whole fight. */
  lasting?: boolean;
  /** Landed by someone else and never by the build itself. The maths carries
   * these so a surface with an opponent in it can apply them - a creature that
   * steals speed slows the other one and quickens itself with one ability - but
   * Speed Builds does not offer them: the question it answers is how fast a
   * build can be, and no build reaches an enemy's slow. */
  hostile?: boolean;
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

/** Egg and Heart speed scale by tier: a quarter to the small, nearly half to a
 * tier 5. Indexed from tier 1. */
const EVENT_SPEED_BY_TIER = [1.25, 1.25, 1.25, 1.35, 1.45];

const eventSpeedPct = (tier: number): number => ((EVENT_SPEED_BY_TIER[tier - 1] ?? 1.25) - 1) * 100;
const SEA_SCHOOL_PER_MATE = 1.05;
/** Sea School lifts the rate by its own figure, which happens to match. */
const SEA_SCHOOL_STAMINA_PER_MATE = 1.05;
/** GuardianChanneling's own `SpeedMultiplier`. The channel holds it open with an
 * unbounded value and the ability removes it on arrival, so its life is the
 * channel's six seconds rather than a stack count. */
const GUARDIAN_CHANNEL_SPEED_MULTIPLIER = 0.1;
export const SEA_SCHOOL_CAP = 6;
/** Strength In Numbers adds 7% a same-species packmate and stops counting at
 * five, so its ceiling is x1.35. */
const STRENGTH_IN_NUMBERS_PER_MATE = 1.07;
export const STRENGTH_IN_NUMBERS_CAP = STRENGTH_IN_NUMBERS_MAX_ALLIES;
/** Photovores and photocarnivores, the two diets the day and night ailments
 * reach. 46 creatures of the 477. */
const PHOTOSYNTHETIC_DIETS = new Set(["photovore", "photocarnivore"]);
/** Poison lowers the rate by a flat percentage point a stack rather than
 * multiplying once a stack: the rate is `base * (1 - stacks * 0.01)`. */
const POISON_STAMINA_REGEN_PER_STACK = 0.01;
/** Ash Fall subtracts a quarter of the rate, flat: the rate is
 * `base * (1 - 0.25)` at every stack count. */
const ASH_FALL_STAMINA_REGEN_LOSS = 0.25;
export const SEA_SCHOOL_MAX_TIER = 2;

/** The three channels an ailment that means "all your speed" targets: Speed,
 * SprintSpeed and FlySpeed, plus the two swim names we fold away. Every effect
 * below that reaches for this helper declares all five. */
function overall(value: number): SpeedOps {
  return { speed: mul(value), sprint: mul(value), fly: mul(value) };
}

/** Every ailment in the game that writes a movement or a stamina channel, bar
 * the ones named below. An ailment that names one channel and computes another
 * changes nothing in a live fight.
 *
 * The hostile slows are here and marked `hostile`, so the maths carries them
 * and Speed Builds does not offer them - see the flag. Cause Fear is not marked:
 * it halves your damage, but on speed it is the largest single buff in the game,
 * so a build is glad of it.
 *
 * Four movement ailments are absent, and the reason is the same for all four:
 * none of them is in the model at all. Nothing applies Sticky Tar, Tangled Kelp
 * or Flash Freeze, and the one thing that applies Chilled is the snowball
 * event, which is neither a creature nor a build. Their figures are real and are written down in the plan; what is
 * missing is a modelled thing to attach them to. And the Stat boost that
 * promises +10% speed and +10% stamina regen is dropped from the boost roster
 * before a player can take it, so the ailment behind it is never granted.
 *
 * Serpent is absent for a different reason. Its ailment names one turning
 * channel and computes another, so the plushie changes turning by nothing in a
 * live fight. Nothing else writes turn either.
 *
 * Pack Scout is absent because it does nothing: its description promises
 * movement speed and it writes no channel at all. */
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
  { id: "plushie_reindeer", label: "Reindeer", source: "plushie", polarity: "buff", plushie: "Reindeer", caption: "fly +2.5%, glide regen +0.5", resolve: () => ({ fly: mul(1.025), glideRegen: add(0.5) }) },
  { id: "plushie_astral_quetzal", label: "Astral Quetzal", source: "plushie", polarity: "debuff", plushie: "Astral Quetzal", caption: "speed -5%", resolve: () => overall(0.95) },
  { id: "plushie_void", label: "Void", source: "plushie", polarity: "debuff", plushie: "Void", caption: "speed -2.5%", resolve: () => overall(0.975) },
  { id: "plushie_partridge", label: "Partridge", source: "plushie", polarity: "debuff", plushie: "Partridge", caption: "speed -2%", resolve: () => overall(0.98) },
  // Bunny returns `max(1.1, base * 1.075)`, so it is a floor as well as a
  // multiplier. The floor cannot bind: the smallest ambush multiplier in the
  // roster is 1.2, and 1.2 x 1.075 already clears 1.1.
  { id: "plushie_bunny", label: "Bunny", source: "plushie", polarity: "buff", plushie: "Bunny", caption: "ambush +7.5%", resolve: () => ({ ambushFactor: mul(1.075) }) },
  // Eclipse also raises damage and health regeneration, neither of which this
  // tab carries a channel for. Its whole return is behind one test on the lighting clock.
  { id: "plushie_eclipse", label: "Eclipse", source: "plushie", polarity: "buff", plushie: "Eclipse", requires: "night_time", caption: "stamina regen +25%, at night only", resolve: () => ({ staminaRegen: mul(1.25) }) },

  // ---- veneration ----
  {
    id: "trait_speed",
    label: "Speed trait",
    source: "trait",
    polarity: "buff",
    trait: "Speed",
    // Reads the ailment's own base and per-stage constants rather than the
    // scraped percentage table.
    resolve: (ctx) => {
      const ascension = ctx.traitAscension("Speed");
      return ascension === null ? {} : overall(1.035 + ascension * 0.015);
    },
  },
  // ---- abilities ----
  { id: "speed_blitz", label: "Speed Blitz", source: "ability", polarity: "buff", ability: "Speed Blitz", caption: "speed +25%, stamina regen +30%", resolve: () => ({ ...overall(1.25), staminaRegen: mul(1.3) }) },
  { id: "escape_area", label: "Escape Area", source: "ability", polarity: "buff", ability: "Escape Area", caption: "speed +75%", resolve: () => overall(1.75) },
  // Ink Cloud hands the caster the same Escape Area ailment alongside the
  // invisibility, so its owners reach +75% too - a separate entry rather than a
  // second ability on the one above, because it stakes two of the ailment where
  // Escape Area stakes ten, and it takes no health for them.
  { id: "ink_cloud_escape", label: "Ink Cloud", source: "ability", polarity: "buff", ability: "Ink Cloud", caption: "speed +75%", resolve: () => overall(1.75) },
  { id: "tail_drop", label: "Tail Drop", source: "ability", polarity: "buff", ability: "Tail Drop", caption: "speed +35%, tail dropped", resolve: () => overall(1.35) },
  { id: "self_destruct", label: "Self-Destruct", source: "ability", polarity: "buff", ability: "Self-Destruct", caption: "speed +25%, fuse burning", resolve: () => overall(1.25) },
  // Adrenaline stops the glide rate as well as the stamina one.
  { id: "adrenaline", label: "Adrenaline", source: "ability", polarity: "buff", ability: "Adrenaline", caption: "speed +20%, no stamina regen", resolve: () => ({ ...overall(1.2), staminaRegen: mul(0), glideRegen: mul(0) }) },
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
      // The speed scales off the creature's own number; the pool and the rate
      // are the ailment's own constants and do not.
      return { speed: mul(factor), sprint: mul(factor), stamina: mul(1.5), staminaRegen: mul(2) };
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
    caption: "speed +40%, fly +75%, takeoff -25%",
    resolve: () => ({ speed: mul(1.4), sprint: mul(1.4), fly: mul(1.75), takeoff: mul(0.75) }),
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
    caption: "fly +1, glide regen +1, plant eaters only",
    resolve: (ctx) => (ctx.eatsHerbivoreFood ? { fly: add(1), glideRegen: add(1) } : {}),
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
    caption: "speed +15%, stamina regen +25%, glide regen +5%",
    resolve: () => ({ ...overall(1.15), staminaRegen: mul(1.25), glideRegen: mul(1.05) }),
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
  // among the "overall speed" effects it gives walking and sprinting different
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
  // Amped lifts every channel by a tenth except swim sprint, which it pins at
  // 1. Swim sprint is a channel of its own in the game, but swimming folds into
  // the land channels here, so a creature sprinting in water reads a tenth
  // high.
  {
    id: "amped",
    label: "Amped",
    source: "ability",
    ability: "Overcharged",
    polarity: "buff",
    caption: "speed +10%, stamina regen +50%",
    resolve: () => ({ ...overall(1.1), staminaRegen: mul(1.5) }),
  },
  {
    id: "sea_school",
    lasting: true,
    label: "Sea School",
    source: "world",
    polarity: "buff",
    caption: "speed +5% per packmate, up to 6, swimmers only",
    // Two gates before the count matters. The ailment reaches only a tier 1 or 2
    // creature, and it only exists in the Aquatic Realm, which admits swimmers -
    // so a tier 2 land creature never meets it however large its pack.
    resolve: (ctx) => {
      if (!ctx.isAquatic || ctx.tier > SEA_SCHOOL_MAX_TIER) return {};
      const packmates = Math.min(SEA_SCHOOL_CAP, Math.max(0, ctx.packmates));
      if (packmates < 1) return {};
      const factor = 1 + (SEA_SCHOOL_PER_MATE - 1) * packmates;
      return {
        speed: mul(factor),
        sprint: mul(factor),
        staminaRegen: mul(1 + (SEA_SCHOOL_STAMINA_PER_MATE - 1) * packmates),
      };
    },
  },
  {
    id: "posture_hunker",
    label: "Hunker",
    source: "ability",
    polarity: "debuff",
    ability: "Hunker",
    // Held rather than timed, the same as the buffs marked this way: the buff
    // is granted afresh for as long as the creature keeps strafing, at a stack
    // count nothing decays through, and it ends when the creature stops. The
    // slow is therefore what the creature moves at the whole time it hunkers,
    // not a moment inside a faster run.
    lasting: true,
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

  // Frosty is a passive rather than an ailment of its own: it holds the ailment
  // open for as long as it is owned, and the ailment holds only during Famine or
  // Winter. Minty Wiggler grants the passive, so a plushie reaches it too.
  {
    id: "frosty",
    label: "Frosty",
    source: "ability",
    polarity: "buff",
    ability: "Frosty",
    lasting: true,
    caption: "stamina regen +25%, during famine or winter",
    resolve: () => ({ staminaRegen: mul(1.25) }),
  },
  // Berserk turns on below its health threshold and cannot be entered on
  // purpose, so what it offers here is the rate a creature already fighting at
  // that health regenerates at. It also halves the bite cooldown, which is the
  // fight's figure and not this tab's.
  {
    id: "berserk",
    label: "Berserk",
    source: "ability",
    polarity: "buff",
    ability: "Berserk",
    lasting: true,
    caption: "stamina regen x2",
    resolve: () => ({ staminaRegen: mul(2) }),
  },
  {
    id: "wardens_rage",
    label: "Warden's Rage",
    source: "ability",
    polarity: "buff",
    ability: "Warden's Rage",
    caption: "stamina regen x2",
    resolve: () => ({ staminaRegen: mul(2) }),
  },
  // Unbridled Rage multiplies melee damage by 1.3 and moves no speed channel,
  // and it stops both rates for its 30 seconds.
  {
    id: "unbridled_rage",
    label: "Unbridled Rage",
    source: "ability",
    polarity: "debuff",
    ability: "Unbridled Rage",
    caption: "no stamina regen, no glide regen",
    resolve: () => ({ staminaRegen: mul(0), glideRegen: mul(0) }),
  },
  // A puddle buffs whichever creature rolls in it, the opponent included: being
  // in range is the whole condition, and placing it grants no exclusive use.
  {
    id: "stamina_puddle",
    label: "Stamina Puddle",
    source: "ability",
    polarity: "buff",
    ability: "Stamina Puddle",
    caption: "stamina regen x3",
    resolve: () => ({ staminaRegen: mul(3) }),
  },

  // ---- what leaving the ground costs ----
  // Three weathers raise takeoff - by 15%, 10% and 25% - and change nothing
  // else. All three are unblockable, so no build turns them off.
  {
    id: "weather_rain",
    label: "Rain",
    source: "world",
    polarity: "debuff",
    lasting: true,
    caption: "takeoff +15%",
    resolve: () => ({ takeoff: mul(1.15) }),
  },
  {
    id: "weather_snow",
    label: "Snow",
    source: "world",
    polarity: "debuff",
    lasting: true,
    caption: "takeoff +10%",
    resolve: () => ({ takeoff: mul(1.1) }),
  },
  // Monsoon is the fourth takeoff weather and the only one that also slows
  // flight itself. Its whole return is behind one check on the two flags that
  // let a creature leave the ground, so it reaches nobody else at all.
  {
    id: "weather_monsoon",
    label: "Monsoon",
    source: "world",
    polarity: "debuff",
    lasting: true,
    caption: "takeoff +15%, fly -20%, glide regen -20%, fliers and gliders only",
    resolve: (ctx) =>
      ctx.leavesTheGround ? { takeoff: mul(1.15), fly: mul(0.8), glideRegen: mul(0.8) } : {},
  },
  {
    id: "weather_thunderstorm",
    label: "Thunderstorm",
    source: "world",
    polarity: "debuff",
    lasting: true,
    caption: "takeoff +25%",
    resolve: () => ({ takeoff: mul(1.25) }),
  },
  {
    id: "plushie_horned_beetlefly",
    label: "Horned Beetlefly",
    source: "plushie",
    polarity: "buff",
    plushie: "Horned Beetlefly",
    caption: "takeoff -50%",
    resolve: () => ({ takeoff: mul(0.5) }),
  },

  // ---- weather, water, pack: nobody's ability, and it lands on you ----
  {
    id: "violent_winds",
    label: "Violent Winds",
    source: "world",
    polarity: "buff",
    lasting: true,
    caption: "stamina regen +25%, glide regen +25%",
    resolve: () => ({ staminaRegen: mul(1.25), glideRegen: mul(1.25) }),
  },
  // Hypothermia is the blizzard's, and it very nearly stops the rate rather
  // than lowering it. Weather immunity voids the whole return.
  {
    id: "hypothermia",
    label: "Hypothermia",
    source: "world",
    polarity: "debuff",
    lasting: true,
    caption: "stamina regen x0.02, glide regen x0.02, unless weather-immune",
    resolve: () => ({ staminaRegen: mul(0.02), glideRegen: mul(0.02) }),
  },
  // Ash Fall lowers the rate by a flat quarter at every stack count, and
  // separately eats the pool on its own tick, which is a drain the engine
  // carries rather than a channel.
  {
    id: "ash_fall",
    label: "Ash Fall",
    source: "world",
    polarity: "debuff",
    lasting: true,
    caption: "stamina regen -25%, and the pool drains",
    resolve: () => ({ staminaRegen: mul(1 - ASH_FALL_STAMINA_REGEN_LOSS) }),
  },
  {
    id: "ashy_lungs",
    label: "Ashy Lungs",
    source: "world",
    polarity: "debuff",
    lasting: true,
    caption: "stamina regen -20%",
    resolve: () => ({ staminaRegen: mul(0.8) }),
  },
  {
    id: "day_time",
    label: "Day Time",
    entryName: "Day / Night",
    source: "world",
    polarity: "buff",
    lasting: true,
    caption: "stamina regen +25%, photovores and photocarnivores only",
    resolve: (ctx) => (PHOTOSYNTHETIC_DIETS.has(ctx.diet) ? { staminaRegen: mul(1.25) } : {}),
  },
  {
    id: "night_time",
    label: "Night Time",
    entryName: "Day / Night",
    source: "world",
    polarity: "debuff",
    lasting: true,
    caption: "stamina regen -25%, photovores and photocarnivores only, unblockable",
    resolve: (ctx) => (PHOTOSYNTHETIC_DIETS.has(ctx.diet) ? { staminaRegen: mul(0.75) } : {}),
  },
  {
    id: "blood_moon",
    label: "Blood Moon",
    entryName: "Moon",
    source: "world",
    polarity: "buff",
    lasting: true,
    caption: "stamina regen +50%, unless weather-immune",
    resolve: () => ({ staminaRegen: mul(1.5) }),
  },
  // Blue Moon is the phase's buff and lands on whoever is under it. Moon Beam
  // pulses the same status and is out of the model - see its entry.
  {
    id: "blue_moon",
    label: "Blue Moon",
    entryName: "Moon",
    source: "world",
    polarity: "buff",
    lasting: true,
    caption: "stamina regen +50%, unless weather-immune",
    resolve: () => ({ staminaRegen: mul(1.5) }),
  },
  {
    id: "enriched",
    label: "Enriched",
    source: "world",
    polarity: "buff",
    caption: "stamina +25%, stamina regen +25%",
    resolve: () => ({ stamina: mul(1.25), staminaRegen: mul(1.25) }),
  },
  // Spring Water raises the pool and leaves both rates alone. Its own gate is
  // on getting it: the source is a magical water drunk as a photovore.
  {
    id: "spring_water",
    label: "Spring Water",
    source: "world",
    polarity: "buff",
    caption: "stamina +25%, photovores only",
    resolve: (ctx) => (ctx.diet === "photovore" ? { stamina: mul(1.25) } : {}),
  },
  // Clean Water reads Sickly's own PercentIncrease constant rather than
  // carrying one of its own, which is why the figure matches Sickly's inverse.
  {
    id: "clean_water",
    label: "Clean Water",
    source: "world",
    polarity: "buff",
    caption: "stamina regen +20%",
    resolve: () => ({ staminaRegen: mul(1.2) }),
  },
  {
    id: "pack_migration",
    label: "Pack Migration",
    source: "world",
    polarity: "buff",
    lasting: true,
    caption: "stamina regen +10%",
    resolve: () => ({ staminaRegen: mul(1.1) }),
  },
  // Aggression is a pose on its own key, the same family as Cower, so it is
  // entered rather than landed. Bear lifts the whole term by a tenth, which
  // takes the rate from half to 0.55 - the same branch Cower reads.
  {
    id: "posture_aggressive",
    label: "Aggressive",
    source: "state",
    polarity: "debuff",
    lasting: true,
    caption: (ctx) => `stamina regen x${ctx.hasBear ? 0.55 : 0.5}, until you move`,
    resolve: (ctx) => ({ staminaRegen: mul(0.5 * (ctx.hasBear ? 1.1 : 1)) }),
  },
  {
    id: "strength_in_numbers",
    label: "Strength In Numbers",
    source: "ability",
    polarity: "buff",
    ability: "Strength In Numbers",
    lasting: true,
    caption: (ctx) =>
      `stamina regen +${formatPct((STRENGTH_IN_NUMBERS_PER_MATE - 1) * 100 * Math.min(STRENGTH_IN_NUMBERS_CAP, ctx.sameSpeciesPackmates))}, 7% a same-species packmate up to nine`,
    resolve: (ctx) => {
      const mates = Math.min(STRENGTH_IN_NUMBERS_CAP, Math.max(0, ctx.sameSpeciesPackmates));
      if (mates < 1) return {};
      return { staminaRegen: mul(1 + (STRENGTH_IN_NUMBERS_PER_MATE - 1) * mates) };
    },
  },
  // Aftershock is the price of the user's own Earthquake, applied to the caster
  // alongside a quarter of its pool. Two creatures can land it on someone else
  // through a Lich Mark and a Yolk Bomb; the offer here is the self-inflicted
  // one, which is the only route a build controls.
  {
    id: "aftershock",
    label: "Aftershock",
    source: "ability",
    polarity: "debuff",
    ability: "Earthquake",
    caption: "stamina regen -50%",
    resolve: () => ({ staminaRegen: mul(0.5) }),
  },

  // ---- landed by someone else ----
  // Channels per ailment rather than per habit: these do not all reach the same
  // set. Torn Ligaments writes walk / swim alone, Inked leaves flight untouched,
  // and only the three that name `BeachedSpeed` reach a beached aquatic.
  {
    id: "hostile_freeze",
    label: "Freeze",
    source: "world",
    polarity: "debuff",
    hostile: true,
    // Defensive Paralyze puts it on whoever bit its owner - 18 creatures carry
    // that passive. Its stacks are the ability's own value and cap at one, and
    // the slow is the same 75% at any stack count.
    caption: "speed -75%",
    resolve: () => ({ speed: mul(0.25), sprint: mul(0.25), fly: mul(0.25), beached: mul(0.25) }),
  },
  {
    id: "hostile_sticky_trap",
    label: "Sticky Trap",
    source: "world",
    polarity: "debuff",
    hostile: true,
    caption: "speed -75%",
    resolve: () => ({ speed: mul(0.25), sprint: mul(0.25), fly: mul(0.25), beached: mul(0.25) }),
  },
  {
    id: "hostile_torn_ligaments",
    label: "Torn Ligaments",
    source: "world",
    polarity: "debuff",
    hostile: true,
    // Walk and swim is the only movement channel it names; the other two
    // targets are the stamina ones, at a tenth of the rate a stack.
    caption: "walk / swim -50%, stamina regen -10% a stack",
    resolve: () => ({ speed: mul(0.5), staminaRegen: mul(0.9), glideRegen: mul(0.9) }),
  },
  {
    id: "hostile_inked",
    label: "Inked",
    source: "world",
    polarity: "debuff",
    hostile: true,
    // Ink Cloud's other half: the escaper gets +75%, whoever is caught in it
    // gets this. Flight is not among its targets.
    caption: "walk / swim -35%, sprint -35%",
    resolve: () => ({ speed: mul(0.65), sprint: mul(0.65) }),
  },
  {
    id: "hostile_injury",
    label: "Injury",
    source: "world",
    polarity: "debuff",
    hostile: true,
    caption: "speed -25%",
    resolve: () => ({ speed: mul(0.75), sprint: mul(0.75), fly: mul(0.75), beached: mul(0.75) }),
  },
  {
    id: "hostile_gale",
    label: "Gale",
    source: "world",
    polarity: "debuff",
    hostile: true,
    caption: "speed -20%",
    resolve: () => overall(0.8),
  },
  {
    id: "hostile_stolen_speed",
    label: "Stolen Speed",
    source: "world",
    polarity: "debuff",
    hostile: true,
    // Speed Steal's other half: the thief carries Speed Gift, the robbed one
    // carries this. The same multiplier lands on every channel it names, so the
    // rate goes with the speed.
    caption: "speed -20%, stamina regen -20%",
    resolve: () => ({ ...overall(0.8), staminaRegen: mul(0.8) }),
  },
  {
    id: "hostile_slowed",
    label: "Slowed",
    source: "world",
    polarity: "debuff",
    hostile: true,
    caption: "speed -15%",
    resolve: () => overall(0.85),
  },
  // The four below move a rate rather than a speed. Quoted at one stack, the
  // same convention Torn Ligaments above uses: the per-stack figure is in the
  // caption and a surface that knows a real count applies it.
  // Defiled Ground's Defiled Sickly is this ailment down to the constant, so it
  // is this row rather than a second one: same 0.8, a different source.
  {
    id: "hostile_sickly",
    label: "Sickly",
    source: "world",
    polarity: "debuff",
    hostile: true,
    caption: "stamina regen -20%",
    resolve: () => ({ staminaRegen: mul(0.8) }),
  },
  {
    id: "hostile_frostbite",
    label: "Frostbite",
    source: "world",
    polarity: "debuff",
    hostile: true,
    caption: "stamina regen -25%",
    resolve: () => ({ staminaRegen: mul(0.75) }),
  },
  // Poison takes the rate down linearly rather than by a multiply a stack, and
  // it also eats 0.35% of a full pool per tick per stack - a drain rather than
  // a channel, so the engine carries that half.
  {
    id: "hostile_poison",
    label: "Poison",
    source: "world",
    polarity: "debuff",
    hostile: true,
    caption: "stamina regen -1% a stack",
    resolve: () => ({ staminaRegen: mul(1 - POISON_STAMINA_REGEN_PER_STACK) }),
  },
];

export const speedEffectById: ReadonlyMap<string, SpeedEffect> = new Map(SPEED_EFFECTS.map((e) => [e.id, e]));
