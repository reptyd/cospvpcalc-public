/**
 * Authoritative lists of valid identifiers for the custom-ability
 * editor. Sourced from the Rust engine — see file references below.
 * Keep these in lockstep with the engine; surface mismatches via
 * validation rather than silent failure.
 *
 * The lists are also used by the visual editor's slot inputs (as
 * <datalist> autocomplete suggestions) and by the pseudocode docs.
 */

/**
 * Status IDs the engine recognises. Authoritative list:
 *   wasm-engine/src/statuses.rs (is_fortify_removable + extras)
 *
 * Custom abilities can also use any string here — the engine treats
 * unknown IDs as "this side has 0 stacks". The list below is the
 * surface area users would *want* to interact with.
 */
export const KNOWN_STATUS_IDS: ReadonlyArray<string> = [
  "Aftershock",
  "Ashy_Lungs",
  "Bad_Omen",
  "Bleed_Status",
  "Blessings_Boon",
  "Broken_Legs_Status",
  "Burn_Status",
  "Confusion_Status",
  "Corrosion_Status",
  "Deep_Wounds_Status",
  "Disease_Status",
  "Drowsy_Status",
  "Fear_Status",
  "Freeze_Status",
  "Frostbite_Status",
  "Heartbroken_Status",
  "Heat_Wave_Status",
  "Hypothermia_Status",
  "Injury_Status",
  "Lich_Mark_Status",
  "Muddy_Status",
  "Necropoison_Status",
  "Paralyze_Status",
  "Poison_Status",
  "Radiation_Status",
  "Scared_Bear_Status",
  "Scared_Status",
  "Shock_Status",
  "Shredded_Wings",
  "Sickly_Status",
  "Sticky_Teeth_Status",
  "Sticky_Trap_Status",
  "Stolen_Speed_Status",
  "Torn_Ligaments_Status",
] as const;

/**
 * SimpleCombatantStats numeric/boolean fields that work in
 * `modify_stat <field>`. From wasm-engine/src/contracts.rs.
 */
export const STATS_FIELDS: ReadonlyArray<string> = [
  "health",
  "weight",
  "damage",
  "bite_cooldown",
  "health_regen",
  "active_cooldown_multiplier",
  "quick_recovery_hp_ratio_threshold",
  "unbreakable_damage_cap_pct",
  "damage_taken_multiplier_on_being_bitten",
  "breath_resistance",
  "berserk_bite_cooldown_multiplier",
  "berserk_hp_ratio_threshold",
  "first_strike_pct",
  "first_strike_hp_ratio_threshold",
  "has_warden_resistance",
  "has_reflect",
  "hunker_reduction_pct",
  "plushie_reflect_avg_pct",
] as const;

/**
 * Built-in ability IDs that the engine registry already knows.
 * From wasm-engine/src/policy/decisions/mod.rs. Custom abilities
 * use the `user.<name>` prefix; built-ins do not.
 *
 * Use for cooldown_id / active_id / ability_id slots — both built-in
 * and user-defined IDs are valid; the suggestion list helps the
 * common case.
 */
export const BUILT_IN_ABILITY_IDS: ReadonlyArray<string> = [
  "adrenaline",
  "cocoon",
  "fortify",
  "hunker",
  "hunters_curse",
  "life_leech",
  "reflect",
  "rewind",
  "unbridled_rage",
  "wardens_rage",
] as const;

/**
 * Convenience export: all ability/cooldown ID suggestions, including
 * a placeholder hint for user-defined IDs. The latter doesn't actually
 * appear in datalists (it's just a string), but consumers may use it.
 */
export const ABILITY_ID_SUGGESTIONS: ReadonlyArray<string> = BUILT_IN_ABILITY_IDS;

/**
 * Variable paths the expression resolver supports. Used in docs and
 * (eventually) in expression-input autocomplete. From
 * wasm-engine/src/policy/user_ability.rs (~lines 270-441).
 */
export const EXPR_GLOBAL_PATHS: ReadonlyArray<string> = [
  "time",
  "combat.iteration_count",
  // Round 45 / B4: cumulative per-fight combat counters (perspective
  // side = whoever owns the firing spec). Bite-only this round;
  // breath / DOT / trap sources don't accumulate yet.
  "combat.bites_dealt",
  "combat.bites_taken",
  "combat.damage_dealt_total",
  "combat.damage_taken_total",
  // Round 32 / A5: compare-page environment flags. Seeded at simulation
  // start; constant for the run. Each resolves to 0.0 or 1.0.
  //   env.is_day            — Compare "Day/Night" set to "day"
  //   env.is_night          — Compare "Day/Night" set to "night"
  //   env.is_blue_moon      — Compare "Moon" set to "blueMoon"
  //   env.is_blood_moon     — Compare "Moon" set to "bloodMoon"
  //   env.air_rule_active   — Compare "Special Air PvP Rule" enabled
  "env.is_day",
  "env.is_night",
  "env.is_blue_moon",
  "env.is_blood_moon",
  "env.air_rule_active",
  // Round 40 / A11: per-ability scaling table. `<key>` is one of the
  // entries the user declares in `spec.scaling`. Resolves to
  // `scaling[key][active_level - 1]` at dispatch time. Outside dispatch
  // (or for unknown keys) the resolver returns 0.0.
  "scaling.<key>",
] as const;

