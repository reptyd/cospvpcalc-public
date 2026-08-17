// Ability configuration for the composable engine.
//
// Extracted from composable/mod.rs (light split, behavior-preserving).

use serde::{Deserialize, Serialize};

use crate::contracts::{AbilityPolicyOverrides, SimpleBadOmenOutcome};

/// Which activated abilities each side has.
/// Start empty (base breath engine) and add abilities incrementally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CombatEventPhase {
    Passives,
    StatusTicks,
    StatusDecay,
    Regen,
    Bite,
    Breath,
    ActiveAbilities,
}

/// Per-side bite-variant policy mode. Drives whether each bite event
/// uses the primary attack (`stats.damage` + on-hit ailments) or the
/// secondary attack (`stats.damage2`, no on-hit ailments).
///
/// - `PrimaryOnly` - every bite uses primary. Mirrors the historical
///   default for any creature with a secondary attack (the chip
///   unchecked). Zero behavior change vs. earlier simulations.
/// - `SecondaryOnly` - every bite uses secondary, no on-hit
///   statuses. Mirrors today's "Use secondary attack only" chip
///   when checked. Used to live as a TS-bridge damage substitution
///   in `rustCompareMatchupRuntime.ts`; now driven engine-side so a
///   single per-bite gate covers both forced modes and dynamic.
/// - `Dynamic` - engine picks per-bite via
///   [`crate::policy::decisions::bite_variant::BuiltinBiteVariantReplayDecision`].
///   The bite cadence is unchanged - same `next_hit` schedule for
///   both variants and no switch cost between bites.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SimpleBiteVariantMode {
    #[default]
    PrimaryOnly,
    Dynamic,
    SecondaryOnly,
}

