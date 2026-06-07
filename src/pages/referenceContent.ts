export type ReferenceStatus =
  | "Modeled"
  | "Partial"
  | "Out of model"
  | "Not modeled yet"
  | "Not planned"
  | "Disputed"
  | "Compare-only"
  | "Sandbox-only";

export type AbilityReferenceEntry = {
  id: string;
  name: string;
  status: ReferenceStatus;
  summary: string;
  mechanics: string[];
  whyItsNotModeledHere?: string[];
  policyDifferences: string[];
  notes: string[];
};

export type StatusReferenceEntry = {
  id: string;
  name: string;
  status: ReferenceStatus;
  summary: string;
  mechanics: string[];
  notes: string[];
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
    policyDifferences: [
      "This ability does not currently have modeled policy behavior.",
    ],
    notes: [
      "When this ability is added, it will be treated as a Compare-Only rule or ability.",
      "In that compare-only mode, healing and buff effects will always benefit the user.",
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
    summary: "Currently out of model.",
    mechanics: [
      "This ability is currently not included in the stand-and-fight combat model.",
    ],
    policyDifferences: [],
    notes: [
      "Movement, positioning, stealth, and other non-direct combat effects do not currently affect the PvP model.",
    ],
  };
}

export const ABILITY_POLICY_REFERENCE_DRAFTS: PolicyReferenceEntry[] = [
  {
    id: "policy_fast",
    name: "Fast",
    summary: "A weak middle-ground mode that is usually worse than the other options.",
    mechanics: [
      "Fast uses more complicated timing rules than Really fast, but the actual results are usually worse.",
      "It is not as practical and believable as Really fast.",
      "It is also not as accurate as the deeper search-based modes.",
      "That leaves Fast in an awkward middle position where it often does not clearly do anything better than the modes around it.",
    ],
    notes: [
      "In the current codebase, Fast is usually the least useful policy.",
    ],
  },
  {
    id: "policy_really_fast",
    name: "Really fast",
    summary: "The most practical and most player-like timing mode in the system.",
    mechanics: [
      "Really fast does not try to search for the mathematically perfect moment. It tries to imitate the kind of simple, direct decisions a real player would often make in a real fight.",
      "That does not mean it blindly presses everything the instant it becomes ready.",
      "Instead, it uses simple rules such as: do not waste a heal while HP is still high, do not cleanse too early if there are not enough negative effects yet, and use an ability immediately once it has become clearly useful.",
      "That is why Really fast often feels much more natural than the deeper timing modes.",
      "In the current code, Life Leech refuses to cast above 85% HP under Really fast.",
      "In the current code, Fortify waits until there are at least 15 total removable negative stacks under Really fast.",
      "In the current code, Rewind only activates at 75% HP or lower under Really fast.",
      "Some abilities are still much more blunt here. Hunker is the clearest example: Really fast turns it on immediately and keeps it on.",
    ],
    notes: [
      "Really fast is the best practical baseline if you want timing that usually resembles simple real-player behavior.",
    ],
  },
  {
    id: "policy_semi_ideal_ideal_and_extreme",
    name: "Semi-ideal, Ideal, and Extreme",
    summary: "The search-based timing family that looks ahead and compares multiple possible use timings.",
    mechanics: [
      "These three modes try to answer a harder question: would the ability be stronger if it was used a little later instead of right now?",
      "To do that, the code creates several possible wait times, simulates what the fight would look like if the ability was used at each of those times, compares those future results, and keeps the timing that looks best.",
      "This means they do not just ask whether an ability is usable now. They actively compare now against later.",
      "Semi-ideal is the lightest version of this idea. It checks 0, 0.5, 1, and 2 second delays, looks about 24 seconds ahead, and moves through that future in 1 second steps.",
      "Ideal is the main detailed timing mode. It checks 0, 0.25, 0.5, 1, 1.5, 2, 3, and 4 second delays, also adds extra timing points around important fight events such as hits, regeneration ticks, and status ticks, looks about 45 seconds ahead, and moves through that future in 0.5 second steps.",
      "Extreme is the densest version. It checks 0 to 12 seconds in 0.05 second steps, 12.25 to 30 seconds in 0.25 second steps, and 31 to 120 seconds in 1 second steps. It looks up to 120 seconds ahead and moves through that future in 0.1 second steps.",
      "This search family can behave less like a human player because it is willing to wait for a timing that gives better projected value later in the fight.",
      "That is why abilities like Life Leech, Fortify, Warden's Rage, Hunker, Hunters Curse, Adrenaline, Reflect, Rewind, and Unbridled Rage can all look more analytical under this family than under Really fast.",
      "Extreme is the most detailed timing mode in the code, but in practice it is also mostly useless. There is usually little real fight-result difference between Extreme and Ideal.",
    ],
    notes: [
      "Semi-ideal is the rough search mode, Ideal is the main detailed timing mode, and Extreme is the most exhaustive version with little practical gain over Ideal.",
    ],
  },
  {
    id: "policy_what_ability_policies_are",
    name: "What Ability Policies Are",
    summary: "The timing rules the site uses to decide when to press active abilities.",
    mechanics: [
      "Ability Policies do not change what an ability does. They only change when the model chooses to use it.",
      "The site needs this because many active abilities become much stronger or much weaker depending on timing.",
      "So the code has to answer one simple question again and again during the fight: use it now, wait, or do not use it yet.",
      "The site shows five named modes: Really fast, Fast, Semi-ideal, Ideal, and Extreme.",
      "In practice, those five names behave like three groups: Really fast, Fast, and the Semi-ideal / Ideal / Extreme family.",
      "The search-based family looks ahead, compares several possible timings, and keeps the one that gives the best projected result.",
      "When projected results are compared, winning matters first, then time to kill, and then effective damage.",
    ],
    notes: [
      "This section explains the timing system itself, not the separate Compare UI for per-ability overrides.",
    ],
  },
];

export const KNOWN_APPROXIMATION_REFERENCE_DRAFTS: ApproximationReferenceEntry[] = [
  {
    id: "approx_bad_omen",
    parentId: "status_bad_omen",
    name: "Bad Omen outcome resolution",
    summary: "Bad Omen does not use one universal outcome rule across all site modes.",
    gameTruth: [
      "In game, Bad Omen rolls one outcome from the outcome pool randomly per expiry, every time.",
    ],
    currentApproximation: [
      "Compare (Auto): the outcome is sampled randomly from the pool per run.",
      "Compare (Debug): the user-selected outcome is forced.",
      "Best Builds and Optimizer: the outcome is fixed to Burn +8 for the entire calculation cycle.",
    ],
    whyApproximated: "Best Builds and Optimizer compare deterministic build scores; per-run randomness would prevent stable build ranking.",
    notes: [],
  },
  {
    id: "approx_breath_pseudo_crits_and_pseudo_procs",
    name: "Breath pseudo-crits and pseudo-procs",
    summary: "Breath crits and breath side-effect chances are modeled as stable averages instead of true random rolls.",
    gameTruth: [
      "In game, breath crits and chance-based side effects roll independently per breath instance.",
    ],
    currentApproximation: [
      "Breath crit chance is converted into a constant damage multiplier instead of using true random crit rolls.",
      "Chance-based breath effects are converted into expected average stacks instead of true random procs.",
    ],
    whyApproximated: "Stable averages make breath behavior reproducible and easier to compare across repeated simulations.",
    notes: [],
  },
  {
    id: "approx_broodwatcher",
    parentId: "compare_broodwatcher",
    name: "Broodwatcher",
    summary: "Broodwatcher is treated as a permanent compare-only Defensive setup with no decay.",
    gameTruth: [
      "In game, Defensive stacks decay over time once granted.",
    ],
    currentApproximation: [
      "When Broodwatcher is enabled in Compare, the fight starts with 5 Defensive stacks already present.",
      "Those stacks do not decay away.",
      "The buff is effectively active for the whole fight.",
    ],
    whyApproximated: "Compare-side assumption: Broodwatcher is treated as a full-fight benefit because its in-game uptime is not modeled.",
    notes: [],
  },
  {
    id: "approx_buffered_natural_regeneration",
    name: "Buffered natural regeneration",
    summary: "Blocked natural regeneration ticks are buffered and can apply later instead of being lost.",
    gameTruth: [
      "In-game behavior for blocked regen ticks has not been precisely re-derived; they may be lost outright.",
    ],
    currentApproximation: [
      "If a natural regeneration tick happens while regeneration is blocked, that tick is not lost.",
      "The model stores a buffered regen tick.",
      "When the anti-heal condition ends, that stored regen can apply immediately.",
    ],
    whyApproximated: "Buffering preserves the user's healing budget when status windows overlap, avoiding unfair loss when timing flickers.",
    notes: [],
  },
  {
    id: "approx_first_tick_rule",
    parentId: "compare_first_tick_rule",
    name: "First Tick Rule",
    summary: "First Tick Rule is a compare-only approximation for server-driven passive ticking.",
    gameTruth: [
      "The real game server runs passive tick systems on its own continuous global timer.",
    ],
    currentApproximation: [
      "The local fight model cannot reproduce a fully global server timer.",
      "First Tick Rule is a compare-only attempt to imitate that behavior by shifting when the first passive tick happens.",
    ],
    whyApproximated: "Client-side simulation cannot reproduce a server-global tick timer; the rule lets users approximate its effect manually.",
    notes: [],
  },
  {
    id: "approx_frosty",
    parentId: "compare_frosty",
    name: "Frosty",
    summary: "Frosty keeps only its regeneration bonus; weather-related side is dropped.",
    gameTruth: [
      "In game, Frosty also has weather-related effects tied to in-world weather events.",
    ],
    currentApproximation: [
      "In Compare, Frosty applies only its +25% health regeneration effect.",
    ],
    whyApproximated: "The site does not simulate weather itself or weather event effects.",
    notes: [],
  },
  {
    id: "approx_hunker_first_activation",
    parentId: "ability_hunker",
    name: "Hunker first activation",
    summary: "The first Hunker activation in a fight applies immediately, skipping the normal 5 second delay.",
    gameTruth: [
      "In-game startup timing for the very first Hunker activation has not been precisely confirmed.",
    ],
    currentApproximation: [
      "The first time Hunker is turned on in a fight, its effect starts immediately.",
      "The 5 second delay applies only to later re-activations, not to the first activation.",
    ],
    whyApproximated: "Existing model behavior; first-activation timing has not been re-derived from empirical data.",
    notes: [],
  },
  {
    id: "approx_pack_healer",
    parentId: "compare_pack_healer",
    name: "Pack Healer",
    summary: "Pack Healer nearby heals both sides at once in Compare.",
    gameTruth: [
      "In game, Pack Healer's regen aura affects only allies within range, not the opponent.",
    ],
    currentApproximation: [
      "When Pack Healer nearby is enabled in Compare, both creatures receive the health regeneration increase.",
      "It is not treated as a one-sided self-only buff.",
    ],
    whyApproximated: "Compare-side symmetry assumption: in 1v1 the aura is treated as benefiting both combatants since neither side is clearly the ally target.",
    notes: [],
  },
  {
    id: "approx_reflux_puddle_occupancy",
    parentId: "ability_reflux",
    name: "Reflux puddle occupancy",
    summary: "The target is treated as staying inside the Reflux puddle for its full duration.",
    gameTruth: [
      "In game, the target may move out of the puddle, reducing exposure to its damage and Corrosion ticks.",
    ],
    currentApproximation: [
      "Once Reflux creates its puddle, the target is treated as remaining inside it for the whole effect duration.",
      "Puddle damage and Corrosion are applied automatically until the puddle ends.",
    ],
    whyApproximated: "Stand-and-fight simplification: target movement out of area effects is not modeled.",
    notes: [],
  },
  {
    id: "approx_rewind_snapshot_behavior",
    parentId: "ability_rewind",
    name: "Rewind snapshot behavior",
    summary: "Rewind uses a snapshot rollback model that also restores statuses, not just HP.",
    gameTruth: [
      "In game, Rewind is closer to a simple direct heal; status rollback has not been fully verified against in-game behavior.",
    ],
    currentApproximation: [
      "The model looks for the user's recorded state from about 9 seconds earlier.",
      "If no valid 9 second snapshot exists, Rewind does nothing.",
      "The model restores the user's statuses from that older snapshot.",
      "It also restores HP toward that older state, with the HP gain capped at 25% of max HP.",
    ],
    whyApproximated: "Snapshot rollback was implemented before in-game behavior was fully verified; the status-restoration side stays until empirical re-derivation confirms or refutes it.",
    notes: [],
  },
  {
    id: "approx_self_destruct",
    parentId: "ability_self_destruct",
    name: "Self-Destruct",
    summary: "Self-Destruct uses an outdated near-instant low-HP activation instead of a player-initiated cast.",
    gameTruth: [
      "In the older in-game version, the player had an activation opportunity around the low-HP threshold rather than an automatic trigger.",
    ],
    currentApproximation: [
      "Self-Destruct arms automatically while the user's HP is at or below 25%.",
      "After that, it explodes about 1 second later.",
    ],
    whyApproximated: "Representation is outdated and is expected to be updated later; even this outdated version is only approximate.",
    notes: [],
  },
  {
    id: "approx_special_air_pvp_rule",
    parentId: "compare_special_air_pvp_rule",
    name: "Special Air PvP Rule",
    summary: "Special Air PvP Rule is a compare-only shortcut imitating one part of air PvP behavior.",
    gameTruth: [
      "Air PvP in game involves more complex movement, positioning, and bite-cooldown rules than the rule captures.",
    ],
    currentApproximation: [
      "When this rule is enabled, both creatures are forced to use one fixed bite cooldown value.",
      "That fixed cooldown overrides normal bite-cooldown changes from statuses and traits.",
    ],
    whyApproximated: "Compare-only shortcut: a full air-combat simulation is out of scope; the fixed bite cooldown captures the most impactful part.",
    notes: [],
  },
  {
    id: "approx_thorn_trap_target_behavior",
    parentId: "ability_thorn_trap",
    name: "Thorn Trap target behavior",
    summary: "The model assumes the target is caught by Thorn Trap immediately.",
    gameTruth: [
      "In game, the target may avoid the trap or be caught after a delay.",
    ],
    currentApproximation: [
      "Once Thorn Trap is activated, the target is treated as being caught by the trap right away.",
    ],
    whyApproximated: "Stand-and-fight simplification: positioning and avoidance are not modeled.",
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
      "The poison ticks continue until the Totem duration ends.",
    ],
    whyApproximated: "Target AI for prioritizing structure destruction is not modeled.",
    notes: [],
  },
  {
    id: "approx_two_faced",
    parentId: "ability_two_faced",
    name: "Two-Faced",
    summary: "Two-Faced is modeled as a single fixed side per build, chosen via a page-level toggle.",
    gameTruth: [
      "In game, Two-Faced alternates between Madness and Tranquility sides during combat.",
    ],
    currentApproximation: [
      "Each run picks one side for the whole fight: Madness or Tranquility.",
      "Tranquility multiplies damage and bite cooldown by 1.6 (+60% on both).",
      "Madness multiplies damage and bite cooldown by 0.625 (-37.5% on both).",
      "On every page, the chosen side applies to every Two-Faced owner involved in the run.",
    ],
    whyApproximated: "Best Builds requires deterministic build scores; full alternation would need timing or randomness, breaking ranking stability.",
    notes: [],
  },
];