/** `self.X` and `opp.X` paths — combine with the prefix at use site. */
export const EXPR_SIDE_FIELDS: ReadonlyArray<string> = [
  "hp",
  "max_hp",
  "hp_ratio",
  "bite_dps",
  "breath_capacity",
  "next_hit",
  "next_breath",
  "is_alive",
  "time_to_max_hp",
  "statuses_count",
  "statuses_total_stacks",
  // Phase 5 / G8: numeric creature tier (ordinal — `opp.tier >= 4`) and
  // the bare elder flag (any non-None variant). Specific elder variants
  // use the `is_elder.<V>` family in EXPR_SIDE_IDENTITY_FAMILIES.
  "tier",
  "is_elder",
] as const;

/** `self.X.<id>` paths — id is one of ABILITY_ID_SUGGESTIONS or a custom user.* */
export const EXPR_SIDE_TIMER_FAMILIES: ReadonlyArray<string> = [
  "cooldown_until",
  "active_until",
  "cooldown_remaining",
  "active_remaining",
  "is_idle",
  "fired_count",
  "last_fire_time",
  "time_since_fire",
  // Round 46 / B2: sliding-window damage helpers. The suffix after
  // the dot is the window length in seconds — e.g.
  // `self.damage_taken_last.5` = "post-mitigation damage taken in the
  // last 5 seconds". Bite damage only this round; engine retains a
  // 30s buffer (longer windows return what's still in the buffer).
  "damage_taken_last",
  "damage_dealt_last",
  // 2026-05-12: status-resistance interrogation. `<side>.status_block.<id>`
  // returns the combined resist + plushie block fraction (clamped [0,1])
  // for the named status on this side; 1.0 if the status is in
  // `immune_status_ids`. `<side>.is_immune.<id>` returns 1/0. Lets
  // utility expressions multiply ailment value by `(1 - opp.status_block.<id>)`
  // so blocked ailments score lower in target selection.
  "status_block",
  "is_immune",
] as const;

/**
 * `self.X.<seg>` / `opp.X.<seg>` identity & posture families resolved as
 * boolean builtins — the path segment is matched (case-insensitively)
 * against the side's attribute and resolves to 1.0 / 0.0. Same mechanism
 * as `is_immune.<id>`; unknown segments resolve to 0.0 (typo-safe).
 *
 * Phase 5 / G9 ships `is_posture` (Standing / Sitting / Laying). G8
 * extends this list with `is_type` / `is_diet` / `is_elder`. The numeric
 * `tier` attribute is a plain side scalar (see EXPR_SIDE_FIELDS), not a
 * boolean family. From wasm-engine/src/policy/user_ability.rs.
 */
export const EXPR_SIDE_IDENTITY_FAMILIES: ReadonlyArray<string> = [
  "is_posture",
  "is_type",
  "is_diet",
  "is_elder",
] as const;

/** `event.X` — only available inside trigger blocks. */
export const EXPR_EVENT_FIELDS: ReadonlyArray<string> = [
  "damage_taken",
  "damage_dealt",
  "tick_index",
  "applied_status_count",
  "expired_status_count",
  "first_strike_active",
  // Round 36 / A10: damage-kind flags. 0 or 1. Set inside
  // on_take_damage / on_deal_damage for whichever damage source(s)
  // hit this iteration.
  //   event.is_bite   — bite damage landed (Phase 10/11 melee)
  //   event.is_breath — breath damage landed (Phase 14/15 breath)
  //   event.is_dot    — DOT status tick damage landed (Phase 12)
  // Other engine damage (Lance aura, Reflux, Grim Lariat, traps, …)
  // currently leaves all three at 0 — round 36 covers the common
  // anti-bite / anti-breath / anti-DOT reaction surface; future
  // rounds may add more flags.
  "is_bite",
  "is_breath",
  "is_dot",
  // Round 37 / A7: heal amount inside on_heal trigger.
  "heal_amount",
  // Round 37 / A7: count of user active windows that expired this
  // iteration inside on_active_end trigger. Per-id flags live under
  // event.ended.<ability_id> (see EXPR_EVENT_ACTIVE_END_FAMILY).
  "ended_count",
  // Round 43 / A10b: pre-mitigation damage totals. Available inside
  // on_take_damage / on_deal_damage / on_before_take_damage /
  // on_before_deal_damage. `raw_damage` is the amount BEFORE any
  // built-in mitigation (Hunker etc.); `prevented_damage` =
  // raw - damage_taken. Both 0 outside damage-related triggers.
  // Only bite damage instruments this round; breath / DOT / traps
  // still report 0 (extends in a follow-up).
  "raw_damage",
  "prevented_damage",
] as const;

