export type ReferenceStatus =
  | "Modeled"
  | "Partial"
  | "Out of model"
  | "Not modeled yet"
  | "Not planned"
  | "Disputed"
  | "Battle setting"
  | "Sandbox-only"
  | "Speed-Builds-only";

/**
 * A magnitude the spec commits to, kept here as the single source of truth so
 * reference tests read the number instead of copying it. `quote` must be a
 * verbatim slice of one of the entry's `mechanics` bullets and contain `value`;
 * codegen (scripts/gen_spec_constants.ts) welds both into spec_constants.rs and
 * specConstants.generated.ts.
 */
export type SpecConstant = {
  key: string;
  value: number;
  quote: string;
};

export type AbilityReferenceEntry = {
  id: string;
  name: string;
  status: ReferenceStatus;
  summary: string;
  mechanics: string[];
  specConstants?: SpecConstant[];
  whyItsNotModeledHere?: string[];
  policyDifferences: string[];
  notes: string[];
  /** Also listed under Movement Speed. Set on a card whose movement side has no
   * entry of its own there, so the object is not missing from that section. */
  movesSpeed?: boolean;
};

export type StatusReferenceEntry = {
  id: string;
  name: string;
  status: ReferenceStatus;
  summary: string;
  mechanics: string[];
  specConstants?: SpecConstant[];
  notes: string[];
  /** Documents a rule the statuses run under rather than a status of its own,
   * so nothing tries to route it to an engine id. */
  isSystemRule?: boolean;
  /** Also listed under Movement Speed. Set on a card whose movement side has no
   * entry of its own there, so the object is not missing from that section. */
  movesSpeed?: boolean;
};

export type PolicyReferenceEntry = {
  id: string;
  name: string;
  summary: string;
  mechanics: string[];
  notes: string[];
};

export type ApproximationReferenceEntry = {
  id: string;
  parentId?: string;
  name: string;
  summary: string;
  gameTruth: string[];
  currentApproximation: string[];
  whyApproximated: string;
  notes: string[];
};

export type PlushieReferenceEntry = {
  id: string;
  name: string;
  status: ReferenceStatus;
  summary: string;
  mechanics: string[];
  notes: string[];
  /** Also listed under Movement Speed. Set on a card whose movement side has no
   * entry of its own there, so the object is not missing from that section. */
  movesSpeed?: boolean;
};

function slugifyReferenceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['‘’ʼ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function createDisputedCompareOnlyAbilityEntry(name: string): AbilityReferenceEntry {
  return {
    id: `compare_${slugifyReferenceName(name)}`,
    name,
    status: "Disputed",
    summary: "Currently not modeled.",
    mechanics: [
      "This ability is currently not included in the default stand-and-fight combat model.",
      "Its exact modeled behavior is still being defined.",
    ],
    policyDifferences: [],
    notes: [
      "When this ability is added, it will be treated as a battle setting.",
      "Under that setting, healing and buff effects will always benefit the user.",
      "Offensive effects will always apply their negative effect to the opponent.",
      "Trap and area effects will be treated as affecting the opponent for their full duration.",
      "Because those assumptions are inherently disputed, this ability will not be enabled by default.",
    ],
  };
}

function createOutOfModelAbilityEntry(name: string): AbilityReferenceEntry {
  return {
    id: `ability_${slugifyReferenceName(name)}`,
    name,
    status: "Out of model",
    summary: "Out of model.",
    mechanics: [
      "Nothing about this ability reaches a number this calculator produces.",
    ],
    policyDifferences: [],
    notes: [
      "Movement, positioning and stealth do not reach the stand-and-fight model.",
    ],
  };
}

/**
 * A status the model carries and nothing more: it lands, it decays, it takes
 * part in cleanse and cross-status rules, and it moves no combat figure. The
 * wording is shared because the claim is - the only thing that varies is
 * polarity.
 */
function createTrackedOnlyStatusEntry(
  name: string,
  polarity: "positive" | "negative",
  extraMechanics: string[] = [],
): StatusReferenceEntry {
  return {
    id: `status_${slugifyReferenceName(name)}`,
    name,
    status: "Partial",
    summary: "Carried on the affected creature with no combat effect of its own.",
    mechanics: [
      "The model records this status as present on the affected creature and decays it on the standard schedule.",
      "It takes part in cleanse and cross-status rules.",
      "It moves no combat figure, so a fight runs identically without it.",
      ...extraMechanics,
    ],
    notes: [
      polarity === "negative"
        ? "Polarity is negative - Fortify cleanses it."
        : "Fortify cleanses negative statuses only, and this one is positive.",
      "The stand-and-fight model has no movement, positioning or vision, so a status that only touches those changes nothing in it.",
    ],
  };
}

export const ABILITY_POLICY_REFERENCE_DRAFTS: PolicyReferenceEntry[] = [
  {
    id: "policy_fast",
    name: "Fast",
    summary: "The search mode with the fewest candidate delays: 0, 1 and 3 seconds.",
    mechanics: [
      "Fast runs the search mechanism, not the really fast state rules.",
      "It runs the same search semi-ideal, ideal and extreme run, over three candidate delays: 0, 1 and 3 seconds.",
      "It carries none of the really fast state rules.",
      "Fast's longest candidate delay is 3 seconds, so it cannot choose any of the longer delays semi-ideal, ideal and extreme propose.",
    ],
    notes: [],
  },
  {
    id: "policy_really_fast",
    name: "Really fast",
    summary: "Decides from rules about the state of the fight instead of searching.",
    mechanics: [
      "Really fast proposes no candidate delays and projects no fight forward. It answers each decision from a rule.",
      "A really fast rule can hold an ability that is off cooldown.",
      "Each rule reads only the state of the fight at the moment of the decision, so a really fast decision does not depend on anything that happens after it.",
      "Life Leech does not fire above 85% HP under really fast.",
      "Fortify waits until there are at least 15 removable negative stacks under really fast.",
      "Only stacks that are still decaying count toward that threshold; a permanent stack is not counted.",
      "Fortify never fires in the first 8 seconds of a fight under really fast.",
      "Rewind only fires at 75% HP or lower under really fast.",
      "Rewind fires only when the recorded HP is above the current HP.",
      "Really fast turns Hunker on as soon as it is available and keeps it on for the rest of the fight.",
    ],
    notes: [
      "Fortify is held for the first 8 seconds because a cleanse there removes only the stacks landed so far and then leaves the ability on cooldown for 90 seconds, while further stacks land.",
    ],
  },
  {
    id: "policy_semi_ideal_ideal_and_extreme",
    name: "Semi-ideal, Ideal, and Extreme",
    summary: "The three timing modes that project the fight from each of several candidate delays and keep the delay whose projection scores highest.",
    mechanics: [
      "Each of the three scores using the ability now against using it after each candidate delay.",
      "The model proposes candidate wait times, projects the fight from each, and keeps the wait time whose projection scores highest.",
      "The three differ in how many delays they propose.",
      "They run the same search fast runs; only the candidate set differs.",
      "They also differ in how often a standing decision is reconsidered.",
      "Hunker, which is held on or off rather than fired once, is re-evaluated every 0.1 seconds under extreme, every 0.25 seconds under ideal, and every 0.5 seconds under really fast, fast and semi-ideal.",
      "Semi-ideal checks 6 delays - 0, 0.5, 1, 2, 4, and 8 seconds.",
      "Ideal checks 11 delays - 0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, and 12 seconds.",
      "Extreme checks 202 delays - 0 to 12 seconds every 0.1 seconds, 12.5 to 30 seconds every 0.5 seconds, and 32 to 120 seconds every 2 seconds.",
      "Extreme proposes 202 candidate delays against ideal's 11.",
      "The length of the projected fight is set by the ability's scoring formula, not by the mode, so two abilities under ideal can project fights of different lengths.",
      "The search holds an ability that is usable now whenever a later delay projects a higher score.",
      "Life Leech, Fortify, Warden's Rage, Hunker, Hunters Curse, Adrenaline, Reflect, Rewind, Cocoon, and Unbridled Rage each score their candidate delays with their own formula.",
    ],
    notes: [],
  },
  {
    id: "policy_what_ability_policies_are",
    name: "What Ability Policies Are",
    summary: "The timing rules that decide when the model presses an active ability.",
    mechanics: [
      "Ability Policies do not change what an ability does. They only change when the model chooses to use it.",
      "The model answers one question at each decision point: use the ability now, wait, or skip it.",
      "There are five timing modes: really fast, fast, semi-ideal, ideal, and extreme.",
      "The five modes run two mechanisms between them.",
      "Really fast answers with rules about the current state.",
      "Fast, semi-ideal, ideal and extreme run a search: propose candidate delays, project the fight from each, and keep the delay with the highest score.",
      "Fast runs the search mechanism, over the three delays listed in Fast.",
      "Projected results are compared on a single score.",
      "Each ability supplies the formula that turns a projected fight into that score.",
      "The delay with the highest score is the one used.",
      "When two delays score the same, the earlier one is kept.",
      "In Compare, one ability can run under a different mode from the rest of the fight.",
    ],
    notes: [],
  },
];

export const KNOWN_APPROXIMATION_REFERENCE_DRAFTS: ApproximationReferenceEntry[] = [
  {
    id: "approx_bad_omen",
    parentId: "status_bad_omen",
    name: "Bad Omen outcome resolution",
    summary: "Bad Omen's expiry outcome is rolled at each expiry in Compare and fixed for the whole run in Best Builds and Optimizer.",
    gameTruth: [
      "In game, one outcome is rolled at each Bad Omen expiry from the ten listed under Bad Omen.",
    ],
    currentApproximation: [
      "In Compare, an outcome is rolled at each expiry, so two expiries in one fight can apply different follow-ups.",
      "In Debug Mode, every expiry applies the same outcome, the one selected for the run.",
      "In Best Builds and Optimizer, every expiry applies 8 stacks of Burn, in every fight of the run.",
    ],
    whyApproximated: "A build score has to be repeatable, and an outcome rolled per run would make the same build score differently each time.",
    notes: [],
  },
  {
    id: "approx_breath_pseudo_crits_and_pseudo_procs",
    name: "Breath pseudo-crits and pseudo-procs",
    summary: "Breath crit chance and chance-based breath side effects are modeled as pseudo-crits and expected stacks rather than rolled per breath.",
    gameTruth: [
      "In game, breath crits and chance-based side effects roll independently per breath instance.",
    ],
    currentApproximation: [
      "Breath crit chance becomes a constant damage multiplier: every breath is scaled by 1 + (crit chance / 100) × 0.5, where crit chance is the breath's crit percentage and 0.5 is the extra damage a crit adds at the game's 1.5x breath crit multiplier, instead of rolling for a crit.",
      "Chance-based breath effects become expected average stacks: a P% chance to apply N stacks is applied as P / 100 × N stacks on every breath.",
      "Every breath deals the same damage and applies the same number of stacks, so no fight varies between runs.",
    ],
    whyApproximated: "One fight is one sample, and in a short fight the difference between a crit and no crit is large enough to decide which creature wins.",
    notes: [],
  },
  {
    id: "approx_broodwatcher",
    parentId: "compare_broodwatcher",
    name: "Broodwatcher",
    summary: "The creature is treated as never leaving its nest, so its Defensive stacks never decay.",
    gameTruth: [
      "In game Defensive decays once the creature is outside its nest's radius.",
    ],
    currentApproximation: [
      "When Broodwatcher is enabled in Compare, Defensive lands on the creature that owns it at the start of the fight.",
      "Its stacks do not decay.",
    ],
    whyApproximated: "The stand-and-fight model has no movement, so nothing in a fight moves the creature away from its nest.",
    notes: [],
  },
  {
    id: "approx_buffered_natural_regeneration",
    parentId: "status_natural_regeneration",
    name: "Buffered natural regeneration",
    summary: "A natural regeneration tick that would land while regeneration is fully blocked is held, and delivered after the block ends.",
    gameTruth: [
      "In game, a suppressed regeneration tick returns once regeneration is possible again, but not at the instant the block lifts.",
    ],
    currentApproximation: [
      "A natural regeneration tick that would land while regeneration is fully blocked - by Warden's Rage, or by a status that drives the regeneration multiplier to zero such as Bleed or 10 stacks of Burn - is held rather than lost, and delivered once regeneration is possible again.",
      "At most one tick buffers, no matter how long the block lasts.",
      "Warden's Rage releases the buffered tick the moment it turns off.",
      "A status block releases it 1.5 seconds after the blocking effect clears.",
      "The released tick heals at the regeneration multiplier in effect at the moment of release, so remaining regeneration-reducing stacks - Burn decayed from 10 stacks to 9, for example - still reduce it.",
    ],
    whyApproximated: "1.5 seconds matches the observed in-game average.",
    notes: [],
  },
  {
    id: "approx_first_tick_rule",
    parentId: "compare_first_tick_rule",
    name: "First Tick Rule",
    summary: "First Tick Rule sets the time of the first passive tick of a fight.",
    gameTruth: [
      "In game the passive tick cycle runs continuously, so a fight begins at an arbitrary offset into it.",
    ],
    currentApproximation: [
      "A fight in the model starts its tick clocks at time zero, so its offset into the cycle is always zero.",
      "First Tick Rule sets that offset directly, for ailments, for regeneration, or for both.",
      "The first tick fires after the chosen delay instead of at its default time. See First Tick Rule for the two defaults.",
      "Every later tick keeps its normal interval.",
    ],
    whyApproximated: "Nothing in a matchup determines where in the cycle it would begin, so the offset is chosen rather than computed.",
    notes: [],
  },
  {
    id: "approx_frosty",
    parentId: "compare_frosty",
    name: "Frosty",
    summary: "Frosty's +25% health regeneration applies only while its battle setting is enabled; its Hypothermia immunity applies unconditionally.",
    gameTruth: [
      "In game the regeneration bonus applies during Winter and Famine.",
    ],
    currentApproximation: [
      "Frosty's +25% health regeneration applies only while its battle setting is enabled.",
      "A creature with Frosty never takes Hypothermia, from either side of the fight, whether or not the battle setting is enabled.",
    ],
    whyApproximated: "Winter and Famine are modeled only as changes to the hunger and thirst intervals, so no season decides the regeneration bonus.",
    notes: [],
  },
  {
    id: "approx_hunker_first_activation",
    parentId: "ability_hunker",
    name: "Hunker first activation",
    summary: "The first Hunker activation of a fight applies at once; every later one applies 5 seconds after it is turned on.",
    gameTruth: [
      "In game Hunker takes 5 seconds of holding the pose before it does anything, every time.",
    ],
    currentApproximation: [
      "The first time Hunker comes on in a fight, it applies at once.",
      "Every activation after that waits the 5 seconds.",
    ],
    whyApproximated: "A fight in the model starts at the moment the two creatures meet, and the 5 seconds of holding the pose can be spent before that moment.",
    notes: [],
  },
  {
    id: "approx_reflux_puddle_occupancy",
    parentId: "ability_reflux",
    name: "Reflux puddle occupancy",
    summary: "The target is treated as staying inside the Reflux puddle for its full duration.",
    gameTruth: [
      "In game, the target can leave the puddle and stop taking its damage and Corrosion ticks.",
    ],
    currentApproximation: [
      "Once Reflux creates its puddle, the target is treated as remaining inside it for the whole effect duration.",
      "Puddle damage and Corrosion apply on every puddle tick until the puddle expires.",
    ],
    whyApproximated: "Movement is outside the stand-and-fight model, so nothing takes a target out of an area effect.",
    notes: [],
  },
  {
    id: "approx_special_air_pvp_rule",
    parentId: "compare_special_air_pvp_rule",
    name: "Special Air PvP Rule",
    summary: "Air combat is modeled as one number: a fixed bite cooldown in place of the creature's own.",
    gameTruth: [
      "In game an air fight is decided by movement and positioning as well as by the exchange of bites.",
    ],
    currentApproximation: [
      "While the rule is enabled, each creature's bite cooldown is a fixed value.",
      "The two sides use the same value unless they are given different ones.",
      "That fixed cooldown overrides normal bite-cooldown changes from statuses and traits.",
      "Positioning, altitude and pursuit are not modeled; bite cooldown is the only channel the rule changes.",
    ],
    whyApproximated: "The stand-and-fight model has no positions to move between, so the rate of biting is the only part of an aerial matchup it can carry.",
    notes: [],
  },
  {
    id: "approx_thorn_trap_target_behavior",
    parentId: "ability_thorn_trap",
    name: "Thorn Trap target behavior",
    summary: "The target is treated as caught by Thorn Trap the moment it is used.",
    gameTruth: [
      "In game, the target may avoid the trap or be caught after a delay.",
    ],
    currentApproximation: [
      "Once Thorn Trap is activated, the target is treated as being caught by the trap right away.",
    ],
    whyApproximated: "Positioning is outside the stand-and-fight model, so nothing avoids a trap.",
    notes: [],
  },
  {
    id: "approx_totem_target_behavior",
    parentId: "ability_totem",
    name: "Totem target behavior",
    summary: "The opposing creature does not try to destroy Totem.",
    gameTruth: [
      "In game, the target can attack and remove the Totem, ending the poison ticks early.",
    ],
    currentApproximation: [
      "Once Totem is active, the target does not try to remove or destroy it.",
      "The poison ticks continue until Totem expires.",
    ],
    whyApproximated: "Neither creature has any action other than its own attacks, so nothing attacks a Totem.",
    notes: [],
  },
  {
    id: "approx_two_faced",
    parentId: "ability_two_faced",
    name: "Two-Faced",
    summary: "Two-Faced runs in one mode for a whole fight instead of alternating during it.",
    gameTruth: [
      "In game a creature can switch between Madness and Tranquility during a fight.",
    ],
    currentApproximation: [
      "Each run picks one side for the whole fight: Madness or Tranquility.",
      "The two modes are the multipliers stated under Two-Faced.",
      "In Best Builds and Optimizer, one mode applies to every Two-Faced owner in the run.",
      "In Compare, each creature has its own mode, so one fight can put Madness against Tranquility.",
    ],
    whyApproximated: "Alternating would require deciding when the user presses the ability, and Two-Faced has no timing policy to decide it with.",
    notes: [],
  },
];