export const COMPARE_ONLY_REFERENCE_DRAFTS: AbilityReferenceEntry[] = [
  {
    id: "compare_posture_policy",
    name: "Sit/Lay/Stand Policy",
    status: "Compare-only",
    summary: "Compare-only AI that decides when a creature should sit or lay to gain regen / ailment-decay / damage-trade benefits.",
    mechanics: [
      "Postures: Standing (default), Sitting, Laying. Each side runs its own policy choice independently.",
      "Transition durations: Standing to Sitting = 1 second; Standing to Laying = 2 seconds; Sitting to Laying or back = 1 second each way; standing up from any posture is instant.",
      "Settled (post-transition) Sitting multiplies passive health regen by 1.5, negative-ailment natural decay by 2.0, and incoming bite and breath damage by 1.5.",
      "Settled Laying multiplies passive health regen by 2.0, negative-ailment natural decay by 4.0, and incoming bite and breath damage by 1.75.",
      "Multipliers apply only AFTER the transition fully completes. During the 1 to 2 second transition window the side is treated as Standing for damage / regen / decay math.",
      "While settled in Sitting or Laying, the side cannot bite, cannot breathe, and cannot start new active-ability activations. Pre-existing active states keep ticking through their own duration.",
      "Hunker deactivates the moment ANY posture transition starts, including standing up, because Hunker requires the Standing pose.",
      "During the transition window the side CAN still bite, breath, and activate new abilities - only the settled state gates actions.",
      "At each decision point the policy clones the live engine state and replays it forward for each candidate action (Stay, Start Sit, Start Lay, Stand Up). The candidate is scored by the replay's outcome - final HP for both sides and who died first if anyone - so the policy sees exactly what the engine would produce, with no hand-rolled approximations.",
      "Inner replays use posture-policy override ForcedOff so the projection can't recurse. The replay runs until either side dies or hits the simulation's time bound, with a 5000-iteration safety cap against pathological runaways.",
      "Stay is always one of the evaluated candidates. The policy never picks a non-Stay candidate unless its replay outcome is STRICTLY better than Stay's.",
      "Decision points: periodic re-evaluation every 5 seconds, plus an extra check 2 seconds before each upcoming regen tick when Regen-aware mode is on. Regen-aware vs Regen-unaware differ ONLY in WHEN decisions fire, not how candidates are scored - both use the same engine-replay, so a regen tick counts toward the candidate's outcome as soon as its lay-window covers one.",
    ],
    policyDifferences: [
      "The policy has three modes per side: Off (no posture changes ever), Auto Regen-aware, Auto Regen-unaware.",
      "Off mode is guaranteed identical to runs without the policy.",
      "Both Auto modes are guaranteed to never produce a worse projected outcome than Off, because Stay is always one of the evaluated candidates.",
    ],
    notes: [
      "Compare-only feature. Best Builds and Optimizer ignore the policy and always run with posture forced to Standing.",
      "The damage multiplier applies only to bite and breath. Ailment ticks, Lance, Self-Destruct, and other percentage-based abilities are NOT multiplied by posture.",
      "Shadow Barrage copies the original bite event verbatim, so it inherits the posture multiplier without re-applying it.",
      "Combat log writes 'A started sitting/laying/standing' on transition start, 'A is now sitting/laying' on completion, and 'A stood up' for instant stand-ups.",
    ],
  },
  {
    id: "compare_aggressive",
    name: "Aggressive",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "Aggressive applies Aggressive Status for 10 seconds.",
      "That gives +25% damage.",
      "If the user has Bear, it uses the Bear version instead and the effect becomes +37.5% damage (25% × 1.1 + 10; see plushie_bear).",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_storming",
    name: "Storming",
    status: "Modeled",
    summary: "Buff-menu debuff: a terrestrial caught in water takes more damage from Aquatic species.",
    mechanics: [
      "Storming is a buff-menu toggle in Compare and Best Builds / Optimizer (it is not offered in Sandbox's own controls, though Sandbox inherits the shared battle settings).",
      "It only takes effect when the afflicted side is a Terrestrial creature and its opponent is an Aquatic species.",
      "While in effect, the afflicted side takes 10% more damage from the opponent - both bites and breath.",
      "The effect lasts the whole fight (a single permanent marker) and deals no damage of its own.",
    ],
    policyDifferences: [],
    notes: [
      "Mirrors the in-game Storming debuff terrestrials receive for staying in the water too long.",
      "The terrestrial-self / aquatic-opponent gate is resolved when the fight is set up; toggling Storming in any other matchup does nothing.",
    ],
  },
  {
    id: "compare_broodwatcher",
    name: "Broodwatcher",
    status: "Compare-only",
    summary: "Compare-only ability.",
    mechanics: [
      "In Compare, Broodwatcher starts the fight with 5 Defensive stacks.",
      "Those stacks do not decay naturally.",
    ],
    policyDifferences: [],
    notes: [
      "Broodwatcher is not part of the default model and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_clean_water",
    name: "Clean water",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "Clean water applies the Clean Water status for 180 seconds when the toggle is on.",
      "While active, Clean Water increases health regeneration by 20% multiplicatively.",
      "The duration corresponds to 60 standard stacks at 3 seconds per stack; re-applying refreshes the timer rather than stacking.",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
      "See status_clean_water for the underlying status entry.",
    ],
  },
  {
    id: "compare_damage_boost",
    name: "Damage Boost",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "Damage Boost gives +5% damage, +5% weight, and -5% bite cooldown.",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_defiled_ground",
    name: "Defiled Ground",
    status: "Compare-only",
    summary: "Compare-only ability.",
    mechanics: [
      "In Compare, Defiled Ground lets you choose contaminated land level 1, 2, or 3.",
      "The owner gains +5% / +7.5% / +10% max health depending on the selected level.",
      "The owner also gains +5% / +7.5% / +10% weight depending on the selected level.",
      "The owner also gains 10% / 20% / 30% faster ailment recovery depending on the selected level.",
      "In the current model, that ailment recovery is implemented by reducing the normal 3 second decay interval for recoverable negative statuses.",
      "If Use hunger rules is enabled, the user also uses 20% / 50% / 80% less hunger or thirst depending on the selected level.",
      "At the same time, the opponent gets Weakness from the contaminated land and uses 20% more hunger or thirst while hunger rules are enabled.",
    ],
    policyDifferences: [],
    notes: [
      "Hunger and thirst changes do nothing unless Use hunger rules is enabled.",
      "The current model treats the contaminated land bonus as active for the whole fight once it is enabled.",
      "Defiled Ground is not part of the default model and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_first_tick_rule",
    name: "First Tick Rule",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "First Tick Rule changes when the first passive tick happens.",
      "It can apply to ailments, regeneration, or both.",
      "When it is enabled, the first tick uses the chosen compare delay instead of the normal starting timing.",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_frosty",
    name: "Frosty",
    status: "Compare-only",
    summary: "Compare-only ability.",
    mechanics: [
      "In Compare, Frosty currently applies only its +25% health regeneration effect.",
    ],
    policyDifferences: [],
    notes: [
      "Frosty is not part of the default model and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_gore_charge",
    name: "Gore Charge",
    status: "Compare-only",
    summary: "Compare-only ability.",
    mechanics: [
      "In Compare, Gore Charge currently changes only the first melee hit.",
      "That hit applies 2 stacks of Bleed and 10 stacks of Deep Wounds.",
    ],
    policyDifferences: [],
    notes: [
      "Gore Charge is treated as a compare-side assumption and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_gourmandizer",
    name: "Gourmandizer",
    status: "Compare-only",
    summary: "Compare-only ability.",
    mechanics: [
      "In Compare, Gourmandizer gives a weight bonus based on appetite fill above 100%.",
      "That bonus scales linearly from +0% at 100% fill to +15% at 125% fill.",
      "Without hunger rules, only the starting fill is used.",
      "With hunger rules enabled, the bonus updates dynamically from the current fill instead.",
    ],
    policyDifferences: [],
    notes: [
      "Gourmandizer is treated as a compare-side assumption and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_healing_pulse",
    name: "Healing Pulse",
    status: "Compare-only",
    summary: "Compare-only active ability with two firing modes.",
    mechanics: [
      "In Compare, the user first toggles Healing Pulse on. When enabled, a mode selector offers Normal or Once at start.",
      "Each cast applies 10 stacks of Healing Ailment to both combatants (self and opponent) because the in-game radius covers both in a stand-and-fight exchange.",
      "Normal: the user casts at t=0 and again every 90 seconds of cooldown for the rest of the fight.",
      "Once at start: the user casts a single time at t=0, targeting only the user - the opponent does not receive Healing Ailment.",
    ],
    policyDifferences: [
      "Healing Pulse does not use policy timing; Normal fires on cooldown, Once at start fires once at t=0.",
    ],
    notes: [
      "The timeline records each Healing Pulse activation.",
      "Healing Pulse is not part of the default model and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_mud_pile",
    name: "Mud Pile",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "In Compare, Mud Pile is currently represented through the Muddy Status toggle.",
      "That applies Muddy Status for 90 seconds.",
      "Muddy gives +25% health regeneration and doubles Bleed and Poison healing rate.",
    ],
    policyDifferences: [],
    notes: [
      "Mud Pile is treated as a compare-side assumption and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_no_move_facetank",
    name: "No Move Facetank",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "No Move Facetank changes how persistent PvP statuses behave.",
      "When it is disabled, Poison, Burn, Bleed, Corrosion, Necropoison, and Frostbite stop naturally decaying.",
      "When it is enabled, those statuses decay normally.",
      "Because each ailment tick processes natural decay first and then deals damage using the post-decay stack count, a moving (No Move Facetank disabled) target keeps its stacks while a stationary target loses one stack right before damage is calculated. The result is that the very first tick on a 1-stack Burn deals 5x more on a moving target than on a stationary one, but the gap narrows quickly with more stacks (about 1.1x at 10 stacks).",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_pack_healer",
    name: "Pack Healer",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "In Compare, Pack Healer nearby gives +25% health regeneration to both creatures if it is enabled on either side.",
    ],
    policyDifferences: [],
    notes: [
      "Pack Healer is treated as a compare-side assumption and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_poison_area",
    name: "Poison Area",
    status: "Compare-only",
    summary: "Compare-only active ability.",
    mechanics: [
      "In Compare, the user activates Poison Area on cooldown.",
      "Each activation applies 5 stacks of Poison to the opponent.",
      "The ability has a 15-second cooldown that is scaled by the usual active cooldown multiplier.",
    ],
    policyDifferences: [
      "Poison Area is fired whenever its cooldown is ready. It does not wait for ideal-timing search.",
    ],
    notes: [
      "Poison Area is not part of the default model and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_power_charge",
    name: "Power Charge",
    status: "Compare-only",
    summary: "Compare-only ability.",
    mechanics: [
      "In Compare, Power Charge currently changes only the first melee hit.",
      "That hit gains +50% damage and applies 2 stacks of Shredded Wings.",
    ],
    policyDifferences: [],
    notes: [
      "Power Charge is treated as a compare-side assumption and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_refreshed",
    name: "Refreshed",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "Refreshed applies the Refreshed status for 180 seconds when the toggle is on.",
      "While active, Refreshed increases health regeneration by 5% multiplicatively.",
      "The duration corresponds to 60 standard stacks at 3 seconds per stack; re-applying refreshes the timer rather than stacking.",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
      "See status_refreshed for the underlying status entry.",
    ],
  },
  {
    id: "compare_regen_boost",
    name: "Regen Boost",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "Regen Boost gives +20% health regeneration and -10% ability cooldown.",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_scared_status",
    name: "Scared Status",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "Scared Status applies Scared Status for 10 seconds.",
      "That gives -50% damage.",
      "If the user has Bear, it uses the Bear version instead and the effect becomes -45% damage (-50% × 1.1 + 10; see plushie_bear).",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_special_air_pvp_rule",
    name: "Special Air PvP Rule",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "Special Air PvP Rule forces both creatures to use one fixed bite cooldown.",
      "When it is enabled, that fixed cooldown overrides normal bite-cooldown changes from statuses and traits.",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_spite_ready_at_start",
    name: "Spite ready at start",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "This rule starts the fight with a fully charged Spite already armed.",
      "The opening bite consumes that charged Spite immediately.",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_strength_in_numbers",
    name: "Strength In Numbers",
    status: "Compare-only",
    summary: "Compare-only passive ability.",
    mechanics: [
      "In Compare, the user picks how many nearby allies with Strength In Numbers are present, from 0 up to 8.",
      "Each nearby ally adds +1.5% damage to the user.",
      "The stamina regeneration bonus is not modeled here.",
    ],
    policyDifferences: [],
    notes: [
      "Strength In Numbers is not part of the default model and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_use_hunger_rules",
    name: "Use hunger rules",
    status: "Compare-only",
    summary: "Compare-only rule.",
    mechanics: [
      "This rule enables compare-side appetite behavior.",
      "Appetite drains by 1 unit every 30 seconds.",
      "Disease makes appetite drain faster.",
      "Gourmandizer overfill above 100% drains 1.5x faster.",
      "Reflux spends 25 percentage points of the full appetite meter on cast start and cannot start below that cost.",
    ],
    policyDifferences: [],
    notes: [
      "This rule exists only in Compare and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_volcanic",
    name: "Volcanic",
    status: "Compare-only",
    summary: "Compare-only ability.",
    mechanics: [
      "In Compare, Volcanic currently applies only its +50% health regeneration effect.",
    ],
    policyDifferences: [],
    notes: [
      "Volcanic is not part of the default model and does not move into Optimizer or Best Builds.",
    ],
  },
  {
    id: "compare_secondary_attack",
    name: "Secondary Attack",
    status: "Compare-only",
    summary:
      "Compare-only per-bite choice between the creature's primary bite (base damage + on-hit offensive ailments) and its wiki-listed secondary bite (`stats.damage2`, higher damage but no offensive ailments).",
    mechanics: [
      "Available on any creature whose wiki entry has a non-zero `stats.damage2`. The Compare page surfaces a three-way chip under \"Specific / disputed abilities\": Primary / Dynamic / Secondary.",
      "Primary mode: every bite uses base damage and applies the creature's on-hit offensive ailments as listed in `effects_catalog`. This is the default and matches every other simulator path (Best Builds, Optimizer, Sandbox always use primary).",
      "Secondary mode: every bite uses `stats.damage2` and applies zero on-hit offensive ailments. All other multipliers (Hunters Curse, Adrenaline, Warden's Rage, base Spite damage, Power Charge, Cocoon damage, Expunge kill-secure / heal-save) stack on the secondary value identically.",
      "Dynamic mode: at each bite firing the engine picks primary or secondary based on which choice maximises projected damage delivered to the opponent over a near-future horizon. Bite cadence is unchanged - same `next_hit` schedule for both variants, no switch cost between bites.",
    ],
    policyDifferences: [
      "Primary / Secondary modes are forced - no policy evaluation, the same variant fires every bite.",
      "Dynamic mode uses the same engine-replay projection as the Posture policy. At each bite firing, the engine clones the live state and replays it forward for each variant (primary or secondary). The variant with the better replay outcome wins - by remaining HP for both sides and who died first; ties go to primary so behavior is conservative when both variants are equivalent.",
      "Inner replays use posture-policy override ForcedOff to avoid recursion. Future bites' variants are decided independently when their own engine-replay calls fire - a fight assembles a per-bite-optimal sequence by rolling commit, not by one big up-front plan.",
      "Because the replay uses real engine math, all multiplier stacks (Hunters Curse, Adrenaline, Warden's Rage, base Spite, Power Charge, Cocoon damage, Expunge synergy), opponent block / resist / immunity, stacking caps, status DPS and decay, and Fortify cleanse risk are honored automatically - no hand-rolled formula.",
    ],
    notes: [
      "`stats.damage2` is wiki-sourced (synced by `tools/wiki-sync.ts`) - replaces the hand-maintained 57-entry table that used to gate the chip and drift from the wiki.",
      "Compare-only by design - Best Builds, Optimizer, and Sandbox all fix the variant at primary. The secondary-attack mechanic exists in-game but isn't part of the build-optimization problem.",
      "When the selected creature has no secondary attack (`damage2 <= 0`), the chip is hidden and the mode is forced back to Primary so the UI never shows a stale non-default selection.",
    ],
  },
];

export const MODELED_ABILITY_REFERENCE_DRAFTS: AbilityReferenceEntry[] = [
  {
    id: "ability_acid_breath",
    name: "Acid Breath",
    status: "Modeled",
    summary: "Channeled breath that ticks corrosive damage and applies Corrosion stacks while firing.",
    mechanics: [
      "Acid Breath fires one damage tick every 0.5 seconds while breath is held, which is 2 ticks per second.",
      "Capacity is 10 seconds of firing - each second of continuous fire consumes 1 capacity unit, regardless of damage tick frequency. When capacity reaches 0 the breath stops until it regenerates at 1.8 capacity per second.",
      "Per-tick direct damage equals base × 0.5 × 1.05 × (1 − defender breath resistance), where base = (defender max HP × (1 + attacker effective weight / defender effective weight)) / 2 / 100.",
      "Each tick applies 0.5 stacks of Corrosion to the defender.",
    ],
    policyDifferences: [
      "Breath abilities do not use the standard ability timing policy modes.",
      "Once actives are enabled, the breath fires whenever capacity is available.",
    ],
    notes: [
      "The 1.05× factor is a pseudo-crit. The model does not roll random breath crits - it folds Acid Breath's listed 10% crit chance into a flat 1.05× multiplier on every tick (10% chance × 1.5× crit = 1 + 0.10 × 0.5).",
      "The 0.5 stacks per tick is a pseudo-proc. The model does not roll the listed 100% Corrosion chance per tick - it applies the expected stack value (1.0 × 0.5 = 0.5) every tick.",
      "Effective weight on each side is multiplied by any active Corrosion on that side before the ratio is computed.",
      "The timeline can show breath damage ticks and Corrosion applications.",
    ],
  },
  {
    id: "ability_adrenaline",
    name: "Adrenaline",
    status: "Modeled",
    summary: "Temporarily increases the user's bite damage.",
    mechanics: [
      "Adrenaline lasts for 30 seconds.",
      "Its base cooldown is 90 seconds.",
      "While Adrenaline is active, the user's bite damage is multiplied by 1.2x.",
      "The boost applies to bite damage only and does not increase breath damage.",
      "The model does not apply Adrenaline's speed boost.",
      "The model does not apply Adrenaline's stamina regeneration penalty because stamina is outside the stand-and-fight damage model.",
    ],
    policyDifferences: [
      "Adrenaline activates as soon as it is available across all timing policy modes.",
      "The 1.2x bite-damage buff is treated as a pure outgoing buff with no cost, so firing as early as possible strictly dominates any delayed window.",
    ],
    notes: [
      "The timeline can show when Adrenaline is activated.",
    ],
  },
  createOutOfModelAbilityEntry("Agile Swimmer"),
  createOutOfModelAbilityEntry("Area Food Restore"),
  createOutOfModelAbilityEntry("Area Water Restore"),
  {
    id: "ability_aura",
    name: "Aura",
    status: "Modeled",
    summary: "Applies a repeating aura ailment every 3 seconds.",
    mechanics: [
      "Aura effects tick every 3 seconds while they are active.",
      "The first tick happens 3 seconds after the fight starts or 3 seconds after the aura becomes active.",
      "Aura effects apply their ailment automatically on that cadence.",
      "Each tick applies 3 stacks of the corresponding ailment to the opposite side.",
      "Aura effects are treated as active automatically while their ability is enabled.",
    ],
    policyDifferences: [
      "Aura effects do not use a separate activation policy.",
      "Once actives are enabled, they tick automatically on their normal cadence.",
    ],
    notes: [
      "The timeline can show repeated aura ticks.",
      "The current model includes Aura (Disease).",
      "Radiation currently functions as Aura (Corrosion), but the name has not been changed yet.",
    ],
  },
  {
    id: "ability_berserk",
    name: "Berserk",
    status: "Modeled",
    summary: "Increases bite speed at low HP.",
    mechanics: [
      "Berserk is a passive ability that becomes active when the user's HP drops below 20%.",
      "While Berserk is active, the user's bite cooldown is multiplied by 0.5x.",
    ],
    policyDifferences: [
      "Berserk does not use a separate activation policy.",
      "It turns on automatically when the HP condition is met and turns off automatically when the condition is no longer met.",
    ],
    notes: [
      "The timeline and Details UI show Berserk activation and deactivation when the HP condition changes.",
    ],
  },
  {
    id: "ability_breath_resistance",
    name: "Breath Resistance",
    status: "Modeled",
    summary: "Reduces incoming breath damage.",
    mechanics: [
      "Raw breath damage = ((target max HP * ((attacker weight / defender weight) + 1)) / 2 / 100) * dps_pct * 0.5.",
      "dps_pct is the breath ability's listed damage-per-second percentage. The 0.5 factor converts it to per-tick because breaths tick 2 times per second.",
      "Capacity is denominated in seconds of continuous fire: a breath with capacity N lasts N seconds before it empties, independent of damage tick frequency. Capacity drains at 1 unit per second of firing.",
      "Crit chance and chain stacks, when present, multiply the raw damage as additional factors before breath resistance is applied.",
      "Final breath damage = raw breath damage * (1 - Breath Resistance).",
      "It affects breath damage only and does not block breath-applied ailments or statuses.",
    ],
    policyDifferences: [
      "Breath Resistance does not use a separate activation policy.",
      "It is always applied automatically.",
    ],
    notes: [
      "Breath Resistance is always-on and is not shown as a conditional passive transition.",
    ],
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
    policyDifferences: [
      "Cause Fear does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The timeline can show when Cause Fear is activated.",
    ],
  },
  createOutOfModelAbilityEntry("Change Weather"),
  createOutOfModelAbilityEntry("Channeling"),
  createOutOfModelAbilityEntry("Charge"),
  createOutOfModelAbilityEntry("Climber"),
  {
    id: "ability_cloud_breath",
    name: "Cloud Breath",
    status: "Modeled",
    summary: "Provides light self-healing and can refresh Muddy Status instead of dealing damage.",
    mechanics: [
      "Cloud Breath deals no damage.",
      "Cloud Breath has capacity 10.",
      "Cloud Breath ticks 2 times per second while it is firing.",
      "Each tick heals the user for 0.5% of max HP.",
      "Cloud Breath also uses a deterministic pseudo-proc for Muddy Status, refreshing Muddy to 90 seconds on a fixed cadence derived from its listed 40% chance.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "The timeline can show Cloud Breath healing ticks and Muddy applications.",
      "Cloud Breath's listed Water Regeneration self-application is not currently modeled.",
    ],
  },
  {
    id: "ability_cocoon",
    name: "Cocoon",
    status: "Modeled",
    summary: "Three-phase active: 5s wind-up (normal play continues), 5s invincibility + heal, then a ~20s damage buff.",
    mechanics: [
      "Cocoon is a single-charge active with a 120 second cooldown. Activation is gated by HP (policy-dependent, see below).",
      "Phase 1 (0 to 5 seconds): the user keeps playing normally - they can bite, use other actives, and their defensive ailments fire on incoming bites. They also take damage normally and can die during this window.",
      "Phase 2 (5 to 10 seconds): the user is fully invincible and immune to new statuses; they cannot bite or use other actives during this window. A lump heal equal to 30% of max HP is applied at the end of Phase 2, matching the total of a linear +6% max HP per second heal over those 5 seconds. Opponent bites scheduled during Phase 2 are pushed to the end of Phase 2.",
      "Phase 3 (after the Phase 2 heal, about 20 seconds): the user's melee bites deal +15% damage while Cocoon_Damage_Status has stacks. The status starts at 6.66 stacks with its first decay tick delayed 3 seconds into Phase 3 so the buff window spans roughly 20 seconds.",
      "Cocoon does not apply any status to the opponent.",
    ],
    policyDifferences: [
      "really fast / fast: activate as soon as HP drops at or below 70% and Cocoon is off cooldown.",
      "semi-ideal / ideal: same 70% HP gate, plus a lookahead check - do not activate if the opponent's projected damage over the 5 second Phase 1 window would kill the user (using current opponent bite DPS with a 5% max HP safety margin).",
      "The lookahead guard means ideal may skip an activation that reallyFast would take; in exchange, when ideal does activate it survives Phase 1.",
    ],
    notes: [
      "The timeline records when Cocoon is activated.",
      "Because bites that fall inside Phase 2 are rescheduled instead of landing, on-hit statuses, Power Charge, Gore Charge, reflect, and life-leech from those blocked bites are all skipped - the user and opponent resume normal exchanges at Phase 2 end.",
    ],
  },
  {
    id: "ability_crystal_breath",
    name: "Crystal Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Crystal Breath deals damage 2 times per second while it is firing.",
      "Crystal Breath has capacity 10.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.5 * 1.0 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effects are Bleed at 75% chance for 0.5 stacks, Injury at 50% chance for 1 stack, and Shredded Wings at 50% chance for 1 stack.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Crystal Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Its listed secondary effects use pseudo-procs, but only Bleed is currently modeled, so that becomes 0.375 expected stacks per tick.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  {
    id: "ability_cursed_sigil",
    name: "Cursed Sigil",
    status: "Modeled",
    summary: "Applies Bad Omen immediately.",
    mechanics: [
      "Cursed Sigil applies Bad Omen immediately when it is used.",
      "The number of applied Bad Omen stacks is based on the user's Cursed Sigil value.",
      "It has an 85 second cooldown.",
    ],
    policyDifferences: [
      "Cursed Sigil does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The timeline can show when Cursed Sigil is activated.",
    ],
  },
  {
    id: "ability_damage_link",
    name: "Damage Link",
    status: "Not planned",
    summary: "Currently not modeled.",
    mechanics: [],
    whyItsNotModeledHere: [
      "Damage Link was not added for the same general reason as other multi-creature abilities.",
      "In practice, it does not fit the site's main 1v1 PvP model because its relevant use cases are 2v1, 2v2, and similar fights.",
    ],
    policyDifferences: [],
    notes: [
      "Damage Link is not planned to be added because of that PvP scope mismatch.",
    ],
  },
  createOutOfModelAbilityEntry("Dazzling Flash"),
  createOutOfModelAbilityEntry("Diver"),
  {
    id: "ability_divination",
    name: "Divination",
    status: "Modeled",
    summary: "Arms a short bite-empowerment window that adds flat damage and Burn to the next few bites.",
    mechanics: [
      "When activated, Divination arms 3 bite charges.",
      "Each of the next 3 bites consumes one charge, adds +50 flat damage to that bite, and applies 2 stacks of Burn to the target.",
      "Charges are consumed only by landed bites. Remaining charges persist until consumed.",
      "It has a 120 second cooldown, counted from the activation moment.",
      "Divination cannot be re-armed while charges are still unspent.",
    ],
    policyDifferences: [
      "Divination does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The flat +50 damage is added after all melee damage multipliers and is not affected by them.",
      "The timeline can show when Divination is activated.",
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
    policyDifferences: [
      "Drowsy Area does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The timeline can show when Drowsy Area is activated.",
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
      "Energy Breath has capacity 8.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.225 * 1.0 * chain multiplier * (1 - breath resistance).",
      "Its chain multiplier starts ramping immediately while the breath keeps firing.",
      "In the current model, each breath tick adds 1 chain stack up to 10 stacks, and the multiplier is 1 + (1.0 * current chain stacks).",
      "That means the chain multiplier ramps from 2.0x on the first chained tick up to 11.0x at 10 stacks.",
      "Its listed secondary effect is Slowed at 25% chance with no stacking.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Energy Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Its listed secondary effect is currently out of model.",
      "The timeline can show Energy Breath damage ticks.",
    ],
  },
  createOutOfModelAbilityEntry("Escape Area"),
  {
    id: "ability_expunge",
    name: "Expunge",
    status: "Modeled",
    summary: "Active ability that, on its next bite, consumes all Bleed on the target to deal bonus damage and heal the user.",
    mechanics: [
      "Expunge is tied to the user's next bite. When it fires, all Bleed stacks on the target are erased and the bite deals final damage = D_normal × (1 + 0.05 × bleed_stacks), where D_normal is the weight-adjusted bite damage that would have landed without Expunge.",
      "On the same bite, the user is healed for a flat amount = 0.5 × baseAttack × 0.05 × bleed_stacks (flat HP, independent of weight).",
      "Cooldown is 45 seconds and starts when the bonus bite lands.",
      "Bleed stacks are read from the target at bite time, no rounding. If bleed_stacks is 0 the ability does not fire (no cooldown started).",
    ],
    policyDifferences: [
      "Expunge uses a single ideal policy that fires only when the bite yields unambiguous net benefit.",
      "Kill-secure: fires if the normal bite would not kill the target but the bonus bite would.",
      "Heal-save: fires if the user would otherwise die to the opponent's projected damage during the next bite cooldown, and the Expunge heal (plus a 5% max-HP safety margin) keeps them alive.",
      "Otherwise the charge is held - spending it speculatively would strip future passive Bleed DoT without a corresponding payoff.",
    ],
    notes: [
      "Damage formula is applied as a post-hoc multiplier on D_normal so weight/hunker/other modifiers compose naturally.",
      "Healing is based on raw baseAttack (not weight-adjusted D_normal), matching the wiki-stated formula.",
      "Bleed on the target is cleared immediately when Expunge fires, whether or not the user is still alive after counter-hits in the same tick.",
    ],
  },
  {
    id: "ability_fire_breath",
    name: "Fire Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Fire Breath deals damage 2 times per second while it is firing.",
      "Fire Breath has capacity 20.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.5 * 1.125 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effect is Burn at 75% chance for 0.5 stacks.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Fire Breath uses a 25% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.125x instead of random crit rolls.",
      "Its Burn application uses pseudo-procs, so 0.5 stacks at 75% chance becomes 0.375 expected stacks per tick.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  {
    id: "ability_first_strike",
    name: "First Strike",
    status: "Modeled",
    summary: "Increases outgoing damage while HP is above 75%.",
    mechanics: [
      "First Strike applies while the user's HP is above 75%.",
      "While it is active, outgoing damage is multiplied by 1 + First Strike value.",
      "For example, First Strike 0.25 means outgoing damage is multiplied by 1.25.",
    ],
    policyDifferences: [
      "First Strike does not use a separate activation policy.",
      "It turns on automatically when the HP condition is met and turns off automatically when the condition is no longer met.",
    ],
    notes: [
      "The timeline and Details UI show First Strike activation and deactivation when the HP condition changes.",
    ],
  },
  {
    id: "ability_flame_trail",
    name: "Flame Trail",
    status: "Modeled",
    summary: "Passive HP-gated trail that ticks Burn damage to the opponent while the user is below the ability's HP threshold.",
    mechanics: [
      "Flame Trail is a passive ability gated by the Trails compare-only toggle.",
      "It activates while the user's current HP is at or below the ability's value, expressed as a fraction of max HP (for example, value 50 means 50% HP).",
      "While active, every 1 second the opponent takes damage equal to 2% of their max HP and receives 2 stacks of Burn.",
      "Only one trail segment is modeled and it is treated as eternal while the HP threshold is met. Segment despawn is not simulated.",
      "While any of the user's trail abilities is active, No Move Facetank is automatically overridden off; the previous setting is restored when the override clears.",
    ],
    policyDifferences: [
      "Flame Trail is a passive and does not have policy timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
    ],
    notes: [
      "Flame Trail is a Compare-only modeled effect and is not enabled in the default model. It only runs when the Trails compare-only toggle is enabled for the user.",
      "Damage is computed against the opponent's current max HP, not the user's max HP.",
      "If multiple trail abilities are present on the user, they all activate together while their HP thresholds are met.",
    ],
  },
  {
    id: "ability_fortify",
    name: "Fortify",
    status: "Modeled",
    summary: "Cleans removable negative statuses, then gives a short status immunity window and a small weight bonus.",
    mechanics: [
      "Fortify removes all currently active removable negative statuses when it is used.",
      "This explicitly includes Aftershock, Ashy Lungs, Bad Omen, Bleed, Broken Legs, Burn, Confusion, Corrosion, Deep Wounds, Disease, Drowsy, Fear, Freeze, Frostbite, Heartbroken, Injury, Necropoison, Paralyze, Poison, and Radiation.",
      "It also removes other currently active negative statuses that are treated in the model as damage-over-time effects or as debuffs to healing, stamina regeneration, bite cooldown, damage, or weight.",
      "After activation, Fortify gives status immunity for 9 seconds.",
      "During that same 9 second window, it also gives a 5% weight bonus.",
      "Fortify has a 90 second cooldown.",
    ],
    policyDifferences: [
      "Really fast uses Fortify only when the user has at least 15 total removable negative stacks.",
      "Fast uses a simpler rule. It activates for Bleed, Burn, Corrosion, Drowsy, Freeze, Necropoison, or at least two removable negative statuses.",
      "Semi-ideal, ideal, and extreme use timing search to compare using Fortify now against keeping the current statuses for longer.",
    ],
    notes: [
      "If Fortify immunity is active, new negative statuses are blocked during that window.",
      "The timeline can show when Fortify is activated.",
    ],
  },
  {
    id: "ability_frost_nova",
    name: "Frost Nova",
    status: "Modeled",
    summary: "Applies Frostbite over time after activation.",
    mechanics: [
      "Frost Nova lasts for 15 seconds.",
      "It does not deal direct damage when it is activated.",
      "The first Frost Nova tick happens 3 seconds after activation.",
      "While Frost Nova is active, it applies 3 stacks of Frostbite every 3 seconds.",
      "It has a 60 second cooldown.",
    ],
    policyDifferences: [
      "Frost Nova does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The timeline can show when Frost Nova is activated.",
      "The timeline can also show the repeated Frostbite applications while Frost Nova is active.",
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
    policyDifferences: [
      "Frost Snare does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The timeline can show when Frost Snare is activated.",
    ],
  },
  {
    id: "ability_frost_trail",
    name: "Frost Trail",
    status: "Modeled",
    summary: "Passive HP-gated trail that ticks Frostbite damage to the opponent while the user is below the ability's HP threshold.",
    mechanics: [
      "Frost Trail is a passive ability gated by the Trails compare-only toggle.",
      "It activates while the user's current HP is at or below the ability's value, expressed as a fraction of max HP.",
      "While active, every 1 second the opponent takes damage equal to 2% of their max HP and receives 2 stacks of Frostbite.",
      "Only one trail segment is modeled and it is treated as eternal while the HP threshold is met. Segment despawn is not simulated.",
      "While any of the user's trail abilities is active, No Move Facetank is automatically overridden off; the previous setting is restored when the override clears.",
    ],
    policyDifferences: [
      "Frost Trail is a passive and does not have policy timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
    ],
    notes: [
      "Frost Trail is a Compare-only modeled effect and is not enabled in the default model. It only runs when the Trails compare-only toggle is enabled for the user.",
      "Damage is computed against the opponent's current max HP, not the user's max HP.",
    ],
  },
  {
    id: "ability_glacier_breath",
    name: "Glacier Breath",
    status: "Modeled",
    summary: "Uses chained breath damage with a light ramp and high pseudo-crit.",
    mechanics: [
      "Glacier Breath deals damage 2 times per second while it is firing.",
      "Glacier Breath has capacity 10.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 1.0 * 1.175 * chain multiplier * (1 - breath resistance).",
      "In the current model, each breath tick adds 1 chain stack up to 10 stacks, and the chain multiplier is 1 + (0.05 * current chain stacks).",
      "That means the chain multiplier ramps from 1.05x on the first chained tick up to 1.5x at 10 stacks.",
      "Its listed secondary effects are Slowed at 30% chance with no stacking, Injury at 30% chance for 1 stack, and Freeze at 5% chance with no stacking.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Glacier Breath uses a 35% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.175x instead of random crit rolls.",
      "Its listed secondary effects are currently out of model.",
      "The timeline can show Glacier Breath damage ticks.",
    ],
  },
  createOutOfModelAbilityEntry("Glittering Trail"),
  {
    id: "ability_gold_breath",
    name: "Gold Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Gold Breath deals damage 2 times per second while it is firing.",
      "Gold Breath has capacity 20.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.25 * 1.0 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effects are Blurred Vision at 30% chance with no stacking and Freeze at 5% chance with no stacking.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Gold Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Its listed secondary effects use pseudo-procs from their listed chances, but they are currently out of model.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  createOutOfModelAbilityEntry("Grab"),
  {
    id: "ability_green_fire_breath",
    name: "Green Fire Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Green Fire Breath deals damage 2 times per second while it is firing.",
      "Green Fire Breath has capacity 20.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.5 * 1.125 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effect is Burn at 75% chance for 0.5 stacks.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Green Fire Breath uses a 25% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.125x instead of random crit rolls.",
      "Its Burn application uses pseudo-procs, so 0.5 stacks at 75% chance becomes 0.375 expected stacks per tick.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  {
    id: "ability_grim_lariat",
    name: "Grim Lariat",
    status: "Modeled",
    summary: "Deals an immediate damage burst and applies Heartbroken.",
    mechanics: [
      "Grim Lariat deals damage equal to 50% of the user's current damage.",
      "It also applies 8 stacks of Heartbroken.",
      "It has a 60 second cooldown.",
    ],
    policyDifferences: [
      "Grim Lariat does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The timeline can show Grim Lariat and the applied Heartbroken effect.",
    ],
  },
  {
    id: "ability_guilt",
    name: "Guilt",
    status: "Modeled",
    summary: "Reduces damage taken from bites.",
    mechanics: [
      "Guilt reduces incoming bite damage by 50%.",
      "It does not reduce damage from breaths.",
    ],
    policyDifferences: [
      "Guilt does not use a separate activation policy.",
      "It is always applied automatically.",
    ],
    notes: [
      "Guilt is always-on and is not shown as a conditional passive transition.",
    ],
  },
  {
    id: "ability_harden",
    name: "Harden",
    status: "Modeled",
    summary: "Temporarily increases the user's effective combat weight and passive health regeneration.",
    mechanics: [
      "Harden lasts for 30 seconds.",
      "Its base cooldown is 120 seconds.",
      "While Harden is active, the user's effective combat weight is multiplied by 1.35x.",
      "While Harden is active, passive health regeneration is multiplied by 1.25x.",
    ],
    policyDifferences: [
      "Harden does not currently use timing search or separate policy behavior.",
      "Once actives are enabled and Harden is available, it is used immediately.",
    ],
    notes: [
      "The timeline can show when Harden is activated.",
    ],
  },
  {
    id: "ability_haunt_breath",
    name: "Haunt Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Haunt Breath deals damage 2 times per second while it is firing.",
      "Haunt Breath has capacity 10.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.75 * 1.175 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effects are Poison at 75% chance for 1 stack, Shock at 10% chance for 0.5 stacks, and Tunnel Vision at 25% chance for 0.5 stacks.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Haunt Breath uses a 35% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.175x instead of random crit rolls.",
      "Its listed secondary effects use pseudo-procs, but only Poison is currently modeled, so that becomes 0.75 expected stacks per tick.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  {
    id: "ability_heal_aura",
    name: "Heal Aura",
    status: "Not planned",
    summary: "Currently not modeled.",
    mechanics: [],
    whyItsNotModeledHere: [
      "Heal Aura is not included in the default stand-and-fight combat model.",
      "In game, this ability affects both sides rather than only helping the user, so it is not treated as a normal one-sided combat effect.",
      "Because its effect is inherently disputed under stand-and-fight assumptions, it is not planned to be added.",
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
      "Heal Breath has capacity 10.",
      "Heal Breath ticks 2 times per second while it is firing.",
      "Each tick heals the user for 3% of max HP.",
      "Each tick also removes 0.5 stacks of removable negative statuses from the user.",
      "That cleanse is not random. It works in a fixed order: Poison, Burn, Bleed, then Corrosion.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: ["The timeline can show Heal Breath healing ticks."],
  },
  createOutOfModelAbilityEntry("Healing Hunter"),
  {
    id: "ability_healing_step",
    name: "Healing Step",
    status: "Modeled",
    summary: "Passive HP-gated heal step that restores a portion of the user's max HP every 3 seconds while at low HP.",
    mechanics: [
      "Healing Step is a passive ability gated by the Trails compare-only toggle.",
      "It activates while the user's current HP is at or below 65% of max HP.",
      "While active, every 3 seconds the user heals an amount equal to the ability's value expressed as a percentage of max HP (for example, value 5 heals 5% of max HP per tick).",
      "Only one segment is modeled and it is treated as eternal while the HP threshold is met. Segment despawn and max segment count are not simulated.",
      "Healing Step heals only the user; packmate healing is not modeled.",
      "While any of the user's trail or step abilities is active, No Move Facetank is automatically overridden off; the previous setting is restored when the override clears.",
    ],
    policyDifferences: [
      "Healing Step is a passive and does not have policy timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
    ],
    notes: [
      "Healing Step is a Compare-only modeled effect and is not enabled in the default model. It only runs when the Trails compare-only toggle is enabled for the user.",
      "Healing is based on the user's max HP, not current HP.",
    ],
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
      "Heliolyth's Judgement has capacity 10 (10 seconds of firing) and, once started, it continues firing until that capacity is emptied.",
      "It has a 3 second startup delay before firing begins.",
      "It has a 120 second cooldown instead of normal breath regeneration.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Heliolyth's Judgement has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "The timeline can show Heliolyth's Judgement damage ticks.",
    ],
  },
  {
    id: "ability_hunker",
    name: "Hunker",
    status: "Modeled",
    summary: "Trades melee damage for survivability by lowering the user's melee damage while reducing incoming direct damage.",
    mechanics: [
      "While Hunker is on, the user's melee damage is multiplied by 0.5x.",
      "While Hunker is on, incoming direct damage is reduced by the user's Hunker value.",
      "For example, Hunker 40 reduces incoming direct damage by 40%.",
      "This incoming reduction applies to direct bite damage and direct breath damage.",
      "Hunker does not use a timed active window or a cooldown. It stays on until the policy turns it off, actives are disabled, or the ability is manually released in Sandbox.",
      "If Hunker is turned off and then back on, the new Hunker effect takes 5 seconds to take hold; the very first activation in a fight has no delay.",
    ],
    policyDifferences: [
      "Really fast turns Hunker on immediately and keeps it on.",
      "Fast also turns Hunker on immediately and keeps it on.",
      "Semi-ideal, ideal, and extreme can leave Hunker off, turn it on, or turn it back off depending on the current tradeoff between survivability and damage.",
      "These precision policies can turn Hunker on immediately when the user is in a clearly losing fight, but may keep it off when the fight is already strongly favorable.",
    ],
    notes: [
      "The timeline can show when Hunker is activated and when it is turned off.",
    ],
  },
  {
    id: "ability_hunters_curse",
    name: "Hunters Curse",
    status: "Modeled",
    summary: "Costs half of the user's max HP to activate, then temporarily doubles bite damage.",
    mechanics: [
      "Hunters Curse lasts for 30 seconds.",
      "It has a 120 second cooldown.",
      "When it is activated, the user immediately loses 50% of its max HP.",
      "The activation cost cannot drop the user below 1 HP.",
      "While Hunters Curse is active, the user's bite damage is multiplied by 2x.",
      "It boosts bite damage only and does not increase breath damage.",
    ],
    policyDifferences: [
      "Really fast uses Hunters Curse immediately when it is available, then continues to use it on cooldown.",
      "Fast checks a simple efficiency rule before casting. It skips the cast if current HP is below 75%, if the target is already below 20% HP, or if the expected extra damage is too low for the 50% max HP cost.",
      "Semi-ideal, ideal, and extreme can wait for a stronger burst timing instead of always using Hunters Curse immediately after it becomes available.",
    ],
    notes: [
      "The timeline can show when Hunters Curse is activated.",
    ],
  },
  {
    id: "ability_ice_breath",
    name: "Ice Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Ice Breath deals damage 2 times per second while it is firing.",
      "Ice Breath has capacity 10.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.5 * 1.0 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effects are Slowed at 40% chance with no stacking and Frostbite at 75% chance for 0.5 stacks.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Ice Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Its listed secondary effects use pseudo-procs, but only Frostbite is currently modeled, so that becomes 0.375 expected stacks per tick.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  createOutOfModelAbilityEntry("Ink Cloud"),
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
      "Lance has a 60 second cooldown.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "The timeline can show the initial Lance impact and the later Lance aura ticks.",
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
      "Known payloads currently include Blessing's Boon, Malice's Mark, Slowed, Drowsy, Necropoison, Poison, Bad Omen, Water Regeneration, Flowering, Broken Bones, Stolen Speed, Blurred Vision, and Gale.",
      "Lich Mark has a 30 second cooldown.",
      "If the target still has remaining stacks from the previous Lich Mark-owned payload, only that owned portion is cleared before a fresh 5-stack payload is applied.",
    ],
    policyDifferences: [
      "Lich Mark does not currently use a separate timing policy.",
      "Once actives are enabled, it re-arms automatically whenever its cooldown is ready.",
    ],
    notes: [
      "The timeline can show when Lich Mark is armed, when the pending mark is applied, and when the payload status is applied.",
    ],
  },
  {
    id: "ability_life_leech",
    name: "Life Leech",
    status: "Modeled",
    summary: "Creates a timed healing window. During that window, part of the user's direct damage is returned as healing.",
    mechanics: [
      "Life Leech lasts for 12 seconds.",
      "It has a 60 second cooldown.",
      "Healing is based on direct damage dealt during the active window.",
      "This includes direct bite damage and direct breath damage.",
      "Status damage over time does not count for Life Leech healing.",
      "Healing is limited by the user's missing HP.",
    ],
    policyDifferences: [
      "Really fast: casts as soon as the ability is ready, but only if current HP is below 85% at that moment.",
      "Fast: uses a direct tactical heuristic instead of a deeper projection search.",
      "Semi-ideal, ideal, and extreme all use projection-based timing. They mainly differ by how willing they are to delay the cast for a better healing window.",
      "Ideal can delay the first cast to avoid wasting the window, but later recasts stay close to cooldown instead of drifting too far.",
    ],
    notes: [
      "Combat log shows the activation and healing events.",
    ],
  },
  {
    id: "ability_ligament_tear",
    name: "Ligament Tear",
    status: "Modeled",
    summary: "Applies Torn Ligaments.",
    mechanics: [
      "Offensive abilities apply their effect when the user lands a bite.",
      "Defensive abilities apply their effect when the user is bitten.",
      "Breath does not trigger Ligament Tear.",
      "Ligament Tear applies Torn Ligaments.",
    ],
    policyDifferences: [
      "Ligament Tear does not use a separate activation policy.",
      "It is applied automatically when its hit condition is met.",
    ],
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
      "Lightning Breath has capacity 5.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 1.5 * 1.25 * chain multiplier * (1 - breath resistance).",
      "In the current model, each breath tick adds 1 chain stack up to 5 stacks, and the chain multiplier is 1 + (0.25 * current chain stacks).",
      "That means the chain multiplier ramps from 1.25x on the first chained tick up to 2.25x at 5 stacks.",
      "Its listed secondary effect is Shock at 50% chance with no stacking.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Lightning Breath uses a 50% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.25x instead of random crit rolls.",
      "Its listed secondary effect is currently out of model.",
      "The timeline can show Lightning Breath damage ticks.",
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
      "Miasma Breath has capacity 10.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.25 * 1.125 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Miasma Breath also heals the user 2 times per second while it is firing.",
      "Each healing tick restores 0.5% of the user's max HP.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Miasma Breath uses a 25% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.125x instead of random crit rolls.",
      "The timeline can show Miasma Breath damage and healing ticks.",
    ],
  },
  createOutOfModelAbilityEntry("Overcharged"),
  {
    id: "ability_plague_breath",
    name: "Plague Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Plague Breath deals damage 2 times per second while it is firing.",
      "Plague Breath has capacity 5.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.25 * 1.125 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effect is Disease at 100% chance for 1 stack.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Plague Breath uses a 25% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.125x instead of random crit rolls.",
      "Its Disease application uses pseudo-procs, so 1 stack at 100% chance becomes 1 expected stack per tick.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  {
    id: "ability_plague_trail",
    name: "Plague Trail",
    status: "Modeled",
    summary: "Passive HP-gated trail that ticks Disease damage to the opponent while the user is below the ability's HP threshold.",
    mechanics: [
      "Plague Trail is a passive ability gated by the Trails compare-only toggle.",
      "It activates while the user's current HP is at or below the ability's value, expressed as a fraction of max HP.",
      "While active, every 1 second the opponent takes damage equal to 2% of their max HP and receives 2 stacks of Disease.",
      "Only one trail segment is modeled and it is treated as eternal while the HP threshold is met. Segment despawn is not simulated.",
      "While any of the user's trail abilities is active, No Move Facetank is automatically overridden off; the previous setting is restored when the override clears.",
    ],
    policyDifferences: [
      "Plague Trail is a passive and does not have policy timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
    ],
    notes: [
      "Plague Trail is a Compare-only modeled effect and is not enabled in the default model. It only runs when the Trails compare-only toggle is enabled for the user.",
      "Damage is computed against the opponent's current max HP, not the user's max HP.",
    ],
  },
  {
    id: "ability_plasma_beam",
    name: "Plasma Beam",
    status: "Modeled",
    summary: "Discrete-charge breath with three back-to-back charges before a long per-charge recharge.",
    mechanics: [
      "Plasma Beam starts the fight with 3 charges. Each charge fires 3 damage ticks at 2 ticks per second (1.5 seconds of firing per charge).",
      "Each charge has a 1 second startup delay between activation and its first damage tick.",
      "Consecutive charges fire back-to-back with no inter-charge cooldown - only the per-charge 1 second startup separates them.",
      "While at least one charge is stored, after the current charge exhausts the next charge auto-starts (1 second startup, then 3 ticks).",
      "Once all charges are spent, the user must wait for the next charge to regenerate. Charges regenerate at +1 charge every 40 seconds, capped at 3 charges.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 2.0 * 0.5 * 1.25 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the 2.0 per-hit multiplier, the 50% pseudo-crit folded against the global 1.5x crit, and any breath resistance on the target.",
      "Plasma Beam has no listed secondary effect.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
      "Plasma Beam fires whenever a charge is available, gated only by its own 1 second per-charge startup delay.",
    ],
    notes: [
      "Plasma Beam uses a 50% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.25x instead of random crit rolls.",
      "The 40 second charge-regen timer starts when the first charge is consumed and continues on its own clock; spending charges does not reset it.",
      "The timeline can show Plasma Beam damage ticks; no secondary status effects appear because the breath does not apply one.",
    ],
  },
  {
    id: "ability_quick_recovery",
    name: "Quick Recovery",
    status: "Modeled",
    summary: "Increases natural health regeneration at low HP.",
    mechanics: [
      "Quick Recovery is a passive ability.",
      "Its regeneration bonus scales linearly as the user's HP gets lower.",
      "It starts increasing below 100% HP.",
      "It reaches its maximum effect at 40% HP and below.",
      "In the current model, the multiplier scales from 1x at full HP to 2x at 40% HP or lower.",
    ],
    policyDifferences: [
      "Quick Recovery does not use a separate activation policy.",
    ],
    notes: [
      "Quick Recovery is regen scaling and is not shown as a conditional passive transition.",
    ],
  },
  {
    id: "ability_radiation",
    name: "Radiation",
    status: "Modeled",
    summary: "Applies Corrosion over time.",
    mechanics: [
      "Radiation applies 3 stacks of Corrosion every 3 seconds.",
      "The first Radiation tick happens 3 seconds after the fight starts.",
      "Radiation is treated as always active in the current model.",
    ],
    policyDifferences: [
      "Radiation does not use a separate activation policy.",
      "It is treated as always active.",
    ],
    notes: [
      "The timeline can show repeated Radiation ticks.",
    ],
  },
  createOutOfModelAbilityEntry("Raider"),
  {
    id: "ability_reflect",
    name: "Reflect",
    status: "Modeled",
    summary: "Creates a timed defensive window that prevents direct incoming damage and reflects that prevented damage back to the attacker.",
    mechanics: [
      "Reflect starts immediately at t=0 if actives are enabled.",
      "Reflect lasts for 6 seconds.",
      "It has a 60 second cooldown.",
      "While Reflect is active, direct bite damage is reduced to 0 on the reflector and is instead dealt back to the attacker.",
      "While Reflect is active, direct breath damage is also reduced to 0 on the reflector and is instead dealt back to the attacker.",
      "This applies only to direct damage. Status damage over time is not a Reflect event.",
    ],
    policyDifferences: [
      "Reflect starts immediately at t=0 when the fight begins and actives are enabled.",
      "Really fast and fast both recast Reflect as soon as it becomes available again.",
      "Semi-ideal, ideal, and extreme can use timing search instead of blindly recasting on cooldown.",
      "These precision policies mainly differ by how selective they are about waiting for a better defensive window.",
    ],
    notes: [
      "Bite reflect uses the mirrored melee weight-ratio formula with the melee weight-ratio cap.",
      "Breath reflect uses the mirrored breath weight-ratio formula without the melee cap logic.",
      "Effective weight here includes active weight modifiers and status-based weight modifiers.",
      "Combat log shows Reflect activation.",
      "Combat log also shows reflected damage events as Reflect (bite) or Reflect (breath).",
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
      "It has a 120 second cooldown.",
    ],
    policyDifferences: [
      "In the main stand-and-fight model, Reflux starts as soon as it is available.",
      "It does not currently have separate timing-policy behavior like really fast, fast, ideal, or extreme.",
      "In compare-only hunger mode, Reflux can be blocked by low appetite and can spend appetite on cast start.",
    ],
    notes: [
      "Combat log shows Reflux charge started, Reflux impact, and Reflux puddle tick events.",
      "The model currently assumes the target remains inside the puddle for its full duration.",
      "That puddle assumption is a modeling choice and can be changed later if needed.",
      "With the compare-only hunger rule off, hunger gating is not modeled.",
      "With the compare-only hunger rule on, Reflux spends 25 percentage points of the full appetite meter on cast start and cannot start if current appetite is below that cost.",
    ],
  },
  {
    id: "ability_rewind",
    name: "Rewind",
    status: "Modeled",
    summary: "Restores the user's HP and statuses to an earlier recorded state.",
    mechanics: [
      "Rewind looks for the user's recorded state from 9 seconds earlier.",
      "If no valid 9 second snapshot is available, Rewind does nothing.",
      "When it activates, HP is restored toward that older value.",
      "The heal from Rewind is capped at 25% of the user's max HP.",
      "Statuses are also restored to that earlier state.",
      "This means newer negative statuses can disappear, and older statuses can return if they were present in the saved state.",
      "Rewind has a 100 second cooldown.",
    ],
    policyDifferences: [
      "Really fast uses Rewind only when current HP is 75% or lower.",
      "Fast uses Rewind when it would either restore HP or reduce the current number of statuses.",
      "Semi-ideal, ideal, and extreme compare the current state against the restored state and can delay Rewind until it looks more valuable.",
    ],
    notes: [
      "The timeline can show when Rewind is activated.",
    ],
  },
  {
    id: "ability_rock_breath",
    name: "Rock Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Rock Breath deals damage 2 times per second while it is firing.",
      "Rock Breath has capacity 10.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 1.0 * 1.05 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effects are Injury at 10% chance for 2 stacks and Shredded Wings at 10% chance for 2 stacks.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Rock Breath uses a 10% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.05x instead of random crit rolls.",
      "Its listed secondary effects use pseudo-procs, but they are currently out of model.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  {
    id: "ability_sand_breath",
    name: "Sand Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Sand Breath deals damage 2 times per second while it is firing.",
      "Sand Breath has capacity 10.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.25 * 1.0 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effects are Blurred Vision at 100% chance with no stacking and Tunnel Vision at 50% chance with no stacking.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Sand Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Its listed secondary effects use pseudo-procs from their listed chances, but they are currently out of model.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  {
    id: "ability_self_destruct",
    name: "Self-Destruct",
    status: "Modeled",
    summary: "Arms automatically at low HP, then explodes when the arming fuse runs out.",
    mechanics: [
      "Self-Destruct is armed automatically while the user's HP is at or below 15%.",
      "Arming applies 3 stacks of a self-arming status to the user.",
      "The stacks decay at the standard 1 stack per 3 seconds, giving a 9 second fuse.",
      "The stacks decay regardless of facetank mode, so the fuse always runs.",
      "The explosion fires when the stacks reach zero, whether by natural decay or by cleanse.",
      "The explosion deals 10% of the target's max HP as direct damage.",
      "It also applies 10 stacks of Burn on explosion.",
      "If the user's HP is above 5%, it is capped down to 5% of max HP after the explosion.",
      "If the user's HP is already at or below 5%, it is left alone.",
      "If the user dies while armed, the explosion fires at the moment of death.",
      "Self-Destruct has a 300 second cooldown after each explosion.",
    ],
    policyDifferences: [
      "Self-Destruct does not use a separate activation policy.",
      "It arms automatically once the HP condition is met.",
    ],
    notes: [
      "The timeline shows a 'Self-Destruct armed' event when arming begins.",
      "It shows a 'Self-Destruct' event when the explosion fires.",
    ],
  },
  {
    id: "ability_serrated_teeth",
    name: "Serrated Teeth",
    status: "Modeled",
    summary: "Applies Deep Wounds on hit.",
    mechanics: [
      "Serrated Teeth applies 10 stacks of Deep Wounds when the user lands a direct hit.",
    ],
    policyDifferences: [
      "Serrated Teeth does not use a separate activation policy.",
      "It is applied automatically through direct hits.",
    ],
    notes: [
      "The timeline shows the applied effect as Deep Wounds, not a separate Serrated Teeth event.",
    ],
  },
  {
    id: "ability_shadow_barrage",
    name: "Shadow Barrage",
    status: "Modeled",
    summary: "Repeats the user's most recent melee hit as a single burst of N stacked hits, applied all at once at the moment of activation.",
    mechanics: [
      "Shadow Barrage can only start if the user has landed a melee hit recently.",
      "The current implementation requires the last melee hit to be within the previous 10 seconds.",
      "When it starts, it stores the damage of that last melee hit.",
      "It then computes a number of barrage hits equal to the user's Shadow Barrage value.",
      "The first barrage hit counts as 100% of the stored hit damage.",
      "Each later barrage hit counts as 10% less than the previous barrage hit, so the sequence is 100%, 90%, 80%, 70%, and so on, clamped at zero.",
      "All barrage hits are added together and dealt as a single damage event at the moment of activation, not spread out over time.",
      "On-hit offensive effects are reapplied once for every barrage hit in the burst - for value 3 that is three separate Bleed/Poison/etc. applications combined into one apply event.",
      "It has a 30 second cooldown.",
    ],
    policyDifferences: [
      "Shadow Barrage does not currently have separate timing-policy behavior like really fast, fast, ideal, or extreme.",
      "Once its normal activation conditions are met, it starts automatically and resolves the entire barrage in the same tick.",
    ],
    notes: [
      "The previous model spread the barrage hits across N seconds at 1 Hz; the current model collapses the whole sequence into a single burst at activation time.",
      "Shadow Barrage is based on the damage of the last recent melee hit, not on a newly recalculated bite each time.",
    ],
  },
  createOutOfModelAbilityEntry("Shock Area"),
  createOutOfModelAbilityEntry("Silent Hunter"),
  {
    id: "ability_silly_beam",
    name: "Silly Beam",
    status: "Not planned",
    summary: "Currently not modeled.",
    mechanics: [],
    whyItsNotModeledHere: [
      "Silly Beam has a highly random effect.",
    ],
    policyDifferences: [],
    notes: [
      "Silly Beam is not planned to be added.",
    ],
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
    notes: [
      "Snow Shield is not planned to be added until that implementation detail becomes clearer.",
    ],
  },
  createOutOfModelAbilityEntry("Soft Landing"),
  {
    id: "ability_solar_beam",
    name: "Solar Beam",
    status: "Modeled",
    summary: "Uses high-damage auto-fire breath with a startup delay.",
    mechanics: [
      "Solar Beam deals damage 2 times per second while it is firing.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 1.5 * 1.0 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, Solar Beam's 1.5 per-hit multiplier, its 0% pseudo-crit, and any breath resistance on the target.",
      "Solar Beam has capacity 10 (10 seconds of firing) and, once started, it continues firing until that capacity is emptied.",
      "It has a 3 second startup delay before firing begins.",
      "It has a 120 second cooldown instead of normal breath regeneration.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Solar Beam has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "The timeline can show Solar Beam damage ticks.",
    ],
  },
  createOutOfModelAbilityEntry("Sonic Wings"),
  createOutOfModelAbilityEntry("Speed Blitz"),
  createOutOfModelAbilityEntry("Speed Steal"),
  {
    id: "ability_spirit_glare",
    name: "Spirit Glare",
    status: "Modeled",
    summary: "Uses auto-fire breath damage and also applies Burn and Fear.",
    mechanics: [
      "Spirit Glare deals damage 2 times per second while it is firing.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 1.0 * 1.0 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, Spirit Glare's 1.0 per-hit multiplier, its 0% pseudo-crit, and any breath resistance on the target.",
      "Spirit Glare has capacity 10 (10 seconds of firing) and, once started, it continues firing until that capacity is emptied.",
      "It has no startup delay.",
      "It has a 120 second cooldown instead of normal breath regeneration.",
      "Each damage tick also applies 1 stack of Burn and 1 stack of Fear.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Spirit Glare has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "The timeline can show Spirit Glare damage ticks and its applied effects.",
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
    policyDifferences: [
      "Spite arms automatically as soon as its cooldown elapses instead of being cast manually.",
      "After Spite is armed, the model uses the next bite immediately instead of intentionally delaying that bite to wait for a bigger charge.",
    ],
    notes: [
      "The timeline can show when Spite is armed.",
    ],
  },
  createOutOfModelAbilityEntry("Stamina Puddle"),
  {
    id: "ability_sticky_fur",
    name: "Sticky Fur",
    status: "Modeled",
    summary: "A defensive ability that applies Sticky Teeth when the user is bitten.",
    mechanics: [
      "Sticky Fur is modeled as a defensive ability.",
      "Its effect is applied when the user is hit by a direct attack.",
      "Breath does not trigger Sticky Fur.",
      "Sticky Fur applies 1 stack of Sticky Teeth.",
    ],
    policyDifferences: [
      "Sticky Fur does not use a separate activation policy.",
      "It is applied automatically when its hit condition is met.",
    ],
    notes: [
      "The timeline shows the applied effect as Sticky Teeth, not a separate Sticky Fur event.",
    ],
  },
  createOutOfModelAbilityEntry("Sticky Trap"),
  {
    id: "ability_storm_breath",
    name: "Storm Breath",
    status: "Modeled",
    summary: "Deals very low repeated breath damage with no current modeled side effect.",
    mechanics: [
      "Storm Breath deals damage 2 times per second while it is firing.",
      "Storm Breath has capacity 20.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.001 * 1.0 * (1 - breath resistance).",
      "Its listed secondary effects are Slowed at 35% chance with no stacking and Blurred Vision at 40% chance with no stacking.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Storm Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Its listed secondary effects are currently out of model.",
      "The timeline can show Storm Breath damage ticks.",
    ],
  },
  {
    id: "ability_stubborn_stacker",
    name: "Stubborn Stacker",
    status: "Modeled",
    summary: "Replaces specific plushie effects with creature-specific stat and block bonuses.",
    mechanics: [
      "Stubborn Stacker is a passive ability that changes the effect of specific plushies.",
      "Cat gives +10% health regeneration and +5% Bleed block.",
      "Pig-Lantern gives +5% damage and +5% Burn block.",
      "Haunt Dragon gives +5% Poison block.",
      "Tannenbaum gives -5% bite cooldown and +5% Frostbite block.",
      "These bonuses replace the usual effects of those plushies for creatures with Stubborn Stacker.",
    ],
    policyDifferences: [
      "Stubborn Stacker does not use a separate activation policy.",
    ],
    notes: [
      "The timeline does not show a separate Stubborn Stacker event.",
    ],
  },
  createOutOfModelAbilityEntry("Tail Drop"),
  {
    id: "ability_thorn_trap",
    name: "Thorn Trap",
    status: "Modeled",
    summary: "Applies Bleed and Freeze immediately.",
    mechanics: [
      "Thorn Trap applies 6 stacks of Bleed immediately when it is used.",
      "It also applies 2 stacks of Freeze immediately.",
      "It has a 35 second cooldown.",
    ],
    policyDifferences: [
      "Thorn Trap does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "Thorn Trap is gated by the Traps compare-only toggle, which must be enabled for the user for the ability to activate.",
      "It is modeled because, in the game, its effect is applied immediately when the target steps into the trap and does not require the target to remain inside it over time.",
      "The current model assumes the opponent is caught by the trap as soon as Thorn Trap is activated.",
      "The timeline can show when Thorn Trap is activated.",
    ],
  },
  {
    id: "ability_totem",
    name: "Totem",
    status: "Modeled",
    summary: "Applies Poison over time after it is placed.",
    mechanics: [
      "Totem has a 120 second cooldown.",
      "When it is used, it becomes active for 120 seconds.",
      "While it is active, it applies 2 stacks of Poison every 3 seconds.",
    ],
    policyDifferences: [
      "Totem does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The model does not currently account for destroying the Totem.",
      "The timeline can show Totem activation and repeated Totem ticks.",
    ],
  },
  {
    id: "ability_toxic_trail",
    name: "Toxic Trail",
    status: "Modeled",
    summary: "Passive HP-gated trail that ticks Poison damage to the opponent while the user is below the ability's HP threshold.",
    mechanics: [
      "Toxic Trail is a passive ability gated by the Trails compare-only toggle.",
      "It activates while the user's current HP is at or below the ability's value, expressed as a fraction of max HP.",
      "While active, every 1 second the opponent takes damage equal to 2% of their max HP and receives 2 stacks of Poison.",
      "Only one trail segment is modeled and it is treated as eternal while the HP threshold is met. Segment despawn is not simulated.",
      "While any of the user's trail abilities is active, No Move Facetank is automatically overridden off; the previous setting is restored when the override clears.",
    ],
    policyDifferences: [
      "Toxic Trail is a passive and does not have policy timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
    ],
    notes: [
      "Toxic Trail is a Compare-only modeled effect and is not enabled in the default model. It only runs when the Trails compare-only toggle is enabled for the user.",
      "Damage is computed against the opponent's current max HP, not the user's max HP.",
    ],
  },
  {
    id: "ability_toxic_trap",
    name: "Toxic Trap",
    status: "Modeled",
    summary: "Places a trap that poisons the opponent and has a fixed 25 opponent-bite durability.",
    mechanics: [
      "Toxic Trap is activated on cooldown. When activated, a trap is placed.",
      "While the trap is active, the opponent receives 5 stacks of Poison every 3 seconds.",
      "The first Poison tick occurs 3 seconds after activation.",
      "Each bite by the opponent on the user consumes one of the trap's 25 durability charges. The owner's own bites do not affect the trap.",
      "When all 25 charges are consumed, the trap breaks immediately and Poison ticks stop.",
      "The trap's durability is always exactly 25 opponent bites and is not reduced faster by damage multipliers.",
      "Toxic Trap has a 75 second cooldown, counted from the activation moment.",
    ],
    policyDifferences: [
      "Toxic Trap does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The timeline can show when Toxic Trap is activated.",
      "Toxic Trap is gated by the Traps compare-only toggle, which must be enabled for the user for the ability to activate.",
    ],
  },
  {
    id: "ability_toxin_breath",
    name: "Toxin Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Toxin Breath deals damage 2 times per second while it is firing.",
      "Toxin Breath has capacity 15.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.25 * 1.025 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effect is Poison at 75% chance for 0.75 stacks.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Toxin Breath uses a 5% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.025x instead of random crit rolls.",
      "Its Poison application uses pseudo-procs, so 0.75 stacks at 75% chance becomes 0.5625 expected stacks per tick.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  {
    id: "ability_two_faced",
    name: "Two-Faced",
    status: "Modeled",
    summary: "One side is chosen per build via a page-level toggle and applied as a passive multiplier for the whole fight.",
    mechanics: [
      "Each page (Compare, Best Builds, Optimizer) exposes a Two-Faced mode toggle.",
      "Tranquility multiplies damage by 1.6 and bite cooldown by 1.6 (+60% on each).",
      "Madness multiplies damage by 0.625 and bite cooldown by 0.625 (-37.5% on each).",
      "On Compare, the toggle is per-side so A and B may run different modes.",
      "On Best Builds and Optimizer, the toggle is global and applies to the source plus every opponent that owns Two-Faced.",
    ],
    policyDifferences: [
      "Two-Faced does not use a separate activation policy.",
      "It is treated as a constant passive modifier once a side is selected.",
    ],
    notes: [
      "The chosen side is frozen for the entire fight; the model does not switch sides mid-combat.",
      "Two-Faced does not currently appear as a separate event in the timeline.",
    ],
  },
  {
    id: "ability_unbreakable",
    name: "Unbreakable",
    status: "Modeled",
    summary: "Caps damage from a single source to the listed percent of max HP.",
    mechanics: [
      "Unbreakable uses the user's listed value as a per-source damage cap.",
      "For example, Unbreakable (12) means one hit, tick, reflect, recoil, or ability self-cost cannot remove more than 12% of the user's maximum HP at once.",
    ],
    policyDifferences: [
      "Unbreakable does not use a separate activation policy.",
      "It is always applied automatically.",
    ],
    notes: [
      "The cap is based on maximum HP, not current HP.",
    ],
  },
  {
    id: "ability_unbridled_rage",
    name: "Unbridled Rage",
    status: "Modeled",
    summary: "Gives a temporary damage boost to bites.",
    mechanics: [
      "Unbridled Rage lasts for 30 seconds.",
      "It has a 120 second cooldown.",
      "While Unbridled Rage is active, the user's bite damage is multiplied by 1.3x.",
      "It boosts bite damage only and does not increase breath damage.",
    ],
    policyDifferences: [
      "Really fast activates Unbridled Rage as soon as it is available.",
      "Fast uses a simple efficiency rule before casting. It skips the cast if current HP is below 25%, or if the expected extra damage is too low to justify using it.",
      "Semi-ideal, ideal, and extreme can delay Unbridled Rage to a better damage window instead of always using it immediately.",
    ],
    notes: [
      "The timeline can show when Unbridled Rage is activated.",
    ],
  },
  createOutOfModelAbilityEntry("Vanish"),
  {
    id: "ability_virus_breath",
    name: "Virus Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Virus Breath deals damage 2 times per second while it is firing.",
      "Virus Breath has capacity 20 (20 seconds of firing). Capacity drains at 1 unit per second of firing regardless of damage tick frequency.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.25 * 1.0 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effect is Bleed at 75% chance for 1 stack.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Virus Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.",
      "Its Bleed application uses pseudo-procs, so 1 stack at 75% chance becomes 0.75 expected stacks per tick.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  {
    id: "ability_wardens_rage",
    name: "Warden's Rage",
    status: "Modeled",
    summary: "Applies a damage boost that scales with missing HP. Different policies decide whether to turn it off quickly or keep it active longer.",
    mechanics: [
      "Warden's Rage strength is based on current HP.",
      "At 100% HP it gives no damage bonus.",
      "At 50% HP or lower it reaches full strength.",
      "Between 100% and 50% HP, the damage bonus scales linearly.",
      "The current implementation uses a damage multiplier of 1 + 7.5 * WardenStrength, which means it reaches 8.5x damage at full strength.",
      "While Warden's Rage is active, passive health regeneration is disabled.",
      "The ability has a 30 second cooldown that starts when it is turned on.",
    ],
    policyDifferences: [
      "Really fast turns Warden's Rage on immediately and keeps it active.",
      "Fast uses a simpler non-precision decision path.",
      "Semi-ideal, ideal, and extreme test different timings and compare two main lines: turning Warden's Rage on briefly to lock in the current bonus and resume passive regeneration sooner, or keeping it on longer to reach a stronger bonus before turning it off.",
      "Outside really fast, the first activation can be very short unless the policy decides it is better to keep the ability active.",
    ],
    notes: [
      "If Warden's Rage is turned off, the damage bonus it was giving remains until the next time Warden's Rage is activated again.",
      "Passive regeneration ticks are buffered while Warden's Rage is active. If a regen tick becomes due during that time, the heal is applied immediately after Warden's Rage is turned off.",
      "The timeline can show when Warden's Rage is activated and when it turns off during the fight.",
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
    ],
    policyDifferences: [
      "Warden's Resistance does not use a separate activation policy.",
      "It turns on and off automatically based on the user's current HP.",
    ],
    notes: [
      "Warden's Resistance does not block Warden's Rage stacks.",
      "The timeline and Details UI show Warden's Resistance activation and deactivation when the HP condition changes.",
    ],
  },
  {
    id: "ability_water_breath",
    name: "Water Breath",
    status: "Modeled",
    summary: "Deals repeated breath damage and can apply secondary effects.",
    mechanics: [
      "Water Breath deals damage 2 times per second while it is firing.",
      "Water Breath has capacity 10.",
      "Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * 0.75 * 1.1 * (1 - breath resistance).",
      "That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
      "Its listed secondary effect is Blurred Vision at 60% chance with no stacking.",
    ],
    policyDifferences: [
      "Breaths do not use the standard ability timing policy modes.",
    ],
    notes: [
      "Water Breath uses a 20% pseudo-crit at the global 1.5x breath crit multiplier, so its crit factor is 1.1x instead of random crit rolls.",
      "Its listed secondary effect uses a 60% pseudo-proc chance, but it is currently out of model.",
      "The timeline can show breath damage ticks and any applied modeled secondary effects.",
    ],
  },
  createOutOfModelAbilityEntry("Will To Live"),
  {
    id: "ability_wing_shredder",
    name: "Wing Shredder",
    status: "Modeled",
    summary: "Applies Shredded Wings.",
    mechanics: [
      "Offensive abilities apply their effect when the user lands a bite.",
      "Defensive abilities apply their effect when the user is bitten.",
      "Breath does not trigger Wing Shredder.",
      "Wing Shredder applies Shredded Wings.",
    ],
    policyDifferences: [
      "Wing Shredder does not use a separate activation policy.",
      "It is applied automatically when its hit condition is met.",
    ],
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
      "When the value is Fortify, Yolk Bomb grants the standard Fortify immunity window for its duration instead of applying a status.",
      "It has a 30 second cooldown.",
    ],
    policyDifferences: [
      "Yolk Bomb does not currently have meaningful timing differences between really fast, fast, semi-ideal, ideal, and extreme.",
      "Once it is available, it is activated immediately.",
    ],
    notes: [
      "The timeline can show when Yolk Bomb is activated.",
    ],
  },
];

/**
 * Ability names the author has explicitly classified as out of the
 * stand-and-fight combat model (the `createOutOfModelAbilityEntry` rows, i.e.
 * `status === "Out of model"`). This is the authoritative source of truth for
 * the out-of-model coverage label: an ability listed here is surfaced as
 * out-of-model regardless of any unimplemented catalog `def`. It deliberately
 * EXCLUDES Compare-only abilities - those live in COMPARE_ONLY_REFERENCE_DRAFTS
 * and count as modeled.
 */
export const REFERENCE_OUT_OF_MODEL_ABILITY_NAMES: string[] =
  MODELED_ABILITY_REFERENCE_DRAFTS.filter((entry) => entry.status === "Out of model").map(
    (entry) => entry.name,
  );

export const STATUS_REFERENCE_DRAFTS: StatusReferenceEntry[] = [
  {
    id: "status_bad_omen",
    name: "Bad Omen",
    status: "Modeled",
    summary: "Reduces passive health regeneration and applies one random follow-up status when it ends.",
    mechanics: [
      "Bad Omen reduces passive health regeneration by 25% while it is active.",
      "When Bad Omen ends, it applies one follow-up status.",
      "That follow-up status can be one of the following: 5 Frostbite, 8 Burn, 10 Bleed, 5 Corrosion, 3 Confusion, 3 Shredded Wings, 20 Disease, 10 Injury, 10 Necropoison, or 10 Poison.",
    ],
    notes: [
      "Bad Omen is usually applied by Cursed Sigil.",
      "In Compare, the follow-up status is chosen randomly by default.",
      "In Debug Mode, one specific follow-up status can be selected manually.",
      "In Best Builds and Optimizer, the follow-up status is fixed to Burn +8 for the whole calculation cycle.",
      "The timeline can show when Bad Omen is applied, but not its follow-up outcome as a separate event.",
    ],
  },
  {
    id: "status_bleed",
    name: "Bleed",
    status: "Modeled",
    summary: "Deals flat damage over time and stops natural health regeneration.",
    mechanics: [
      "Bleed deals 2 damage per stack per second while it is active.",
      "Bleed blocks natural health regeneration completely.",
      "Bleed stacks increase the damage directly.",
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
    notes: [
      "The timeline can show Blessing's Boon heal ticks.",
    ],
  },
  {
    id: "status_blurred_vision",
    name: "Blurred Vision",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement and visual-side effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_broken_bones",
    name: "Broken Bones",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement and visual-side effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_burn",
    name: "Burn",
    status: "Modeled",
    summary: "Deals percent max HP damage over time and weakens natural health regeneration.",
    mechanics: [
      "Burn deals damage every 3 seconds.",
      "Its damage is 0.025% max HP base plus 0.1% per remaining stack at the moment of the tick.",
      "Each tick first applies natural decay (one stack expires) and then deals damage using the post-decay stack count. If decay just removed the last stack, the tick still fires once with the base contribution because the effect existed at the start of the tick.",
      "On a stationary target a single Burn stack decays to zero before damage is calculated, so the lone tick deals only the base 0.025% max HP. On a moving target (No Move Facetank disabled) decay is suppressed for that tick, so the same single stack deals 0.025% + 0.1% = 0.125% max HP - five times the stationary value at one stack. The gap shrinks as stacks grow (about 1.1x at ten stacks).",
      "Each Burn stack also reduces natural health regeneration by 10%.",
      "At 10 Burn, natural health regeneration is fully blocked.",
    ],
    notes: [
      "The timeline can show Burn damage ticks.",
      "Empirical observation matches the formula: 1 stack, 1 tick, stationary ≈ 0.025% max HP; moving ≈ 0.125% max HP.",
      "The decay-before-damage tick order is shared by all persistent PvP ailments (Poison, Bleed, Corrosion, Necropoison, Frostbite) but only Burn has been re-derived from empirical PvP data so far. The other ailments still use their wiki-sourced base values.",
    ],
  },
  {
    id: "status_confusion",
    name: "Confusion",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement and visual-side effects do not currently affect the PvP model.",
    ],
  },
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
      "When Corrosion is applied through an offensive direct attack payload, its applied stacks scale upward by max(1, (1 + min(attackerWeight / defenderWeight, 3)) / 2).",
      "That means equal weight gives 1.0x stacks, a 2:1 weight advantage gives 1.5x stacks, and any 3:1 or larger advantage gives 2.0x stacks.",
      "If the attacker is lighter than the target, the applied stacks stay at 1.0x instead of scaling downward.",
    ],
    notes: [
      "1 Corrosion stack gives 8.5% weight reduction, because the effect starts at 7.5% and then adds 1% per stack.",
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
      "Because of that, existing Bleed stacks stay in place until Deep Wounds runs out.",
    ],
    notes: [
      "Deep Wounds is usually applied by Serrated Teeth.",
      "The timeline can show when Deep Wounds is applied.",
    ],
  },
  {
    id: "status_disease",
    name: "Disease",
    status: "Modeled",
    summary: "Weakens natural regeneration.",
    mechanics: [
      "Disease reduces natural health regeneration by 15%.",
      "Its strength does not scale with stacks in the current PvP model.",
      "When Disease is applied through an offensive direct attack payload, its applied stacks scale upward by max(1, (1 + min(attackerWeight / defenderWeight, 3)) / 2).",
      "That means equal weight gives 1.0x stacks, a 2:1 weight advantage gives 1.5x stacks, and any 3:1 or larger advantage gives 2.0x stacks.",
      "If the attacker is lighter than the target, the applied stacks stay at 1.0x instead of scaling downward.",
    ],
    notes: [
      "Disease is usually applied by Aura and some other abilities.",
    ],
  },
  {
    id: "status_drowsy",
    name: "Drowsy",
    status: "Modeled",
    summary: "Increases time between bites.",
    mechanics: [
      "Drowsy increases bite cooldown by 35% while it is active.",
      "The strength of the effect does not stack.",
      "Adding more Drowsy stacks does not make the effect stronger or weaker.",
      "The number of stacks only affects how long Drowsy lasts.",
    ],
    notes: [
      "Drowsy is usually applied by Drowsy Area.",
      "The timeline can show when Drowsy is applied.",
    ],
  },
  {
    id: "status_fear",
    name: "Fear",
    status: "Modeled",
    summary: "Reduces outgoing damage.",
    mechanics: [
      "Fear reduces outgoing damage by 45% while it is active.",
      "The strength of the effect does not stack.",
      "Adding more Fear stacks does not make the effect stronger or weaker.",
      "The number of stacks only affects how long Fear lasts.",
    ],
    notes: [
      "Fear is applied by Cause Fear and by some other abilities such as Spirit Glare.",
      "The timeline can show when Fear is applied.",
    ],
  },
  {
    id: "status_flowering",
    name: "Flowering",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement and visual-side effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_freeze",
    name: "Freeze",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_frostbite",
    name: "Frostbite",
    status: "Modeled",
    summary: "Increases time between bites.",
    mechanics: [
      "Frostbite increases bite cooldown by 2% per stack while it is active.",
      "Its strength scales directly with stacks.",
    ],
    notes: [
      "The timeline can show when Frostbite is applied.",
    ],
  },
  {
    id: "status_gale",
    name: "Gale",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement and visual-side effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_healing_ailment",
    name: "Healing Ailment",
    status: "Modeled",
    summary: "Scheduled flat +7% max HP heals every 15 seconds while active; bypasses bleed/burn regen disable.",
    mechanics: [
      "Healing Ailment fires a discrete heal every 15 seconds while the status is active.",
      "Each heal restores a flat 7% of the target's max HP, added on top of normal regen after all other multipliers.",
      "The heal still applies even if natural regeneration is disabled by Bleed or Burn.",
      "Stacks act as duration: 10 stacks corresponds to ~30 seconds of coverage (2 heal ticks). More stacks extend the window proportionally.",
      "Sitting/Lying multipliers are not modeled here.",
    ],
    notes: [
      "Applied by Healing Pulse in Compare (Compare-only ability).",
      "The timeline records each Healing Ailment heal tick.",
    ],
  },
  {
    id: "status_heartbroken",
    name: "Heartbroken",
    status: "Modeled",
    summary: "Blocks most healing.",
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
    summary: "Weather-style damage over time that also inflicts Burn; ignored by Volcanic creatures.",
    mechanics: [
      "Heat Wave deals 1% max HP damage every 3 seconds, regardless of stack count.",
      "Each Heat Wave tick also applies 2 stacks of Burn to the same target.",
      "Stacks act as duration: each stack corresponds to 3 seconds of ticking time.",
      "Creatures with the Volcanic ability are immune - Heat Wave is not applied to them.",
    ],
    notes: [
      "Heat Wave is the offensive counterpart to Hypothermia and shares the same weather-status shape.",
      "The 2 Burn applied on tick obeys the usual Burn rules, including its own damage ticks and HP regen debuff.",
      "The timeline can show Heat Wave damage ticks and the resulting Burn ticks.",
    ],
  },
  {
    id: "status_hypothermia",
    name: "Hypothermia",
    status: "Modeled",
    summary: "Weather-style damage over time; ignored by Frosty creatures.",
    mechanics: [
      "Hypothermia deals 0.75% max HP damage every 3 seconds, regardless of stack count.",
      "Stacks act as duration: each stack corresponds to 3 seconds of ticking time.",
      "Creatures with the Frosty ability are immune - Hypothermia is not applied to them.",
    ],
    notes: [
      "Hypothermia was introduced alongside Yolk Bomb and as a building block for the future weather system.",
      "As a weather effect (Blizzard) it is a single permanent stack; ability-applied stacks follow the standard stack-as-duration model.",
      "Laying down nullifies the Hypothermia damage tick (any source) while the creature stays settled in the Laying posture; the status itself persists.",
      "The timeline can show Hypothermia damage ticks.",
    ],
  },
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
    ],
    notes: [
      "Acid Rain is the weather counterpart of Heat Wave and Hypothermia and shares the same weather-status shape.",
      "As a weather effect it is a single permanent stack for the whole fight; the 2 Poison applied on tick obey the usual Poison rules.",
      "The timeline can show Acid Rain damage ticks and the resulting Poison ticks.",
    ],
  },
  {
    id: "status_injury",
    name: "Injury",
    status: "Partial",
    summary: "Applies Injury stacks.",
    mechanics: [
      "The site currently records Injury as present.",
      "Its movement-side effect is not currently converted into a meaningful stand-and-fight combat penalty.",
      "When Injury is applied through an offensive direct attack payload, its applied stacks scale upward by max(1, (1 + min(attackerWeight / defenderWeight, 3)) / 2).",
      "That means equal weight gives 1.0x stacks, a 2:1 weight advantage gives 1.5x stacks, and any 3:1 or larger advantage gives 2.0x stacks.",
      "If the attacker is lighter than the target, the applied stacks stay at 1.0x instead of scaling downward.",
    ],
    notes: [
      "Movement effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_malices_mark",
    name: "Malice's Mark",
    status: "Modeled",
    summary: "Reduces outgoing damage.",
    mechanics: [
      "Malice's Mark reduces outgoing damage by 15% while it is active.",
    ],
    notes: [
      "The timeline can show when Malice's Mark is applied.",
    ],
  },
  {
    id: "status_necropoison",
    name: "Necropoison",
    status: "Modeled",
    summary: "Blocks most active abilities at high stacks.",
    mechanics: [
      "Necropoison blocks new active ability activations at 10 stacks and above.",
      "It does not disable abilities that were already active before that point.",
      "Warden's Rage is not blocked by Necropoison.",
    ],
    notes: [
      "The timeline can show when Necropoison is applied.",
    ],
  },
  {
    id: "status_poison",
    name: "Poison",
    status: "Modeled",
    summary: "Deals percent max HP damage over time.",
    mechanics: [
      "Poison deals damage every 3 seconds.",
      "Its damage starts at 0.2% max HP and increases by 0.05% per stack.",
    ],
    notes: [
      "The timeline can show Poison damage ticks.",
    ],
  },
  {
    id: "status_shock",
    name: "Shock",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement and visual-side effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_shredded_wings",
    name: "Shredded Wings",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [],
  },
  {
    id: "status_slowed",
    name: "Slowed",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement and visual-side effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_sticky_teeth",
    name: "Sticky Teeth",
    status: "Modeled",
    summary: "Increases time between bites.",
    mechanics: [
      "Sticky Teeth increases bite cooldown by 65% while it is active.",
      "The strength of the effect does not stack.",
      "Adding more Sticky Teeth stacks does not make the effect stronger or weaker.",
      "The number of stacks only affects how long Sticky Teeth lasts.",
    ],
    notes: [
      "Sticky Teeth is usually applied by Sticky Fur.",
      "The timeline can show when Sticky Teeth is applied.",
    ],
  },
  {
    id: "status_stolen_speed",
    name: "Stolen Speed",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement and visual-side effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_torn_ligaments",
    name: "Torn Ligaments",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_water_regeneration",
    name: "Water Regeneration",
    status: "Partial",
    summary: "Currently out of model.",
    mechanics: [
      "The site currently only records that this effect is present.",
      "It does not currently produce a separate combat effect in the stand-and-fight model.",
    ],
    notes: [
      "Movement and visual-side effects do not currently affect the PvP model.",
    ],
  },
  {
    id: "status_clean_water",
    name: "Clean Water",
    status: "Modeled",
    summary: "Boosts health regeneration multiplicatively for a fixed duration.",
    mechanics: [
      "Clean Water increases health regeneration by 20% multiplicatively while active.",
      "Default duration is 180 seconds (60 standard stacks at 3 seconds per stack).",
      "Re-applying refreshes the duration; the effect does not stack.",
    ],
    notes: [
      "In Compare, this status is the canonical home of the Clean water buff toggle (replaces the previous durationless approximation).",
    ],
  },
  {
    id: "status_muddy",
    name: "Muddy",
    status: "Modeled",
    summary: "Boosts health regeneration and doubles Bleed/Poison healing rate while active.",
    mechanics: [
      "Muddy increases health regeneration by 25% multiplicatively while active.",
      "Muddy doubles the healing rate of Bleed and Poison status effects (Mud Pile interaction).",
      "Default duration is 90 seconds. Unlike most statuses, Muddy decays at 1 second per stack (not the standard 3 seconds), so 90 stacks decay over 90 seconds.",
      "Re-applying refreshes the duration; the effect does not stack.",
    ],
    notes: [
      "Mud Pile rule applies Muddy with a multiplier on duration when a Land plushie is equipped (90 s base, 180 s with one Land plushie).",
    ],
  },
  {
    id: "status_refreshed",
    name: "Refreshed",
    status: "Modeled",
    summary: "Boosts health regeneration multiplicatively for a fixed duration (lighter version of Clean Water).",
    mechanics: [
      "Refreshed increases health regeneration by 5% multiplicatively while active.",
      "Default duration is 180 seconds (60 standard stacks at 3 seconds per stack).",
      "Re-applying refreshes the duration; the effect does not stack.",
    ],
    notes: [
      "In Compare, this status is the canonical home of the Refreshed buff toggle (replaces the previous durationless approximation).",
    ],
  },
  {
    id: "status_aftershock",
    name: "Aftershock",
    status: "Partial",
    summary: "Tracked engine status without an explicit Reference-level combat formula yet.",
    mechanics: [
      "The engine recognises this status by id for cleanse / cross-status interactions but does not yet model its combat effect at the Reference level.",
    ],
    notes: [
      "Polarity is negative - Fortify cleanses it.",
    ],
  },
  {
    id: "status_ashy_lungs",
    name: "Ashy Lungs",
    status: "Partial",
    summary: "Tracked engine status without an explicit Reference-level combat formula yet.",
    mechanics: [
      "The engine recognises this status by id for cleanse / cross-status interactions but does not yet model its combat effect at the Reference level.",
    ],
    notes: [
      "Polarity is negative - Fortify cleanses it.",
    ],
  },
  {
    id: "status_broken_legs",
    name: "Broken Legs",
    status: "Partial",
    summary: "Tracked engine status without an explicit Reference-level combat formula yet.",
    mechanics: [
      "The engine recognises this status by id for cleanse / cross-status interactions but does not yet model its combat effect at the Reference level.",
      "Distinct from Broken Bones (status_broken_bones) - the engine has separate ids.",
    ],
    notes: [
      "Polarity is negative - Fortify cleanses it.",
    ],
  },
  {
    id: "status_paralyze",
    name: "Paralyze",
    status: "Partial",
    summary: "Tracked engine status without an explicit Reference-level combat formula yet.",
    mechanics: [
      "The engine recognises this status by id for cleanse / cross-status interactions but does not yet model its combat effect at the Reference level.",
    ],
    notes: [
      "Polarity is negative - Fortify cleanses it.",
    ],
  },
  {
    id: "status_radiation",
    name: "Radiation",
    status: "Partial",
    summary: "Legacy alias retained after Aura subtype-driven generalisation retired the dedicated Radiation path.",
    mechanics: [
      "The engine still recognises Radiation_Status by id so Fortify and other cleanse paths work, but the Aura subtype mechanic supersedes the dedicated Radiation effect.",
    ],
    notes: [
      "Aura was generalized to a subtype-driven mechanic, retiring the Radiation alias.",
      "Polarity is negative - Fortify cleanses it.",
    ],
  },
  {
    id: "status_aggressive",
    name: "Aggressive",
    status: "Modeled",
    summary: "Multiplicatively increases outgoing damage by 25% for 10 seconds.",
    mechanics: [
      "Aggressive increases outgoing melee damage by 25% multiplicatively while active.",
      "Default duration is 10 seconds. In-game the emote applies ten one-second stacks; with a flat +25% bonus that nets to a single 10-second window, which is how the engine models it (one non-stacking instance, defaultDurationSec=10).",
    ],
    notes: [
      "Polarity is positive - Fortify does not cleanse it.",
      "In Compare, the Aggressive buff toggle applies this status with the standard 10-second duration.",
      "The Bear plushie replaces this status with Aggressive (Bear), which strengthens the boost to +37.5% (see plushie_bear and status_aggressive_bear).",
    ],
  },
  {
    id: "status_aggressive_bear",
    name: "Aggressive (Bear)",
    status: "Modeled",
    summary: "Bear-plushie variant of Aggressive: +37.5% outgoing damage for 10 seconds.",
    mechanics: [
      "Aggressive (Bear) increases outgoing melee damage by 37.5% multiplicatively for 10 seconds.",
      "The Bear plushie scales the standard Aggressive damage modifier by ×1.1 (sign-preserving) and adds a flat +10 percentage points: 25% × 1.1 + 10 = +37.5%.",
    ],
    notes: [
      "Polarity is positive - Fortify does not cleanse it.",
      "See plushie_bear for the full Bear modifier formula.",
    ],
  },
  {
    id: "status_scared",
    name: "Scared",
    status: "Modeled",
    summary: "Multiplicatively reduces outgoing damage by 50% for 10 seconds.",
    mechanics: [
      "Scared reduces outgoing melee damage by 50% multiplicatively while active.",
      "Default duration is 10 seconds.",
    ],
    notes: [
      "In Compare, the Scared Status buff toggle applies this status with the standard 10-second duration.",
      "The Bear plushie replaces this status with Scared (Bear) which softens the penalty to -45% (see plushie_bear and status_scared_bear).",
    ],
  },
  {
    id: "status_scared_bear",
    name: "Scared (Bear)",
    status: "Modeled",
    summary: "Bear-plushie variant of Scared: -45% outgoing damage for 10 seconds.",
    mechanics: [
      "Scared (Bear) reduces outgoing melee damage by 45% multiplicatively for 10 seconds.",
      "The Bear plushie scales the standard Scared damage modifier by ×1.1 (sign-preserving) and adds a flat +10 percentage points: −50% × 1.1 + 10 = −45%, softer than plain Scared's −50% (see plushie_bear). Engine: combat.rs Scared_Bear_Status => -45.0.",
    ],
    notes: [
      "Polarity is negative - Fortify cleanses it.",
      "See plushie_bear for the full Bear modifier formula.",
    ],
  },
  {
    id: "status_sickly",
    name: "Sickly",
    status: "Modeled",
    summary: "Reduces passive health regeneration by 20% multiplicatively while active.",
    mechanics: [
      "Sickly reduces passive health regen by 20% multiplicatively.",
      "The effect applies as a flat percentage and does not scale with stacks.",
    ],
    notes: [
      "Polarity is negative - Fortify cleanses it.",
    ],
  },
  {
    id: "status_sticky_trap",
    name: "Sticky Trap",
    status: "Partial",
    summary: "Tracked engine status without an explicit Reference-level combat formula yet.",
    mechanics: [
      "The engine recognises this status by id for cleanse / cross-status interactions but does not yet model its combat effect at the Reference level.",
    ],
    notes: [
      "Polarity is negative - Fortify cleanses it.",
    ],
  },
];

export const PLUSHIE_REFERENCE_DRAFTS: PlushieReferenceEntry[] = [
  {
    id: "plushie_aerix",
    name: "Aerix",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_aerodon",
    name: "Aerodon",
    status: "Modeled",
    summary: "Decreases appetite drain by 15%.",
    mechanics: [
      "Aerodon slows appetite drain by 15% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_arcane",
    name: "Arcane",
    status: "Modeled",
    summary: "Increases breath damage by 12.5%.",
    mechanics: [
      "Arcane increases breath damage by 12.5% multiplicatively.",
      "Only applies to creatures that have breath.",
      "Unique - equipping two Arcane is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_astral_quetzal",
    name: "Astral Quetzal",
    status: "Modeled",
    summary: "Gives +50% breath resistance and +50% Bleed block, at the cost of −5% movement speed and −25% health regeneration.",
    mechanics: [
      "Astral Quetzal increases breath resistance by 50 percentage points.",
      "Astral Quetzal gives +50% Bleed block.",
      "Astral Quetzal reduces all movement speeds by 5% multiplicatively.",
      "Astral Quetzal reduces health regeneration by 25% multiplicatively.",
      "Unique - equipping two Astral Quetzal is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_baby_dragon",
    name: "Baby Dragon",
    status: "Modeled",
    summary: "Increases breath capacity recharge rate by 20%.",
    mechanics: [
      "Baby Dragon increases breath capacity recharge rate by 20% multiplicatively.",
      "Does not affect Solar Beam and Spirit Glare, which use a fixed cooldown.",
      "Unique - equipping two Baby Dragon is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_bear",
    name: "Bear",
    status: "Modeled",
    summary: "Boosts Aggressive and Scared emote effects with a ×1.1 multiplier plus a flat +10 percentage points.",
    mechanics: [
      "Bear scales the Aggressive and Scared emote damage modifiers by ×1.1 (sign-preserving) and then adds a flat +10 percentage points.",
      "Aggressive: 25% × 1.1 + 10 = +37.5% outgoing damage.",
      "Scared: −50% × 1.1 + 10 = −45% outgoing damage (less penalty than the −50% baseline).",
      "Only applies when the matching emote buff is toggled on in Compare.",
      "Stackable, but the effect does not stack - a second Bear does not increase the boost.",
    ],
    notes: [],
  },
  {
    id: "plushie_blessed_bean",
    name: "Blessed Bean",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_bunny",
    name: "Bunny",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_cat",
    name: "Cat",
    status: "Modeled",
    summary: "Applies 1 Bleed to the opponent on each of the owner's bites, at the cost of −2.5% melee damage.",
    mechanics: [
      "Cat applies 1 stack of Bleed to the opponent on each landed bite.",
      "Cat reduces the owner's melee damage by 2.5% multiplicatively.",
      "With Stubborn Stacker the effect changes: Cat instead gives +10% health regeneration and +5% Bleed block. See Stubborn Stacker.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_catalyst",
    name: "Catalyst",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_cavity_critter",
    name: "Cavity Critter",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_chick",
    name: "Chick",
    status: "Modeled",
    summary: "Increases all movement speeds by 5% multiplicatively and reduces weight by 7.5% multiplicatively.",
    mechanics: [
      "Chick increases walk, swim, and sprint speed by 5% multiplicatively.",
      "Chick reduces weight by 7.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_clover_blossom",
    name: "Clover Blossom",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_clownfish",
    name: "Clownfish",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_coal",
    name: "Coal",
    status: "Modeled",
    summary: "Increases the owner's weight by 3.5%.",
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
    summary: "Reduces melee damage by 5% and increases weight by 20%, both multiplicatively.",
    mechanics: [
      "Cow reduces melee damage by 5% multiplicatively.",
      "Cow increases weight by 20% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_creator_star",
    name: "Creator Star",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_darkstar",
    name: "Darkstar",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_dolt",
    name: "Dolt",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_eclipse",
    name: "Eclipse",
    status: "Modeled",
    summary: "Grants +5% damage, +25% stamina regeneration, and +15% health regeneration only at night.",
    mechanics: [
      "Eclipse increases melee damage by 5% multiplicatively only at night.",
      "Eclipse increases stamina regeneration by 25% multiplicatively only at night.",
      "Eclipse increases health regeneration by 15% multiplicatively only at night.",
      "The buff is silent in-game (the night-only effect is not described in the plushie's tooltip).",
      "Not stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_egg_gobbler",
    name: "Egg Gobbler",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_egg_shell",
    name: "Egg Shell",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_eggy_snake",
    name: "Eggy Snake",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_elemental",
    name: "Elemental",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_ember_spirit",
    name: "Ember Spirit",
    status: "Modeled",
    summary: "Applies 0.5 Burn to the opponent on each hit taken, at the cost of −7.5% Frostbite block.",
    mechanics: [
      "Ember Spirit applies 0.5 stacks of Burn to the opponent on each bite they land on the owner.",
      "Ember Spirit reduces the owner's Frostbite block by 7.5%.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_euvatops",
    name: "Euvatops",
    status: "Modeled",
    summary: "Decreases appetite drain by 15%.",
    mechanics: [
      "Euvatops slows appetite drain by 15% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_fox",
    name: "Fox",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_frost_dragon",
    name: "Frost Dragon",
    status: "Modeled",
    summary: "Gives +25% Frostbite block.",
    mechanics: [
      "Frost Dragon reduces incoming Frostbite damage by 25%.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_ghost",
    name: "Ghost",
    status: "Modeled",
    summary: "Gives +7.5% Bleed block.",
    mechanics: [
      "Ghost reduces incoming Bleed damage by 7.5%.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_ginger_snapper",
    name: "Ginger Snapper",
    status: "Modeled",
    summary: "Applies 0.5 Frostbite to the opponent on each hit taken, at the cost of −5% Burn block.",
    mechanics: [
      "Ginger Snapper applies 0.5 stacks of Frostbite to the opponent on each bite they land on the owner.",
      "Ginger Snapper reduces the owner's Burn block by 5%.",
      "Unique - equipping two Ginger Snapper is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_golden_bulb",
    name: "Golden Bulb",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_goldfish",
    name: "Goldfish",
    status: "Modeled",
    summary: "Grants Iron Stomach and increases appetite drain by 20%.",
    mechanics: [
      "Goldfish increases appetite drain by 20% multiplicatively.",
      "Iron Stomach is granted but not modeled in combat.",
      "Unique - equipping two Goldfish is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_haunt_dragon",
    name: "Haunt Dragon",
    status: "Modeled",
    summary: "Applies 0.5 Poison to the opponent on each hit taken.",
    mechanics: [
      "Haunt Dragon applies 0.5 stacks of Poison to the opponent on each bite they land on the owner.",
      "With Stubborn Stacker the effect changes: Haunt Dragon instead gives +25% stamina regeneration and +5% Poison block. See Stubborn Stacker.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_heart",
    name: "Heart",
    status: "Modeled",
    summary: "Increases health regeneration by 30% multiplicatively and reduces weight by 5% multiplicatively.",
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
    summary: "Applies 0.75 Poison to the opponent on each hit taken.",
    mechanics: [
      "Heartsnake applies 0.75 stacks of Poison to the opponent on each bite they land on the owner.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_horned_beetlefly",
    name: "Horned Beetlefly",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_hum",
    name: "Hum",
    status: "Modeled",
    summary: "Increases the owner's weight by 2.5%.",
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
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_ice_wolf",
    name: "Ice Wolf",
    status: "Modeled",
    summary: "Increases the owner's melee damage by 5%.",
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
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_jackrabbit",
    name: "Jackrabbit",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_jammy_slug",
    name: "Jammy Slug",
    status: "Modeled",
    summary: "Applies 0.5 Necropoison to the opponent on each hit taken, at the cost of −5% melee damage.",
    mechanics: [
      "Jammy Slug applies 0.5 stacks of Necropoison to the opponent on each bite they land on the owner.",
      "Jammy Slug reduces the owner's melee damage by 5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_jotun_scale",
    name: "Jotun Scale",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_knight",
    name: "Knight",
    status: "Modeled",
    summary: "Reduces own damage by 5% and reflects 5% of incoming melee damage back on average.",
    mechanics: [
      "Knight reduces the owner's melee damage by 5% multiplicatively.",
      "Knight reflects bite and breath hits back to the attacker, modeled as a deterministic average: 5% of each direct hit (25% chance × 20% damage).",
      "Reflected damage does not count toward the owner's damage output.",
      "Does not apply to DoT effects such as Bleed, Burn, and Poison.",
      "Does not apply while the owner is hunkering.",
      "Unique - equipping two Knight is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_knox",
    name: "Knox",
    status: "Modeled",
    summary: "Increases all movement speeds by 5%.",
    mechanics: [
      "Knox increases walk, swim, and sprint speed by 5% multiplicatively.",
      "Unique - equipping two Knox is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_land",
    name: "Land",
    status: "Modeled",
    summary: "Increases Muddy Status duration by 100% per stack.",
    mechanics: [
      "Land increases Muddy Status duration by 100% multiplicatively per stack.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_lunar_qilin",
    name: "Lunar Qilin",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_magic_frog",
    name: "Magic Frog",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_magichorn_prongbug",
    name: "Magichorn Prongbug",
    status: "Modeled",
    summary: "Increases the owner's health regeneration by 10%.",
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
    summary: "Gives +22.5% Injury block.",
    mechanics: [
      "Maple Leaflet reduces incoming Injury damage by 22.5%.",
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
      "Minty Wiggler grants Frosty, enabled via Compare toggle.",
      "Unique - equipping two Minty Wiggler is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_mo",
    name: "Mo",
    status: "Modeled",
    summary: "Increases the owner's melee damage by 2.5%.",
    mechanics: [
      "Mo increases melee damage by 2.5% multiplicatively.",
      "Unique - equipping two Mo is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_mylo",
    name: "Mylo",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_notes",
    name: "Notes",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_oceanwing",
    name: "Oceanwing",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_octroma",
    name: "Octroma",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_owl",
    name: "Owl",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_palmtree",
    name: "Palmtree",
    status: "Modeled",
    summary: "Increases appetite capacity by 10%.",
    mechanics: [
      "Palmtree increases appetite capacity by 10% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_partridge",
    name: "Partridge",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_pie_chomper",
    name: "Pie Chomper",
    status: "Modeled",
    summary: "Grants the Serrated Teeth ability.",
    mechanics: [
      "Pie Chomper grants the owner the Serrated Teeth ability.",
      "Serrated Teeth applies 10 stacks of Deep Wounds to the opponent on each landed bite. See Serrated Teeth.",
      "Unique - equipping two Pie Chomper is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_pig_lantern",
    name: "Pig-Lantern",
    status: "Modeled",
    summary: "Applies 0.5 Burn to the opponent on each of the owner's bites, at the cost of −2.5% melee damage.",
    mechanics: [
      "Pig-Lantern applies 0.5 stacks of Burn to the opponent on each landed bite.",
      "Pig-Lantern reduces the owner's melee damage by 2.5% multiplicatively.",
      "With Stubborn Stacker the effect changes: Pig-Lantern instead gives +5% melee damage and +5% Burn block. See Stubborn Stacker.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_reindeer",
    name: "Reindeer",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_rock",
    name: "Rock",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
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
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_sea",
    name: "Sea",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_seal",
    name: "Seal",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_serpent",
    name: "Serpent",
    status: "Modeled",
    summary: "Reduces the owner's melee damage by 10%.",
    mechanics: [
      "Serpent reduces melee damage by 10% multiplicatively.",
      "Unique - equipping two Serpent is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_sky",
    name: "Sky",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_smore_cat",
    name: "Smore Cat",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_snowflake_sneak",
    name: "Snowflake Sneak",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_snowman",
    name: "Snowman",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_sparkler",
    name: "Sparkler",
    status: "Modeled",
    summary: "Gives +15% Poison block, +15% Frostbite block, +15% Burn block, and −20% Bleed block.",
    mechanics: [
      "Sparkler reduces incoming Poison damage by 15%.",
      "Sparkler reduces incoming Frostbite damage by 15%.",
      "Sparkler reduces incoming Burn damage by 15%.",
      "Sparkler reduces Bleed block by 20%.",
      "Unique - equipping two Sparkler is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_springbok",
    name: "Springbok",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_springram",
    name: "Springram",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_stick",
    name: "Stick",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_stitch_head",
    name: "Stitch Head",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_succulant",
    name: "Succulant",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_swan",
    name: "Swan",
    status: "Out of model",
    summary: "Not modeled.",
    mechanics: ["Not modeled."],
    notes: [],
  },
  {
    id: "plushie_tannenbaum",
    name: "Tannenbaum",
    status: "Modeled",
    summary: "Applies 0.5 Frostbite to the opponent on each of the owner's bites and increases bite cooldown by 5%.",
    mechanics: [
      "Tannenbaum applies 0.5 stacks of Frostbite to the opponent on each landed bite.",
      "Tannenbaum increases the owner's bite cooldown by 5% multiplicatively, making bites slower.",
      "With Stubborn Stacker the effect changes: Tannenbaum instead gives −5% bite cooldown and +5% Frostbite block. See Stubborn Stacker.",
      "Unique - equipping two Tannenbaum is not allowed.",
    ],
    notes: [],
  },
  {
    id: "plushie_vampire_bat",
    name: "Vampire Bat",
    status: "Modeled",
    summary: "Applies 1 Bleed to the opponent on each hit taken, gives +2.5% Bleed block, at the cost of −2.5% melee damage.",
    mechanics: [
      "Vampire Bat applies 1 stack of Bleed to the opponent on each bite they land on the owner.",
      "Vampire Bat gives +2.5% Bleed block to the owner.",
      "Vampire Bat reduces the owner's melee damage by 2.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
  {
    id: "plushie_void",
    name: "Void",
    status: "Modeled",
    summary: "Increases the owner's melee damage by 7.5%.",
    mechanics: [
      "Void increases melee damage by 7.5% multiplicatively.",
      "Stackable.",
    ],
    notes: [],
  },
];