/**
 * Round 37 / A7: inside an `on_active_end` trigger, the engine writes
 * `event.ended.<ability_id>` = 1.0 for each user-defined `active_until`
 * window that elapsed this iteration. Mirrors the per-id flag pattern
 * A9 introduced for applied/expired statuses. Reads of unknown ids
 * resolve to 0.0 (typo-safe).
 */
export const EXPR_EVENT_ACTIVE_END_FAMILY: ReadonlyArray<string> = [
  "ended",
] as const;

/**
 * Round 33 / A9: inside an `on_status_apply` / `on_status_expire` trigger,
 * the engine writes `event.applied.<status_id>` / `event.expired.<status_id>`
 * = 1.0 for each status id that changed this iteration. Lets users write
 * counter-mechanics like:
 *
 *   on_status_apply:
 *     if event.applied.Poison_Status:
 *       apply_status_to_target opp Disease_Status 3
 *
 * Unrecognised status ids resolve to 0.0 (no-op), so a typo never crashes.
 */
export const EXPR_EVENT_STATUS_FAMILIES: ReadonlyArray<string> = [
  "applied",
  "expired",
] as const;

/**
 * Round 44 / A6: compose every var-path the engine resolver currently
 * recognises into one flat suggestion list. Drives the ExprEditor's
 * `<datalist>` autocomplete so users discover what's reachable from
 * an expression without leaving the editor.
 *
 * The list is intentionally derived from the OTHER vocab exports
 * above — adding a new path family there is the single change site
 * that propagates to autocomplete. Each entry is either a complete
 * path (`self.hp`, `event.damage_taken`) or a prefix the user appends
 * to (`self.cooldown_remaining.`, `event.applied.`).
 *
 * Stable order: globals → self.* scalars → opp.* scalars → self
 * timer families → opp timer families → self.stats.* → opp.stats.*
 * → self.status./extra. helpers → opp.status./extra. helpers →
 * event scalars → event prefix families. Determinism matters for
 * snapshot tests that pin the editor surface.
 */
export function buildVarSuggestions(): string[] {
  const out: string[] = [];
  // Global paths (time, env.*, combat.iteration_count, scaling.<key>).
  for (const p of EXPR_GLOBAL_PATHS) out.push(p);
  // Side scalars — both self and opp.
  for (const f of EXPR_SIDE_FIELDS) out.push(`self.${f}`);
  for (const f of EXPR_SIDE_FIELDS) out.push(`opp.${f}`);
  // Timer / counter families — emit as prefixes so users see
  // `self.cooldown_remaining.` and type an id.
  for (const fam of EXPR_SIDE_TIMER_FAMILIES) out.push(`self.${fam}.`);
  for (const fam of EXPR_SIDE_TIMER_FAMILIES) out.push(`opp.${fam}.`);
  // Identity / posture families (Phase 5) — boolean builtins.
  for (const fam of EXPR_SIDE_IDENTITY_FAMILIES) out.push(`self.${fam}.`);
  for (const fam of EXPR_SIDE_IDENTITY_FAMILIES) out.push(`opp.${fam}.`);
  // Status / extras dot families.
  out.push("self.status.");
  out.push("self.extra.");
  out.push("opp.status.");
  out.push("opp.extra.");
  // Stats-field bridge — every numeric/boolean field.
  for (const f of STATS_FIELDS) out.push(`self.stats.${f}`);
  for (const f of STATS_FIELDS) out.push(`opp.stats.${f}`);
  // Event scalars (inside trigger blocks).
  for (const f of EXPR_EVENT_FIELDS) out.push(`event.${f}`);
  // Event prefix families — applied./expired./ended.
  for (const fam of EXPR_EVENT_STATUS_FAMILIES) out.push(`event.${fam}.`);
  for (const fam of EXPR_EVENT_ACTIVE_END_FAMILY) out.push(`event.${fam}.`);
  return out;
}