export const BATTLE_SETTING_REFERENCE_DRAFTS: AbilityReferenceEntry[] = [
  {
    id: "compare_aerial_dodge",
    name: "Aerial Dodge",
    status: "Battle setting",
    summary: "Fliers dodge incoming bites and breath, with 25% of them landing by default.",
    mechanics: [
      "When enabled, each incoming bite and breath tick on a creature that can fly or glide has a per-side chance to land; it dodges the rest.",
      "A creature counts as airborne when it has a fly-speed or take-off stat (fliers and gliders).",
      "The chance is set per creature (default 25% to land).",
      "A grounded creature is always hit.",
      "A creature with Shredded Wings can no longer dodge, so attacks on it always land.",
      "See Shredded Wings in Statuses for what applies it.",
      "A dodged attack deals no damage and applies no on-hit statuses.",
      "The attacker's bite still advances its normal bite cooldown.",
      "Even pattern (default) lands hits as evenly as possible, so the result is the same every run.",
      "Real random uses independent rolls that vary between runs and can streak.",
      "In Sandbox, Best Builds and Optimizer real random runs from a fixed seed, so a run repeats.",
    ],
    policyDifferences: [],
    notes: [
      "The timeline shows a dodged attack as a Dodged entry.",
    ],
  },
  {
    id: "compare_aggressive",
    name: "Aggressive",
    status: "Battle setting",
    summary: "The Aggressive emote: 10 seconds of +25% damage, or +37.5% for a creature carrying Bear.",
    mechanics: [
      "Aggressive applies the Aggressive status for 10 seconds.",
      "Aggressive gives +25% damage.",
      "A user carrying Bear gets Aggressive's Bear variant instead, at +37.5% damage. See Bear.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_broodwatcher",
    name: "Broodwatcher",
    status: "Battle setting",
    summary: "Opens the fight with Defensive already on: +10% weight that does not decay.",
    mechanics: [
      "In Compare, Broodwatcher starts the fight with Defensive on the creature that owns it.",
      "Defensive multiplies weight by 1.1.",
      "Stacks set how long Defensive lasts and not how deep it goes: the multiplier is 1.1 at one stack and at five.",
      "They do not decay naturally.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_clean_water",
    name: "Clean water",
    status: "Battle setting",
    summary: "Clean water drunk before the fight: 180 seconds of +20% health regeneration.",
    mechanics: [
      "Clean water applies the Clean Water status for 180 seconds.",
      "While active, Clean Water increases health regeneration by 20% multiplicatively.",
      "Re-applying refreshes the timer rather than stacking.",
    ],
    policyDifferences: [],
    notes: [
      "See Clean Water in Statuses.",
    ],
  },
  {
    id: "compare_damage_boost",
    name: "Damage Boost",
    status: "Battle setting",
    summary: "The weekly Damage boost: +5% damage, +5% weight, -5% bite cooldown.",
    mechanics: [
      "Damage Boost gives +5% damage.",
      "Damage Boost gives +5% weight.",
      "Damage Boost gives -5% bite cooldown.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_day_night",
    name: "Day / Night",
    status: "Battle setting",
    summary: "The time the fight happens at, which moves damage and health regeneration for photovore and photocarnivore diets.",
    mechanics: [
      "A global battle setting with three values: None (default), Day, and Night.",
      "Day gives a photovore or photocarnivore creature +5% damage and +15% health regeneration.",
      "Night gives a photovore or photocarnivore creature -5% damage and -15% health regeneration.",
      "A creature of any other diet keeps its own figures at either value.",
      "At Night a creature carrying Eclipse gets +5% damage and +15% health regeneration whatever its diet, which leaves a photo diet where it started and puts every other diet ahead. See Eclipse in Plushies.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_defiled_ground",
    name: "Defiled Ground",
    status: "Battle setting",
    summary: "Contaminated land at one of three levels: the user gains max HP, weight and ailment recovery, and the opponent is left Sickly.",
    mechanics: [
      "In Compare, Defiled Ground runs at contaminated land level 1, 2, or 3.",
      "The user gains +5% / +7.5% / +10% max HP depending on the selected level.",
      "The user also gains +5% / +7.5% / +10% weight depending on the selected level.",
      "The user also gains 10% / 20% / 30% faster ailment recovery depending on the selected level.",
      "That ailment recovery applies only while the user is sitting or laying.",
      "It is a per-tick rate multiplier on how fast recoverable negative ailments clear: 1.10x / 1.20x / 1.30x at level 1 / 2 / 3.",
      "It multiplies on top of the sit/lay decay speed-up (2x sitting, 4x laying) and applies to the recoverable set only: Bad Omen, Bleed, Burn, Corrosion, Disease, Frostbite, Heartbroken, Injury, Necropoison, Poison.",
      "Standing gives no bonus.",
      "While Hunger and thirst is on, the user consumes 16.7% / 33.3% / 44.4% less hunger or thirst at level 1 / 2 / 3. It is a longer interval between appetite units - a 1.2x / 1.5x / 1.8x interval - so a 1.5x interval is a third less consumed, not a half. See Hunger and thirst.",
      "Sickly lands on the opponent and stays for as long as the setting is on.",
      "Both halves need the user to own Defiled Ground.",
      "Sickly reduces the opponent's passive health regeneration by 20%.",
      "While Hunger and thirst is on, Sickly makes the opponent consume 25% more hunger or thirst - the seconds-per-unit interval on both meters is multiplied by 0.8.",
      "The contaminated land bonus is active for the whole fight once the setting is on.",
      "Defiled Ground is off in the default model.",
      "In Best Builds the level is chosen per side and applies to the whole opponent pool, while ownership is still read per creature.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_first_tick_rule",
    name: "First Tick Rule",
    status: "Battle setting",
    summary: "Sets when the first ailment tick and the first regeneration tick happen, overriding the schedule each would otherwise start on.",
    mechanics: [
      "First Tick Rule can apply to ailments, regeneration, or both.",
      "When it is enabled, the first tick uses the chosen delay instead of its normal starting time: 15 seconds for regeneration, 3 seconds for a freshly applied ailment.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_frosty",
    name: "Frosty",
    status: "Battle setting",
    summary: "The cold-weather trait: +25% health regeneration, and hunger and thirst 20% slower.",
    mechanics: [
      "The creature must own Frosty.",
      "A Minty Wiggler grants it. See Minty Wiggler.",
      "Frosty raises the owner's health regeneration by 25%.",
      "Frosty stretches both drain intervals by 1.25, so hunger and thirst drain 20% slower.",
      "A creature with Frosty is immune to Hypothermia from Blizzard whether or not this setting is on. See Hypothermia.",
    ],
    policyDifferences: [],
    notes: [
      "In game Frosty's health regeneration and drain-interval bonuses apply during Winter and Famine. In the model they apply while this setting is on and do not depend on the season.",
    ],
  },
  {
    id: "compare_gore_charge",
    name: "Gore Charge",
    status: "Battle setting",
    summary: "A charge into the opening bite, which lands 2 stacks of Bleed and 9 stacks of Deep Wounds.",
    mechanics: [
      "In Compare, Gore Charge changes only the first melee hit.",
      "That hit applies 2 stacks of Bleed and 9 stacks of Deep Wounds.",
    ],
    specConstants: [
      { key: "gore_charge_bleed_stacks", value: 2, quote: "applies 2 stacks of Bleed" },
      { key: "gore_charge_deep_wounds_stacks", value: 9, quote: "9 stacks of Deep Wounds" },
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_guardians_seal",
    name: "Guardian's Seal",
    status: "Battle setting",
    summary: "Starts the fight already sealed, as if a packmate had used Guardians Passage on the creature a moment earlier.",
    mechanics: [
      "The Guardian's Seal buff applies 3 stacks of Guardian's Seal to the creature at the start of the fight.",
      "The stacks decay on the standard schedule, so the seal covers the first 9 seconds.",
      "It is available to every creature, whether or not that creature owns Guardians Passage.",
    ],
    policyDifferences: [],
    notes: [
      "See Guardian's Seal in Statuses.",
    ],
  },
  {
    id: "compare_head_start",
    name: "Head Start",
    status: "Battle setting",
    summary: "Holds the opponent inert for a chosen number of opening seconds while the user acts.",
    mechanics: [
      "Head Start is a number of seconds held per creature. A creature whose Head Start is above 0 acts alone for that many seconds from the start of the fight.",
      "During the opening the opponent takes no action: it does not attack, breathe, change posture, use abilities, or self-destruct.",
      "The opponent still takes the user's bites.",
      "Its defensive on-being-bitten reactions still fire: defensive ailments and Reflect.",
      "The opponent is still a live target during the opening: its regeneration, status decay, and status ticks keep running.",
      "After the chosen number of seconds, the opponent acts normally.",
      "Each side is independent. If both creatures set a head start, each one stands inert during the other's window.",
      "It is available to every creature.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_healing_pulse",
    name: "Healing Pulse",
    status: "Battle setting",
    summary: "A pulse of 10 stacks of Healing Ailment, on the user alone at the start of the fight or on both creatures every 90 seconds.",
    mechanics: [
      "In Compare, Healing Pulse runs in one of two modes: Normal or Once at start.",
      "In Normal mode each activation applies 10 stacks of Healing Ailment to the user and the opponent, because the in-game radius covers both in a stand-and-fight exchange.",
      "Normal: the user fires at the start of the fight and again every 90 seconds of cooldown for the rest of the fight.",
      "Once at start: the user fires a single time at the start of the fight, targeting only the user - the opponent does not receive Healing Ailment.",
    ],
    specConstants: [
      { key: "healing_pulse_cooldown_sec", value: 90, quote: "every 90 seconds of cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all leave Healing Pulse alone: Normal fires whenever its cooldown is ready, and Once at start fires once at the start of the fight.",
    ],
    notes: [
      "The timeline can show each Healing Pulse activation.",
    ],
  },
  {
    id: "compare_use_hunger_rules",
    name: "Hunger and thirst",
    status: "Battle setting",
    summary: "The two survival meters, which drain for the whole fight and starve whoever empties one.",
    mechanics: [
      "Both meters run for the whole fight.",
      "Each meter starts at a chosen fill. A meter starts above full only on a creature carrying Gourmandizer.",
      "Hunger drains by 1 appetite unit every 36 seconds.",
      "Thirst is sized by the same appetite number and drains at the same rate.",
      "Disease drains both meters faster: each meter's seconds-per-unit interval is multiplied by 0.8 - 0.015 × stacks. See Disease.",
      "Gourmandizer drains an overfilled meter 2x faster, at any fill above 100% rather than in proportion to it.",
      "Every 36 seconds after a meter reaches zero the creature gains another stack of Hungry or Thirsty.",
      "Anything that drains the meter faster brings the next stack sooner.",
      "Hungry and Thirsty each deal 0.5% of max health per stack every 3 seconds. See Hungry.",
      "Neither tick deals less than 1 damage.",
      "Health regeneration stops entirely while either is present.",
      "Reflux costs 25 percentage points of the full appetite meter, and cannot fire below that cost.",
      "Photovore creatures have no hunger meter.",
      "Aquatic and Photocarnivore creatures have no thirst meter.",
    ],
    specConstants: [
      { key: "appetite_drain_sec_per_unit", value: 36, quote: "1 appetite unit every 36 seconds" },
      { key: "gourmandizer_overfill_drain_multiplier", value: 2, quote: "overfilled meter 2x faster" },
      { key: "starving_damage_pct_max_hp", value: 0.5, quote: "0.5% of max health per stack" },
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_moon",
    name: "Moon",
    status: "Battle setting",
    summary: "A moon phase over the whole fight: one halves damage and raises regeneration, the other raises damage and quickens the bite.",
    mechanics: [
      "A global battle setting with three values: None (default), Blue Moon, and Blood Moon.",
      "Blue Moon halves damage.",
      "Blue Moon raises health regeneration by 50%.",
      "Blood Moon raises damage by 50%.",
      "Blood Moon halves the bite cooldown.",
      "Both values apply to every creature, whatever its diet.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_mud_pile",
    name: "Mud Pile",
    status: "Battle setting",
    summary: "Rolling in a mud pile before the fight: 90 seconds of Muddy.",
    mechanics: [
      "In Compare, Mud Pile applies Muddy for 90 seconds.",
      "Each Land plushie equipped adds another 90 seconds to that duration. See Land.",
      "Muddy gives +25% health regeneration.",
      "Muddy doubles the rate at which Bleed and Poison decay.",
    ],
    policyDifferences: [],
    notes: [
      "See Muddy in Statuses.",
    ],
  },
  {
    id: "compare_no_move_facetank",
    name: "No Move Facetank",
    status: "Battle setting",
    summary: "Holds both creatures still for the whole fight, so persistent ailments decay and Aggressive never expires.",
    mechanics: [
      "No Move Facetank changes how persistent PvP statuses behave.",
      "The persistent set is the ailments that only decay while the creature is still: Poison, Burn, Bleed, Corrosion, Necropoison, Frostbite, Radiation, Hypothermia, and Injury.",
      "With No Move Facetank off, those statuses stop naturally decaying.",
      "With it on, those statuses decay normally.",
      "Sickly belongs to that set too, but its only source (Defiled Ground) applies it permanently, so it never decays regardless of this setting.",
      "Each ailment tick processes natural decay first and then deals damage using the post-decay stack count.",
      "A moving target therefore keeps its stacks, while a stationary target loses one stack right before damage is calculated.",
      "The very first tick on a 1-stack Burn deals 5x more on a moving target than on a stationary one.",
      "The gap shrinks as stacks grow, reaching 1.108x at 10 stacks. See Burn in Statuses.",
      "With No Move Facetank on, Aggressive and its Bear variant do not decay, so each lasts the whole fight instead of its 10-second window. See Aggressive.",
      "A trail or step ability that temporarily turns No Move Facetank off also resumes Aggressive's normal decay.",
    ],
    policyDifferences: [],
    notes: [
      "The Aggressive half mirrors the in-game rule that Aggressive stacks do not decrease until the creature moves.",
    ],
  },
  {
    id: "compare_oxygen_moisture",
    name: "Oxygen / Moisture Drain",
    status: "Battle setting",
    summary: "Drains moisture on land or oxygen underwater, and takes 5% of max HP every second once the pool is empty.",
    mechanics: [
      "A global battle setting with three mutually exclusive values: Off (default), Ground, and Underwater.",
      "It uses two stats every creature already has: Moisture Time (Ground) and Oxygen Time (Underwater), both measured in seconds-to-depletion. Each side starts with a pool equal to its stat and drains 1 per second.",
      "Ground: while the side's moisture pool is above 0 it just drains. Once the pool hits 0 the side loses 5% of its max HP per second, floored at 50% of max HP - drying out never kills.",
      "Underwater: while the oxygen pool is above 0 it just drains. Once it hits 0 the side loses 5% of its max HP per second with no floor, so drowning can kill.",
      "A side whose relevant-mode stat is 0 (or missing) is immune in that mode: no drain and no damage. Only the active mode's stat matters - an oxygen-only creature is immune on Ground, and a moisture-only creature is immune Underwater.",
      "Damage starts one tick after the pool empties: a pool of N seconds reaches 0 at second N, and the first 5% comes off at second N + 1.",
      "The drain and the damage stop when a side dies.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_pack_healer",
    name: "Pack Healer",
    status: "Battle setting",
    summary: "A Pack Healer in range of the fight, whose regeneration aura reaches both creatures.",
    mechanics: [
      "In Compare, Pack Healer nearby gives +25% health regeneration to both creatures if it is enabled on either side.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_poison_area",
    name: "Poison Area",
    status: "Battle setting",
    summary: "A poison field the user drops whenever it comes off cooldown, each one leaving 5 stacks of Poison on the opponent.",
    mechanics: [
      "In Compare, the user fires Poison Area whenever its cooldown is ready.",
      "Each time it fires it applies 5 stacks of Poison to the opponent.",
      "The ability has a 15 second cooldown.",
      "Anything that changes active ability cooldown changes it.",
    ],
    specConstants: [
      { key: "poison_area_stacks", value: 5, quote: "applies 5 stacks of Poison" },
      { key: "poison_area_cooldown_sec", value: 15, quote: "15 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Poison Area the moment its cooldown is ready.",
    ],
    notes: [
      "The timeline can show when Poison Area is activated and when it applies its Poison.",
    ],
  },
  {
    id: "compare_power_charge",
    name: "Power Charge",
    status: "Battle setting",
    summary: "A charge into the opening bite, which hits 50% harder and lands 2 stacks of Shredded Wings.",
    mechanics: [
      "In Compare, Power Charge changes only the first melee hit.",
      "That hit gains +50% damage and applies 2 stacks of Shredded Wings.",
    ],
    specConstants: [
      { key: "power_charge_first_hit_damage_pct", value: 50, quote: "gains +50% damage" },
      { key: "power_charge_shredded_wings_stacks", value: 2, quote: "applies 2 stacks of Shredded Wings" },
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_reflect_response",
    name: "Reflect response",
    status: "Battle setting",
    summary: "Whether a side keeps attacking into an active Reflect or waits for it to expire.",
    mechanics: [
      "Under hold, the side does not bite while the opponent's Reflect is active.",
      "Under hold, the side does not use its breath while the opponent's Reflect is active.",
      "A held bite is not lost: it lands the moment Reflect expires, and the bite cooldown carries on from there.",
    ],
    policyDifferences: [
      "This setting runs its own pair of modes rather than the five timing modes.",
      "Ignore keeps biting and breathing into an active Reflect, and is the default.",
      "Hold waits the window out instead.",
    ],
    notes: [],
  },
  {
    id: "compare_refreshed",
    name: "Refreshed",
    status: "Battle setting",
    summary: "Refreshed drunk before the fight: 180 seconds of +5% health regeneration.",
    mechanics: [
      "Refreshed applies the Refreshed status for 180 seconds.",
      "While active, Refreshed increases health regeneration by 5% multiplicatively.",
      "Re-applying refreshes the timer rather than stacking.",
    ],
    policyDifferences: [],
    notes: [
      "See Refreshed in Statuses.",
    ],
  },
  {
    id: "compare_regen_boost",
    name: "Regen Boost",
    status: "Battle setting",
    summary: "The weekly Regen boost: +20% health regeneration and -10% ability cooldown.",
    mechanics: [
      "Regen Boost gives +20% health regeneration.",
      "Regen Boost gives -10% ability cooldown.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_scared_status",
    name: "Scared",
    status: "Battle setting",
    summary: "The Scared emote: 10 seconds of -50% damage, or -45% for a creature carrying Bear.",
    mechanics: [
      "Scared applies the Scared status for 10 seconds.",
      "Scared gives -50% damage.",
      "A user carrying Bear gets Scared's Bear variant instead, at -45% damage. See Bear.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_season",
    name: "Season",
    status: "Battle setting",
    summary: "The world's season, which changes how fast the hunger and thirst meters drain.",
    mechanics: [
      "A global battle setting with eight values: None (default), Spring, Summer, Fall, Winter, Sakura, Famine and Drought.",
      "Winter multiplies the hunger interval by 0.8, so hunger drains 25% faster.",
      "Winter multiplies the thirst interval by 0.9, so thirst drains 11.1% faster.",
      "Famine multiplies the hunger interval by 1.9, so hunger drains 47.4% slower.",
      "Famine multiplies the thirst interval by 0.9, so thirst drains 11.1% faster.",
      "Drought multiplies the thirst interval by 0.7, so thirst drains 42.9% faster.",
      "Drought leaves hunger unchanged.",
      "Spring, Summer, Fall and Sakura leave both meters at their normal rate.",
    ],
    policyDifferences: [],
    notes: [
      "Winter also lands 5 stacks of Frostbite in game, once, at the moment the season begins. The model does not place a fight anywhere within a season, so seeding those stacks would pin every winter fight to the season boundary. The setting leaves them out, and Frostbite reaches a fight through its own sources. See Frostbite.",
    ],
  },
  {
    id: "compare_secondary_attack",
    name: "Secondary Attack",
    status: "Battle setting",
    summary:
      "A per-bite choice between the creature's primary bite - base damage plus its on-hit offensive ailments - and its secondary bite, which hits harder but applies no ailments.",
    mechanics: [
      "Secondary Attack is available to any creature whose secondary bite damage is above zero.",
      "It has three modes: Primary, Dynamic, and Secondary.",
      "Primary: every bite uses base damage and applies the creature's on-hit offensive ailments.",
      "Secondary: every bite uses the secondary damage value and applies no on-hit offensive ailments.",
      "All other multipliers - Hunters Curse, Adrenaline, Warden's Rage, base Spite damage, Power Charge, Cocoon damage, Expunge kill-secure and heal-save - stack on the secondary value identically.",
      "Dynamic: at each bite the model replays the rest of the fight under a set of candidate bite schedules and takes the immediate variant from the best one.",
      "Both variants fire on the same bite schedule.",
      "Switching between them costs nothing.",
      "Sandbox always uses the primary bite.",
      "Best Builds and Optimizer default to the primary bite.",
      "Best Builds and Optimizer can be set to another variant per side.",
      "A creature with no secondary attack is always treated as Primary.",
    ],
    policyDifferences: [
      "Primary and Secondary are forced - no policy evaluation, the same variant fires every bite.",
      "Dynamic uses the same engine-replay projection as the Sit/Lay/Stand policy, scored on the same outcome - final HP for both sides, and who died first if anyone.",
      "The candidates are whole schedules, not the next bite alone: all-primary, all-secondary, secondary once then primary, and a switch after 1, 2, 3, 5, 8, 13 or 21 bites in either direction. Each is replayed to the end of the fight.",
      "Ties go to primary.",
      "A Dynamic projection takes no postures of its own.",
      "Each future bite decides its own variant when its own projection runs, so the sequence is decided bite by bite rather than planned in advance.",
      "The projection accounts for every multiplier stack, the opponent's block, resist and immunity, stacking caps, status damage and decay, and Fortify cleanse risk.",
    ],
    notes: [
      "The secondary bite damage value is wiki-sourced.",
    ],
  },
  {
    id: "compare_posture_policy",
    name: "Sit/Lay/Stand Policy",
    status: "Battle setting",
    summary: "Decides when a creature sits or lays: both postures speed up health regeneration and ailment decay, and both increase the damage it takes.",
    mechanics: [
      "Postures: Standing (default), Sitting, Laying. Each side runs its own policy choice independently.",
      "Transition durations: Standing to Sitting = 1 second; Standing to Laying = 2 seconds; Sitting to Laying or back = 1 second each way; standing up from any posture is instant.",
      "Settled (post-transition) Sitting multiplies passive health regen by 1.5, negative-ailment natural decay by 2.0, and incoming bite and breath damage by 1.5.",
      "Settled Laying multiplies passive health regen by 2.0, negative-ailment natural decay by 4.0, and incoming bite and breath damage by 2.0.",
      "The faster decay covers a fixed set of negative ailments rather than every negative status.",
      "Acid Rain, Ashy Lungs, Paralyze, Sickly, Sticky Trap and the Bear variant of Scared are outside that set and decay at their normal rate.",
      "The damage multiplier applies only to bite and breath.",
      "An ailment tick is not multiplied by posture, and neither is a percent-of-max-HP ability - Lance and Self-Destruct.",
      "Shadow Barrage copies the original bite event verbatim, so it inherits the posture multiplier without re-applying it.",
      "Multipliers apply only after the transition fully completes. During the 1 to 2 second transition window the side is treated as Standing for damage / regen / decay math.",
      "While settled in Sitting or Laying, the side cannot bite, cannot breathe, and cannot start new active-ability activations. Pre-existing active states keep ticking through their own duration.",
      "Hunker deactivates the moment any posture transition starts, including standing up, because Hunker requires the Standing pose.",
      "During the transition window the side can still bite, breathe, and activate new abilities.",
      "At each decision point the fight is played forward once for each option open to it - stay, start sitting, start laying, stand up.",
      "Each is scored on how that fight ends: the HP both sides finish with, and who died first if either did.",
      "The look-ahead runs the real fight rather than an estimate of one.",
      "A look-ahead takes no postures of its own.",
      "It stops at the first death, or at the time the fight is bounded to if neither side dies.",
      "Stay is always one of the evaluated candidates. The policy never picks a non-Stay candidate unless its replay outcome is strictly better than Stay's.",
      "Decision points: periodic re-evaluation every 5 seconds, plus extra checks 2 seconds before and immediately after each upcoming regen tick. Both Auto modes place their decision points the same way and score candidates the same way, so a regen tick counts toward a candidate's outcome as soon as its lay-window covers one.",
    ],
    policyDifferences: [
      "The policy has three modes per side: Off (no posture changes ever), Auto Regen-aware, Auto Regen-unaware. The two Auto modes behave identically.",
      "Off mode is guaranteed identical to runs without the policy.",
      "Both Auto modes are guaranteed to never produce a worse projected outcome than Off, because Stay is always one of the evaluated candidates.",
      "Best Builds and Optimizer default the policy to Off, so a build search runs with posture standing unless the policy is turned on for it.",
    ],
    notes: [
      "Combat log writes 'A started sitting/laying/standing' on transition start, 'A is now sitting/laying' on completion, and 'A stood up' for instant stand-ups.",
    ],
  },
  {
    id: "compare_special_air_pvp_rule",
    name: "Special Air PvP Rule",
    status: "Battle setting",
    summary: "Replaces each creature's bite cooldown with a fixed one.",
    mechanics: [
      "Special Air PvP Rule replaces each creature's bite cooldown with a fixed number of seconds.",
      "Both sides take one value by default, and each side can be given its own.",
      "That fixed cooldown overrides normal bite-cooldown changes from statuses and traits.",
    ],
    policyDifferences: [],
    notes: [
      "This rule is available in Compare, Best Builds, and Optimizer.",
    ],
  },
  {
    id: "compare_spite_ready_at_start",
    name: "Spite ready at start",
    status: "Battle setting",
    summary: "Spite is armed before the first bite instead of charging during the fight.",
    mechanics: [
      "The creature must own Spite.",
      "The fight starts with that Spite fully charged.",
      "The opening bite consumes that charged Spite immediately.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_storming",
    name: "Storming",
    status: "Battle setting",
    summary: "A terrestrial caught in the water takes 10% more damage from an Aquatic opponent.",
    mechanics: [
      "It only takes effect when the affected creature is Terrestrial and its opponent is Aquatic.",
      "While in effect, the affected creature takes 10% more damage from the opponent - both bites and breath.",
      "The effect lasts the whole fight.",
      "It deals no damage of its own.",
      "Being permanent, it survives a Fortify cleanse and does not count toward what Fortify needs to fire. See Fortify.",
      "Storming does nothing in any other matchup.",
    ],
    specConstants: [
      { key: "storming_incoming_damage_increase_pct", value: 10, quote: "takes 10% more damage" },
    ],
    policyDifferences: [],
    notes: [
      "Mirrors the in-game Storming debuff terrestrials receive for staying in the water too long.",
      "Storming is set in Compare and in Best Builds / Optimizer. Sandbox does not set it directly, but inherits the shared battle settings.",
    ],
  },
  {
    id: "compare_strength_in_numbers",
    name: "Strength In Numbers",
    status: "Battle setting",
    summary: "Damage that grows with the number of nearby allies carrying the same ability, up to nine of them.",
    mechanics: [
      "In Compare, the number of nearby allies with Strength In Numbers runs from 0 up to 9.",
      "The creature must own Strength In Numbers.",
      "Each nearby ally adds +1.5% damage to the owner.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "compare_trails",
    name: "Trails",
    status: "Battle setting",
    summary: "Lets a creature lay the trails it owns, and holds No Move Facetank off for that creature while one is active.",
    mechanics: [
      "Trails is set per side. It decides whether that side's Toxic Trail, Plague Trail, Flame Trail, Frost Trail and Healing Step run at all.",
      "With Trails off, none of those abilities reaches the fight, whichever side owns it.",
      "The setting starts off in Compare and in Best Builds, so a trail owner lays no segments until it is turned on.",
      "While any of the owner's trails or its Healing Step is active, No Move Facetank is held off for that owner. See No Move Facetank for what that does to its persistent ailments.",
      "The override reaches its owner only. The opponent keeps whatever No Move Facetank is set to.",
      "The owner's previous No Move Facetank setting returns as soon as none of its trails is active.",
      "The setting does not hand a trail to a creature that has none: such a creature runs the same with it on or off.",
      "Each trail is passive and gated on its owner's HP, so the setting decides whether a trail can run and the threshold decides when.",
    ],
    policyDifferences: [],
    notes: [
      "See Flame Trail for the threshold.",
      "See Toxic Trail, Plague Trail, Flame Trail, Frost Trail and Healing Step for what each one applies.",
    ],
  },
  {
    id: "compare_traps",
    name: "Traps",
    status: "Battle setting",
    summary: "Lets a creature set the traps it owns during the fight.",
    mechanics: [
      "Traps is set per side. It decides whether that side's Thorn Trap and Toxic Trap fire at all.",
      "With Traps on, each trap the creature owns fires whenever its own cooldown is ready.",
      "With Traps off, a creature that owns Thorn Trap or Toxic Trap fires neither.",
      "The setting starts off in Compare, so a trap owner opens a fight with its traps idle.",
      "The setting starts on in Best Builds, so a trap owner is searched with its traps firing.",
      "The setting does not hand a trap to a creature that has none: such a creature runs the same with it on or off.",
    ],
    policyDifferences: [],
    notes: [
      "See Thorn Trap and Toxic Trap for what each one applies and how often.",
    ],
  },
  {
    id: "compare_volcanic",
    name: "Volcanic",
    status: "Battle setting",
    summary: "The heat trait: +50% health regeneration, and hunger and thirst 20% slower.",
    mechanics: [
      "The creature must own Volcanic.",
      "Volcanic raises the owner's health regeneration by 50%.",
      "Volcanic stretches both drain intervals by 1.25, so hunger and thirst drain 20% slower.",
      "A creature with Volcanic is immune to Heat Wave whether or not this setting is on. See Heat Wave.",
    ],
    policyDifferences: [],
    notes: [
      "In game Volcanic's health regeneration and drain-interval bonuses apply during Summer and Drought. In the model they apply while this setting is on and do not depend on the season.",
    ],
  },
];

export const MODELED_ABILITY_REFERENCE_DRAFTS: AbilityReferenceEntry[] = [
  {
    id: "ability_acid_breath",
    name: "Acid Breath",
    status: "Modeled",
    summary: "Breath that applies Corrosion stacks on every damage tick.",
    mechanics: [
      "Acid Breath deals damage 2 times per second while it is firing.",
      "Capacity is 10 seconds of firing: each second of continuous fire spends 1 unit, whatever the tick rate.",
      "Capacity comes back at 1 unit every 1.8 seconds, so a fully drained bar takes 18 seconds to refill.",
      "An empty bar does not stop the breath. Firing and refilling alternate, so once the opening burst is spent the breath averages 0.71 damage ticks per second - 2 ticks per second of firing spread over each 1 second of fire plus 1.8 seconds of refill.",
      "Per-tick direct damage equals base × 0.5 × 1.05 × (1 - defender breath resistance), where base = (defender max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2 / 100. The weight ratio is capped at 3:1, identical to the melee weight formula.",
      "Each tick applies 0.5 stacks of Corrosion to the target.",
      "A user that also carries Aura (Corrosion) applies no Corrosion from the breath.",
    ],
    policyDifferences: [
      "Breath abilities do not use the standard ability timing policy modes.",
      "Once actives are enabled, the breath fires whenever capacity is available.",
    ],
    notes: [
      "The 1.05x factor is a pseudo-crit. The model does not roll random breath crits - it folds Acid Breath's listed 10% crit chance into a flat 1.05x multiplier on every tick (10% chance × 1.5x crit = 1 + 0.10 × 0.5).",
      "The 0.5 stacks per tick is a pseudo-proc. The model does not roll the listed 100% Corrosion chance per tick - it applies the expected stack value (1.0 × 0.5 = 0.5) every tick.",
      "Effective weight on each side is multiplied by any active Corrosion on that side before the ratio is computed.",
    ],
  },
  {
    id: "ability_adrenaline",
    movesSpeed: true,
    name: "Adrenaline",
    status: "Modeled",
    summary: "Temporarily increases the user's melee damage and movement speeds.",
    mechanics: [
      "Adrenaline lasts for 30 seconds.",
      "Its base cooldown is 90 seconds.",
      "While Adrenaline is active, the user's melee damage is multiplied by 1.2.",
      "The boost applies to melee damage only and does not increase breath damage.",
      "While Adrenaline is active, the user's walk, swim, sprint and flight speeds are multiplied by 1.2.",
    ],
    specConstants: [
      { key: "adrenaline_duration_sec", value: 30, quote: "Adrenaline lasts for 30 seconds" },
      { key: "adrenaline_cooldown_sec", value: 90, quote: "base cooldown is 90 seconds" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all activate Adrenaline as soon as it is available.",
      "The 1.2x bite-damage buff is treated as a pure outgoing buff with no cost, so firing as early as possible strictly dominates any delayed window.",
    ],
    notes: [
      "Adrenaline's speed side reaches Speed Builds and not Compare, so a fight sees the bite-damage buff alone.",
    ],
  },
  {
    id: "ability_agile_swimmer",
    movesSpeed: true,
    name: "Agile Swimmer",
    status: "Speed-Builds-only",
    summary: "Deepens the user's oxygen pool, and raises its swimming speeds where speed is modeled.",
    mechanics: [
      "Agile Swimmer multiplies the user's walk, swim and sprint speeds while it is swimming.",
      "The multiplier is 1 plus the creature's own Agile Swimmer value divided by 100.",
      "A creature that carries no Agile Swimmer value of its own uses 1.75.",
      "It holds for as long as its condition does rather than for a set time, so in Speed Builds it counts toward sustained as well as peak.",
      "Agile Swimmer adds 45 seconds of oxygen.",
    ],
    policyDifferences: [],
    notes: [
      "Agile Swimmer's speed side reaches Speed Builds and not Compare, so the oxygen is the only side a fight sees.",
      "The oxygen is modeled: it lengthens the pool the underwater drain mode empties before drowning starts.",
    ],
  },
  createOutOfModelAbilityEntry("Area Food Restore"),
  createOutOfModelAbilityEntry("Area Water Restore"),
  createOutOfModelAbilityEntry("Area Wind Blast"),
  {
    id: "ability_aura",
    name: "Aura",
    status: "Modeled",
    summary: "Applies a repeating aura ailment every 3 seconds.",
    mechanics: [
      "Aura effects tick every 3 seconds while they are active.",
      "The first tick happens 3 seconds after the fight starts or 3 seconds after the aura becomes active.",
      "Each tick applies 3 stacks of the corresponding ailment to the opponent.",
      "An aura is on from the first moment of the fight, and stays on unless it is switched off.",
      "Sandbox is the exception: the aura starts off there, and nothing ticks until it is switched on.",
    ],
    policyDifferences: [
      "Timing modes do not reach an aura: while it is on it ticks on its own cadence and nothing decides when.",
    ],
    notes: [
      "The timeline marks the aura as activated at the start of the fight rather than at its first tick, and can show the repeated ticks after it.",
      "The aura subtype selects which ailment is applied. The model resolves Disease, Corrosion, Burn, Radiation, Poison, Bleed, Frostbite and Necropoison subtypes.",
    ],
  },
  {
    id: "ability_berserk",
    name: "Berserk",
    status: "Modeled",
    summary: "Shortens the user's bite cooldown at low HP.",
    mechanics: [
      "Berserk is a passive ability that becomes active when the user's HP drops below 20%.",
      "While Berserk is active, the user's bite cooldown is multiplied by 0.5.",
    ],
    specConstants: [
      { key: "berserk_hp_gate_pct", value: 20, quote: "HP drops below 20%" },
      { key: "berserk_bite_cooldown_multiplier", value: 0.5, quote: "bite cooldown is multiplied by 0.5" },
    ],
    policyDifferences: [
      "Timing modes do not reach Berserk: it switches itself on and off as the HP condition changes.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_breath_resistance",
    name: "Breath Resistance",
    status: "Modeled",
    summary: "Reduces incoming breath damage.",
    mechanics: [
      "Raw breath damage = ((target max HP × (1 + min(attacker weight / defender weight, 3))) / 2 / 100) × dps_pct × 0.5.",
      "dps_pct is the breath ability's listed damage-per-second percentage. The 0.5 factor converts it to per-tick because breaths tick 2 times per second.",
      "The weight ratio is capped at 3:1, the same cap the melee weight formula uses, so a heavier attacker stops gaining past that point.",
      "Capacity is denominated in seconds of continuous fire: a breath with capacity N lasts N seconds before it empties, independent of damage tick frequency. Capacity drains at 1 unit per second of firing.",
      "Crit chance and chain stacks, when present, multiply the raw damage as additional factors before breath resistance is applied.",
      "Final breath damage = raw breath damage × (1 - Breath Resistance).",
      "It affects breath damage only and does not block breath-applied ailments or statuses.",
    ],
    policyDifferences: [
      "Timing modes do not reach Breath Resistance: it is always on.",
    ],
    notes: [],
  },
  createOutOfModelAbilityEntry("Burrower"),
  {
    id: "ability_cause_fear",
    name: "Cause Fear",
    status: "Modeled",
    summary: "Applies Fear immediately.",
    mechanics: [
      "Cause Fear applies 10 stacks of Fear immediately when it is used.",
      "It has a 120 second cooldown.",
    ],
    specConstants: [
      { key: "cause_fear_stacks", value: 10, quote: "applies 10 stacks of Fear" },
      { key: "cause_fear_cooldown_sec", value: 120, quote: "120 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Cause Fear the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
  createOutOfModelAbilityEntry("Change Weather"),
  createOutOfModelAbilityEntry("Channeling"),
  {
    id: "ability_charge",
    name: "Charge",
    status: "Partial",
    summary: "One ability with five kinds, of which Power and Gore change a fight and Launch, Throw and Crush do not.",
    mechanics: [
      "A creature carrying Charge carries one kind of it: Power, Gore, Launch, Crush or Throw.",
      "Power multiplies the charged hit by 1.5 and applies 2 stacks of Shredded Wings. See Power Charge.",
      "Gore leaves the charged hit at 1x and applies 2 stacks of Bleed and 9 stacks of Deep Wounds. See Gore Charge.",
      "Launch leaves the charged hit at 1x and applies 2 stacks of Confusion and 3 stacks of Torn Ligaments, both of which are tracked here and carry no combat effect.",
      "Throw leaves the charged hit at 1x and applies 1 stack of Shock, which is tracked here and carries no combat effect.",
      "Crush multiplies the charged hit by 0.5 and applies 8 stacks of Injury, which is tracked here and carries no combat effect.",
      "Launch, Throw and Crush have no setting of their own, so a fight runs as though their carrier did not charge.",
    ],
    policyDifferences: [],
    notes: [],
  },
  createOutOfModelAbilityEntry("Climber"),
  {
    id: "ability_cloud_breath",
    name: "Cloud Breath",
    status: "Modeled",
    summary: "Heals the user and keeps Muddy on it instead of dealing damage.",
    mechanics: [
      "Cloud Breath deals no damage.",
      "Capacity is 15 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 1.3 seconds while the breath is not firing, so a fully drained bar takes 19.5 seconds to refill.",
      "Cloud Breath ticks 2 times per second while it is firing.",
      "It heals the user for 1% of max HP per second while firing - the self-heal runs on the 1-second regen loop, not on the 2-per-second fire tick.",
      "Cloud Breath applies Muddy to the user for 2 seconds at a time. See Muddy for the regeneration it carries.",
      "Muddy lands on a fixed cadence that stands in for its 40% chance per tick rather than rolling it, and holds Muddy up 87% of the time the breath fires.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "The cadence is set from that uptime rather than from how often the roll fires, because a fixed cadence cannot reproduce both. Firing as often as the roll would apply Muddy for 2 seconds every 1.25 seconds, Muddy would never expire, and the regeneration bonus would be a flat 25% instead of the 21.8% it averages.",
    ],
  },
  {
    id: "ability_cocoon",
    name: "Cocoon",
    status: "Modeled",
    summary: "Three phases over about 30 seconds: five of ordinary fighting, five in which the user cannot act and direct damage is blocked, then a damage buff.",
    mechanics: [
      "Cocoon is a single-charge active with a 120 second cooldown.",
      "Phase 1 runs from 0 to 5 seconds.",
      "The user can bite and use other actives during Phase 1.",
      "The user's defensive ailments fire on incoming bites during Phase 1.",
      "The user still takes damage during Phase 1 and can die inside that window.",
      "Phase 2 runs from 5 to 10 seconds. Bites and breaths aimed at the user are blocked and status damage over time is zeroed, so nothing the opponent does directly reduces the user's HP.",
      "Area effects - Drowsy Area, Poison Area, Cursed Sigil, Divination, the damage trails and the Lance aura - still land on a user in Phase 2 and still apply their statuses.",
      "The user cannot bite or use other actives during Phase 2.",
      "Opponent bites scheduled during Phase 2 are pushed to the end of Phase 2.",
      "Bites that fall inside Phase 2 are rescheduled rather than landing, so the on-hit statuses, Power Charge, Gore Charge, Reflect and Life Leech those bites would have carried are all skipped.",
      "Normal exchanges resume at the end of Phase 2.",
      "A lump heal equal to 30% of max HP lands at the end of Phase 2. In game it arrives as +6% max HP per second across 5 seconds; the model gives the same total at once.",
      "Phase 3 begins once the Phase 2 heal lands and runs about 20 seconds. The user's melee bites deal +15% damage for as long as the Cocoon damage buff holds stacks.",
      "That buff starts at 6.66 stacks and its first decay tick is delayed 3 seconds into Phase 3, which is what stretches the window to roughly 20 seconds.",
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all activate Cocoon on one rule: HP at or below 70% with the cooldown clear.",
      "No mode carries an extra survival check: a user whose Phase 2 window looks lethal dies whether it cocoons or not.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_crystal_breath",
    name: "Crystal Breath",
    status: "Modeled",
    summary: "A 0.5x per-hit breath that applies Bleed, Injury and Shredded Wings on every tick.",
    mechanics: [
      "Crystal Breath deals damage 2 times per second while it is firing.",
      "Capacity is 10 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 1.8 seconds while the breath is not firing, so a fully drained bar takes 18 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.5 × 1.0 × (1 - breath resistance).",
      "Every damage tick applies 0.375 stacks of Bleed, 0.5 stacks of Injury and 0.5 stacks of Shredded Wings - the model does not roll Bleed's 75% chance for 0.5 stacks, Injury's 50% chance for 1 stack, or Shredded Wings' 50% chance for 1 stack, it applies the average of each roll.",
    ],
    specConstants: [
      { key: "crystal_breath_per_hit_multiplier", value: 0.5, quote: "/ 100) × 0.5 × 1.0 ×" },
      { key: "crystal_breath_crit_multiplier", value: 1.0, quote: "× 0.5 × 1.0 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Crystal Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Injury carries no combat effect of its own here. It lands as a negative status, which a cleanse can remove and which sitting or laying strips faster.",
      "Shredded Wings grounds the target, so an aerial target under it stops dodging.",
    ],
  },
  {
    id: "ability_cursed_sigil",
    name: "Cursed Sigil",
    status: "Modeled",
    summary: "Applies Bad Omen immediately.",
    mechanics: [
      "Cursed Sigil applies Bad Omen immediately when it is used.",
      "The number of applied Bad Omen stacks is the user's own Cursed Sigil value.",
      "It has an 85 second cooldown.",
    ],
    specConstants: [
      { key: "cursed_sigil_cooldown_sec", value: 85, quote: "85 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Cursed Sigil the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_damage_link",
    name: "Damage Link",
    status: "Not planned",
    summary: "A multi-creature ability whose effect needs a second creature on the user's side.",
    mechanics: [],
    whyItsNotModeledHere: [
      "Damage Link is left out for the same reason as the other multi-creature abilities.",
      "Its use cases are 2v1, 2v2 and similar fights, which the 1v1 stand-and-fight model has no way to express.",
    ],
    policyDifferences: [],
    notes: [],
  },
  createOutOfModelAbilityEntry("Dart"),
  createOutOfModelAbilityEntry("Dazzling Flash"),
  createOutOfModelAbilityEntry("Diver"),
  {
    id: "ability_divination",
    name: "Divination",
    status: "Modeled",
    summary: "Adds flat damage and Burn to the user's next 3 bites.",
    mechanics: [
      "When activated, Divination arms 3 bite charges.",
      "Each of the next 3 bites consumes one charge, adds +50 flat damage to that bite, and applies 2 stacks of Burn to the target.",
      "Charges are consumed only by landed bites. Remaining charges persist until consumed.",
      "It has a 120 second cooldown, counted from the activation moment.",
      "Divination cannot be re-armed while charges are still unspent.",
      "The flat +50 damage is added after every multiplier on the user's side - the melee multipliers, the sit/lay posture multiplier and the user's own Hunker - and none of them scale it.",
      "The opponent's Hunker reduction does apply to it, because that reduction lands on the whole bite after the flat term has joined it.",
    ],
    specConstants: [
      { key: "divination_bite_charges", value: 3, quote: "arms 3 bite charges" },
      { key: "divination_flat_damage", value: 50, quote: "adds +50 flat damage" },
      { key: "divination_burn_stacks", value: 2, quote: "applies 2 stacks of Burn" },
      { key: "divination_cooldown_sec", value: 120, quote: "120 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all arm Divination the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_drowsy_area",
    name: "Drowsy Area",
    status: "Modeled",
    summary: "Applies Drowsy immediately.",
    mechanics: [
      "Drowsy Area applies 5 stacks of Drowsy immediately when it is used.",
      "It has a 60 second cooldown.",
    ],
    specConstants: [
      { key: "drowsy_area_stacks", value: 5, quote: "applies 5 stacks of Drowsy" },
      { key: "drowsy_area_cooldown_sec", value: 60, quote: "60 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Drowsy Area the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
  createOutOfModelAbilityEntry("Earthquake"),
  createOutOfModelAbilityEntry("Egg Stealer"),
  {
    id: "ability_energy_breath",
    name: "Energy Breath",
    status: "Modeled",
    summary: "Uses chained breath damage that ramps up while it keeps firing.",
    mechanics: [
      "Energy Breath deals damage 2 times per second while it is firing.",
      "Capacity is 8 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 5 seconds while the breath is not firing, so a fully drained bar takes 40 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.225 × 1.0 × chain multiplier × (1 - breath resistance).",
      "Its chain multiplier starts ramping immediately while the breath keeps firing.",
      "Each breath tick applies the multiplier 1 + (1.0 × current chain stacks) and then adds 1 chain stack, up to 10 stacks.",
      "That means the first chained tick is 1.0x (0 stacks) and the multiplier ramps up to 11.0x at 10 stacks.",
      "Chain stacks do not decay. They reset to 0 the moment a firing run stops, so the ramp starts over on the next burst.",
      "Every damage tick applies 0.25 stacks of Slowed - the model does not roll Slowed's 25% chance with no stacking, it applies the average of that roll.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
      "Because the ramp resets on every break in fire, Energy Breath defaults to firing on a full bar rather than tapping whenever capacity allows.",
    ],
    notes: [
      "Energy Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Slowed moves speed, which the stand-and-fight model does not carry, so it lands with no combat effect of its own. It is still a negative status that a cleanse can remove and that sitting or laying strips faster.",
    ],
  },
  {
    id: "ability_escape_area",
    movesSpeed: true,
    name: "Escape Area",
    status: "Speed-Builds-only",
    summary: "Multiplies every movement speed by 1.75.",
    mechanics: [
      "Escape Area multiplies walk, swim, sprint and flight speed by 1.75.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "ability_expunge",
    name: "Expunge",
    status: "Modeled",
    summary: "On the user's next bite, erases all Bleed on the target to deal bonus damage and heal the user.",
    mechanics: [
      "Expunge is tied to the user's next bite. When it fires, all Bleed stacks on the target are erased and the bite deals final damage = D_normal × (1 + 0.05 × bleed_stacks), where D_normal is the bite that would have landed without Expunge - weight- and posture-scaled, after mitigation, before the on-attack bonuses - and bleed_stacks is the Bleed count erased.",
      "On the same bite, the user is healed for 0.5 × D_normal × 0.05 × bleed_stacks, using the same two quantities - D_normal is the normal bite's landed damage (weight- and posture-scaled, after mitigation), the same base the bonus damage multiplies, before the Expunge bonus and other on-attack bonuses.",
      "Cooldown is 45 seconds and starts when the bonus bite lands.",
      "Bleed stacks are read from the target at bite time, no rounding.",
      "The target must carry at least 1 full Bleed stack. Below that the ability does not fire and starts no cooldown, so a fractional stack is held rather than spent.",
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all decide Expunge by one rule: fire only when the bite yields unambiguous net benefit.",
      "Kill-secure: fires if the normal bite would not kill the target but the bonus bite would.",
      "Heal-save: fires if the user would otherwise die to the opponent's projected damage during the next bite cooldown, and the Expunge heal (plus a 5% max-HP safety margin) keeps them alive.",
      "Otherwise the charge is held: casting without a target above the threshold removes the passive Bleed damage the charge would have dealt later and applies nothing in its place.",
    ],
    notes: [
      "Healing scales with the landed normal bite, not the raw base-attack stat: in-game Expunge heals half of the extra damage it adds, and that extra is D_normal × 0.05 × bleed. On-attack bonuses (Spite, Power Charge, Divination) are not part of D_normal, matching the reflected-hit base.",
      "Bleed on the target is cleared immediately when Expunge fires, whether or not the user is still alive after counter-hits in the same tick.",
    ],
  },
  {
    id: "ability_fire_breath",
    name: "Fire Breath",
    status: "Modeled",
    summary: "A 0.5x per-hit breath that carries Burn and nothing else.",
    mechanics: [
      "Fire Breath deals damage 2 times per second while it is firing.",
      "Capacity is 20 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 1.5 seconds while the breath is not firing, so a fully drained bar takes 30 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.5 × 1.125 × (1 - breath resistance).",
      "Every damage tick applies 0.375 stacks of Burn - the model does not roll Burn's 75% chance for 0.5 stacks, it applies the average of that roll.",
    ],
    specConstants: [
      { key: "fire_breath_per_hit_multiplier", value: 0.5, quote: "/ 100) × 0.5 × 1.125 ×" },
      { key: "fire_breath_crit_multiplier", value: 1.125, quote: "× 0.5 × 1.125 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Fire Breath uses a 25% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.125x instead of random crit rolls.",
    ],
  },
  {
    id: "ability_first_strike",
    name: "First Strike",
    status: "Modeled",
    summary: "Increases the user's melee damage while its HP is at or above 75% of max HP.",
    mechanics: [
      "First Strike applies while the user's HP is at or above 75% of max HP.",
      "While it is active, the user's melee damage is multiplied by 1 + First Strike value.",
      "For example, First Strike 0.25 means melee damage is multiplied by 1.25.",
      "It raises melee damage only and does not increase breath damage.",
    ],
    specConstants: [
      { key: "first_strike_hp_gate_pct", value: 75, quote: "at or above 75%" },
    ],
    policyDifferences: [
      "Timing modes do not reach First Strike: it switches itself on and off as the HP condition changes.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_flame_trail",
    name: "Flame Trail",
    status: "Modeled",
    summary: "Passive trail that damages the opponent and applies Burn every 2 seconds while the user's HP is at or below the ability's value.",
    mechanics: [
      "In Compare, Flame Trail runs only with the Trails rule turned on for the user.",
      "Flame Trail activates while the user's current HP is at or below the ability's value, read as a fraction of max HP - value 50 means 50% HP.",
      "While active, every 2 seconds the opponent takes damage equal to 2% of their max HP.",
      "Each of those ticks also applies 2 stacks of Burn.",
      "The damage is measured against the opponent's max HP, not the user's.",
      "Only one trail segment is modeled, and it is treated as eternal while the HP threshold holds. Segment despawn is not simulated.",
      "Several trail abilities on one user all activate together, each against its own HP threshold.",
      "While any of the user's trail abilities is active, No Move Facetank is forced off.",
      "The previous No Move Facetank setting returns as soon as no trail is active.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "ability_fortify",
    name: "Fortify",
    status: "Modeled",
    summary: "Cleanses the user's removable negative statuses, then gives a 9 second status immunity window and a 5% weight bonus.",
    mechanics: [
      "Fortify removes every negative status on the user that is not permanent. Positive and neutral statuses stay.",
      "This explicitly includes Aftershock, Ashy Lungs, Bad Omen, Bleed, Broken Legs, Burn, Confusion, Corrosion, Deep Wounds, Disease, Drowsy, Fear, Freeze, Frostbite, Heartbroken, Injury, Necropoison, Paralyze, Poison, and Radiation.",
      "It also removes any other active negative status the model treats as damage over time, or as a debuff to healing, bite cooldown, damage or weight.",
      "After activation, Fortify gives status immunity for 9 seconds.",
      "During that same 9 second window, it also gives a 5% weight bonus.",
      "Fortify has a 90 second cooldown.",
      "Activation needs something to remove. With no removable negative status on the user, Fortify does not fire at all: no cleanse, no immunity, no weight bonus, and no cooldown spent.",
      "A permanent instance survives the cleanse whatever it is: the weather statuses Acid Rain, Heat Wave and Hypothermia, Storming, and the Sickly that Defiled Ground keeps re-applying.",
      "They do not count toward activation either, so a user carrying nothing but permanent negatives cannot fire Fortify at all.",
    ],
    specConstants: [
      { key: "fortify_cooldown_sec", value: 90, quote: "90 second cooldown" },
    ],
    policyDifferences: [
      "Really fast holds Fortify for the first 8 seconds of the fight, then fires it once the user carries at least 15 removable negative stacks.",
      "Fast makes the same comparison over three delays - 0, 1 and 3 seconds - and semi-ideal, ideal and extreme make it over more. See Semi-ideal, Ideal, and Extreme.",
      "Semi-ideal, ideal, and extreme replay the fight forward to weigh firing Fortify now against carrying the current statuses longer.",
    ],
    notes: [
      "If Fortify immunity is active, new negative statuses are blocked during that window.",
    ],
  },
  {
    id: "ability_frost_nova",
    name: "Frost Nova",
    status: "Modeled",
    summary: "Applies Frostbite over time after activation.",
    mechanics: [
      "Frost Nova lasts for 15 seconds.",
      "The first Frost Nova tick happens 3 seconds after activation.",
      "While Frost Nova is active, it applies 3 stacks of Frostbite every 3 seconds.",
      "It has a 60 second cooldown.",
    ],
    specConstants: [
      { key: "frost_nova_frostbite_stacks", value: 3, quote: "applies 3 stacks of Frostbite" },
      { key: "frost_nova_duration_sec", value: 15, quote: "lasts for 15 seconds" },
      { key: "frost_nova_cooldown_sec", value: 60, quote: "60 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Frost Nova the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_frost_snare",
    name: "Frost Snare",
    status: "Modeled",
    summary: "Applies an immediate Frostbite burst.",
    mechanics: [
      "Frost Snare applies 5 stacks of Frostbite immediately when it is used.",
      "It has a 205 second cooldown.",
    ],
    specConstants: [
      { key: "frost_snare_frostbite_stacks", value: 5, quote: "applies 5 stacks of Frostbite" },
      { key: "frost_snare_cooldown_sec", value: 205, quote: "205 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Frost Snare the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_frost_trail",
    name: "Frost Trail",
    status: "Modeled",
    summary: "Passive trail that damages the opponent and applies Frostbite every 2 seconds while the user's HP is at or below the ability's value.",
    mechanics: [
      "In Compare, Frost Trail runs only with the Trails rule turned on for the user.",
      "Frost Trail activates while the user's current HP is at or below the ability's value, read as a fraction of max HP - value 50 means 50% HP.",
      "While active, every 2 seconds the opponent takes damage equal to 2% of their max HP.",
      "Each of those ticks also applies 2 stacks of Frostbite.",
      "The damage is measured against the opponent's max HP, not the user's.",
      "Only one trail segment is modeled, and it is treated as eternal while the HP threshold holds. Segment despawn is not simulated.",
      "Several trail abilities on one user all activate together, each against its own HP threshold.",
      "While any of the user's trail abilities is active, No Move Facetank is forced off.",
      "The previous No Move Facetank setting returns as soon as no trail is active.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "ability_glacier_breath",
    name: "Glacier Breath",
    status: "Modeled",
    summary: "Uses chained breath damage with a light ramp and high pseudo-crit.",
    mechanics: [
      "Glacier Breath deals damage 2 times per second while it is firing.",
      "Capacity is 10 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 4.5 seconds while the breath is not firing, so a fully drained bar takes 45 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 1.0 × 1.175 × chain multiplier × (1 - breath resistance).",
      "Each breath tick applies the multiplier 1 + (0.05 × current chain stacks) and then adds 1 chain stack, up to 10 stacks.",
      "That means the first chained tick is 1.0x (0 stacks) and the multiplier ramps up to 1.5x at 10 stacks.",
      "Chain stacks do not decay. They reset to 0 the moment a firing run stops, so the ramp starts over on the next burst.",
      "Every damage tick applies 0.15 stacks of Slowed, 0.3 stacks of Injury and 0.05 stacks of Freeze - the model does not roll Slowed's 15% chance with no stacking, Injury's 30% chance for 1 stack or Freeze's 5% chance with no stacking, it applies the average of those rolls.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
      "Because the ramp resets on every break in fire, Glacier Breath defaults to firing on a full bar rather than tapping whenever capacity allows.",
    ],
    notes: [
      "Glacier Breath uses a 35% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.175x instead of random crit rolls.",
      "Slowed, Injury and Freeze carry no combat effect of their own here. They land as negative statuses, which a cleanse can remove and which sitting or laying strips faster.",
    ],
  },
  createOutOfModelAbilityEntry("Gale"),
  createOutOfModelAbilityEntry("Genesis Tether"),
  createOutOfModelAbilityEntry("Glittering Trail"),
  {
    id: "ability_gold_breath",
    name: "Gold Breath",
    status: "Modeled",
    summary: "A 0.25x per-hit breath whose Blurred Vision and Freeze both land with no combat effect of their own.",
    mechanics: [
      "Gold Breath deals damage 2 times per second while it is firing.",
      "Capacity is 20 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 0.75 seconds while the breath is not firing, so a fully drained bar takes 15 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.25 × 1.0 × (1 - breath resistance).",
      "Every damage tick applies 0.3 stacks of Blurred Vision and 0.05 stacks of Freeze - the model does not roll Blurred Vision's 30% chance with no stacking or Freeze's 5% chance with no stacking, it applies the average of each roll.",
    ],
    specConstants: [
      { key: "gold_breath_per_hit_multiplier", value: 0.25, quote: "/ 100) × 0.25 × 1.0 ×" },
      { key: "gold_breath_crit_multiplier", value: 1.0, quote: "× 0.25 × 1.0 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Gold Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Blurred Vision and Freeze carry no combat effect of their own here. They land as negative statuses, which a cleanse can remove and which sitting or laying strips faster.",
    ],
  },
  {
    id: "compare_gourmandizer",
    movesSpeed: true,
    name: "Gourmandizer",
    status: "Modeled",
    summary: "Gives the user weight and costs it movement speed as appetite fill rises above 100%.",
    mechanics: [
      "Gourmandizer gives a weight bonus based on appetite fill above 100%.",
      "That bonus scales linearly from +0% at 100% fill to +15% at 125% fill.",
      "The fill a fight starts at is set per side rather than read off the creature, because nothing before the fight decides how full it ate.",
      "Without hunger rules, that starting fill holds for the whole fight.",
      "With hunger rules on, the bonus updates from the current fill as the meter drains.",
      "Over the same window Gourmandizer also multiplies the user's walk, swim, sprint and flight speeds, ramping linearly from 1 at 100% fill to 0.925 at 125% fill.",
      "At or below 100% fill Gourmandizer does nothing at all.",
    ],
    policyDifferences: [
      "Timing modes do not reach Gourmandizer: the bonus follows the appetite meter, and nothing decides when to take it.",
    ],
    notes: [
      "Gourmandizer's speed side reaches Speed Builds and not Compare; only the weight bonus reaches a fight.",
      "See Hunger and thirst for the drain the meter follows when that rule is on.",
    ],
  },
  createOutOfModelAbilityEntry("Grab"),
  {
    id: "ability_green_fire_breath",
    name: "Green Fire Breath",
    status: "Modeled",
    summary: "A 0.5x per-hit breath that carries Burn and nothing else.",
    mechanics: [
      "Green Fire Breath deals damage 2 times per second while it is firing.",
      "Capacity is 20 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 1.5 seconds while the breath is not firing, so a fully drained bar takes 30 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.5 × 1.125 × (1 - breath resistance).",
      "Every damage tick applies 0.375 stacks of Burn - the model does not roll Burn's 75% chance for 0.5 stacks, it applies the average of that roll.",
    ],
    specConstants: [
      { key: "green_fire_breath_per_hit_multiplier", value: 0.5, quote: "/ 100) × 0.5 × 1.125 ×" },
      { key: "green_fire_breath_crit_multiplier", value: 1.125, quote: "× 0.5 × 1.125 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Green Fire Breath uses a 25% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.125x instead of random crit rolls.",
    ],
  },
  {
    id: "ability_grim_lariat",
    name: "Grim Lariat",
    status: "Modeled",
    summary: "Deals an immediate damage burst and applies Heartbroken.",
    mechanics: [
      "Grim Lariat deals damage equal to 50% of the user's current damage.",
      "That reads the build's damage stat after traits, plushies and Two-Faced. It is not the fully buffed bite: the weight ratio, First Strike and the timed damage buffs do not feed it.",
      "It also applies 8 stacks of Heartbroken.",
      "It has a 60 second cooldown.",
    ],
    specConstants: [
      { key: "grim_lariat_damage_pct_user_damage", value: 50, quote: "50% of the user's current damage" },
      { key: "grim_lariat_heartbroken_stacks", value: 8, quote: "applies 8 stacks of Heartbroken" },
      { key: "grim_lariat_cooldown_sec", value: 60, quote: "60 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Grim Lariat the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_guardians_passage",
    movesSpeed: true,
    name: "Guardians Passage",
    status: "Modeled",
    summary: "Applies Guardian's Seal to the user for 9 seconds, on a 300 second cooldown.",
    mechanics: [
      "Guardians Passage has a 300 second cooldown.",
      "Using it applies 3 stacks of Guardian's Seal to the user.",
      "The seal outlasts the channel: the 3 stacks decay over 9 seconds, the channel itself runs for 6 seconds.",
    ],
    specConstants: [
      { key: "guardians_passage_cooldown_sec", value: 300, quote: "300 second cooldown" },
      { key: "guardians_passage_seal_stacks", value: 3, quote: "applies 3 stacks of Guardian's Seal" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all use Guardians Passage the moment its cooldown is ready.",
    ],
    notes: [
      "See Guardian's Seal for what those 3 stacks do while they last, and Guardians Passage in Movement Speed for the slow the channel carries.",
      "In game the ability also seals a chosen packmate, and a one-on-one fight has no packmate to seal.",
      "The slow reaches Speed Builds and not Compare - the combat model has no positioning for a movement penalty to act on.",
    ],
  },
  {
    id: "ability_guilt",
    name: "Guilt",
    status: "Modeled",
    summary: "Reduces damage taken from bites and breaths.",
    mechanics: [
      "Guilt reduces incoming damage by 50%.",
      "The reduction covers direct bite damage and direct breath damage alike.",
    ],
    specConstants: [
      { key: "guilt_incoming_damage_reduction_pct", value: 50, quote: "reduces incoming damage by 50%" },
    ],
    policyDifferences: [
      "Timing modes do not reach Guilt: it is always on.",
    ],
    notes: [
      "In game, Guilt also grants the user Adrenaline when hit. That self-buff is not modeled here.",
    ],
  },
  {
    id: "ability_harden",
    movesSpeed: true,
    name: "Harden",
    status: "Modeled",
    summary: "Temporarily increases the user's effective combat weight and passive health regeneration, at the cost of movement speed.",
    mechanics: [
      "Harden lasts for 30 seconds.",
      "Its base cooldown is 120 seconds.",
      "While Harden is active, the user's effective combat weight is multiplied by 1.35.",
      "While Harden is active, passive health regeneration is multiplied by 1.25.",
      "Breath damage scales on the user's weight, so the same 1.35x raises the user's breath damage as well.",
      "While Harden is active, the user's walk, swim, sprint and flight speeds are multiplied by 0.8.",
    ],
    specConstants: [
      { key: "harden_duration_sec", value: 30, quote: "lasts for 30 seconds" },
      { key: "harden_cooldown_sec", value: 120, quote: "base cooldown is 120 seconds" },
      { key: "harden_weight_bonus_multiplier", value: 1.35, quote: "effective combat weight is multiplied by 1.35" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Harden the moment its cooldown is ready.",
    ],
    notes: [
      "Harden's speed cost reaches Speed Builds and not Compare, so a fight applies the weight and the regeneration and not the slow.",
    ],
  },
  {
    id: "ability_haunt_breath",
    name: "Haunt Breath",
    status: "Modeled",
    summary: "A 0.75x per-hit breath that applies Poison on every tick, with Shock and Tunnel Vision at much smaller rates.",
    mechanics: [
      "Haunt Breath deals damage 2 times per second while it is firing.",
      "Capacity is 10 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 2.5 seconds while the breath is not firing, so a fully drained bar takes 25 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.75 × 1.175 × (1 - breath resistance).",
      "Every damage tick applies 0.75 stacks of Poison, 0.05 stacks of Shock and 0.125 stacks of Tunnel Vision - the model does not roll Poison's 75% chance for 1 stack, Shock's 10% chance for 0.5 stacks, or Tunnel Vision's 25% chance for 0.5 stacks, it applies the average of each roll.",
    ],
    specConstants: [
      { key: "haunt_breath_per_hit_multiplier", value: 0.75, quote: "/ 100) × 0.75 × 1.175 ×" },
      { key: "haunt_breath_crit_multiplier", value: 1.175, quote: "× 0.75 × 1.175 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Haunt Breath uses a 35% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.175x instead of random crit rolls.",
      "Shock and Tunnel Vision carry no combat effect of their own here. They land as negative statuses, which a cleanse can remove and which sitting or laying strips faster.",
    ],
  },
  {
    id: "ability_heal_aura",
    name: "Heal Aura",
    status: "Not planned",
    summary: "An aura that heals both sides of the fight rather than only the user.",
    mechanics: [],
    whyItsNotModeledHere: [
      "In game, this ability affects both sides rather than only helping the user, so it is not treated as a normal one-sided combat effect.",
      "A heal that lands on both sides changes each side's survival by an amount that depends on which side is ahead, and a 1v1 fight has no way to say who the aura was meant to help.",
    ],
    policyDifferences: [],
    notes: [],
  },
  createOutOfModelAbilityEntry("Heal Beam"),
  {
    id: "ability_heal_breath",
    name: "Heal Breath",
    status: "Modeled",
    summary: "Provides self-healing and partial self-cleansing instead of damage.",
    mechanics: [
      "Heal Breath deals no damage.",
      "Capacity is 10 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 5 seconds while the breath is not firing, so a fully drained bar takes 50 seconds to refill.",
      "Heal Breath ticks 2 times per second while it is firing.",
      "It heals the user for 3% of max HP per second while firing - the self-heal runs on the 1-second regen loop, not on the 2-per-second fire tick.",
      "Each fire tick also removes 0.5 stacks of removable negative statuses from the user (the cleanse stays on the fire tick).",
      "That cleanse works in a fixed order: Poison, Burn, Bleed, then Corrosion.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [],
  },
  createOutOfModelAbilityEntry("Healing Hunter"),
  {
    id: "ability_healing_step",
    name: "Healing Step",
    status: "Modeled",
    summary: "Passive step that heals the user every 2 seconds while its HP is at or below 65% of max HP.",
    mechanics: [
      "In Compare, Healing Step runs only with the Trails rule turned on for the user.",
      "Healing Step activates while the user's current HP is at or below 65% of max HP. Unlike the trails, that threshold is fixed rather than read from the ability's value.",
      "While active, every 2 seconds the user heals the ability's value as a percentage of max HP - value 5 heals 5% of max HP per tick.",
      "The heal is measured against max HP, not current HP.",
      "Healing Step heals only the user.",
      "Only one segment is modeled, and it is treated as eternal while the HP threshold holds. Segment despawn and the maximum segment count are not simulated.",
      "While any of the user's trail or step abilities is active, No Move Facetank is forced off.",
      "The previous No Move Facetank setting returns as soon as none of them is active.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "ability_heliolyths_judgement",
    name: "Heliolyth's Judgement",
    status: "Modeled",
    summary: "Auto-fire breath that deals true damage based on the target's max HP.",
    mechanics: [
      "Heliolyth's Judgement deals damage 2 times per second while it is firing.",
      "Per-tick damage equals 1.6% of the target's max HP.",
      "Breath resistance and weight scaling do not modify Heliolyth's Judgement damage.",
      "Capacity is 10 seconds of firing. Once Heliolyth's Judgement starts it fires until the bar is empty.",
      "It has a 3 second startup delay before firing begins.",
      "It has a 120 second cooldown instead of a capacity that refills.",
    ],
    specConstants: [
      { key: "heliolyths_judgement_pct_max_hp", value: 1.6, quote: "1.6% of the target's max HP" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_hunker",
    movesSpeed: true,
    name: "Hunker",
    status: "Modeled",
    summary: "Halves the user's melee and breath damage while reducing the direct damage it takes.",
    mechanics: [
      "While Hunker is on, the user's melee damage is multiplied by 0.5.",
      "The same 0.5x lands on the user's outgoing breath damage, with Energy Breath the single exception.",
      "While Hunker is on, incoming direct damage is reduced by the user's Hunker value.",
      "For example, Hunker 40 reduces incoming direct damage by 40%.",
      "This incoming reduction applies to direct bite damage and direct breath damage.",
      "While Hunker is on, the user's walk, swim and sprint speeds are multiplied by 0.75.",
      "Hunker has no timed window and no cooldown. It stays on until the policy turns it off or actives are disabled.",
      "If Hunker is turned off and then back on, the new Hunker effect takes 5 seconds to take hold; the very first activation in a fight has no delay.",
    ],
    policyDifferences: [
      "Really fast turns Hunker on immediately and keeps it on.",
      "Fast also turns Hunker on immediately and keeps it on.",
      "Semi-ideal, ideal, and extreme can leave Hunker off, turn it on, or turn it back off depending on the current tradeoff between survivability and damage.",
      "Semi-ideal, ideal and extreme replay the fight twice - once with Hunker held on for the window ahead, once with it held off - and keep whichever ends with the user further ahead.",
    ],
    notes: [
      "Hunker's speed cost reaches Speed Builds and not Compare, so a fight applies the damage reduction and not the slow.",
    ],
  },
  {
    id: "ability_hunters_curse",
    name: "Hunters Curse",
    status: "Modeled",
    summary: "Costs half of the user's max HP to activate, then temporarily doubles melee damage.",
    mechanics: [
      "Hunters Curse lasts for 30 seconds.",
      "It has a 120 second cooldown.",
      "It cannot be used while the user's current HP is below 50% of max HP.",
      "When it is activated, the user immediately loses 50% of its max HP as a flat cost with no floor, so activating at exactly 50% HP kills the user.",
      "Unbreakable caps that self-cost like any other damage source, so a user carrying Unbreakable survives the same activation.",
      "While Hunters Curse is active, the user's melee damage is multiplied by 2.",
      "It boosts melee damage only and does not increase breath damage.",
    ],
    specConstants: [
      { key: "hunters_curse_duration_sec", value: 30, quote: "lasts for 30 seconds" },
      { key: "hunters_curse_cooldown_sec", value: 120, quote: "120 second cooldown" },
      { key: "hunters_curse_hp_cost_pct", value: 50, quote: "loses 50% of its max HP" },
      { key: "hunters_curse_bite_multiplier", value: 2, quote: "melee damage is multiplied by 2" },
    ],
    policyDifferences: [
      "Really fast and fast use Hunters Curse as soon as it is available: off cooldown, with the user at or above 50% of max HP.",
      "Semi-ideal, ideal and extreme cast on the same terms and add one: they skip the cast when the 50% max HP cost, plus the damage the opponent deals over the 30 seconds that follow, would kill the user first.",
      "No mode delays a cast once its conditions hold. The extra damage the buff adds only falls as the fight goes on, so a later cast is never the better of the two.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_ice_breath",
    name: "Ice Breath",
    status: "Modeled",
    summary: "A 0.5x per-hit breath that applies Frostbite and Slowed on every tick, of which only Frostbite acts here.",
    mechanics: [
      "Ice Breath deals damage 2 times per second while it is firing.",
      "Capacity is 10 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 3.75 seconds while the breath is not firing, so a fully drained bar takes 37.5 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.5 × 1.0 × (1 - breath resistance).",
      "Every damage tick applies 0.4 stacks of Slowed and 0.375 stacks of Frostbite - the model does not roll Slowed's 40% chance with no stacking or Frostbite's 75% chance for 0.5 stacks, it applies the average of each roll.",
    ],
    specConstants: [
      { key: "ice_breath_per_hit_multiplier", value: 0.5, quote: "/ 100) × 0.5 × 1.0 ×" },
      { key: "ice_breath_crit_multiplier", value: 1.0, quote: "× 0.5 × 1.0 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Ice Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Slowed moves speed, which the stand-and-fight model does not carry, so it lands with no combat effect of its own. It is still a negative status that a cleanse can remove and that sitting or laying strips faster.",
    ],
  },
  {
    id: "ability_ink_cloud",
    movesSpeed: true,
    name: "Ink Cloud",
    status: "Speed-Builds-only",
    summary: "Multiplies every movement speed by 1.75.",
    mechanics: [
      "Ink Cloud multiplies walk, swim, sprint and flight speed by 1.75.",
    ],
    policyDifferences: [],
    notes: [],
  },
  createOutOfModelAbilityEntry("Invisibility"),
  createOutOfModelAbilityEntry("Iron Stomach"),
  createOutOfModelAbilityEntry("Keen Observer"),
  {
    id: "ability_lance",
    name: "Lance",
    status: "Modeled",
    summary: "Deals a delayed impact hit and then starts a short aura.",
    mechanics: [
      "Lance does not use the normal repeated breath-damage formula.",
      "When it becomes available, it first arms for 3 seconds.",
      "When that charge finishes, it deals an immediate impact hit for 5% of the target's max HP.",
      "That impact also applies 2 stacks of Slowed.",
      "After the impact, Lance starts a 5 second aura.",
      "That aura ticks once per second.",
      "Each aura tick deals 1% of the target's max HP and applies 1 stack of the user's carrier-specific Lance ailment.",
      "Both the impact and each aura tick are weight-lerped: the base percentage is multiplied by 0.5 + 0.5 × clamp(attacker weight / defender weight, 0, 3) × posture, where posture is 1 standing, 1.5 sitting and 2 laying.",
      "That product is then capped at the base percentage, so weight and posture can only cut Lance down, never push it past 5% or 1%.",
      "Lance has a 60 second cooldown.",
    ],
    specConstants: [
      { key: "lance_primary_pct_max_hp", value: 5, quote: "impact hit for 5% of the target's max HP" },
      { key: "lance_secondary_pct_max_hp", value: 1, quote: "deals 1% of the target's max HP" },
      { key: "lance_cooldown_sec", value: 60, quote: "60 second cooldown" },
    ],
    policyDifferences: [
      "No timing mode decides when Lance fires: it is built as a breath, and breaths run outside the five modes.",
    ],
    notes: [
    ],
  },
  createOutOfModelAbilityEntry("Latch"),
  {
    id: "ability_lich_mark",
    name: "Lich Mark",
    status: "Modeled",
    summary: "Arms a short melee-only mark window, then converts that mark into a species-specific payload status on the next melee hit.",
    mechanics: [
      "Lich Mark is a melee-only active ability. Breath does not arm it and breath hits do not trigger it.",
      "When the cooldown is ready, Lich Mark arms for 5 seconds.",
      "The first melee hit during that armed window applies a pending Lich Mark to the target.",
      "The next melee hit removes that pending mark and replaces it with 5 stacks of the user's species-specific payload status.",
      "The payloads are Blessing's Boon, Malice's Mark, Slowed, Drowsy, Necropoison, Poison, Bad Omen, Water Regeneration, Flowering, Broken Bones, Stolen Speed, Blurred Vision, and Gale.",
      "Lich Mark has a 30 second cooldown.",
      "If the target still has remaining stacks from the previous Lich Mark-owned payload, only that owned portion is cleared before a fresh 5-stack payload is applied.",
    ],
    specConstants: [
      { key: "lich_mark_cooldown_sec", value: 30, quote: "30 second cooldown" },
    ],
    policyDifferences: [
      "Timing modes do not reach Lich Mark: it re-arms itself whenever its cooldown is ready.",
    ],
    notes: [
      "Bad Omen, Blessing's Boon, Drowsy, Malice's Mark, Necropoison and Poison have entries of their own. The remaining seven payloads have none.",
    ],
  },
  {
    id: "ability_life_leech",
    name: "Life Leech",
    status: "Modeled",
    summary: "Creates a timed window in which part of the user's direct damage is returned to it as healing.",
    mechanics: [
      "Life Leech lasts for 12 seconds.",
      "It has a 60 second cooldown.",
      "Healing is based on direct damage dealt during the active window.",
      "The share returned is the user's own Life Leech value, taken straight as a fraction of that damage: Life Leech 0.5 heals for half of every direct hit.",
      "This includes direct bite damage and direct breath damage.",
      "Healing is limited by the user's missing HP.",
    ],
    specConstants: [
      { key: "life_leech_duration_sec", value: 12, quote: "lasts for 12 seconds" },
    ],
    policyDifferences: [
      "Really fast casts as soon as the ability is ready, and only below 85% HP.",
      "Fast, semi-ideal, ideal and extreme score the same quantity - the healing Life Leech is projected to return over the rest of the fight - and keep the delay that scores highest.",
      "They differ only in how many delays they weigh: three under fast, six under semi-ideal, eleven under ideal, and about two hundred under extreme. See Semi-ideal, Ideal, and Extreme.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_ligament_tear",
    name: "Ligament Tear",
    status: "Modeled",
    summary: "Applies Torn Ligaments.",
    mechanics: [
      "On an offensive carrier, Ligament Tear applies Torn Ligaments to the target when the user lands a bite.",
      "Breath does not trigger Ligament Tear.",
      "On a defensive carrier it runs the other way, applying Torn Ligaments to the attacker when the user is bitten.",
      "The number of stacks applied is the user's own Ligament Tear value.",
    ],
    policyDifferences: [],
    notes: [
      "The timeline shows the applied effect as Torn Ligaments, not a separate Ligament Tear event.",
    ],
  },
  {
    id: "ability_lightning_breath",
    name: "Lightning Breath",
    status: "Modeled",
    summary: "Uses heavy chained breath damage with a high pseudo-crit.",
    mechanics: [
      "Lightning Breath deals damage 2 times per second while it is firing.",
      "Capacity is 5 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 12 seconds while the breath is not firing, so a fully drained bar takes 60 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 1.5 × 1.25 × chain multiplier × (1 - breath resistance).",
      "Each breath tick applies the multiplier 1 + (0.25 × current chain stacks) and then adds 1 chain stack, up to 5 stacks.",
      "That means the first chained tick is 1.0x (0 stacks) and the multiplier ramps up to 2.25x at 5 stacks.",
      "Chain stacks do not decay. They reset to 0 the moment a firing run stops, so the ramp starts over on the next burst.",
      "Every damage tick applies 0.5 stacks of Shock - the model does not roll Shock's 50% chance with no stacking, it applies the average of that roll.",
    ],
    specConstants: [
      { key: "lightning_breath_per_hit_multiplier", value: 1.5, quote: "/ 100) × 1.5 × 1.25 ×" },
      { key: "lightning_breath_crit_multiplier", value: 1.25, quote: "× 1.5 × 1.25 × chain multiplier ×" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
      "Because the ramp resets on every break in fire, Lightning Breath defaults to firing on a full bar rather than tapping whenever capacity allows.",
    ],
    notes: [
      "Lightning Breath uses a 50% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.25x instead of random crit rolls.",
      "Shock disorients movement, which the stand-and-fight model does not carry, so it lands with no combat effect of its own. It is still a negative status that a cleanse can remove and that sitting or laying strips faster.",
    ],
  },
  createOutOfModelAbilityEntry("Lure"),
  {
    id: "ability_miasma_breath",
    name: "Miasma Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and also heals the user.",
    mechanics: [
      "Miasma Breath deals damage 2 times per second while it is firing.",
      "Capacity is 10 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 2.5 seconds while the breath is not firing, so a fully drained bar takes 25 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.25 × 1.125 × (1 - breath resistance).",
      "Miasma Breath also heals the user for 0.5% of max HP per second while firing - the damage is on the 2-per-second fire tick, but the self-heal runs on the 1-second regen loop.",
    ],
    specConstants: [
      { key: "miasma_breath_per_hit_multiplier", value: 0.25, quote: "/ 100) × 0.25 × 1.125 ×" },
      { key: "miasma_breath_crit_multiplier", value: 1.125, quote: "× 0.25 × 1.125 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Miasma Breath uses a 25% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.125x instead of random crit rolls.",
    ],
  },
  createOutOfModelAbilityEntry("Moon Beam"),
  createOutOfModelAbilityEntry("Overcharged"),
  {
    id: "ability_plague_breath",
    name: "Plague Breath",
    status: "Modeled",
    summary: "A 0.25x per-hit breath that lands a full stack of Disease on every tick.",
    mechanics: [
      "Plague Breath deals damage 2 times per second while it is firing.",
      "Capacity is 5 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 2 seconds while the breath is not firing, so a fully drained bar takes 10 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.25 × 1.125 × (1 - breath resistance).",
      "Every damage tick applies 1 stack of Disease - the model does not roll Disease's 100% chance for 1 stack, it applies the average of that roll.",
    ],
    specConstants: [
      { key: "plague_breath_per_hit_multiplier", value: 0.25, quote: "/ 100) × 0.25 × 1.125 ×" },
      { key: "plague_breath_crit_multiplier", value: 1.125, quote: "× 0.25 × 1.125 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Plague Breath uses a 25% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.125x instead of random crit rolls.",
    ],
  },
  {
    id: "ability_plague_trail",
    name: "Plague Trail",
    status: "Modeled",
    summary: "Passive trail that damages the opponent and applies Disease every 2 seconds while the user's HP is at or below the ability's value.",
    mechanics: [
      "In Compare, Plague Trail runs only with the Trails rule turned on for the user.",
      "Plague Trail activates while the user's current HP is at or below the ability's value, read as a fraction of max HP - value 50 means 50% HP.",
      "While active, every 2 seconds the opponent takes damage equal to 2% of their max HP.",
      "Each of those ticks also applies 2 stacks of Disease.",
      "The damage is measured against the opponent's max HP, not the user's.",
      "Only one trail segment is modeled, and it is treated as eternal while the HP threshold holds. Segment despawn is not simulated.",
      "Several trail abilities on one user all activate together, each against its own HP threshold.",
      "While any of the user's trail abilities is active, No Move Facetank is forced off.",
      "The previous No Move Facetank setting returns as soon as no trail is active.",
    ],
    specConstants: [
      { key: "plague_trail_disease_stacks", value: 2, quote: "applies 2 stacks of Disease" },
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "ability_plasma_beam",
    name: "Plasma Beam",
    status: "Modeled",
    summary: "Breath with 3 charges on a short recast cooldown and a long per-charge recharge.",
    mechanics: [
      "Plasma Beam starts the fight with 3 charges. Each charge fires 3 damage ticks at 2 ticks per second (1.5 seconds of firing per charge).",
      "Each charge has a 0.8 second startup delay between activation and its first damage tick.",
      "Charges are gated by a 2.5 second recast cooldown measured from the moment a charge starts, not from when it ends.",
      "That recast overlaps the startup and the firing, so the next charge begins 2.5 seconds after the previous one and only a brief gap sits between bursts.",
      "Once all charges are spent, the user must wait for the next charge to regenerate. Charges regenerate at +1 charge every 40 seconds, capped at 3 charges.",
      "The 40 second charge-regen timer runs on its own clock while charges are below the cap: spending a charge does not reset it. Once charges refill to 3 the timer stops, and the next spend starts a fresh 40 seconds.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 2.0 × 0.5 × 1.175 × (1 - breath resistance).",
      "Every damage tick applies 1 stack of Slowed - the model does not roll Slowed's 100% chance with no stacking, it applies the average of that roll.",
    ],
    specConstants: [
      { key: "plasma_beam_per_hit_multiplier", value: 2.0, quote: "/ 100) × 2.0 × 0.5 × 1.175 ×" },
      { key: "plasma_beam_crit_multiplier", value: 1.175, quote: "× 0.5 × 1.175 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
      "Plasma Beam fires whenever a charge is available and its 2.5 second recast has elapsed.",
    ],
    notes: [
      "Plasma Beam uses a 35% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.175x instead of random crit rolls.",
      "Slowed moves speed, which the stand-and-fight model does not carry, so it lands with no combat effect of its own. It is still a negative status that a cleanse can remove and that sitting or laying strips faster.",
    ],
  },
  {
    id: "ability_quick_recovery",
    name: "Quick Recovery",
    status: "Modeled",
    summary: "Increases natural health regeneration at low HP.",
    mechanics: [
      "Quick Recovery is a passive ability.",
      "The regeneration boost applies only while the user is below 40% HP.",
      "Below 40% HP the health regeneration multiplier scales linearly with how low the HP is.",
      "It ramps from 1x at 40% HP up to 2x at 0% HP.",
    ],
    specConstants: [
      { key: "quick_recovery_hp_gate_pct", value: 40, quote: "below 40% HP" },
      { key: "quick_recovery_max_multiplier", value: 2, quote: "2x at 0% HP" },
    ],
    policyDifferences: [
      "Timing modes do not reach Quick Recovery: the multiplier follows current HP and nothing decides when.",
    ],
    notes: [],
  },
  createOutOfModelAbilityEntry("Raider"),
  {
    id: "ability_reflect",
    name: "Reflect",
    status: "Modeled",
    summary: "Creates a timed window in which incoming bites deal no damage to the user and are dealt back to the attacker instead.",
    mechanics: [
      "Reflect starts immediately at t=0 if actives are enabled.",
      "Reflect lasts for 6 seconds.",
      "It has a 45 second cooldown.",
      "While Reflect is active, direct bite damage is reduced to 0 on the user and is instead dealt back to the attacker.",
      "Breath damage is not reflected: it lands on the user in full and nothing returns to the breather.",
      "Only direct melee bites bounce.",
      "The bounce is the attacker's weight-scaled base bite carrying their stat-level buffs and debuffs - Hunters Curse, Unbridled Rage, Adrenaline, Warden's Rage, Cocoon damage.",
      "The reflector's own weight does not rescale the bounce, but their posture and Hunker reduction do: what goes back is the hit as it would have landed on them.",
      "Spite, Expunge, Divination and Power Charge bonuses are not reflected. They land after the bounce has already returned the hit, so they never reach the attacker.",
      "The bounced hit is still capped by the attacker's own Unbreakable limit.",
    ],
    specConstants: [
      { key: "reflect_duration_sec", value: 6, quote: "lasts for 6 seconds" },
      { key: "reflect_cooldown_sec", value: 45, quote: "45 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all recast Reflect the instant the cooldown clears.",
    ],
    notes: [
      "It shows each bounced hit as a Reflect (bite) event.",
    ],
  },
  {
    id: "ability_reflux",
    name: "Reflux",
    status: "Modeled",
    summary: "Starts a charge, then lands a direct hit and leaves a damaging puddle that applies Corrosion over time.",
    mechanics: [
      "Reflux starts with a 5 second charge.",
      "When the charge completes, it deals a direct hit equal to 5% of the target's max HP.",
      "The impact also applies 2 stacks of Slowed to the target.",
      "After the impact, Reflux leaves a puddle for 10 seconds.",
      "The puddle ticks once per second.",
      "Each puddle tick deals direct damage equal to 1.5% of the target's max HP and applies 0.5 stacks of Corrosion.",
      "Under the hunger rule, Reflux can be blocked by low appetite and can spend appetite on cast start.",
      "It has a 120 second cooldown.",
    ],
    specConstants: [
      { key: "reflux_primary_pct_max_hp", value: 5, quote: "5% of the target's max HP" },
      { key: "reflux_secondary_pct_max_hp", value: 1.5, quote: "deals direct damage equal to 1.5% of the target's max HP" },
      { key: "reflux_cooldown_sec", value: 120, quote: "120 second cooldown" },
    ],
    policyDifferences: [
      "In the main stand-and-fight model, Reflux starts as soon as it is available.",
      "Really fast, fast, semi-ideal, ideal and extreme all treat Reflux the same.",
    ],
    notes: [
      "The model assumes the target stays inside the puddle for its full duration. Nothing here tracks position, so the puddle cannot be walked out of.",
      "With the hunger rule on, Reflux spends appetite on cast start and cannot start below that cost. See Hunger and thirst.",
    ],
  },
  {
    id: "ability_rewind",
    name: "Rewind",
    status: "Modeled",
    summary: "Restores the user's HP toward an earlier recorded value.",
    mechanics: [
      "Rewind looks for the user's recorded HP from 9 seconds earlier.",
      "If no valid 9 second snapshot is available, Rewind does nothing.",
      "When it activates, HP is restored toward that older value.",
      "The heal from Rewind is capped at 25% of the user's max HP.",
      "Rewind restores HP only.",
      "Rewind has a 100 second cooldown.",
    ],
    specConstants: [
      { key: "rewind_heal_cap_pct_max_hp", value: 25, quote: "capped at 25% of the user's max HP" },
      { key: "rewind_cooldown_sec", value: 100, quote: "100 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Rewind on the same gate: current HP at or below 75%, with a snapshot that would restore something.",
      "No mode waits past that gate.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_rock_breath",
    name: "Rock Breath",
    status: "Modeled",
    summary: "A 1x per-hit breath whose Injury and Shredded Wings each land 0.2 stacks per tick.",
    mechanics: [
      "Rock Breath deals damage 2 times per second while it is firing.",
      "Capacity is 10 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 3.5 seconds while the breath is not firing, so a fully drained bar takes 35 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 1.0 × 1.05 × (1 - breath resistance).",
      "Every damage tick applies 0.2 stacks of Injury and 0.2 stacks of Shredded Wings - the model does not roll Injury's 10% chance for 2 stacks or Shredded Wings' 10% chance for 2 stacks, it applies the average of each roll.",
    ],
    specConstants: [
      { key: "rock_breath_per_hit_multiplier", value: 1.0, quote: "/ 100) × 1.0 × 1.05 ×" },
      { key: "rock_breath_crit_multiplier", value: 1.05, quote: "× 1.0 × 1.05 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Rock Breath uses a 10% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.05x instead of random crit rolls.",
      "Injury carries no combat effect of its own here. It lands as a negative status, which a cleanse can remove and which sitting or laying strips faster.",
      "Shredded Wings grounds the target, so an aerial target under it stops dodging.",
    ],
  },
  {
    id: "ability_sand_breath",
    name: "Sand Breath",
    status: "Modeled",
    summary: "A 0.25x per-hit breath whose Blurred Vision and Tunnel Vision both land with no combat effect of their own.",
    mechanics: [
      "Sand Breath deals damage 2 times per second while it is firing.",
      "Capacity is 10 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 1.8 seconds while the breath is not firing, so a fully drained bar takes 18 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.25 × 1.0 × (1 - breath resistance).",
      "Every damage tick applies 1 stack of Blurred Vision and 0.5 stacks of Tunnel Vision - the model does not roll Blurred Vision's 100% chance with no stacking or Tunnel Vision's 50% chance with no stacking, it applies the average of each roll.",
    ],
    specConstants: [
      { key: "sand_breath_per_hit_multiplier", value: 0.25, quote: "/ 100) × 0.25 × 1.0 ×" },
      { key: "sand_breath_crit_multiplier", value: 1.0, quote: "× 0.25 × 1.0 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Sand Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Blurred Vision and Tunnel Vision only obscure the screen, which the stand-and-fight model does not carry, so they land with no combat effect of their own. They are still negative statuses that a cleanse can remove and that sitting or laying strips faster.",
    ],
  },
  {
    id: "ability_self_destruct",
    movesSpeed: true,
    name: "Self-Destruct",
    status: "Modeled",
    summary: "Arms automatically at low HP, then explodes when the arming status expires.",
    mechanics: [
      "Self-Destruct is armed automatically while the user's HP is at or below 15%.",
      "Arming applies 3 stacks of a self-arming status to the user.",
      "While the arming status is up, the user's walk, swim, sprint and flight speeds are multiplied by 1.25.",
      "The stacks decay at the standard 1 stack per 3 seconds, giving a 9 second fuse.",
      "The stacks decay regardless of facetank mode, so the fuse always runs.",
      "The explosion fires when the stacks reach zero, whether by natural decay or by cleanse.",
      "The explosion deals 10% of the target's max HP as direct damage.",
      "It also applies 10 stacks of Burn on explosion.",
      "If the user's HP is above 15%, it is capped down to 15% of max HP after the explosion.",
      "If the user's HP is already at or below 15%, it is left alone (no heal).",
      "If the user dies while armed, the explosion fires at the moment of death.",
      "Self-Destruct has a 300 second cooldown after each explosion.",
    ],
    specConstants: [
      { key: "self_destruct_damage_pct_max_hp", value: 10, quote: "deals 10% of the target's max HP" },
      { key: "self_destruct_cap_pct", value: 15, quote: "capped down to 15% of max HP" },
      { key: "self_destruct_cooldown_sec", value: 300, quote: "300 second cooldown" },
    ],
    policyDifferences: [
      "Timing modes do not reach Self-Destruct: it arms itself once the HP condition is met.",
    ],
    notes: [
      "The timeline shows a 'Self-Destruct armed' event when arming begins.",
      "It shows a 'Self-Destruct' event when the explosion fires.",
      "The speed gained while the fuse burns reaches Speed Builds and not Compare, so a fight sees the arming window without it.",
    ],
  },
  {
    id: "ability_serrated_teeth",
    name: "Serrated Teeth",
    status: "Modeled",
    summary: "Applies Deep Wounds on hit.",
    mechanics: [
      "Serrated Teeth applies 10 stacks of Deep Wounds when the user lands a bite.",
      "Breath does not trigger Serrated Teeth.",
      "Each hit of a Shadow Barrage burst counts as its own bite for this, so the stacks multiply with the barrage.",
    ],
    policyDifferences: [
      "Timing modes do not reach Serrated Teeth: it fires on every bite the user lands.",
    ],
    notes: [
      "The timeline shows the applied effect as Deep Wounds, not a separate Serrated Teeth event.",
    ],
  },
  {
    id: "ability_shadow_barrage",
    name: "Shadow Barrage",
    status: "Modeled",
    summary: "Repeats the user's most recent melee hit as one burst of hits, all landing at the moment of activation.",
    mechanics: [
      "Shadow Barrage can only start if the user has landed a melee hit recently.",
      "The last melee hit must be within the previous 10 seconds.",
      "When it starts, it stores the pre-reflect damage of that last melee hit.",
      "It then computes a number of barrage hits equal to the user's Shadow Barrage value.",
      "Each barrage hit is scaled geometrically: hit i deals 0.9^i of the stored bite, so the sequence is 90%, 81%, 72.9%, and so on - it decays but never reaches zero.",
      "Each barrage hit passes through the defender's Reflect just like a normal bite.",
      "Reflect fires before the 0.9^i decay is applied, so what bounces back is the full undecayed stored bite.",
      "Against a Reflect defender the defender takes 0 from the barrage and the attacker takes N times the stored bite, where N is the Shadow Barrage value - the returns are undecayed, so the total returned exceeds the total the barrage would have dealt.",
      "All barrage hits are dealt as a single burst at the moment of activation, not spread out over time.",
      "On-hit offensive effects are reapplied once for every barrage hit in the burst - for value 3 that is three separate Bleed/Poison/etc. applications combined into one apply event.",
      "It has a 30 second cooldown.",
    ],
    specConstants: [
      { key: "shadow_barrage_cooldown_sec", value: 30, quote: "30 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all treat Shadow Barrage the same.",
      "Once its normal activation conditions are met, it starts automatically and resolves the entire barrage in the same tick.",
    ],
    notes: [
      "Shadow Barrage replays the stored damage of the last recent melee hit rather than re-running the full damage calculation for each hit. In game each hit recomputes weight, mitigation and Warden's Rage as it lands, and all N hits here land in one tick, so those three inputs are the same for every hit of the burst.",
    ],
  },
  createOutOfModelAbilityEntry("Shock Area"),
  createOutOfModelAbilityEntry("Silent Hunter"),
  {
    id: "ability_silly_beam",
    name: "Silly Beam",
    status: "Not planned",
    summary: "A beam that draws its effect from a long list of unrelated statuses, none of which the model carries.",
    mechanics: [],
    whyItsNotModeledHere: [
      "Silly Beam has a highly random effect.",
      "Every status it can land is a separate mechanic, and averaging them the way the breaths are averaged would produce a beam that applies a little of everything and resembles nothing the game does.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "ability_snow_shield",
    name: "Snow Shield",
    status: "Not planned",
    summary: "Currently not modeled.",
    mechanics: [],
    whyItsNotModeledHere: [
      "There is still too little reliable information about Snow Shield's exact effect.",
      "It is also not clear how to represent it correctly in the current stand-and-fight model.",
    ],
    policyDifferences: [],
    notes: [],
  },
  createOutOfModelAbilityEntry("Soft Landing"),
  {
    id: "ability_solar_beam",
    name: "Solar Beam",
    status: "Modeled",
    summary: "Uses high-damage auto-fire breath with a startup delay.",
    mechanics: [
      "Solar Beam deals damage 2 times per second while it is firing.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 1.5 × 1.0 × (1 - breath resistance).",
      "Capacity is 10 seconds of firing. Once Solar Beam starts it fires until the bar is empty.",
      "It has a 3 second startup delay before firing begins.",
      "It has a 120 second cooldown instead of a capacity that refills.",
    ],
    specConstants: [
      { key: "solar_beam_per_hit_multiplier", value: 1.5, quote: "/ 100) × 1.5 × 1.0 ×" },
      { key: "solar_beam_crit_multiplier", value: 1.0, quote: "× 1.5 × 1.0 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Solar Beam has 0% crit, so its pseudo-crit multiplier is 1.0x.",
    ],
  },
  createOutOfModelAbilityEntry("Sonic Wings"),
  {
    id: "ability_speed_blitz",
    movesSpeed: true,
    name: "Speed Blitz",
    status: "Speed-Builds-only",
    summary: "Multiplies every movement speed by 1.25.",
    mechanics: [
      "Speed Blitz multiplies walk, swim, sprint and flight speed by 1.25.",
    ],
    policyDifferences: [],
    notes: [],
  },
  createOutOfModelAbilityEntry("Speed Steal"),
  {
    id: "ability_spirit_glare",
    name: "Spirit Glare",
    status: "Modeled",
    summary: "Uses auto-fire breath damage and also applies Burn and Fear.",
    mechanics: [
      "Spirit Glare deals damage 2 times per second while it is firing.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 1.0 × 1.0 × (1 - breath resistance).",
      "Capacity is 10 seconds of firing. Once Spirit Glare starts it fires until the bar is empty.",
      "It has no startup delay.",
      "It has a 120 second cooldown instead of a capacity that refills.",
      "Each damage tick also applies 1 stack of Burn and 1 stack of Fear.",
    ],
    specConstants: [
      { key: "spirit_glare_per_hit_multiplier", value: 1.0, quote: "/ 100) × 1.0 × 1.0 ×" },
      { key: "spirit_glare_crit_multiplier", value: 1.0, quote: "× 1.0 × 1.0 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Spirit Glare has 0% crit, so its pseudo-crit multiplier is 1.0x.",
    ],
  },
  {
    id: "ability_spite",
    name: "Spite",
    status: "Modeled",
    summary: "Arms automatically while available, then boosts the next direct melee hit after charging.",
    mechanics: [
      "Spite has a 20 second cooldown.",
      "Spite arms automatically as soon as its cooldown elapses.",
      "Once armed, it takes 5 seconds to fully charge.",
      "The next direct melee hit then uses the charged Spite bonus and consumes it.",
      "The damage bonus scales from 0% to the user's Spite value over that 5 second charge.",
      "That charged hit also doubles the user's inflicted offensive ailments.",
    ],
    specConstants: [
      { key: "spite_cooldown_sec", value: 20, quote: "20 second cooldown" },
    ],
    policyDifferences: [
      "Spite arms automatically as soon as its cooldown elapses instead of being cast manually.",
      "After Spite is armed, the model uses the next bite immediately instead of intentionally delaying that bite to wait for a bigger charge.",
    ],
    notes: [
    ],
  },
  createOutOfModelAbilityEntry("Stamina Puddle"),
  {
    id: "ability_sticky_fur",
    name: "Sticky Fur",
    status: "Modeled",
    summary: "A defensive ability that applies Sticky Teeth when the user is bitten.",
    mechanics: [
      "Sticky Fur is a defensive ability.",
      "Sticky Fur applies its stacks to the attacker when the user is hit by a direct bite.",
      "Breath does not trigger Sticky Fur.",
      "Sticky Fur applies 2 stacks of Sticky Teeth per bite.",
      "Sticky Teeth stacks accumulate up to a cap of 5.",
    ],
    policyDifferences: [],
    notes: [
      "The timeline shows the applied effect as Sticky Teeth, not a separate Sticky Fur event.",
    ],
  },
  createOutOfModelAbilityEntry("Sticky Trap"),
  {
    id: "ability_storm_breath",
    name: "Storm Breath",
    status: "Modeled",
    summary: "A 0.01x per-hit breath whose Slowed and Blurred Vision both land with no combat effect of their own.",
    mechanics: [
      "Storm Breath deals damage 2 times per second while it is firing.",
      "Capacity is 20 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 1.75 seconds while the breath is not firing, so a fully drained bar takes 35 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.01 × 1.0 × (1 - breath resistance).",
      "Every damage tick applies 0.35 stacks of Slowed and 0.4 stacks of Blurred Vision - the model does not roll Slowed's 35% chance with no stacking or Blurred Vision's 40% chance with no stacking, it applies the average of each roll.",
    ],
    specConstants: [
      { key: "storm_breath_per_hit_multiplier", value: 0.01, quote: "/ 100) × 0.01 × 1.0 ×" },
      { key: "storm_breath_crit_multiplier", value: 1.0, quote: "× 0.01 × 1.0 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Storm Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Slowed moves speed and Blurred Vision obscures the screen, neither of which the stand-and-fight model carries, so both land with no combat effect of their own. They are still negative statuses that a cleanse can remove and that sitting or laying strips faster.",
    ],
  },
  {
    id: "ability_stubborn_stacker",
    name: "Stubborn Stacker",
    status: "Modeled",
    summary: "Replaces specific plushie effects with creature-specific stat and block bonuses.",
    mechanics: [
      "Stubborn Stacker is a passive ability that changes the effect of specific plushies.",
      "Cat gives +10% health regeneration.",
      "Cat blocks 5% of incoming Bleed stacks.",
      "Pig-Lantern gives +5% melee damage.",
      "Pig-Lantern blocks 5% of incoming Burn stacks.",
      "Haunt Dragon blocks 5% of incoming Poison stacks.",
      "Tannenbaum gives -5% bite cooldown.",
      "Tannenbaum blocks 5% of incoming Frostbite stacks.",
      "These bonuses replace the usual effects of those plushies for creatures with Stubborn Stacker.",
    ],
    policyDifferences: [
      "Timing modes do not reach Stubborn Stacker: the plushie bonuses are in place for the whole fight.",
    ],
    notes: [],
  },
  {
    id: "ability_tail_drop",
    movesSpeed: true,
    name: "Tail Drop",
    status: "Speed-Builds-only",
    summary: "Multiplies every movement speed by 1.35 while the tail is off.",
    mechanics: [
      "Tail Drop multiplies walk, swim, sprint and flight speed by 1.35.",
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "ability_thorn_trap",
    name: "Thorn Trap",
    status: "Modeled",
    summary: "Deals a flat max-HP hit and applies Bleed and Freeze immediately.",
    mechanics: [
      "Thorn Trap is gated by the Traps setting: without it on the user's side, the ability does not activate.",
      "Thorn Trap deals direct damage equal to 5% of the target's max HP when it triggers.",
      "That damage is a flat one-time hit: it is not weight-scaled and does not stack.",
      "Thorn Trap applies 6 stacks of Bleed immediately when it is used.",
      "It also applies 2 stacks of Freeze immediately.",
      "It has a 35 second cooldown.",
    ],
    specConstants: [
      { key: "thorn_trap_bleed_stacks", value: 6, quote: "applies 6 stacks of Bleed" },
      { key: "thorn_trap_freeze_stacks", value: 2, quote: "applies 2 stacks of Freeze" },
      { key: "thorn_trap_damage_pct_max_hp", value: 5, quote: "5% of the target's max HP" },
      { key: "thorn_trap_cooldown_sec", value: 35, quote: "35 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Thorn Trap the moment its cooldown is ready.",
    ],
    notes: [
      "The opponent is caught by the trap the moment Thorn Trap is activated. Nothing here tracks position, so the trap cannot be avoided.",
    ],
  },
  {
    id: "ability_totem",
    name: "Totem",
    status: "Modeled",
    summary: "Applies its own ailment over time after it is placed.",
    mechanics: [
      "Totem has a 180 second cooldown.",
      "When it is used, it becomes active for 30 seconds.",
      "While it is active, it applies 2 stacks of an ailment every 3 seconds.",
      "Which ailment it is comes from the creature's own Totem value. A creature that names none applies Poison.",
    ],
    specConstants: [
      { key: "totem_cooldown_sec", value: 180, quote: "180 second cooldown" },
      { key: "totem_active_window_sec", value: 30, quote: "active for 30 seconds" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all place Totem the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_toxic_trail",
    name: "Toxic Trail",
    status: "Modeled",
    summary: "Passive trail that damages the opponent and applies Poison every 2 seconds while the user's HP is at or below the ability's value.",
    mechanics: [
      "In Compare, Toxic Trail runs only with the Trails rule turned on for the user.",
      "Toxic Trail activates while the user's current HP is at or below the ability's value, read as a fraction of max HP - value 50 means 50% HP.",
      "While active, every 2 seconds the opponent takes damage equal to 2% of their max HP.",
      "Each of those ticks also applies 2 stacks of Poison.",
      "The damage is measured against the opponent's max HP, not the user's.",
      "Only one trail segment is modeled, and it is treated as eternal while the HP threshold holds. Segment despawn is not simulated.",
      "Several trail abilities on one user all activate together, each against its own HP threshold.",
      "While any of the user's trail abilities is active, No Move Facetank is forced off.",
      "The previous No Move Facetank setting returns as soon as no trail is active.",
    ],
    specConstants: [
      { key: "toxic_trail_poison_stacks", value: 2, quote: "applies 2 stacks of Poison" },
    ],
    policyDifferences: [],
    notes: [],
  },
  {
    id: "ability_toxic_trap",
    name: "Toxic Trap",
    status: "Modeled",
    summary: "Places a trap that poisons the opponent and has a fixed 25 opponent-bite durability.",
    mechanics: [
      "Toxic Trap is gated by the Traps setting: without it on the user's side, the ability does not activate.",
      "Toxic Trap places a trap as soon as its cooldown is clear.",
      "A trap still standing is replaced rather than blocking the cast.",
      "The replacement starts at full durability.",
      "While the trap is active, the opponent receives 5 stacks of Poison every 3 seconds.",
      "The first Poison tick occurs 3 seconds after activation.",
      "Each bite by the opponent on the user consumes one of the trap's 25 durability charges. The user's own bites do not affect the trap.",
      "When all 25 charges are consumed, the trap breaks immediately and Poison ticks stop.",
      "Nothing else ends it. The trap has no lifetime of its own and keeps ticking until those bites arrive.",
      "Only one trap stands at a time.",
      "The trap's durability is always exactly 25 opponent bites and is not reduced faster by damage multipliers.",
      "Toxic Trap has a 75 second cooldown, counted from the activation moment.",
    ],
    specConstants: [
      { key: "toxic_trap_poison_stacks", value: 5, quote: "receives 5 stacks of Poison" },
      { key: "toxic_trap_durability_bites", value: 25, quote: "always exactly 25 opponent bites" },
      { key: "toxic_trap_cooldown_sec", value: 75, quote: "75 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all place Toxic Trap the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_toxin_breath",
    name: "Toxin Breath",
    status: "Modeled",
    summary: "A 0.25x per-hit breath that lands over half a stack of Poison on every tick.",
    mechanics: [
      "Toxin Breath deals damage 2 times per second while it is firing.",
      "Capacity is 15 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 2.5 seconds while the breath is not firing, so a fully drained bar takes 37.5 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.25 × 1.025 × (1 - breath resistance).",
      "Every damage tick applies 0.5625 stacks of Poison - the model does not roll Poison's 75% chance for 0.75 stacks, it applies the average of that roll.",
    ],
    specConstants: [
      { key: "toxin_breath_per_hit_multiplier", value: 0.25, quote: "/ 100) × 0.25 × 1.025 ×" },
      { key: "toxin_breath_crit_multiplier", value: 1.025, quote: "× 0.25 × 1.025 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Toxin Breath uses a 5% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.025x instead of random crit rolls.",
    ],
  },
  {
    id: "ability_two_faced",
    name: "Two-Faced",
    status: "Modeled",
    summary: "One of two opposed sides is chosen per build and applied as a passive multiplier for the whole fight.",
    mechanics: [
      "Two-Faced runs in one of two modes, and a build commits to one of them before the fight starts.",
      "Tranquility multiplies damage by 1.6 (+60%).",
      "Tranquility multiplies bite cooldown by the same 1.6.",
      "Madness multiplies damage by 0.625 (-37.5%).",
      "Madness multiplies bite cooldown by the same 0.625.",
      "In Compare, the mode is picked per side, so A and B may run opposite modes.",
      "In Best Builds and Optimizer, one mode covers the whole run: the source and every opponent that owns Two-Faced use it.",
    ],
    specConstants: [
      { key: "two_faced_tranquility_multiplier", value: 1.6, quote: "Tranquility multiplies damage by 1.6" },
      { key: "two_faced_madness_multiplier", value: 0.625, quote: "Madness multiplies damage by 0.625" },
    ],
    policyDifferences: [
      "Timing modes do not reach Two-Faced: once a mode is chosen it is a constant multiplier for the whole fight.",
    ],
    notes: [],
  },
  {
    id: "ability_unbreakable",
    name: "Unbreakable",
    status: "Modeled",
    summary: "Caps damage from a single source to the listed percent of max HP.",
    mechanics: [
      "Unbreakable uses the user's listed value as a per-source damage cap.",
      "For example, Unbreakable (12) means one hit, tick, reflect, recoil, or ability self-cost cannot remove more than 12% of the user's max HP at once.",
      "The cap is based on max HP, not current HP.",
      "Drowning damage from an empty oxygen or moisture pool is not limited by the cap.",
    ],
    policyDifferences: [
      "Timing modes do not reach Unbreakable: the cap is always on.",
    ],
    notes: [],
  },
  {
    id: "ability_unbridled_rage",
    name: "Unbridled Rage",
    status: "Modeled",
    summary: "Gives a temporary damage boost to bites.",
    mechanics: [
      "Unbridled Rage lasts for 30 seconds.",
      "It has a 120 second cooldown.",
      "While Unbridled Rage is active, the user's melee damage is multiplied by 1.3.",
      "It boosts melee damage only and does not increase breath damage.",
    ],
    specConstants: [
      { key: "unbridled_rage_duration_sec", value: 30, quote: "lasts for 30 seconds" },
      { key: "unbridled_rage_cooldown_sec", value: 120, quote: "120 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all activate Unbridled Rage as soon as it is available.",
      "No mode delays it. The buff is the same size wherever its 30 seconds fall, so a later cast only leaves less of the fight inside them.",
    ],
    notes: [
    ],
  },
  createOutOfModelAbilityEntry("Vanish"),
  {
    id: "ability_virus_breath",
    name: "Virus Breath",
    status: "Modeled",
    summary: "A 0.25x per-hit breath that lands three quarters of a stack of Bleed on every tick.",
    mechanics: [
      "Virus Breath deals damage 2 times per second while it is firing.",
      "Capacity is 20 seconds of firing: each second of continuous fire spends 1 unit, whatever the tick rate.",
      "Capacity comes back at 1 unit every 1.5 seconds while the breath is not firing, so a fully drained bar takes 30 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.25 × 1.0 × (1 - breath resistance).",
      "Every damage tick applies 0.75 stacks of Bleed - the model does not roll Bleed's 75% chance for 1 stack, it applies the average of that roll.",
    ],
    specConstants: [
      { key: "virus_breath_per_hit_multiplier", value: 0.25, quote: "/ 100) × 0.25 × 1.0 ×" },
      { key: "virus_breath_crit_multiplier", value: 1.0, quote: "× 0.25 × 1.0 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Virus Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
    ],
  },
  {
    id: "ability_wardens_rage",
    name: "Warden's Rage",
    status: "Modeled",
    summary: "One buff, armed either by damage taken below full HP or by a policy turning it on, that scales damage with missing HP and stops passive healing while it is on.",
    mechanics: [
      "Warden's Rage is one effect behind a single on/off switch.",
      "Two things drive that switch: a passive that fires on damage taken below full HP, and a manual activation. While a manual activation is holding it on, that activation is the authority.",
      "Passive: any time the user takes damage while below full HP, Warden's Rage switches on. This has no cooldown, and once on it stays on through later moments with no new damage.",
      "Manual: a policy can turn it on directly. The manual activation carries a 30 second cooldown that starts when it is turned on.",
      "Two things turn it off, and both reset the strength to zero.",
      "It turns off at full HP, but only when no manual activation is holding it.",
      "A manual deactivation turns it off at any HP and releases the manual hold.",
      "Strength is a whole number from 1 to 100 set by current HP: ceil(199 - 198 × current HP / max HP), clamped to that range. It is 1 at full HP and 100 at 50% of max HP or lower.",
      "The damage multiplier is max(1, strength / 100 × 8.5). It reaches 8.5x damage at full strength, and it floors at 1x while strength is 11 or less, which is HP above 95% of max.",
      "While Warden's Rage is on, passive health regeneration is disabled; a single regeneration tick suppressed during that window is released the moment it turns off.",
    ],
    specConstants: [
      { key: "wardens_rage_cap_multiplier", value: 8.5, quote: "reaches 8.5x damage at full strength" },
    ],
    policyDifferences: [
      "Really fast turns the manual Warden's Rage on immediately and keeps it active.",
      "Fast turns the manual Warden's Rage on immediately and keeps it active, as really fast does.",
      "Semi-ideal, ideal, and extreme test different manual timings and compare two main lines: turning the manual hold off briefly to let one buffered regen tick through and resume passive regeneration sooner, or keeping it on longer to reach a stronger bonus before turning it off. The passive re-arms the switch on the next bite either way.",
      "Outside really fast, the first manual activation can be very short unless the policy decides it is better to keep the ability active.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_wardens_resistance",
    name: "Warden's Resistance",
    status: "Modeled",
    summary: "Blocks new incoming ailments while HP is at or below 50%.",
    mechanics: [
      "Warden's Resistance applies while the user's HP is at or below 50%.",
      "While it is active, new incoming ailments and statuses are blocked completely.",
      "Shredded Wings is the one exception: it lands while the block holds, so a flier that takes it is grounded all the same.",
    ],
    specConstants: [
      { key: "wardens_resistance_hp_gate_pct", value: 50, quote: "HP is at or below 50%" },
    ],
    policyDifferences: [
      "Timing modes do not reach Warden's Resistance: it switches itself on and off with the user's current HP.",
    ],
    notes: [
    ],
  },
  {
    id: "ability_water_breath",
    name: "Water Breath",
    status: "Modeled",
    summary: "A 0.75x per-hit breath whose Blurred Vision lands with no combat effect of its own.",
    mechanics: [
      "Water Breath deals damage 2 times per second while it is firing.",
      "Capacity is 10 seconds of firing - one second of continuous fire spends 1 unit.",
      "Capacity comes back at 1 unit every 2.5 seconds while the breath is not firing, so a fully drained bar takes 25 seconds to refill.",
      "Breath damage per tick is calculated as (((target max HP × (1 + min(attacker effective weight / defender effective weight, 3))) / 2) / 100) × 0.75 × 1.1 × (1 - breath resistance).",
      "Every damage tick applies 0.6 stacks of Blurred Vision - the model does not roll Blurred Vision's 60% chance with no stacking, it applies the average of that roll.",
    ],
    specConstants: [
      { key: "water_breath_per_hit_multiplier", value: 0.75, quote: "/ 100) × 0.75 × 1.1 ×" },
      { key: "water_breath_crit_multiplier", value: 1.1, quote: "× 0.75 × 1.1 × (1 - breath resistance)" },
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Water Breath uses a 20% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.1x instead of random crit rolls.",
      "Blurred Vision only obscures the screen, which the stand-and-fight model does not carry, so it lands with no combat effect of its own. It is still a negative status that a cleanse can remove and that sitting or laying strips faster.",
    ],
  },
  createOutOfModelAbilityEntry("Will To Live"),
  {
    id: "ability_wing_shredder",
    name: "Wing Shredder",
    status: "Modeled",
    summary: "Applies Shredded Wings.",
    mechanics: [
      "On an offensive carrier, Wing Shredder applies Shredded Wings to the target when the user lands a bite.",
      "Breath does not trigger Wing Shredder.",
      "On a defensive carrier it runs the other way, applying Shredded Wings to the attacker when the user is bitten.",
      "The number of stacks applied is the user's own Wing Shredder value, and 1 stack where the creature carries no value.",
    ],
    policyDifferences: [],
    notes: [
      "The timeline shows the applied effect as Shredded Wings, not a separate Wing Shredder event.",
    ],
  },
  {
    id: "ability_yolk_bomb",
    name: "Yolk Bomb",
    status: "Modeled",
    summary: "Applies a value-specific status alongside Slowed.",
    mechanics: [
      "Yolk Bomb applies 2 stacks of Slowed plus 4 stacks of the status chosen by its value.",
      "Beneficial values route the full effect to the user, harmful values route it to the opponent.",
      "When the value is Fortify, Yolk Bomb grants a 12 second status-immunity window and the 5% weight bonus that goes with it, instead of applying a status.",
      "That window is longer than the 9 seconds Fortify itself gives.",
      "Yolk Bomb cleanses nothing when it applies that window.",
      "It has a 30 second cooldown.",
    ],
    specConstants: [
      { key: "yolk_bomb_cooldown_sec", value: 30, quote: "30 second cooldown" },
    ],
    policyDifferences: [
      "Really fast, fast, semi-ideal, ideal and extreme all fire Yolk Bomb the moment its cooldown is ready.",
    ],
    notes: [
    ],
  },
];

/**
 * The label a reader sees on an ability, in Compare and in the coverage
 * counts. Four buckets, and the Reference entry's `status` decides which:
 *
 * - `modeled` - the engine simulates it. A battle setting counts here: a switch
 *   means the effect is opt-in, not absent.
 * - `partial` - the engine carries the ability but leaves its deeper effect
 *   alone, because that effect has nothing to act on in a stand-and-fight
 *   model.
 * - `speed-builds-only` - its modeled side is a movement channel, so Speed
 *   Builds ranks it and a fight never reads it.
 * - `out-of-model` - nothing about it reaches anything.
 * - `not-modeled` - not there and not planned, or still being defined.
 */
export type AbilityScopeStatus =
  | "modeled"
  | "partial"
  | "speed-builds-only"
  | "out-of-model"
  | "not-modeled";

function abilityScopeForStatus(status: ReferenceStatus): AbilityScopeStatus {
  switch (status) {
    case "Modeled":
    case "Battle setting":
    case "Sandbox-only":
      return "modeled";
    case "Partial":
      return "partial";
    case "Speed-Builds-only":
      return "speed-builds-only";
    case "Out of model":
      return "out-of-model";
    case "Not planned":
    case "Not modeled yet":
    case "Disputed":
      return "not-modeled";
  }
}

/**
 * Every ability the Reference has an entry for, mapped to its scope. This is
 * the single source for the coverage label and the coloured ability list in
 * Compare - both read it, so neither can drift from the entry a reader opens.
 *
 * It replaced three hand-maintained lists that had drifted in fifteen places:
 * seven setting-gated abilities were still listed as out of model, Plasma Beam
 * was listed as unmodelled while carrying a full entry and a reference test,
 * and three out-of-model abilities were in no list at all.
 */
export const REFERENCE_ABILITY_SCOPE: ReadonlyMap<string, AbilityScopeStatus> = new Map(
  [...MODELED_ABILITY_REFERENCE_DRAFTS, ...BATTLE_SETTING_REFERENCE_DRAFTS].map((entry) => [
    entry.name,
    abilityScopeForStatus(entry.status),
  ]),
);

function abilityNamesWithScope(scope: AbilityScopeStatus): string[] {
  return [...REFERENCE_ABILITY_SCOPE.entries()]
    .filter(([, value]) => value === scope)
    .map(([name]) => name);
}

export const REFERENCE_OUT_OF_MODEL_ABILITY_NAMES: string[] = abilityNamesWithScope("out-of-model");
export const REFERENCE_SPEED_BUILDS_ONLY_ABILITY_NAMES: string[] =
  abilityNamesWithScope("speed-builds-only");
export const REFERENCE_PARTIAL_ABILITY_NAMES: string[] = abilityNamesWithScope("partial");
export const REFERENCE_NOT_MODELED_ABILITY_NAMES: string[] = abilityNamesWithScope("not-modeled");
export const REFERENCE_MODELED_ABILITY_NAMES: string[] = abilityNamesWithScope("modeled");

export const STATUS_REFERENCE_DRAFTS: StatusReferenceEntry[] = [
  {
    id: "status_acid_rain",
    name: "Acid Rain",
    status: "Modeled",
    summary: "Weather-style damage over time that also inflicts Poison; affects every creature.",
    mechanics: [
      "Acid Rain deals 3% max HP damage every 3 seconds, regardless of stack count.",
      "Each Acid Rain tick also applies 2 stacks of Poison to the same target.",
      "Stacks act as duration: each stack corresponds to 3 seconds of ticking time.",
      "No creature is immune - Acid Rain applies to every creature on the field.",
      "As a weather effect it is a single permanent stack for the whole fight.",
      "Being permanent, it survives a Fortify cleanse and does not count toward what Fortify needs to fire. See Fortify.",
    ],
    specConstants: [
      { key: "acid_rain_dot_pct_max_hp", value: 3, quote: "deals 3% max HP damage" },
    ],
    notes: [
      "Acid Rain is the weather counterpart of Heat Wave and Hypothermia and shares the same weather-status shape.",
      "The 2 stacks of Poison applied on tick obey the usual Poison rules.",
      "The timeline can show Acid Rain damage ticks and the resulting Poison ticks.",
    ],
  },
  {
    id: "status_aftershock",
    name: "Aftershock",
    status: "Modeled",
    summary: "Multiplicatively reduces the affected creature's outgoing melee damage by 20% while present.",
    mechanics: [
      "Aftershock reduces the affected creature's outgoing melee damage by 20% multiplicatively while at least one stack is present.",
      "Stacks set how long Aftershock lasts and not how deep it goes: the reduction is 20% at one stack and at ten.",
      "Each stack decays on the standard schedule.",
    ],
    specConstants: [
      { key: "aftershock_outgoing_damage_reduction_pct", value: 20, quote: "outgoing melee damage by 20%" },
    ],
    notes: [
      "Polarity is negative - Fortify cleanses it.",
      "Reaches the opponent through Yolk Bomb (Zeoarex) and Lich Mark (Garluhmoat), which route Aftershock as an enemy status.",
      "Earthquake's in-game self-application of 4 stacks of Aftershock on the user is out of the stand-and-fight model, as are Earthquake's other effects (Injury, Broken Bones, Shredded Wings).",
    ],
  },
  {
    id: "status_aggressive",
    name: "Aggressive",
    status: "Modeled",
    summary: "Multiplicatively increases outgoing melee damage by 25% for 10 seconds.",
    mechanics: [
      "Aggressive increases outgoing melee damage by 25% multiplicatively while active.",
      "Default duration is 10 seconds.",
      "The emote grants 10 stacks, and one comes off each second.",
      "The stacks set the duration and not the strength: the 25% is the same at 1 stack as at 10.",
      "While the affected creature is stationary (No Move Facetank on), Aggressive does not decay, so its 25% holds for the whole fight.",
      "Moving restores the normal 10-second expiry, including under a trail or step ability that temporarily turns No Move Facetank off.",
    ],
    specConstants: [
      { key: "aggressive_outgoing_damage_increase_pct", value: 25, quote: "by 25% multiplicatively while active" },
      { key: "aggressive_duration_sec", value: 10, quote: "Default duration is 10 seconds" },
      { key: "aggressive_max_stacks", value: 10, quote: "The emote grants 10 stacks" },
    ],
    notes: [
      "Fortify cleanses negative statuses only, and this one is positive.",
      "In Compare, the Aggressive buff applies this status with a 10-second duration.",
      "This is the inverse of how persistent ailments behave under the same setting. See No Move Facetank.",
      "The Bear plushie replaces this status with Aggressive (Bear). See Bear and Aggressive (Bear).",
    ],
  },
  {
    id: "status_aggressive_bear",
    name: "Aggressive (Bear)",
    status: "Modeled",
    summary: "Bear-plushie variant of Aggressive: +37.5% outgoing melee damage for 10 seconds.",
    mechanics: [
      "Aggressive (Bear) increases outgoing melee damage by 37.5% multiplicatively for 10 seconds.",
      "The Bear plushie replaces Aggressive with this status.",
      "It does not decay while the affected creature is stationary. See No Move Facetank.",
      "Once the creature moves it expires after 10 seconds, like base Aggressive.",
    ],
    notes: [
      "Fortify cleanses negative statuses only, and this one is positive.",
      "See Bear for the full modifier formula.",
    ],
  },
  {
    id: "status_ailment_block",
    isSystemRule: true,
    name: "Ailment Block",
    status: "Modeled",
    summary: "How a creature's resistances and its plushies decide how much of an incoming ailment actually lands.",
    mechanics: [
      "A block is a fraction of the incoming stacks, not of the damage those stacks deal. Blocking 25% of Frostbite means a quarter fewer stacks land, and every stack that does land is full strength.",
      "Three channels carry a block: the creature's own per-ailment resistance, the sum of its plushies' per-ailment blocks, and the elder's all-ailment block. See Elder and Trait Choice.",
      "Plushies on the same ailment are summed first, so one plushie's block and another's weakness cancel before anything else happens.",
      "The positive side of all three channels is added together and capped at 1. A creature at 1 takes no stacks of that ailment at all.",
      "A negative fraction is a weakness rather than a broken block. Each per-ailment channel multiplies the incoming stacks by 1 plus its own weakness, so a native weakness and a plushie weakness compound.",
      "A weakness on one ailment never touches another: the two sides are computed per ailment, and only the elder's block is shared across all of them.",
      "Healing applications ignore the block entirely.",
      "Warden's Resistance and an immunity resolve before any block fraction is read: they turn the application away entirely rather than scaling it.",
    ],
    notes: [
      "Radiation lowers the two per-ailment channels while it sits on the creature and leaves the elder's all-ailment block alone. See Radiation.",
      "Sparkler is the clearest case of the weakness half: three blocks and a Bleed weakness on one plushie. See Sparkler.",
    ],
  },
  createTrackedOnlyStatusEntry("Ashy Lungs", "negative"),
  {
    id: "status_bad_omen",
    name: "Bad Omen",
    status: "Modeled",
    summary: "Reduces passive health regeneration and applies one random follow-up status at its expiry.",
    mechanics: [
      "Bad Omen reduces passive health regeneration by 25% while it is active.",
      "When Bad Omen expires, it applies one follow-up status.",
      "That follow-up status is one of the following, each at a fixed stack count: 5 stacks of Frostbite, 8 stacks of Burn, 10 stacks of Bleed, 5 stacks of Corrosion, 3 stacks of Confusion, 3 stacks of Shredded Wings, 20 stacks of Disease, 10 stacks of Injury, 10 stacks of Necropoison, or 10 stacks of Poison.",
      "In Best Builds and Optimizer, the follow-up status is fixed to 8 stacks of Burn for the whole calculation cycle.",
    ],
    specConstants: [
      { key: "bad_omen_regen_reduction_pct", value: 25, quote: "reduces passive health regeneration by 25%" },
    ],
    notes: [
      "Cursed Sigil and Lich Mark apply Bad Omen.",
      "In Compare, the follow-up status is rolled randomly at each expiry, so two runs of one fight can land different statuses.",
      "The follow-up lands through the normal status-application path, so it appears in the timeline as a status applied by Bad Omen when it expires.",
    ],
  },
  {
    id: "status_bleed",
    name: "Bleed",
    status: "Modeled",
    summary: "Deals flat damage on each tick and stops natural health regeneration.",
    mechanics: [
      "Bleed ticks every 3 seconds and deals 2 flat damage per stack on each tick. The 2 is per tick, not per second.",
      "Bleed blocks natural health regeneration completely.",
    ],
    specConstants: [
      { key: "bleed_damage_per_stack_per_tick", value: 2, quote: "2 flat damage per stack on each tick" },
    ],
    notes: [
      "The timeline can show Bleed damage ticks.",
    ],
  },
  {
    id: "status_blessings_boon",
    name: "Blessing's Boon",
    status: "Modeled",
    summary: "Restores health over time.",
    mechanics: [
      "Blessing's Boon restores 3% max HP every 3 seconds while it is active.",
    ],
    specConstants: [
      { key: "blessings_boon_heal_pct_max_hp", value: 3, quote: "restores 3% max HP" },
    ],
    notes: [
      "The timeline can show Blessing's Boon heal ticks.",
    ],
  },
  createTrackedOnlyStatusEntry("Blurred Vision", "negative"),
  createTrackedOnlyStatusEntry("Broken Bones", "negative"),
  createTrackedOnlyStatusEntry("Broken Legs", "negative", [
    "Distinct from Broken Bones, which is tracked separately.",
  ]),
  {
    id: "status_burn",
    name: "Burn",
    status: "Modeled",
    summary: "Deals percent max HP damage over time and weakens natural health regeneration.",
    mechanics: [
      "Burn deals damage every 3 seconds.",
      "Its damage is 0.025% max HP base plus 0.1% per remaining stack at the moment of the tick.",
      "Each tick first applies natural decay (one stack expires) and then deals damage using the post-decay stack count. If decay just removed the last stack, the tick still fires once with the base contribution because the effect existed at the start of the tick.",
      "On a stationary target a single Burn stack decays to zero before damage is calculated, so the lone tick deals only the base 0.025% max HP. On a moving target (No Move Facetank disabled) decay is suppressed for that tick, so the same single stack deals 0.025% + 0.1% = 0.125% max HP - five times the stationary value at one stack. The gap shrinks as stacks grow (1.108x at ten stacks).",
      "Each Burn stack also reduces natural health regeneration by 10%.",
      "At 10 Burn, natural health regeneration is fully blocked.",
      "The decay-before-damage tick order is shared by all persistent PvP ailments (Poison, Bleed, Corrosion, Necropoison, Frostbite).",
    ],
    specConstants: [
      { key: "burn_dot_base_pct_max_hp", value: 0.025, quote: "0.025% max HP base" },
      { key: "burn_dot_per_stack_pct_max_hp", value: 0.1, quote: "0.1% per remaining stack" },
    ],
    notes: [
      "The timeline can show Burn damage ticks.",
    ],
  },
  {
    id: "status_clean_water",
    name: "Clean Water",
    status: "Modeled",
    summary: "Boosts health regeneration by 20% for 180 seconds.",
    mechanics: [
      "Clean Water increases health regeneration by 20% multiplicatively while active.",
      "Default duration is 180 seconds.",
    ],
    notes: [
      "In Compare, the Clean Water buff applies this status.",
    ],
  },
  createTrackedOnlyStatusEntry("Confusion", "negative"),
  {
    id: "status_corrosion",
    name: "Corrosion",
    status: "Modeled",
    summary: "Deals percent max HP damage over time and reduces effective weight.",
    mechanics: [
      "Corrosion deals 0.5% max HP damage every 3 seconds.",
      "It also reduces effective weight while it is active.",
      "Its weight reduction starts at 7.5% and increases by 1% per stack.",
      "That reduction is capped at 97.5%.",
      "Corrosion stops stacking at 90 stacks, which is exactly where its weight reduction reaches that cap.",
      "1 Corrosion stack gives 8.5% weight reduction.",
      "When Corrosion is applied through an offensive direct attack payload, its applied stacks are multiplied by (1 + min(ratio, 3)) / 2, where ratio is attacker effective weight / defender effective weight.",
      "That means equal weight gives 1.0x stacks, a 2:1 weight advantage gives 1.5x stacks, and any 3:1 or larger advantage gives 2.0x stacks.",
      "An attacker lighter than the target lands fewer stacks: at half the target weight the factor is 0.75, at a quarter it is 0.625.",
    ],
    specConstants: [
      { key: "corrosion_dot_pct_max_hp", value: 0.5, quote: "deals 0.5% max HP damage" },
      { key: "corrosion_weight_reduction_base_pct", value: 7.5, quote: "starts at 7.5%" },
      { key: "corrosion_weight_reduction_per_stack_pct", value: 1, quote: "increases by 1% per stack" },
      { key: "corrosion_weight_reduction_cap_pct", value: 97.5, quote: "capped at 97.5%" },
      { key: "corrosion_max_stacks", value: 90, quote: "stops stacking at 90 stacks" },
    ],
    notes: [
      "The timeline can show Corrosion damage ticks.",
    ],
  },
  {
    id: "status_deep_wounds",
    name: "Deep Wounds",
    status: "Modeled",
    summary: "Prevents Bleed from decaying while it is active.",
    mechanics: [
      "Deep Wounds blocks natural Bleed decay while it is active.",
      "Bleed stacks already on the creature are held at their count until Deep Wounds expires; Bleed applied during the window is held too.",
    ],
    notes: [
      "Serrated Teeth, Gore Charge and the Gore kind of Charge apply Deep Wounds.",
      "The timeline can show when Deep Wounds is applied.",
    ],
  },
  {
    id: "status_disease",
    name: "Disease",
    status: "Modeled",
    summary: "Cuts natural health regeneration by a fixed 25% and drains the hunger and thirst meters faster with every stack.",
    mechanics: [
      "Disease reduces natural health regeneration by 25%.",
      "That regen cut is a fixed 0.75x on health regeneration and does not change with the number of Disease stacks.",
      "Disease also drains the hunger and thirst meters faster, and that part does change with the stack count.",
      "Each meter's seconds-per-unit interval is multiplied by 0.8 - 0.015 × stacks, so 1 stack drains 1.27x faster and 5 stacks 1.38x faster.",
      "When Disease is applied through an offensive direct attack payload, its applied stacks are multiplied by (1 + min(ratio, 3)) / 2, where ratio is attacker effective weight / defender effective weight.",
      "That means equal weight gives 1.0x stacks, a 2:1 weight advantage gives 1.5x stacks, and any 3:1 or larger advantage gives 2.0x stacks.",
      "An attacker lighter than the target lands fewer stacks: at half the target weight the factor is 0.75, at a quarter it is 0.625.",
    ],
    specConstants: [
      { key: "disease_regen_reduction_pct", value: 25, quote: "reduces natural health regeneration by 25%" },
    ],
    notes: [
      "Disease is applied by Aura, Plague Breath, Plague Trail, and a Bad Omen follow-up.",
    ],
  },
  {
    id: "status_drowsy",
    name: "Drowsy",
    status: "Modeled",
    summary: "Increases bite cooldown by 35%, however many stacks are on the creature.",
    mechanics: [
      "Drowsy increases bite cooldown by 35% while it is active.",
      "It compounds with the other bite-cooldown statuses rather than adding to them. See Sticky Teeth.",
      "The number of stacks only affects how long Drowsy lasts.",
    ],
    specConstants: [
      { key: "drowsy_bite_cooldown_increase_pct", value: 35, quote: "increases bite cooldown by 35%" },
    ],
    notes: [
      "Drowsy Area and Lich Mark apply Drowsy.",
      "The timeline can show when Drowsy is applied.",
    ],
  },
  {
    id: "status_fear",
    movesSpeed: true,
    name: "Fear",
    status: "Modeled",
    summary: "Reduces outgoing melee damage and raises movement speed.",
    mechanics: [
      "Fear reduces outgoing melee damage by 45% while it is active.",
      "Fear multiplies the affected creature's walk, swim, sprint and flight speeds by 1.35.",
      "The number of stacks only affects how long Fear lasts.",
    ],
    specConstants: [
      { key: "fear_outgoing_damage_reduction_pct", value: 45, quote: "reduces outgoing melee damage by 45%" },
    ],
    notes: [
      "Fear is applied by Cause Fear and by Spirit Glare.",
      "The timeline can show when Fear is applied.",
      "Fear's speed side reaches Speed Builds and not Compare, so a fight sees the damage reduction alone.",
    ],
  },
  createTrackedOnlyStatusEntry("Flowering", "positive"),
  createTrackedOnlyStatusEntry("Freeze", "negative"),
  {
    id: "status_frostbite",
    name: "Frostbite",
    status: "Modeled",
    summary: "Increases bite cooldown by 2.5% for every stack carried.",
    mechanics: [
      "Frostbite increases bite cooldown by 2.5% per stack while it is active.",
      "Its strength scales directly with stacks, fractional ones included: half a stack is +1.25%.",
      "It compounds with the other bite-cooldown statuses rather than adding to them. See Sticky Teeth.",
    ],
    specConstants: [
      { key: "frostbite_bite_cooldown_increase_pct_per_stack", value: 2.5, quote: "increases bite cooldown by 2.5% per stack" },
    ],
    notes: [
      "The timeline can show when Frostbite is applied.",
    ],
  },
  createTrackedOnlyStatusEntry("Gale", "negative"),
  {
    id: "status_guardians_seal",
    name: "Guardian's Seal",
    status: "Modeled",
    summary: "Cuts incoming damage from every source by 85%, after every other reduction the defender has.",
    mechanics: [
      "Guardian's Seal reduces incoming damage by 85% while at least one stack is present.",
      "Stacks set how long the seal lasts and not how deep it goes: the reduction is 85% at one stack and at three.",
      "The reduction covers every source that can take HP off the affected creature: bites, breath, damage over time, trails, reflected damage and ability bursts.",
      "The seal applies last, to the damage every other reduction has already left.",
      "Each stack decays on the standard 3 second schedule.",
      "The seal holds at most 3 stacks.",
    ],
    specConstants: [
      { key: "guardian_seal_damage_reduction_pct", value: 85, quote: "reduces incoming damage by 85%" },
      { key: "guardian_seal_max_stacks", value: 3, quote: "seal holds at most 3 stacks" },
    ],
    notes: [
      "Fortify cleanses negative statuses only, and this one is positive.",
      "Guardians Passage applies it. In Compare, the Guardian's Seal buff applies it at the start of the fight, standing in for a packmate who sealed the creature before the fight began.",
    ],
  },
  {
    id: "status_healing_ailment",
    name: "Healing Ailment",
    status: "Modeled",
    summary: "A scheduled heal that lands on top of natural regeneration and is scaled only by posture.",
    mechanics: [
      "Healing Ailment fires a discrete heal every 15 seconds while the status is active.",
      "Each heal restores 7% of the target's max HP at its base rate.",
      "The 7% is added on top of natural health regeneration after every other multiplier, so no regeneration modifier scales it.",
      "It keeps healing even while natural regen is zeroed.",
      "Only the recipient's posture multiplies it (1.5x sitting, 2x laying).",
      "Stacks act as duration: 10 stacks corresponds to about 30 seconds of coverage (2 heal ticks). More stacks extend the window proportionally.",
    ],
    specConstants: [
      { key: "healing_ailment_heal_pct_max_hp", value: 7, quote: "restores 7% of the target's max HP" },
      { key: "healing_ailment_tick_sec", value: 15, quote: "every 15 seconds" },
    ],
    notes: [
      "Applied by Healing Pulse, which runs behind its own battle setting.",
      "The timeline can show Healing Ailment heal ticks.",
    ],
  },
  {
    id: "status_heartbroken",
    name: "Heartbroken",
    status: "Modeled",
    summary: "Blocks every heal except the creature's own natural health regeneration.",
    mechanics: [
      "Heartbroken blocks all healing sources except the creature's natural health regeneration.",
    ],
    notes: [
      "The timeline shows Heartbroken as an applied effect.",
    ],
  },
  {
    id: "status_heat_wave",
    name: "Heat Wave",
    status: "Modeled",
    summary: "Weather-style damage over time that also inflicts Burn; never lands on a creature with Volcanic.",
    mechanics: [
      "Heat Wave deals 1% max HP damage every 3 seconds, regardless of stack count.",
      "Each Heat Wave tick also applies 2 stacks of Burn to the same target.",
      "Stacks act as duration: each stack corresponds to 3 seconds of ticking time.",
      "Creatures with the Volcanic ability are immune - Heat Wave is not applied to them.",
      "The Heat Wave stack itself is permanent, so it survives a Fortify cleanse and does not count toward what Fortify needs to fire. See Fortify.",
    ],
    specConstants: [
      { key: "heat_wave_dot_pct_max_hp", value: 1, quote: "deals 1% max HP damage" },
    ],
    notes: [
      "Heat Wave is the offensive counterpart to Hypothermia and shares the same weather-status shape.",
      "The 2 stacks of Burn applied on tick obey the usual Burn rules, including their own damage ticks and the health regeneration penalty they carry.",
      "The timeline can show Heat Wave damage ticks and the resulting Burn ticks.",
    ],
  },
  {
    id: "status_hungry",
    name: "Hungry",
    status: "Modeled",
    summary: "Starvation damage carried by an empty appetite meter, which also stops health regeneration.",
    mechanics: [
      "Hungry lands the moment the hunger meter reaches zero and is removed the moment the meter is no longer empty.",
      "Every 36 seconds after the meter reaches zero the creature gains another stack. Anything that speeds the drain up brings the next stack sooner.",
      "Each stack deals 0.5% max HP every 3 seconds.",
      "A tick never deals less than 1 damage.",
      "Health regeneration stops entirely while Hungry is present, at any stack count.",
      "The damage is unblockable - no block stat or resistance reduces it.",
      "Photovore creatures have no hunger meter and never get Hungry.",
    ],
    notes: [
      "Thirsty is the same effect on the thirst meter. See Thirsty.",
      "The timeline can show Hungry damage ticks.",
    ],
  },
  {
    id: "status_hypothermia",
    name: "Hypothermia",
    status: "Modeled",
    summary: "Weather-style damage over time; never lands on a creature with Frosty.",
    mechanics: [
      "Hypothermia deals 0.75% max HP damage every 3 seconds, regardless of stack count.",
      "Stacks act as duration: each stack corresponds to 3 seconds of ticking time.",
      "Creatures with the Frosty ability are immune - Hypothermia is not applied to them.",
      "As a weather effect (Blizzard) it is a single stack that never decays; ability-applied stacks follow the standard stack-as-duration model.",
      "The weather stack survives a Fortify cleanse and does not count toward what Fortify needs to fire; an ability-applied stack is cleansed normally. See Fortify.",
      "An ability-applied Hypothermia stack decays only while the creature is stationary: it is held while the creature moves and comes down under No Move Facetank. The permanent weather stack never decays either way. See No Move Facetank.",
      "Laying down nullifies the Hypothermia damage tick (any source) while the creature stays settled in the Laying posture; the status itself persists.",
    ],
    specConstants: [
      { key: "hypothermia_dot_pct_max_hp", value: 0.75, quote: "deals 0.75% max HP damage" },
    ],
    notes: [
      "The timeline can show Hypothermia damage ticks.",
    ],
  },
  {
    id: "status_injury",
    name: "Injury",
    status: "Partial",
    summary: "Carried on the affected creature with no combat effect of its own; only the stack count it lands at is computed.",
    mechanics: [
      "The model records Injury as present on the affected creature and decays it on the standard schedule.",
      "It moves no combat figure, so a fight runs identically without it.",
      "When Injury is applied through an offensive direct attack payload, its applied stacks are multiplied by (1 + min(ratio, 3)) / 2, where ratio is attacker effective weight / defender effective weight.",
      "That means equal weight gives 1.0x stacks, a 2:1 weight advantage gives 1.5x stacks, and any 3:1 or larger advantage gives 2.0x stacks.",
      "An attacker lighter than the target lands fewer stacks: at half the target weight the factor is 0.75, at a quarter it is 0.625.",
    ],
    notes: [
      "Effects outside direct combat, such as movement, vision, thirst and breeding, do not reach the stand-and-fight model.",
    ],
  },
  {
    id: "status_malices_mark",
    name: "Malice's Mark",
    status: "Modeled",
    summary: "Multiplies the affected creature's outgoing melee damage by 0.85.",
    mechanics: [
      "Malice's Mark reduces outgoing melee damage by 15% while it is active.",
    ],
    specConstants: [
      { key: "malices_mark_outgoing_damage_reduction_pct", value: 15, quote: "reduces outgoing melee damage by 15%" },
    ],
    notes: [
      "The timeline can show when Malice's Mark is applied.",
    ],
  },
  {
    id: "status_muddy",
    name: "Muddy",
    status: "Modeled",
    summary: "Increases health regeneration by 25% and doubles how fast Bleed and Poison decay.",
    mechanics: [
      "Muddy increases health regeneration by 25% multiplicatively while active.",
      "The Oceanwing plushie strengthens that bonus. See Oceanwing.",
      "Muddy doubles the rate at which Bleed and Poison decay.",
      "Re-applying Muddy refreshes its duration rather than adding a second instance.",
      "Rolling in a mud pile applies Muddy for 90 seconds.",
      "Cloud Breath applies Muddy for 2 seconds.",
    ],
    notes: [
      "A Land plushie multiplies that duration. See Land.",
    ],
  },
  {
    id: "status_natural_regeneration",
    isSystemRule: true,
    name: "Natural Regeneration",
    status: "Modeled",
    summary: "The passive heal on a fixed 15-second clock, computed from the creature's health regen stat and every modifier acting on it.",
    mechanics: [
      "Natural regeneration ticks every 15 seconds, and the first tick lands at 15 seconds rather than at the start of the fight.",
      "One tick heals max HP × health regen × M / 100, where health regen is the creature's stat and M is the product of every regeneration modifier in effect at that moment.",
      "A creature whose health regen stat is 0 never ticks at all.",
      "A tick is skipped while the creature is at full HP, and a heal stops at full.",
      "A modifier that raises or lowers health regeneration by a percentage moves M, not the interval.",
    ],
    specConstants: [
      { key: "natural_regen_interval_sec", value: 15, quote: "ticks every 15 seconds" },
    ],
    notes: [
      "A tick that would land while regeneration is fully blocked is held rather than lost. See Buffered natural regeneration.",
      "Healing Ailment runs on its own 15-second clock rather than on this one.",
    ],
  },
  {
    id: "status_necropoison",
    name: "Necropoison",
    status: "Modeled",
    summary: "At 10 stacks the affected creature can fire no active ability except Warden's Rage.",
    mechanics: [
      "Necropoison blocks new active ability activations at 10 stacks and above.",
      "Warden's Rage is not blocked by Necropoison.",
    ],
    notes: [
      "The timeline can show when Necropoison is applied.",
    ],
  },
  {
    id: "status_newborn",
    name: "Newborn",
    status: "Modeled",
    summary: "The grace a freshly hatched creature gets: faster healing and slower meters.",
    mechanics: [
      "Newborn raises passive health regeneration by 50%.",
      "It stretches both drain intervals by 1.25x, so hunger and thirst drain about 20% slower.",
    ],
    notes: [],
  },
  createTrackedOnlyStatusEntry("Paralyze", "negative"),
  {
    id: "status_poison",
    name: "Poison",
    status: "Modeled",
    summary: "Deals percent max HP damage over time, deepening with each stack.",
    mechanics: [
      "Poison deals damage every 3 seconds.",
      "Its damage starts at 0.2% max HP and increases by 0.05% per stack.",
    ],
    specConstants: [
      { key: "poison_dot_base_pct_max_hp", value: 0.2, quote: "starts at 0.2% max HP" },
      { key: "poison_dot_per_stack_pct_max_hp", value: 0.05, quote: "increases by 0.05% per stack" },
    ],
    notes: [
      "The timeline can show Poison damage ticks.",
    ],
  },
  {
    id: "status_radiation",
    name: "Radiation",
    status: "Modeled",
    summary: "Lowers the target's blocks against every other ailment and deals a flat damage over time.",
    mechanics: [
      "Radiation stacks up to 99.",
      "Radiation lowers the target's positive ailment blocks for every other ailment, and not its own.",
      "The reduction is 99 × ((stacks / 99) ^ 2.5) percent of the block, applied multiplicatively. At the 99-stack cap the block is lowered by 99%.",
      "The reduction applies to the creature's native per-ailment block and any plushie per-ailment block (the specific block stats).",
      "The elder's all-ailment block is left intact. See Ailment Block.",
      "Ailment blocks do not scale into the negatives - a reduced positive block floors at 0.",
      "Ailment weaknesses (negative blocks) are not lowered or altered in any way.",
      "Radiation deals 0.5% max HP damage per tick. This damage is flat and does not scale with stacks.",
      "Each radiated fighter's tick is multiplied by 1 + N, where N is the Nearby radiated creatures count plus 1 when the opposing fighter is also radiated.",
      "Radiation ticks every 3 seconds, like the other percent-max-HP ailments.",
      "Radiation is applied at flat stacks: unlike Corrosion, Disease, Injury and Torn Ligaments, it does not weight-scale its applied stacks on an offensive payload.",
    ],
    specConstants: [
      { key: "radiation_dot_pct_max_hp", value: 0.5, quote: "0.5% max HP damage per tick" },
    ],
    notes: [
      "Radiation does not lower breath resistance.",
      "Radiation does not affect the ailment resistance granted by Warden's Rage and Warden's Resistance.",
      "In Compare, the Nearby radiated creatures count stands in for radiated creatures the fight does not otherwise carry; at its default of 0 a tick is the plain 0.5%.",
      "Polarity is negative - Fortify cleanses it.",
    ],
  },
  {
    id: "status_refreshed",
    name: "Refreshed",
    status: "Modeled",
    summary: "Increases health regeneration by 5% for 180 seconds.",
    mechanics: [
      "Refreshed increases health regeneration by 5% multiplicatively while active.",
      "Default duration is 180 seconds.",
    ],
    notes: [
      "In Compare, the Refreshed buff applies this status.",
    ],
  },
  {
    id: "status_satiated",
    name: "Satiated",
    status: "Modeled",
    summary: "A well-fed creature burns through its hunger meter more slowly.",
    mechanics: [
      "Satiated stretches the interval between hunger units by 1.3x, so hunger drains about 23% slower.",
      "It does not touch thirst.",
    ],
    notes: [],
  },
  {
    id: "status_scared",
    name: "Scared",
    status: "Modeled",
    summary: "Multiplicatively reduces outgoing melee damage by 50% for 10 seconds.",
    mechanics: [
      "Scared reduces outgoing melee damage by 50% multiplicatively while active.",
      "Default duration is 10 seconds.",
      "The emote grants 10 stacks, and one comes off each second.",
      "The stacks set the duration and not the strength: the 50% reduction is the same at 1 stack as at 10.",
    ],
    specConstants: [
      { key: "scared_outgoing_damage_reduction_pct", value: 50, quote: "reduces outgoing melee damage by 50%" },
      { key: "scared_duration_sec", value: 10, quote: "Default duration is 10 seconds" },
      { key: "scared_max_stacks", value: 10, quote: "The emote grants 10 stacks" },
    ],
    notes: [
      "In Compare, the Scared buff applies this status with the standard 10-second duration.",
      "The Bear plushie replaces this status with Scared (Bear). See Bear and Scared (Bear).",
    ],
  },
  {
    id: "status_scared_bear",
    name: "Scared (Bear)",
    status: "Modeled",
    summary: "Bear-plushie variant of Scared: -45% outgoing melee damage for 10 seconds.",
    mechanics: [
      "Scared (Bear) reduces outgoing melee damage by 45% multiplicatively for 10 seconds.",
      "The Bear plushie replaces Scared with this status.",
    ],
    notes: [
      "Polarity is negative - Fortify cleanses it.",
      "See Bear for the full modifier formula.",
    ],
  },
  createTrackedOnlyStatusEntry("Shock", "negative"),
  {
    id: "status_shredded_wings",
    name: "Shredded Wings",
    status: "Modeled",
    summary: "Grounds an airborne creature so it can no longer dodge under the Aerial Dodge rule.",
    mechanics: [
      "Wing Shredder, Power Charge, Crystal Breath, Rock Breath, Yolk Bomb and a Bad Omen follow-up all apply Shredded Wings.",
      "While a creature has Shredded Wings, the Aerial Dodge rule can no longer make it dodge: every incoming bite and breath lands on it.",
      "With the Aerial Dodge rule off, the status has no separate combat effect in the stand-and-fight model.",
    ],
    notes: [],
  },
  {
    id: "status_sickly",
    name: "Sickly",
    status: "Modeled",
    summary: "Reduces the affected creature's passive health regeneration by 20% and adds a hunger-drain penalty.",
    mechanics: [
      "Sickly reduces passive health regen by 20% multiplicatively.",
      "The regen effect applies as a flat percentage and does not scale with stacks.",
      "While Use hunger rules is enabled, Sickly also raises the affected creature's hunger and thirst drain by 25% - the seconds-per-unit interval on both meters is multiplied by 0.8.",
      "The only source in the current model is Defiled Ground: it applies Sickly permanently to the opponent standing on the contaminated land, re-applied continuously with an effectively unbounded stack limit.",
    ],
    specConstants: [
      { key: "sickly_regen_reduction_pct", value: 20, quote: "reduces passive health regen by 20%" },
    ],
    notes: [
      "Polarity is negative. A decaying Sickly instance is Fortify-cleansable, but the Defiled Ground instance never decays and is not - matching the game, which re-applies it every tick.",
      "Sickly decays only while the creature is stationary: it is held while the creature moves and comes down under No Move Facetank. Its only source applies it permanently, so it never decays in practice. See No Move Facetank.",
    ],
  },
  createTrackedOnlyStatusEntry("Slowed", "negative"),
  {
    id: "status_spring_water",
    name: "Spring Water",
    status: "Modeled",
    summary: "A drink from a magical source, which slows the thirst meter.",
    mechanics: [
      "Spring Water stretches the interval between thirst units by 1.3x, so thirst drains about 23% slower.",
      "It does not touch hunger.",
    ],
    notes: [],
  },
  {
    id: "status_sticky_teeth",
    name: "Sticky Teeth",
    status: "Modeled",
    summary: "Increases bite cooldown by 65%, however many stacks are on the creature.",
    mechanics: [
      "Sticky Teeth increases bite cooldown by 65% while it is active.",
      "It compounds with the other bite-cooldown statuses rather than adding to them: the multipliers are applied in sequence, so Sticky Teeth and Drowsy together are 1.65 × 1.35 = 2.2275x, not 2.00x.",
      "The number of stacks only affects how long Sticky Teeth lasts.",
    ],
    specConstants: [
      { key: "sticky_teeth_bite_cooldown_increase_pct", value: 65, quote: "increases bite cooldown by 65%" },
    ],
    notes: [
      "Sticky Fur is the only ability in the model that applies Sticky Teeth.",
      "The timeline can show when Sticky Teeth is applied.",
    ],
  },
  createTrackedOnlyStatusEntry("Sticky Trap", "negative"),
  createTrackedOnlyStatusEntry("Stolen Speed", "negative"),
  {
    id: "status_territory",
    name: "Territory",
    status: "Modeled",
    summary: "Standing inside the creature's own territory slows the hunger meter.",
    mechanics: [
      "Territory stretches the interval between hunger units by 1.2x, so hunger drains about 17% slower.",
      "It does not touch thirst.",
    ],
    notes: [
      "A territory belongs to one creature's own build, so one fighter can be standing in one while the other is not.",
    ],
  },
  {
    id: "status_thirsty",
    name: "Thirsty",
    status: "Modeled",
    summary: "Dehydration damage carried by an empty thirst meter, which also stops health regeneration.",
    mechanics: [
      "Thirsty is Hungry on the thirst meter: same stack rule, same damage, same regeneration block.",
      "Aquatic and Photocarnivore creatures have no thirst meter and never get Thirsty.",
    ],
    notes: [
      "See Hungry for the numbers. Both can be present at once on a creature that carries both meters.",
    ],
  },
  createTrackedOnlyStatusEntry("Torn Ligaments", "negative"),
  createTrackedOnlyStatusEntry("Tunnel Vision", "negative"),
  createTrackedOnlyStatusEntry("Water Regeneration", "positive"),
];

export const PLUSHIE_REFERENCE_DRAFTS: PlushieReferenceEntry[] = [
  {
    id: "plushie_aerix",
    name: "Aerix",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_aerodon",
    name: "Aerodon",
    status: "Modeled",
    summary: "Decreases thirst drain by 15%.",
    mechanics: [
      "Aerodon slows thirst drain by 15% multiplicatively.",
      "Stackable.",
    ],
    notes: [
    ],
  },
  {
    id: "plushie_arcane",
    name: "Arcane",
    status: "Modeled",
    summary: "Increases breath damage by 12.5%.",
    mechanics: [
      "Arcane increases breath damage by 12.5% multiplicatively.",
      "Unique - equipping two Arcane is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_astral_quetzal",
    movesSpeed: true,
    name: "Astral Quetzal",
    status: "Modeled",
    summary: "Adds 50 percentage points of breath resistance and blocks 50% of incoming Bleed stacks, at the cost of 5% of movement speed and 25% of health regeneration.",
    mechanics: [
      "Astral Quetzal increases breath resistance by 50 percentage points.",
      "Astral Quetzal blocks 50% of incoming Bleed stacks.",
      "Block scales the stacks that land, not the damage each one deals. See Ailment Block.",
      "Astral Quetzal reduces all movement speeds by 5% multiplicatively.",
      "Astral Quetzal reduces health regeneration by 25% multiplicatively.",
      "Unique - equipping two Astral Quetzal is not allowed.",
    ],
    notes: [
      "The speed cost reaches Speed Builds and not Compare.",
      "The game halves incoming breath damage outright. Here the 50 points are added to the creature's own breath resistance, which comes to the same halving on a creature that has none.",
    ],
  },
  {
    id: "plushie_baby_dragon",
    name: "Baby Dragon",
    status: "Modeled",
    summary: "Increases the rate breath capacity refills by 20%.",
    mechanics: [
      "Baby Dragon increases the rate breath capacity refills by 20% multiplicatively: the seconds a breath takes to refill 1 unit are divided by 1.2.",
      "The refill cannot be driven below 0.5 seconds per unit, so a breath already at or under 0.5 seconds gains nothing.",
      "Does not affect Solar Beam, Spirit Glare and Heliolyth's Judgement, which fire on a fixed 120 second cooldown instead of refilling.",
      "Unique - equipping two Baby Dragon is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_bear",
    name: "Bear",
    status: "Modeled",
    summary: "Multiplies the Aggressive and Scared emote buffs by 1.1.",
    mechanics: [
      "Bear multiplies the Aggressive emote's damage factor by 1.1, taking it from +25% to +37.5% outgoing damage.",
      "Bear multiplies the Scared emote's damage factor by 1.1, taking it from -50% to -45% outgoing damage.",
      "Bear moves no stat of its own.",
      "Unique - equipping two Bear is not allowed.",
    ],
    notes: [
      "In Compare, the boost applies only while the matching emote is one of the buffs held.",
      "The same 1.1 applies to the Scared posture's speed side in Speed Builds. See Cower in Movement Speed.",
    ],
  },
  {
    id: "plushie_blessed_bean",
    name: "Blessed Bean",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_bunny",
    movesSpeed: true,
    name: "Bunny",
    status: "Speed-Builds-only",
    summary: "Increases the ambush multiplier by 7.5%.",
    mechanics: [
      "Bunny increases the ambush multiplier by 7.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [
      "In game, the boosted multiplier is held to a floor of 1.1. No floor is applied here, because no creature carrying the ambush multiplier starts low enough to reach it.",
    ],
  },
  {
    id: "plushie_cat",
    name: "Cat",
    status: "Modeled",
    summary: "Applies 1 stack of Bleed to the opponent on each of the user's bites, at the cost of 2.5% of its melee damage.",
    mechanics: [
      "Cat applies 1 stack of Bleed to the opponent on each landed bite.",
      "Cat reduces the user's melee damage by 2.5% multiplicatively.",
      "Stubborn Stacker replaces this effect with a health regeneration bonus and a Bleed block. See Stubborn Stacker for the figures.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_catalyst",
    name: "Catalyst",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_cavity_critter",
    name: "Cavity Critter",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_chick",
    movesSpeed: true,
    name: "Chick",
    status: "Modeled",
    summary: "Increases all movement speeds by 5% and reduces weight by 7.5%, both multiplicatively.",
    mechanics: [
      "Chick increases all movement speeds by 5% multiplicatively.",
      "Chick reduces weight by 7.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [
      "The speed side reaches Speed Builds and not Compare; only the weight reaches a fight.",
    ],
  },
  {
    id: "plushie_clover_blossom",
    name: "Clover Blossom",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_clownfish",
    name: "Clownfish",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_coal",
    name: "Coal",
    status: "Modeled",
    summary: "Increases the user's weight by 3.5%.",
    mechanics: [
      "Coal increases weight by 3.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_cow",
    name: "Cow",
    status: "Modeled",
    summary: "Reduces melee damage by 5% and increases weight by 10%, both multiplicatively.",
    mechanics: [
      "Cow reduces melee damage by 5% multiplicatively.",
      "Cow increases weight by 10% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_creator_star",
    name: "Creator Star",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_darkstar",
    name: "Darkstar",
    status: "Modeled",
    summary: "Speeds up recovery from recoverable debuff ailments by 25% while the creature is settled sitting or laying.",
    mechanics: [
      "Darkstar speeds up how fast recoverable debuff ailments clear by 25% (a 1.25x per-tick rate multiplier), but only while the creature is settled sitting or laying.",
      "Applies to the recoverable set only: Bad Omen, Bleed, Burn, Corrosion, Disease, Frostbite, Heartbroken, Injury, Necropoison, Poison.",
      "Composes multiplicatively with Defiled Ground's recovery bonus and with the sit/lay decay speed-up.",
      "Unique - equipping two Darkstar is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_dolt",
    name: "Dolt",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_eclipse",
    name: "Eclipse",
    status: "Modeled",
    summary: "Grants +5% damage and +15% health regeneration only at night.",
    mechanics: [
      "Eclipse increases melee damage by 5% multiplicatively only at night.",
      "Eclipse increases health regeneration by 15% multiplicatively only at night.",
      "Eclipse is stackable and a second copy can be equipped.",
      "A second Eclipse changes nothing here: the bonus is granted once however many copies are equipped.",
    ],
    notes: [
      "In Compare, the night that gates it is the day / night setting, not anything the two creatures do.",
    ],
  },
  {
    id: "plushie_egg_gobbler",
    name: "Egg Gobbler",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_egg_shell",
    name: "Egg Shell",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_eggy_snake",
    name: "Eggy Snake",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [
      "In game, it grants Egg Stealer. No plushie here grants Egg Stealer, so a creature that does not already own it stays without it.",
    ],
  },
  {
    id: "plushie_elemental",
    name: "Elemental",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_ember_spirit",
    name: "Ember Spirit",
    status: "Modeled",
    summary: "Applies 0.5 stacks of Burn to the opponent on each bite they land on the user, at the cost of 7.5 percentage points of Frostbite block.",
    mechanics: [
      "Ember Spirit applies 0.5 stacks of Burn to the opponent on each bite they land on the user.",
      "Ember Spirit lowers the user's Frostbite block by 7.5 percentage points. On a user with no other Frostbite block that is a weakness: 7.5% more Frostbite stacks land.",
      "Block scales the stacks that land, not the damage each one deals. See Ailment Block.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_euvatops",
    name: "Euvatops",
    status: "Modeled",
    summary: "Decreases hunger drain by 15%.",
    mechanics: [
      "Euvatops slows hunger drain by 15% multiplicatively.",
      "Stackable.",
    ],
    notes: [
    ],
  },
  {
    id: "plushie_fox",
    name: "Fox",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [
      "It only acts while the creature is inside a burrow, and there are no burrows here.",
    ],
  },
  {
    id: "plushie_frost_dragon",
    name: "Frost Dragon",
    status: "Modeled",
    summary: "Blocks 25% of incoming Frostbite stacks and slows hunger and thirst drain by 5%.",
    mechanics: [
      "Frost Dragon blocks 25% of incoming Frostbite stacks.",
      "Block scales the stacks that land, not the damage each one deals. See Ailment Block.",
      "Frost Dragon slows hunger and thirst drain by 5% multiplicatively.",
      "Stackable.",
    ],
    notes: [
    ],
  },
  {
    id: "plushie_ghost",
    name: "Ghost",
    status: "Modeled",
    summary: "Blocks 7.5% of incoming Bleed stacks.",
    mechanics: [
      "Ghost blocks 7.5% of incoming Bleed stacks.",
      "Block scales the stacks that land, not the damage each one deals. See Ailment Block.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_ginger_snapper",
    name: "Ginger Snapper",
    status: "Modeled",
    summary: "Applies 0.5 stacks of Frostbite to the opponent on each bite they land on the user, at the cost of 5 percentage points of Burn block.",
    mechanics: [
      "Ginger Snapper applies 0.5 stacks of Frostbite to the opponent on each bite they land on the user.",
      "Ginger Snapper lowers the user's Burn block by 5 percentage points. On a user with no other Burn block that is a weakness: 5% more Burn stacks land.",
      "Block scales the stacks that land, not the damage each one deals. See Ailment Block.",
      "Unique - equipping two Ginger Snapper is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_golden_bulb",
    name: "Golden Bulb",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_goldfish",
    name: "Goldfish",
    status: "Modeled",
    summary: "Grants Iron Stomach.",
    mechanics: [
      "Goldfish grants the user the Iron Stomach ability.",
      "Iron Stomach is granted but not modeled in combat.",
      "Unique - equipping two Goldfish is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_haunt_dragon",
    name: "Haunt Dragon",
    status: "Modeled",
    summary: "Applies 0.5 stacks of Poison to the opponent on each of the user's bites.",
    mechanics: [
      "Haunt Dragon applies 0.5 stacks of Poison to the opponent on each landed bite.",
      "Stubborn Stacker replaces this effect with a Poison block. See Stubborn Stacker for the figures.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_heart",
    name: "Heart",
    status: "Modeled",
    summary: "Increases health regeneration by 30% and reduces weight by 5%, both multiplicatively.",
    mechanics: [
      "Heart increases health regeneration by 30% multiplicatively.",
      "Heart reduces weight by 5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_heartsnake",
    name: "Heartsnake",
    status: "Modeled",
    summary: "Applies 0.75 stacks of Poison to the opponent on each bite they land on the user.",
    mechanics: [
      "Heartsnake applies 0.75 stacks of Poison to the opponent on each bite they land on the user.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_horned_beetlefly",
    name: "Horned Beetlefly",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_hum",
    name: "Hum",
    status: "Modeled",
    summary: "Increases the user's weight by 2.5%.",
    mechanics: [
      "Hum increases weight by 2.5% multiplicatively.",
      "Unique - equipping two Hum is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_humming_frost",
    name: "Humming Frost",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_ice_wolf",
    name: "Ice Wolf",
    status: "Modeled",
    summary: "Increases the user's melee damage by 5%.",
    mechanics: [
      "Ice Wolf increases melee damage by 5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_icebreaker",
    name: "Icebreaker",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [
      "In game, it strengthens the knockback Charge deals. Knockback is outside the stand-and-fight model, so the plushie moves no figure a fight computes.",
    ],
  },
  {
    id: "plushie_jackrabbit",
    name: "Jackrabbit",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_jammy_slug",
    name: "Jammy Slug",
    status: "Modeled",
    summary: "Applies 0.5 stacks of Necropoison to the opponent on each bite they land on the user, at the cost of 5% of its melee damage.",
    mechanics: [
      "Jammy Slug applies 0.5 stacks of Necropoison to the opponent on each bite they land on the user.",
      "Jammy Slug reduces the user's melee damage by 5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_jotun_scale",
    name: "Jotun Scale",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [
      "In game, it cuts damage taken by 15% while the creature is being grabbed. Grab is modeled as a hold, and the hold applies no damage-taken modifier to the grabbed side.",
    ],
  },
  {
    id: "plushie_knight",
    name: "Knight",
    status: "Modeled",
    summary: "Reduces the user's melee damage by 5% and reflects 5% of each incoming bite and breath hit back to the attacker.",
    mechanics: [
      "Knight reduces the user's melee damage by 5% multiplicatively.",
      "Knight reflects bite and breath hits back to the attacker, modeled as a deterministic average: 5% of each direct hit (25% chance × 20% damage).",
      "Reflected damage does not count toward the user's damage output.",
      "Does not apply to damage a status deals over time.",
      "Does not apply while the user is hunkering.",
      "Unique - equipping two Knight is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_knox",
    movesSpeed: true,
    name: "Knox",
    status: "Speed-Builds-only",
    summary: "Increases walk and swim speed by 5%.",
    mechanics: [
      "Knox increases walk and swim speed by 5% multiplicatively.",
      "Unique - equipping two Knox is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_land",
    name: "Land",
    status: "Modeled",
    summary: "Increases Muddy duration by 100% per copy equipped.",
    mechanics: [
      "Land adds 100% of the base Muddy duration for each copy equipped, so one Land takes 90 seconds to 180 and two take it to 270.",
      "Stackable.",
    ],
    notes: [
      "In game, the same boost covers the hidden scent a mud pile grants. Only the Muddy duration is carried here.",
    ],
  },
  {
    id: "plushie_lunar_qilin",
    name: "Lunar Qilin",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_magic_frog",
    name: "Magic Frog",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_magichorn_prongbug",
    name: "Magichorn Prongbug",
    status: "Modeled",
    summary: "Increases health regeneration by 10%.",
    mechanics: [
      "Magichorn Prongbug increases health regeneration by 10% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_maple_leaflet",
    name: "Maple Leaflet",
    status: "Modeled",
    summary: "Blocks 22.5% of incoming Injury stacks.",
    mechanics: [
      "Maple Leaflet blocks 22.5% of incoming Injury stacks.",
      "Block scales the stacks that land, not the damage each one deals. See Ailment Block.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_minty_wiggler",
    name: "Minty Wiggler",
    status: "Modeled",
    summary: "Grants the Frosty ability.",
    mechanics: [
      "Minty Wiggler grants the user the Frosty ability.",
      "Unique - equipping two Minty Wiggler is not allowed.",
    ],
    notes: [
      "In Compare, the health regeneration Frosty carries follows the Frosty battle setting. Its Hypothermia immunity runs whether that setting is on or off. See Frosty in Battle Settings.",
    ],
  },
  {
    id: "plushie_mo",
    name: "Mo",
    status: "Modeled",
    summary: "Increases the user's melee damage by 2.5%.",
    mechanics: [
      "Mo increases melee damage by 2.5% multiplicatively.",
      "Unique - equipping two Mo is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_momo",
    name: "Momo",
    status: "Speed-Builds-only",
    summary: "Grants Sugar Rush after eating herbivore food.",
    mechanics: [
      "Eating any herbivore food grants the user Sugar Rush.",
      "Unique - equipping two Momo is not allowed.",
    ],
    notes: [
      "Sugar Rush is a movement effect, so it reaches Speed Builds and not Compare. See Sugar Rush in Movement Speed.",
    ],
  },
  {
    id: "plushie_mylo",
    movesSpeed: true,
    name: "Mylo",
    status: "Speed-Builds-only",
    summary: "Increases all movement speeds by 2.5%.",
    mechanics: [
      "Mylo increases all movement speeds by 2.5% multiplicatively.",
      "Unique - equipping two Mylo is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_notes",
    name: "Notes",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_oceanwing",
    name: "Oceanwing",
    status: "Modeled",
    summary: "Adds 12.5 percentage points to the health regeneration Muddy gives, for each copy equipped.",
    mechanics: [
      "Oceanwing adds half of Muddy's bonus again for each copy equipped, taking it from 25% to 37.5% with one copy and to 50% with two.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_octroma",
    name: "Octroma",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_owl",
    name: "Owl",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [
      "In game, it puts nightvision at its maximum. Nightvision is carried as a creature stat and nothing reads it, so the plushie changes no figure.",
    ],
  },
  {
    id: "plushie_palmtree",
    name: "Palmtree",
    status: "Modeled",
    summary: "Increases food and water capacity by 10%.",
    mechanics: [
      "Palmtree increases food capacity by 10% multiplicatively.",
      "Palmtree increases water capacity by 10% multiplicatively.",
      "Stackable.",
    ],
    notes: [
      "Food and water are two capacities in game and one appetite figure here, so the plushie's two 10% gains arrive as a single 10% gain.",
    ],
  },
  {
    id: "plushie_partridge",
    movesSpeed: true,
    name: "Partridge",
    status: "Speed-Builds-only",
    summary: "Reduces all movement speeds by 2%.",
    mechanics: [
      "Partridge reduces all movement speeds by 2% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_pie_chomper",
    name: "Pie Chomper",
    status: "Modeled",
    summary: "Grants the Serrated Teeth ability and reduces health regeneration by 25%.",
    mechanics: [
      "Pie Chomper grants the user the Serrated Teeth ability.",
      "Serrated Teeth applies Deep Wounds to the opponent on each landed bite. See Serrated Teeth.",
      "Pie Chomper reduces health regeneration by 25% multiplicatively.",
      "Unique - equipping two Pie Chomper is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_pig_lantern",
    name: "Pig-Lantern",
    status: "Modeled",
    summary: "Applies 0.5 stacks of Burn to the opponent on each of the user's bites, at the cost of 2.5% of its melee damage.",
    mechanics: [
      "Pig-Lantern applies 0.5 stacks of Burn to the opponent on each landed bite.",
      "Pig-Lantern reduces the user's melee damage by 2.5% multiplicatively.",
      "Stubborn Stacker replaces this effect with a melee damage bonus and a Burn block. See Stubborn Stacker for the figures.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_reindeer",
    movesSpeed: true,
    name: "Reindeer",
    status: "Speed-Builds-only",
    summary: "Increases flight speed by 2.5%.",
    mechanics: [
      "Reindeer increases flight speed by 2.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_rock",
    name: "Rock",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_rod",
    name: "Rod",
    status: "Modeled",
    summary: "Increases health regeneration by 10%.",
    mechanics: [
      "Rod increases health regeneration by 10% multiplicatively.",
      "Unique - equipping two Rod is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_rosevine",
    name: "Rosevine",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [
      "In game, it adds 10% to what a Healing Hunter heals. No plushie here reaches an ability's own numbers, so Healing Hunter heals the same with Rosevine as without.",
    ],
  },
  {
    id: "plushie_sea",
    movesSpeed: true,
    name: "Sea",
    status: "Speed-Builds-only",
    summary: "Increases walk, swim and beached speed by 10%.",
    mechanics: [
      "Sea increases walk, swim and beached speed by 10% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_seal",
    name: "Seal",
    status: "Modeled",
    summary: "Increases moisture time by 15%.",
    mechanics: [
      "Seal increases the creature's moisture time by 15% multiplicatively.",
      "Stackable.",
    ],
    notes: [
      "Moisture time is read only while Oxygen / Moisture Drain is set to Ground. In every other mode the extra time changes nothing. See Oxygen / Moisture Drain in Battle Settings.",
    ],
  },
  {
    id: "plushie_serpent",
    name: "Serpent",
    status: "Modeled",
    summary: "Reduces the user's melee damage by 10%.",
    mechanics: [
      "Serpent reduces melee damage by 10% multiplicatively.",
      "Unique - equipping two Serpent is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_sky",
    movesSpeed: true,
    name: "Sky",
    status: "Modeled",
    summary: "Reduces weight by 10% and adds a flat 2 to flight speed.",
    mechanics: [
      "Sky reduces weight by 10% multiplicatively.",
      "Sky adds a flat 2 to flight speed.",
      "The flight bonus is added after every multiplier, so nothing on the build scales it.",
      "Stackable.",
    ],
    notes: [
      "The flight side reaches Speed Builds and not Compare; only the weight reaches a fight.",
    ],
  },
  {
    id: "plushie_smore_cat",
    name: "Smore Cat",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_snowflake_sneak",
    name: "Snowflake Sneak",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_snowman",
    name: "Snowman",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_sparkler",
    name: "Sparkler",
    status: "Modeled",
    summary: "Blocks 15% of incoming Poison, Frostbite and Burn stacks, and lets 20% more Bleed stacks land.",
    mechanics: [
      "Sparkler blocks 15% of incoming Poison stacks.",
      "Sparkler blocks 15% of incoming Frostbite stacks.",
      "Sparkler blocks 15% of incoming Burn stacks.",
      "Sparkler lowers the user's Bleed block by 20 percentage points. On a user with no other Bleed block that is a weakness: 20% more Bleed stacks land.",
      "Block scales the stacks that land, not the damage each one deals. See Ailment Block.",
      "Unique - equipping two Sparkler is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_springbok",
    name: "Springbok",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [
      "In game, it grants Will To Live. A creature that does not already own the ability stays without it here.",
    ],
  },
  {
    id: "plushie_springram",
    name: "Springram",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_stick",
    name: "Stick",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_stitch_head",
    name: "Stitch Head",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [],
  },
  {
    id: "plushie_succulant",
    movesSpeed: true,
    name: "Succulant",
    status: "Speed-Builds-only",
    summary: "Increases all movement speeds by 2.5%.",
    mechanics: [
      "Succulant increases all movement speeds by 2.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_swan",
    name: "Swan",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: [],
    notes: [
      "In game, it grants Agile Swimmer. A creature that does not already own the ability stays without it here.",
    ],
  },
  {
    id: "plushie_tannenbaum",
    name: "Tannenbaum",
    status: "Modeled",
    summary: "Applies 0.5 stacks of Frostbite to the opponent on each of the user's bites, at the cost of 5% longer bite cooldown.",
    mechanics: [
      "Tannenbaum applies 0.5 stacks of Frostbite to the opponent on each landed bite.",
      "Tannenbaum increases the user's bite cooldown by 5% multiplicatively, making bites slower.",
      "Stubborn Stacker replaces this effect with a bite cooldown reduction and a Frostbite block. See Stubborn Stacker for the figures.",
      "Unique - equipping two Tannenbaum is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_vampire_bat",
    name: "Vampire Bat",
    status: "Modeled",
    summary: "Applies 1 stack of Bleed to the opponent on each bite they land on the user, blocks 2.5% of incoming Bleed stacks, at the cost of 2.5% of its melee damage.",
    mechanics: [
      "Vampire Bat applies 1 stack of Bleed to the opponent on each bite they land on the user.",
      "Vampire Bat blocks 2.5% of incoming Bleed stacks.",
      "Block scales the stacks that land, not the damage each one deals. See Ailment Block.",
      "Vampire Bat reduces the user's melee damage by 2.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_void",
    movesSpeed: true,
    name: "Void",
    status: "Modeled",
    summary: "Increases the user's melee damage by 7.5%, at the cost of 2.5% of all movement speeds.",
    mechanics: [
      "Void increases melee damage by 7.5% multiplicatively.",
      "Void reduces all movement speeds by 2.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [
      "The speed cost reaches Speed Builds and not Compare, so a fight applies the damage bonus and not the slow.",
    ],
  },
];

export const MOVEMENT_SPEED_REFERENCE_DRAFTS: StatusReferenceEntry[] = [
  {
    id: "speed_ambush",
    name: "Ambush",
    status: "Speed-Builds-only",
    summary: "Sprint multiplied by the creature's ambush multiplier.",
    mechanics: [
      "Ambush speed is Sprint multiplied by the creature's ambush multiplier, and the product is not capped.",
      "It is computed from Sprint, so every effect that raises Sprint raises ambush by the same factor.",
      "No effect holds it, so it counts toward peak rather than sustained. See Sustained and Peak.",
      "The ambush multiplier is never below 1, so ambush is the fastest movement a creature has.",
    ],
    notes: [
      "For a creature whose type is Aquatic, out of water the game reads Beached in place of ambush. That replacement is not modeled here.",
    ],
  },
  {
    id: "speed_effect_amped",
    name: "Amped",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim, Sprint and Fly by 10%.",
    mechanics: [
      "Amped multiplies Walk / Swim, Sprint and Fly by 1.1.",
      "The creature must own Overcharged.",
    ],
    notes: [
      "In the game Amped raises every movement speed by 10% except the swim sprint. Swim is folded into the land channels here, so an aquatic creature's Sprint reads 10% above the game's figure under Amped.",
    ],
  },
  {
    id: "speed_effect_cocooning",
    name: "Cocooning",
    status: "Speed-Builds-only",
    summary: "Cuts Walk / Swim, Sprint, Fly and Beached to 30% while Cocooning is held.",
    mechanics: [
      "Cocooning multiplies Walk / Swim, Sprint, Fly and Beached by 0.3.",
      "It also grounds the creature, so the Fly figure cannot be reached while Cocooning is held.",
      "The creature must own Cocoon.",
    ],
    notes: [
      "Cocooning is the status the creature carries before the cocoon forms. See Cocoon in Modeled Abilities.",
    ],
  },
  {
    id: "speed_effect_posture_cower",
    name: "Cower",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim and Sprint by 25%, or 37.5% with Bear, until the creature moves.",
    mechanics: [
      "Cower multiplies Walk / Swim and Sprint by 1.25.",
      "Bear raises that factor to 1.375.",
      "Bear moves no channel by itself.",
      "It does not touch Fly.",
      "It is the Scared posture. Any creature can enter it; no ability gates it here.",
      "Cower and Hunker are not exclusive.",
    ],
    notes: [
      "In the game the order the two poses are entered in decides which pose the creature is in. Speed Builds has no pose order, so it applies both buffs.",
    ],
  },
  {
    id: "speed_effect_event_speed",
    name: "Egg Speed",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim, Sprint and Fly by 25% to 45%, by creature tier.",
    mechanics: [
      "Egg Speed multiplies Walk / Swim, Sprint and Fly.",
      "The multiplier is 1.25 at tiers 1 to 3, 1.35 at tier 4, and 1.45 at tier 5.",
      "A tier outside 1 to 5 falls back to 1.25.",
      "It comes from collecting an event Egg, so no ability gates it here.",
    ],
    notes: [
      "Heart Speed applies the same tier table, from a different event item.",
    ],
  },
  {
    id: "speed_sweep_elder_and_trait",
    name: "Elder and Trait Choice",
    status: "Speed-Builds-only",
    summary: "The elder and the trait loadout are fixed by measurement rather than varied, because only one trait and one elder raise a movement channel.",
    mechanics: [
      "Only the plushie slots are varied. The elder and the trait loadout are fixed before the search starts.",
      "Each is picked by measurement: every choice is evaluated on the channel being ranked and the best one is kept.",
      "Where no elder moves the channel being ranked, all three elders tie and the choice changes no figure.",
      "Of the three elders, only Devious raises speed, by 7.5%. Powerful lowers it by 5%. Gentle does not touch it.",
      "Of the traits, only Speed moves a movement channel at all.",
      "The measured elder and the measured trait are at least as good as every other on the channel being ranked, so the search does not vary them.",
      "An elder or trait fixed on the build is used as given.",
      "The elder bonus is applied to Walk / Swim, Sprint and Fly.",
      "Veneration reaches a movement channel only through the Speed trait. See Speed trait.",
      "With two traits slotted, the ascension assignments divide the stages between them, and those assignments are taken from the build rather than measured.",
      "A stage assigned to the other trait moves no movement channel.",
    ],
    notes: [
      "The game's elder text says \"Speed\" and names no channel. Everywhere else the game uses that word for every kind of movement, so the bonus is applied to Walk / Swim, Sprint and Fly here.",
    ],
  },
  {
    id: "speed_effect_guardians_passage_channel",
    name: "Guardians Passage",
    status: "Speed-Builds-only",
    summary: "Cuts Walk / Swim, Sprint and Fly to 10% for the 6 seconds it channels.",
    mechanics: [
      "Guardians Passage multiplies Walk / Swim, Sprint and Fly by 0.1 while it is channeling.",
      "It channels for 6 seconds, and the multiplier applies for exactly that window.",
      "The creature must own Guardians Passage.",
    ],
    notes: [
      "It applies to the swim sprint by the same factor as to the land speeds, so folding swim into the land channels changes no figure here. See Movement Channels.",
      "While it channels, the user and the target take no damage. That side is a combat effect. See Guardians Passage in Modeled Abilities.",
    ],
  },
  {
    id: "speed_effect_heart_speed",
    name: "Heart Speed",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim, Sprint and Fly by 25% to 45%, by creature tier.",
    mechanics: [
      "Heart Speed multiplies Walk / Swim, Sprint and Fly.",
      "The multiplier is 1.25 at tiers 1 to 3, 1.35 at tier 4, and 1.45 at tier 5.",
      "A tier outside 1 to 5 falls back to 1.25.",
      "It comes from collecting an event Heart, so no ability gates it here.",
    ],
    notes: [
      "Egg Speed applies the same tier table, from a different event item.",
    ],
  },
  {
    id: "speed_out_of_combat_model",
    name: "Movement and the Combat Model",
    status: "Speed-Builds-only",
    summary: "The combat model does not simulate movement, so a movement figure is ranked on its own and never reaches a fight result.",
    mechanics: [
      "The combat model is a 1v1 fight in which neither creature moves. It simulates no movement, disengagement, chasing, spacing, terrain or running.",
      "No movement channel reaches a fight. Speed Builds ranks movement stats and simulates no combat.",
      "Every effect that moves a movement channel is described once.",
      "An effect with an entry of its own in another section carries its movement side there.",
      "The entries here are the effects with no entry of their own in another section.",
    ],
    notes: [
      "The elder's speed bonus applies to Walk / Swim, Sprint and Fly here. It changes no figure the combat model computes, because the combat model reads no movement stat. See Elder and Trait Choice.",
      "Speed effects an opponent lands on the creature - Stolen Speed, Injury, Sticky Trap, Inked, Tangled Kelp, Gale, Slowed, Sticky Tar, Torn Ligaments, Freeze, Flash Freeze - are absent, because no build can reach them.",
    ],
  },
  {
    id: "speed_channels",
    name: "Movement Channels",
    status: "Speed-Builds-only",
    summary: "The six movement stats Speed Builds reads, the two figures it derives from them, and the direction each one is ranked in.",
    mechanics: [
      "Walk / Swim is the creature's ground speed. An aquatic creature has no separate swim stat and reuses this one.",
      "Sprint is the creature's sprint speed.",
      "Fly is flight speed.",
      "Beached is the speed an aquatic creature keeps out of water.",
      "Turn is the time in seconds a creature takes to complete a turn.",
      "Ambush multiplier is the factor an ambush multiplies Sprint by. It is a multiplier rather than a speed, so it is never read as one. Only Bunny raises it.",
      "Fly sprint is not a stat of its own. It is Fly times one plus the creature's fly-sprint bonus, so anything that changes Fly changes it too.",
      "Ambush is not a stat of its own either. It is Sprint times the ambush multiplier, so anything that changes Sprint changes it too.",
      "Higher is better on every channel except Turn, where lower is better.",
      "A channel reads None when the creature does not carry that stat at all: a grounded creature has no Fly, a land creature no Beached.",
      "Turn cannot be optimized for. Nothing moves it, so every build would read the same number.",
    ],
    notes: [
      "The game keeps swim speeds separate from land speeds, but no creature carries a swim stat of its own, and every effect that moves a swim speed moves the matching land speed by the same factor. They are folded into Walk / Swim and Sprint here.",
      "Amped is where the fold is visible: it multiplies Walk / Swim, Sprint and Fly, and does not move the swim sprint. See Amped.",
      "The fly-sprint bonus is carried as the bonus rather than the factor: a creature the game gives 1.4x reads 0.4 here.",
      "Serpent is the only effect that names Turn, and the game does not apply it. See Serpent.",
      "Take-off cost and glide regen are flight stats Speed Builds does not read. Three effects move nothing else and are absent with them: Horned Beetlefly, Unbridled Rage and Violent Winds.",
    ],
  },
  {
    id: "speed_sweep_plushie_shortlist",
    name: "Plushie Shortlist",
    status: "Speed-Builds-only",
    summary: "Only plushies that can move a movement channel are varied; the rest cannot change a figure Speed Builds computes.",
    mechanics: [
      "The roster varied is every plushie named by a movement effect, plus Bear.",
      "Bear moves no channel of its own. It multiplies the Cower buff by 1.1, from 1.25 to 1.375, so it is varied with them although no effect names it as its plushie.",
      "A plushie outside that roster cannot change any figure Speed Builds computes, so a build carrying one differs only in a slot no figure reflects.",
      "Every pair of slots is evaluated, unordered, with an empty slot and a doubled plushie both included.",
      "The game applies a repeated plushie's effect twice, so two Chicks multiply by 1.05 × 1.05 rather than by 1.05.",
      "A unique plushie does not double.",
      "A build is dropped when a build carrying a subset of its plushies reaches the same value on the channel being ranked. The smaller build is kept, and its spare slot stays empty.",
      "When a build is left with an empty slot and the creature has an ambush multiplier, Bunny is put in that slot.",
      "Bunny is only added when adding it does not change the value builds are sorted on. An ambush channel is sorted on a value Bunny changes, so there the empty slot stays empty.",
      "Bunny is not added when it is not owned, and it never replaces a plushie already chosen.",
      "Two builds that tie without one being a subset of the other are both kept. Mylo and Succulant are each a flat 2.5% and are kept as alternatives.",
    ],
    notes: [
      "A plushie can move a movement channel and still change nothing on the channel being ranked: Bear moves nothing unless Cower is held, Knox moves Walk / Swim only, Sky moves Fly only.",
    ],
  },
  {
    id: "speed_effect_sea_school",
    name: "Sea School",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim and Sprint by 5% per counted packmate, up to six.",
    mechanics: [
      "Sea School multiplies Walk / Swim and Sprint by 1 plus 0.05 for each counted packmate.",
      "The count is capped at six, for a 1.3 multiplier.",
      "Below one packmate it resolves to nothing.",
      "It does not touch Fly.",
      "The packmates it counts are tier 1 and 2.",
      "It holds while the creature has at least one counted packmate rather than for a set time, so it counts toward sustained as well as peak.",
      "The creature carrying it must be tier 1 or 2.",
      "The creature must be aquatic or semi-aquatic.",
    ],
    notes: [],
  },
  {
    id: "speed_effect_creature_speed_boost",
    name: "Speed Boost",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim by 10% and Sprint by 5%.",
    mechanics: [
      "Speed Boost multiplies Walk / Swim by 1.1.",
      "Speed Boost multiplies Sprint by 1.05.",
      "It does not touch Fly.",
      "It is held for the whole build rather than for a set time, so it counts toward sustained as well as peak.",
    ],
    notes: [],
  },
  {
    id: "speed_effect_speed_gift",
    name: "Speed Gift",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim, Sprint and Fly by 20% for the user of Speed Steal.",
    mechanics: [
      "Speed Gift multiplies Walk / Swim, Sprint and Fly by 1.2.",
      "It lasts 4 seconds.",
      "The creature must own Speed Steal.",
    ],
    notes: [],
  },
  {
    id: "speed_effect_trait_speed",
    name: "Speed trait",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim, Sprint and Fly by 3.5%, rising 1.5 percentage points per veneration stage put into it.",
    mechanics: [
      "The Speed trait multiplies Walk / Swim, Sprint and Fly.",
      "The multiplier is 1.035 with no ascension and gains 0.015 for every stage assigned to Speed.",
      "The six steps are +3.5%, +5%, +6.5%, +8%, +9.5% and +11%.",
      "With one trait slotted, every veneration stage goes to it. With two, the ascension assignments decide how many stages go to Speed.",
      "It is the only trait that moves a speed channel.",
    ],
    notes: [
      "It follows the trait loadout, so it counts toward sustained rather than peak.",
    ],
  },
  {
    id: "speed_effect_sugar_rush",
    name: "Sugar Rush",
    status: "Speed-Builds-only",
    summary: "Adds a flat 1 to Fly, for a herbivore, an omnivore or a photovore carrying Momo.",
    mechanics: [
      "Sugar Rush adds 1 to Fly. It is additive, not a percentage.",
      "A herbivore, an omnivore and a photovore all get it.",
      "For a carnivore or a photocarnivore it resolves to nothing - neither eats the food that grants it.",
      "It counts toward sustained rather than peak. See Sustained and Peak.",
      "Momo is unique. A second Momo cannot be equipped.",
    ],
    notes: [
      "The addition is applied after every multiplier, so no multiplier changes it.",
    ],
  },
  {
    id: "speed_sustained_vs_peak",
    name: "Sustained and Peak",
    status: "Speed-Builds-only",
    summary: "Every figure is a pair: what the build gives on its own, and what it reaches with effects held.",
    mechanics: [
      "Sustained is the build with nothing held: the plushies, the trait and its veneration, the elder, and Momo's Sugar Rush.",
      "Peak is sustained plus every effect held at the moment.",
      "Both come out of the same evaluation. The only difference between them is which held effects are counted.",
      "Sugar Rush counts as sustained: Momo grants it while the creature eats, and a creature can eat at any time, so carrying Momo is treated as the condition.",
      "A percentage is peak measured against sustained, never against the creature's printed stat.",
      "With nothing held, peak equals sustained and every percentage reads unchanged.",
      "Builds are ordered on peak when at least one effect is held, and on sustained when none is.",
    ],
    notes: [
      "Sustained is true of the creature whatever it is doing, so it is the baseline rather than the printed stat.",
      "The printed stat is the creature with no build, so no loadout produces it.",
    ],
  },
  {
    id: "speed_effect_swift_scales",
    name: "Swift Scales",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim and Sprint by 40% and Fly by 75%.",
    mechanics: [
      "Swift Scales multiplies Walk / Swim and Sprint by 1.4.",
      "Swift Scales multiplies Fly by 1.75.",
      "The creature must own Swift Scales.",
    ],
    notes: [],
  },
  {
    id: "speed_effect_windstorm",
    name: "Windstorm",
    status: "Speed-Builds-only",
    summary: "Raises Walk / Swim, Sprint and Fly by 15%.",
    mechanics: [
      "Windstorm multiplies Walk / Swim, Sprint and Fly by 1.15.",
      "It is weather, so no ability gates it here.",
      "It holds while the Windstorm weather is active rather than for a set time, so it counts toward sustained as well as peak.",
    ],
    notes: [],
  },
];