/// Per-side breath firing policy (only consulted under the
/// `BREATH_BURST_MODEL` flag; the flag-off path ignores it entirely).
///
/// - `OnAvailability` - fire whenever the fuel meter is positive, the
///   natural regen-limited cadence. This is the default and, with the
///   burst model off, the only behavior. For a chain breath every
///   isolated tap resets the chain, so the ramp never builds.
/// - `OnFullBar` - hold fire while charging, and only start a burst once
///   the meter is full; then fire continuously (the chain ramps) until
///   the meter drains, at which point the chain resets and the meter
///   refills. The intended default for chain breaths.
/// - `Ideal` - pick the burst-start timing that maximizes the actor's own
///   end-HP via engine replay. Wired end-to-end at the enum + bridge
///   surface; the engine currently falls back to `OnAvailability` until
///   the replay is implemented.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SimpleBreathPolicyMode {
    #[default]
    OnAvailability,
    OnFullBar,
    Ideal,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ComposableAbilityConfig {
    pub attacker_thorn_trap: bool,
    pub defender_thorn_trap: bool,
    pub attacker_toxic_trap: bool,
    pub defender_toxic_trap: bool,
    pub attacker_frost_snare: bool,
    pub defender_frost_snare: bool,
    pub attacker_poison_area: bool,
    pub defender_poison_area: bool,
    pub attacker_yolk_bomb: bool,
    pub defender_yolk_bomb: bool,
    pub attacker_yolk_bomb_value: Option<String>,
    pub defender_yolk_bomb_value: Option<String>,
    pub attacker_divination: bool,
    pub defender_divination: bool,
    /// Aura subtype string, e.g. "Disease", "Corrosion". None means the side
    /// has no aura ability. Each subtype maps to one ailment status applied
    /// every AURA_TICK_SEC seconds; see aura_status_id() in composable/mod.rs.
    pub attacker_aura_subtype: Option<String>,
    pub defender_aura_subtype: Option<String>,
    pub attacker_cursed_sigil_stacks: f64,
    pub defender_cursed_sigil_stacks: f64,
    pub attacker_fortify: bool,
    pub defender_fortify: bool,
    pub attacker_drowsy_area: bool,
    pub defender_drowsy_area: bool,
    pub attacker_unbridled_rage: bool,
    pub defender_unbridled_rage: bool,
    pub attacker_hunters_curse: bool,
    pub defender_hunters_curse: bool,
    pub attacker_life_leech_value: f64,
    pub defender_life_leech_value: f64,
    pub attacker_rewind: bool,
    pub defender_rewind: bool,
    pub attacker_warden_rage: bool,
    pub defender_warden_rage: bool,
    pub attacker_adrenaline: bool,
    pub defender_adrenaline: bool,
    pub attacker_lich_mark: bool,
    pub defender_lich_mark: bool,
    pub attacker_lich_mark_payload_status_id: Option<String>,
    pub defender_lich_mark_payload_status_id: Option<String>,
    pub attacker_spite_value: f64,
    pub defender_spite_value: f64,
    pub attacker_frost_nova: bool,
    pub defender_frost_nova: bool,
    pub attacker_reflux: bool,
    pub defender_reflux: bool,
    pub attacker_totem: bool,
    pub defender_totem: bool,
    /// Ailment the Totem applies. None defaults to Poison_Status, matching the
    /// historical Totem (byte-identical). "Totem Radiation" sets this to
    /// Radiation_Status. Only the carried ailment varies; the cadence (2 stacks
    /// every 3 s while placed) and the cooldown are unchanged.
    #[serde(default)]
    pub attacker_totem_status_id: Option<String>,
    #[serde(default)]
    pub defender_totem_status_id: Option<String>,
    pub attacker_guardians_passage: bool,
    pub defender_guardians_passage: bool,
    pub attacker_reflect: bool,
    pub defender_reflect: bool,
    pub attacker_cause_fear: bool,
    pub defender_cause_fear: bool,
    pub attacker_grim_lariat: bool,
    pub defender_grim_lariat: bool,
    pub attacker_shadow_barrage_value: f64,
    pub defender_shadow_barrage_value: f64,
    pub attacker_hunker: bool,
    pub defender_hunker: bool,
    pub attacker_harden: bool,
    pub defender_harden: bool,
    pub attacker_cocoon: bool,
    pub defender_cocoon: bool,
    /// Healing Step heal percent of max HP per 3s tick (0.0 = disabled).
    /// Owner heals while HP <= 65% max. Gated by Trails compare-only toggle in TS.
    pub attacker_healing_step_value: f64,
    pub defender_healing_step_value: f64,

    /// Healing Pulse (Compare-only disputed active). When true, the owner casts
    /// Healing_Ailment. Mode selects behaviour:
    ///   "normal"      - cast at t=0 and every 90s cooldown, applies 10 stacks
    ///                   of Healing_Ailment to BOTH sides (radius).
    ///   "onceAtStart" - cast once at t=0 only, applies 10 stacks to self only.
    /// If both sides enable Healing Pulse with "normal" mode, each casts
    /// independently at t=0 -> 20 total stacks on each side at battle start.
    pub attacker_healing_pulse: bool,
    pub defender_healing_pulse: bool,
    pub attacker_healing_pulse_once: bool,
    pub defender_healing_pulse_once: bool,

    /// Expunge (Compare-only disputed active). When true, the owner's next
    /// bite on a Bleeding target consumes all Bleed stacks on the target,
    /// deals bonus damage = D_normal x 0.05 x bleed (post-hoc multiplier) and
    /// heals the owner for flat 0.5 x baseAttack x 0.05 x bleed HP. 45s
    /// cooldown starts when the bonus bite lands. Single "ideal" policy:
    /// fires only when target has >= 5 Bleed stacks and cooldown has expired.
    pub attacker_expunge: bool,
    pub defender_expunge: bool,
    /// Damage trails family: raw `value` from effects_catalog (HP-threshold
    /// fraction; value > 1 is interpreted as percent). 0.0 disables the trail.
    /// Each active trail at tick time deals 2% of opponent max HP and applies
    /// 2 stacks of its status. Gated by Trails compare-only toggle in TS.
    pub attacker_flame_trail_value: f64,
    pub defender_flame_trail_value: f64,
    pub attacker_frost_trail_value: f64,
    pub defender_frost_trail_value: f64,
    pub attacker_plague_trail_value: f64,
    pub defender_plague_trail_value: f64,
    pub attacker_toxic_trail_value: f64,
    pub defender_toxic_trail_value: f64,

    /// Generic damage-trail channel: any ailment can ride the trail mechanic
    /// with the same semantics as the four named flavors above (HP-threshold
    /// gate in `*_trail_value`, 2% opponent max HP + 2 stacks of the status
    /// per tick). None status_id = no generic trail. Lets new ailment trails
    /// ("Trail Radiation", a Necropoison trail) flow through without a
    /// dedicated flavor field; the named flavors stay byte-identical.
    #[serde(default)]
    pub attacker_trail_status_id: Option<String>,
    #[serde(default)]
    pub defender_trail_status_id: Option<String>,
    #[serde(default)]
    pub attacker_trail_value: f64,
    #[serde(default)]
    pub defender_trail_value: f64,

    /// Aggregate compare-only HP regen bonus in percentage points, applied as
    /// an additional multiplier on regen ticks. This folds together:
    ///   Frosty (+25), Volcanic (+50), Pack Healer (+25, shared both sides),
    ///   Clean water (+20), Refreshed (+5), Regen Boost (+20), Mud Pile (+25).
    /// Caller is expected to sum the active toggles; example: Frosty+Refreshed
    /// -> 30.0. Unit: percentage points added to regen multiplier (not
    /// multiplicative stack). 0.0 = no bonus.
    pub attacker_compare_regen_bonus_pct: f64,
    pub defender_compare_regen_bonus_pct: f64,

    /// Compare-only "Spite ready at start" toggle. When true, the owner begins
    /// with Spite already armed and fully charged - the opening bite consumes
    /// it immediately. Requires a non-zero spite_value to have any effect.
    pub attacker_spite_ready_at_start: bool,
    pub defender_spite_ready_at_start: bool,

    /// Power Charge (compare-only): first melee hit gets +50% damage AND
    /// applies 2 stacks of Shredded Wings to the target. Consumed after the
    /// first melee event regardless of whether damage landed. Per Reference:
    /// "In Compare, Power Charge currently changes only the first melee hit."
    pub attacker_power_charge: bool,
    pub defender_power_charge: bool,

    /// Gore Charge (compare-only): first melee hit applies 2 Bleed + 9
    /// Deep Wounds to the target (no damage modifier). Consumed after the
    /// first melee event. Per Reference: "In Compare, Gore Charge changes
    /// only the first melee hit."
    pub attacker_gore_charge: bool,
    pub defender_gore_charge: bool,

    /// Compare-only "No Move Facetank" inverse: when true, PvP-persistent
    /// statuses (Poison/Burn/Bleed/Corrosion/Necropoison/Frostbite) skip
    /// natural decay and only have remaining_sec recomputed. Mirrors TS
    /// `!state.compareNoMoveFacetank` branch in statusDurationRuntime.ts.
    /// Default false (= TS default `compareNoMoveFacetank=true`, decay
    /// normally).
    pub attacker_compare_block_persistent_decay: bool,
    pub defender_compare_block_persistent_decay: bool,

    /// Compare-only First Tick Rule (regen half): when true, override the
    /// first health regen tick to occur at `first_tick_delay_sec` seconds
    /// instead of the default 15s interval. Mirrors TS
    /// `compareFirstTickMode in {"regen","both"}` init in engine.ts:130-135.
    pub attacker_compare_first_tick_regen: bool,
    pub defender_compare_first_tick_regen: bool,

    /// Delay in seconds used by the First Tick Rule. TS default is 1.0.
    /// Only used when *_first_tick_regen or *_first_tick_ailments is enabled.
    pub attacker_compare_first_tick_delay_sec: f64,
    pub defender_compare_first_tick_delay_sec: f64,

    /// Compare-only First Tick Rule (ailments half): when true, the first tick
    /// of a freshly applied DoT status fires at `first_tick_delay_sec` instead
    /// of the default tick period. Mirrors TS
    /// `compareFirstTickMode in {"ailments","both"}` in
    /// statusApplyRuntime.ts:41-52. A status counts as "freshly applied" when
    /// it was absent at the start of the current iteration; re-applications
    /// within 3 seconds of a previous natural clearance are treated as
    /// refreshes (no override) via the snapshot-based tracking on
    /// CombatSide.status_last_cleared_at.
    pub attacker_compare_first_tick_ailments: bool,
    pub defender_compare_first_tick_ailments: bool,

    /// Compare-only posture policy (lay/sit/stay). When enabled the
    /// engine periodically evaluates whether the side should sit /
    /// lay / stand based on a forward-simulation fitness comparison
    /// vs the "stay standing" baseline. The Stay branch is always
    /// included so the policy can never produce a worse projected
    /// outcome than Off - it only acts when a non-Stay candidate
    /// scores strictly higher. Default disabled (no posture changes).
    #[serde(default)]
    pub attacker_posture_policy_enabled: bool,
    #[serde(default)]
    pub defender_posture_policy_enabled: bool,
    /// When `posture_policy_enabled` AND `posture_policy_regen_aware`
    /// are both true, the policy includes regen-tick boundaries as
    /// decision points and credits the regen multiplier in fitness
    /// scoring. False means "regen-unaware": the policy ignores regen
    /// ticks for posture timing and credits regen mult as 1.0 even if
    /// the lookahead window catches one. Lets the user choose between
    /// "exploit regen-ticks for free heals" vs "only lay for ailment
    /// clearing / tactical reasons".
    #[serde(default)]
    pub attacker_posture_policy_regen_aware: bool,
    #[serde(default)]
    pub defender_posture_policy_regen_aware: bool,

    /// Compare-only Gourmandizer starting fill percentage. When > 100, grants
    /// a static weight bonus (linear ramp 0..15% between 100..125% fill).
    /// Default 0 -> factor 1.0, no change. Caller is responsible for only
    /// setting this when the creature actually has Gourmandizer and hunger
    /// rules are off (per Reference: "Without hunger rules, only the
    /// starting fill is used."). Dynamic-hunger half is deferred.
    pub attacker_compare_gourmandizer_fill_pct: f64,
    pub defender_compare_gourmandizer_fill_pct: f64,

    /// Compare-only Mud Pile toggle: when true, inject Muddy_Status for 90s
    /// at t=0. Muddy_Status gives +25% health regen (already handled in
    /// effective_hp_regen_multiplier) and doubles Bleed/Poison heal rate
    /// (now handled in heal_simple_status_stacks).
    pub attacker_compare_muddy_buff: bool,
    pub defender_compare_muddy_buff: bool,

    /// Compare-only starting current HP override. 0.0 = disabled/full HP.
    /// Caller currently exposes this only as a disputed Warden's Rage setup;
    /// max HP is unchanged, only side.hp at t=0 is adjusted.
    pub attacker_compare_start_hp_pct: f64,
    pub defender_compare_start_hp_pct: f64,

    /// Compare-only "Use Hunger Rules" toggle. When true, the side's
    /// `compare_hunger` drains each tick at 1 unit / 30 s baseline, and
    /// Reflux cast spends 25% of `compare_appetite_base`. Disease, the
    /// Gourmandizer overfill multiplier, and Defiled Ground modify the drain
    /// rate. Reference: "Use hunger rules" entry in referenceContent.ts.
    pub attacker_compare_hunger_rule: bool,
    pub defender_compare_hunger_rule: bool,

    /// When Gourmandizer is enabled AND the hunger rule is on, hunger above
    /// appetite_base drains 1.5x faster. Setting this independently (without
    /// the hunger rule) has no effect; the static-fill weight bonus path is
    /// covered by `*_compare_gourmandizer_fill_pct`.
    pub attacker_compare_gourmandizer: bool,
    pub defender_compare_gourmandizer: bool,

    /// How this side answers an opponent whose Reflect is up. Default false =
    /// bites and breathes straight into it, which is what the model always did.
    /// True = holds both until the window closes; abilities are unaffected,
    /// matching what Reflect actually turns back.
    #[serde(default)]
    pub attacker_reflect_response_hold: bool,
    #[serde(default)]
    pub defender_reflect_response_hold: bool,

    /// Compare-only starting hunger in appetite *units* (not %). Caller is
    /// expected to convert any fill% input via
    /// `compare_hunger::convert_fill_pct_to_appetite_units`.
    pub attacker_compare_starting_hunger: f64,
    pub defender_compare_starting_hunger: f64,

    /// Starting thirst, same units and the same appetite base. Left at 0 the
    /// meter starts full, matching the hunger side.
    #[serde(default)]
    pub attacker_compare_starting_thirst: f64,
    #[serde(default)]
    pub defender_compare_starting_thirst: f64,

    /// Meter ownership, named the way the game names it (`HasNoHunger` /
    /// `HasNoThirst`) so the default of false leaves a side carrying both.
    /// Photovore has no hunger; Aquatic and Photocarnivore have no thirst.
    #[serde(default)]
    pub attacker_compare_has_no_hunger: bool,
    #[serde(default)]
    pub defender_compare_has_no_hunger: bool,
    #[serde(default)]
    pub attacker_compare_has_no_thirst: bool,
    #[serde(default)]
    pub defender_compare_has_no_thirst: bool,

    /// Compare-only appetite base in units. TS default 100. Used by Reflux
    /// cost and as the threshold for Gourmandizer overfill drain.
    pub attacker_compare_appetite_base: f64,
    pub defender_compare_appetite_base: f64,

    /// Compare-only Defiled Ground level on this side (1/2/3). 0 = disabled.
    /// Reduces hunger drain by 20/50/80%. Referenced by
    /// `compare_hunger::defiled_ground_consumption_multiplier`.
    pub attacker_compare_defiled_ground_level: i32,
    pub defender_compare_defiled_ground_level: i32,

    /// Compare-only Defiled Ground Weakness flag (opponent debuff). When on,
    /// this side's hunger drain is multiplied by 1.2x (stacks with the
    /// owner-reduction factor if the side ALSO has its own Defiled Ground).
    pub attacker_compare_defiled_ground_weakness: bool,
    pub defender_compare_defiled_ground_weakness: bool,

    /// Compare-only Darkstar plushie flag. While the side is settled sit/lay,
    /// it accelerates Defiled-Ground-recoverable ailment recovery by x1.25,
    /// composed multiplicatively with the Defiled Ground level bonus and the
    /// posture decay multiplier (see `CombatSide::recoverable_recovery_mult`).
    /// Default false = no acceleration (off-path byte-identical).
    #[serde(default)]
    pub attacker_compare_dark_star: bool,
    #[serde(default)]
    pub defender_compare_dark_star: bool,

    /// Bad Omen follow-up outcomes, consumed one per expiry. When a side's
    /// Bad_Omen status expires (stacks drop from >0 to 0), the engine applies
    /// `bad_omen_outcomes[expiry_index % len]` to that side and advances the
    /// side's expiry counter. The caller (TS) fills this per context:
    ///   - Compare / Sandbox: a freshly-rolled random batch (Bad Omen is a
    ///     random ability, so each run re-rolls), or a single pinned outcome
    ///     when the debug Roulette forces one.
    ///   - Best Builds / Optimizer: a single deterministic outcome (Burn +8).
    ///
    /// Empty = no follow-up on expiry (legacy / unset).
    #[serde(default)]
    pub bad_omen_outcomes: Vec<SimpleBadOmenOutcome>,

    /// Compare-only plushie hunger drain multiplier. Applied on top of
    /// Defiled Ground and Disease multipliers in `advance_side_hunger`.
    /// 1.0 = no change. Example: Euvatops/Aerodon (-15%) -> 0.85;
    /// Goldfish (+20%) -> 1.20.
    pub attacker_compare_plushie_drain_multiplier: f64,
    pub defender_compare_plushie_drain_multiplier: f64,

    /// The same for thirst. Euvatops moves hunger and Aerodon thirst, so the
    /// two channels part company. Left at 0 the hunger figure covers both.
    #[serde(default)]
    pub attacker_compare_plushie_thirst_drain_multiplier: f64,
    #[serde(default)]
    pub defender_compare_plushie_thirst_drain_multiplier: f64,

    /// Per-ability timing-mode overrides for the attacker side. Empty =
    /// all abilities use the session-default `ability_policy`. Keys are
    /// display-name strings matching TS `AbilityTimingOverrides`.
    #[serde(default)]
    pub attacker_ability_policy_overrides: AbilityPolicyOverrides,

    /// Per-ability timing-mode overrides for the defender side. Same shape
    /// as the attacker field.
    #[serde(default)]
    pub defender_ability_policy_overrides: AbilityPolicyOverrides,

    /// Same-timestamp event order. Passives are fixed as the first boundary
    /// and are ignored here after deserialization; missing/duplicate phases
    /// are normalized by the simulation loop.
    #[serde(default)]
    pub combat_event_order: Vec<CombatEventPhase>,

    /// Compare-page environment flags. Pure data forwarded from the session
    /// UI knobs; the engine does nothing with these by itself - they're
    /// surfaced to user abilities through the `env.*` expression namespace
    /// (`env.is_day`, `env.is_night`, `env.is_blue_moon`, `env.is_blood_moon`,
    /// `env.air_rule_active`). Day/night and moon also separately drive
    /// `FinalStats` buffs on the TS side via `applyCompareBuffRuntime`; the
    /// engine sees the post-buff stats, not these strings.
    ///
    /// Day/night values: `"none" | "day" | "night"`.
    /// Moon values: `"none" | "blueMoon" | "bloodMoon"`.
    /// Both `None` -> treated as `"none"`.
    #[serde(default)]
    pub compare_day_night: Option<String>,
    #[serde(default)]
    pub compare_moon: Option<String>,

    /// Season multipliers on the two drain intervals, applied to both sides.
    /// Stated the way the game states them, so above 1 is a slower meter.
    /// 0 or absent = no season, which the drain reads as 1.
    #[serde(default)]
    pub compare_season_hunger_interval: f64,
    #[serde(default)]
    pub compare_season_thirst_interval: f64,

    /// Global weather cataclysm applied to BOTH sides at setup. Values:
    /// `"none" | "heatWave" | "blizzard" | "acidRain"` (None -> "none").
    /// At setup each non-immune side is seeded with a single permanent
    /// (no_decay) weather status: Heat Wave -> `Heat_Wave_Status`,
    /// Blizzard -> `Hypothermia_Status`, Acid Rain -> `Acid_Rain_Status`.
    /// Immunity is resolved on the TS side (Volcanic vs Heat Wave,
    /// Frosty vs Blizzard; Acid Rain has none) and delivered as the two
    /// `*_weather_immune` flags below - the Rust engine has no
    /// ability-by-name path for Volcanic/Frosty.
    #[serde(default)]
    pub weather: Option<String>,
    #[serde(default)]
    pub attacker_weather_immune: bool,
    #[serde(default)]
    pub defender_weather_immune: bool,

    /// Global Oxygen / Moisture drain mode applied to BOTH sides. Values:
    /// `"off" | "ground" | "underwater"` (None -> "off"). Mutually exclusive.
    /// - `"ground"`: each side drains its `moisture_time` pool by 1/sec; once
    ///   empty it loses 5% max HP/sec, floored at 50% max HP (drying never
    ///   kills).
    /// - `"underwater"`: each side drains its `oxygen_time` pool by 1/sec;
    ///   once empty it loses 5% max HP/sec with no floor - drowning is lethal.
    ///
    /// A side whose relevant-mode stat is 0/absent is immune in that mode.
    /// None / `"off"` is inert (no drain timer armed) -> byte-identical.
    #[serde(default)]
    pub oxygen_moisture_mode: Option<String>,

    /// Compare-only Aerial Dodge rule master switch. When set, each incoming
    /// bite / breath tick on a side rolls against that side's
    /// `aerial_dodge_hit_chance_pct` (100 = always hit; Shredded Wings forces
    /// 100). Off (default) is inert -> byte-identical.
    #[serde(default)]
    pub aerial_dodge_active: bool,
    /// Roll style for Aerial Dodge. false (default) = the deterministic even
    /// pattern (hits land as evenly as possible, same result every run). true
    /// = independent seeded rolls (`aerial_dodge_seed`) that vary per run and
    /// can streak - used only in Compare / Sandbox; optimizer / best-builds
    /// keep the even pattern so rankings stay stable.
    #[serde(default)]
    pub aerial_dodge_real_random: bool,
    /// Seed for `aerial_dodge_real_random`. The TS bridge supplies a fresh
    /// value per Compare / Sandbox run so real-random varies, and a fixed value
    /// where reproducibility is required. Ignored in even-pattern mode.
    #[serde(default)]
    pub aerial_dodge_seed: f64,

    /// Storming debuff (buff-menu toggle, Compare + Best Builds/Optimizer).
    /// When set, the side is seeded with a permanent `Storming_Status` that
    /// makes it take +10% incoming damage (bite + breath). The gate - the
    /// afflicted side is Terrestrial and its opponent is Aquatic - is
    /// resolved on the TS side; the engine only seeds the marker.
    #[serde(default)]
    pub attacker_storming: bool,
    #[serde(default)]
    pub defender_storming: bool,

    /// Compare-only "Nearby radiated creatures": the number of EXTRA creatures
    /// (besides the two fighters) currently suffering Radiation in the shared
    /// area. Radiation's 0.5% max-HP tick is additive across nearby radiated
    /// creatures, so each fighter's Radiation DOT is multiplied by
    /// (1 + this count + the other fighter when it is currently radiated).
    /// 0 = a single source = the plain 0.5% baseline (byte-identical default).
    #[serde(default)]
    pub radiation_nearby_count: f64,

    /// Per-side bite-variant mode. Default `PrimaryOnly` matches
    /// today's behavior for every creature: the engine reads this
    /// at each bite event in `process_phase_10_11_melee` and picks
    /// primary vs. secondary accordingly. See
    /// [`SimpleBiteVariantMode`] for variant semantics.
    #[serde(default)]
    pub attacker_bite_variant_mode: SimpleBiteVariantMode,
    #[serde(default)]
    pub defender_bite_variant_mode: SimpleBiteVariantMode,

    /// Per-side breath firing policy. Default `OnAvailability` matches
    /// today's behavior for every breath. Consulted at each standard
    /// breath tick in `tick_breath_side` only when the `BREATH_BURST_MODEL`
    /// flag is engaged; the flag-off path ignores it. See
    /// [`SimpleBreathPolicyMode`] for the mode semantics.
    #[serde(default)]
    pub attacker_breath_policy: SimpleBreathPolicyMode,
    #[serde(default)]
    pub defender_breath_policy: SimpleBreathPolicyMode,

    /// Head Start (seconds): the side that enables it gets an opening
    /// window during which its opponent stands inert. `attacker_head_start_sec
    /// = N` means the ATTACKER (side A) has the head start, so the DEFENDER
    /// (side B) is inert while `time + 1e-9 < N`; symmetrically
    /// `defender_head_start_sec = N` makes side A inert while
    /// `time + 1e-9 < N`. An inert side does not bite, breathe, change
    /// posture, activate abilities, or self-destruct, but it is still a live
    /// target: it takes the enabled side's bites, its defensive on-being-bitten
    /// reactions still fire, and its regen / status decay / status ticks keep
    /// running. After `time >= N` the side acts normally. Per-side independent;
    /// both sides may set N>0. Default 0.0 = window empty = no-op
    /// (byte-identical). Available to every creature - no eligibility gate.
    #[serde(default)]
    pub attacker_head_start_sec: f64,
    #[serde(default)]
    pub defender_head_start_sec: f64,
}

impl ComposableAbilityConfig {
    /// True while side A (the attacker) is inert under the opponent's
    /// Head Start window: the DEFENDER enabled Head Start and `time` is still
    /// inside `[0, defender_head_start_sec)`. Boundary matches the engine's
    /// 1e-9 "due" epsilon: inert while `time + 1e-9 < N`, active at `time >= N`.
    #[inline]
    pub fn head_start_inert_a(&self, time: f64) -> bool {
        time + 1e-9 < self.defender_head_start_sec
    }

    /// Symmetric: true while side B (the defender) is inert under the
    /// attacker's Head Start window.
    #[inline]
    pub fn head_start_inert_b(&self, time: f64) -> bool {
        time + 1e-9 < self.attacker_head_start_sec
    }
}
