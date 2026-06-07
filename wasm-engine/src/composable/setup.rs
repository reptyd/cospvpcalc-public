//! Composable-engine setup helpers.
//!
//! Houses [`populate_combat_sides_and_flags`], the one-shot initializer that
//! mutates fresh `CombatSide`s into their `time = 0` state (warden-rage compare
//! start HP, env extras, user-ability levels, hunger / gourmandizer fields,
//! Muddy buff, traps, area cooldowns, auras, healing actives, damage-trail
//! timers, spite-ready-at-start, starting statuses, initial rewind snapshots),
//! plus computes the [`ComposableLoopFlags`] bundle the main event loop reads
//! to skip branches their abilities don't use.
//!
//! Extracted from the driver in `mod.rs` so the Sandbox runtime
//! (`composable/sandbox.rs`) can share the same initialization without
//! duplicating ~380 LoC of conditional setup. **Pure move - no logic split.**
//! Behavior parity with the inline form is gated by `cargo test --lib`
//! (baseline: 941/941).
//!
//! `'state` lifetime matches the `&'state SimpleCombatantStats` borrow each
//! `CombatSide` holds - caller owns the post-`apply_disabled_abilities`
//! clones; this fn just writes into the sides.

use super::{
    apply_compare_start_hp, aura_status_id, seed_env_extras_into_side, seed_user_levels_into_side,
    CombatSide, ComposableAbilityConfig, AURA_TICK_SEC, DAMAGE_TRAIL_TICK_SEC,
    HEALING_STEP_TICK_SEC,
};
use crate::abilities::rewind_breath::record_rewind_snapshot;
use crate::active_runtime::gourmandizer_weight_factor_from_fill_pct;
use crate::compare_hunger;
use crate::contracts::{
    apply_disabled_abilities as _apply_disabled_abilities, resolve_ability_policy,
    SimpleAbilityTimingMode, SimpleCombatantStats, SimpleStatusInstance,
};
use crate::statuses::apply_simple_status_list;

/// Setup-time flags and cached values consumed by the main event loop.
///
/// `has_any_*` toggles short-circuit per-iter checks the scheduler and phase
/// fns would otherwise pay for unused abilities. `hunker_decision_cadence_sec`
/// is the densest cadence across both sides' Hunker policies (Extreme → 0.1s,
/// Ideal → 0.25s, otherwise 0.5s); the Hunker decision phase consumes it
/// directly. `attacker_aura_status` / `defender_aura_status` cache the
/// subtype → status-id lookup so it isn't redone each iter.
#[derive(Debug, Clone)]
pub(super) struct ComposableLoopFlags {
    pub attacker_hunker_enabled: bool,
    pub defender_hunker_enabled: bool,
    pub has_any_hunker: bool,
    pub has_any_self_destruct: bool,
    pub has_any_thorn_trap: bool,
    pub has_any_toxic_trap: bool,
    pub has_any_fortify: bool,
    pub has_any_frost_snare: bool,
    pub has_any_poison_area: bool,
    pub has_any_yolk_bomb: bool,
    pub has_any_divination: bool,
    pub has_any_aura: bool,
    pub has_any_healing_step: bool,
    pub has_any_healing_pulse: bool,
    pub has_any_damage_trail: bool,
    pub has_any_rewind: bool,
    pub has_any_active_ability: bool,
    pub hunker_decision_cadence_sec: f64,
    pub attacker_aura_status: Option<&'static str>,
    pub defender_aura_status: Option<&'static str>,
}

/// Mutate `a` and `b` into their `time = 0` configured state, and compute the
/// [`ComposableLoopFlags`] bundle the main event loop reads.
///
/// Caller must pre-apply `apply_disabled_abilities` to `attacker` / `defender`
/// (so the sides see the post-filter `SimpleCombatantStats` clones); this fn
/// does **not** clone or filter - it only writes into the supplied sides.
pub(super) fn populate_combat_sides_and_flags(
    a: &mut CombatSide,
    b: &mut CombatSide,
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    ability_policy: SimpleAbilityTimingMode,
    config: &ComposableAbilityConfig,
) -> ComposableLoopFlags {
    // _apply_disabled_abilities import is unused here on purpose - kept so a
    // mistaken in-this-module reapplication trips the compiler.
    let _ = _apply_disabled_abilities;
    if config.attacker_warden_rage {
        apply_compare_start_hp(a, attacker, config.attacker_compare_start_hp_pct);
    }
    if config.defender_warden_rage {
        apply_compare_start_hp(b, defender, config.defender_compare_start_hp_pct);
    }

    // Seed environment flags into each side's user_extras
    // so user abilities can read them via the `env.*` expression namespace.
    seed_env_extras_into_side(a, attacker, config);
    seed_env_extras_into_side(b, defender, config);

    // Seed the per-fight active level for each user
    // ability attached to each side. Compare-page overrides come from
    // config.<side>_ability_policy_overrides.user_ability_levels;
    // missing entries fall back to the spec's default_level.
    seed_user_levels_into_side(
        a,
        attacker,
        &config.attacker_ability_policy_overrides.user_ability_levels,
    );
    seed_user_levels_into_side(
        b,
        defender,
        &config.defender_ability_policy_overrides.user_ability_levels,
    );

    // First Tick Rule (regen half): override the first regen tick to fire at
    // `first_tick_delay_sec` (TS default 1.0s) instead of the default 15s
    // interval. Matches TS engine.ts:130-135 behaviour when
    // compareFirstTickMode ∈ {"regen","both"}.
    if config.attacker_compare_first_tick_regen && attacker.health_regen > 0.0 {
        let delay = config.attacker_compare_first_tick_delay_sec.max(0.0);
        if delay < a.next_regen {
            a.next_regen = delay;
        }
    }
    if config.defender_compare_first_tick_regen && defender.health_regen > 0.0 {
        let delay = config.defender_compare_first_tick_delay_sec.max(0.0);
        if delay < b.next_regen {
            b.next_regen = delay;
        }
    }

    // Gourmandizer (compare-only, no-hunger-rules half): set a static weight
    // bonus factor from the starting fill%.
    a.gourmandizer_weight_factor =
        gourmandizer_weight_factor_from_fill_pct(config.attacker_compare_gourmandizer_fill_pct);
    b.gourmandizer_weight_factor =
        gourmandizer_weight_factor_from_fill_pct(config.defender_compare_gourmandizer_fill_pct);

    // Use Hunger Rules (compare-only): seed per-side appetite + flags. If
    // caller leaves starting_hunger / appetite_base at 0 we fall back to the
    // TS defaults (100 / 100) so tests and the off-path stay consistent.
    a.compare_hunger_rule_enabled = config.attacker_compare_hunger_rule;
    a.compare_gourmandizer_enabled = config.attacker_compare_gourmandizer;
    a.compare_defiled_ground_level = config.attacker_compare_defiled_ground_level;
    a.compare_defiled_ground_weakness_enabled = config.attacker_compare_defiled_ground_weakness;
    a.compare_appetite_base = if config.attacker_compare_appetite_base > 0.0 {
        compare_hunger::normalize_compare_appetite_base(config.attacker_compare_appetite_base)
    } else {
        compare_hunger::COMPARE_DEFAULT_APPETITE_BASE
    };
    a.compare_hunger = if config.attacker_compare_starting_hunger > 0.0 {
        compare_hunger::normalize_compare_hunger(config.attacker_compare_starting_hunger)
    } else {
        compare_hunger::COMPARE_DEFAULT_STARTING_HUNGER
    };
    a.compare_plushie_drain_multiplier = if config.attacker_compare_plushie_drain_multiplier > 0.0
    {
        config.attacker_compare_plushie_drain_multiplier
    } else {
        1.0
    };
    b.compare_hunger_rule_enabled = config.defender_compare_hunger_rule;
    b.compare_gourmandizer_enabled = config.defender_compare_gourmandizer;
    b.compare_defiled_ground_level = config.defender_compare_defiled_ground_level;
    b.compare_defiled_ground_weakness_enabled = config.defender_compare_defiled_ground_weakness;
    b.compare_plushie_drain_multiplier = if config.defender_compare_plushie_drain_multiplier > 0.0
    {
        config.defender_compare_plushie_drain_multiplier
    } else {
        1.0
    };
    b.compare_appetite_base = if config.defender_compare_appetite_base > 0.0 {
        compare_hunger::normalize_compare_appetite_base(config.defender_compare_appetite_base)
    } else {
        compare_hunger::COMPARE_DEFAULT_APPETITE_BASE
    };
    b.compare_hunger = if config.defender_compare_starting_hunger > 0.0 {
        compare_hunger::normalize_compare_hunger(config.defender_compare_starting_hunger)
    } else {
        compare_hunger::COMPARE_DEFAULT_STARTING_HUNGER
    };

    // When both Gourmandizer and the hunger rule are on, the dynamic factor
    // (hunger / base) supersedes the static fill% config.
    if a.compare_hunger_rule_enabled && a.compare_gourmandizer_enabled {
        a.gourmandizer_weight_factor = compare_hunger::gourmandizer_weight_factor_from_hunger(
            a.compare_hunger,
            a.compare_appetite_base,
        );
    }
    if b.compare_hunger_rule_enabled && b.compare_gourmandizer_enabled {
        b.gourmandizer_weight_factor = compare_hunger::gourmandizer_weight_factor_from_hunger(
            b.compare_hunger,
            b.compare_appetite_base,
        );
    }

    // Mud Pile (compare-only): inject Muddy_Status for 90 seconds at t=0.
    if config.attacker_compare_muddy_buff {
        a.statuses.insert(
            "Muddy_Status".to_string(),
            SimpleStatusInstance {
                stacks: 1.0,
                next_tick_at: None,
                next_decay_at: Some(90.0),
                remaining_sec: 90.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
    }
    if config.defender_compare_muddy_buff {
        b.statuses.insert(
            "Muddy_Status".to_string(),
            SimpleStatusInstance {
                stacks: 1.0,
                next_tick_at: None,
                next_decay_at: Some(90.0),
                remaining_sec: 90.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
    }

    let attacker_hunker_enabled = config.attacker_hunker && CombatSide::has_hunker(attacker);
    let defender_hunker_enabled = config.defender_hunker && CombatSide::has_hunker(defender);
    let has_any_hunker = attacker_hunker_enabled || defender_hunker_enabled;
    let has_any_self_destruct =
        attacker.self_destruct_profile.is_some() || defender.self_destruct_profile.is_some();
    let has_any_thorn_trap = config.attacker_thorn_trap || config.defender_thorn_trap;
    let has_any_toxic_trap = config.attacker_toxic_trap || config.defender_toxic_trap;
    // Cadence tightens to 0.25s only when at least one active Hunker side
    // runs on Ideal policy. Overrides are honored so a side with default
    // SemiIdeal can opt into Ideal Hunker without paying for the other side.
    let hunker_eff_policy_a = if attacker_hunker_enabled {
        resolve_ability_policy(ability_policy, config.attacker_ability_policy_overrides.hunker)
    } else {
        ability_policy
    };
    let hunker_eff_policy_b = if defender_hunker_enabled {
        resolve_ability_policy(ability_policy, config.defender_ability_policy_overrides.hunker)
    } else {
        ability_policy
    };
    fn hunker_cadence_for(policy: SimpleAbilityTimingMode) -> f64 {
        match policy {
            SimpleAbilityTimingMode::Extreme => 0.1,
            SimpleAbilityTimingMode::Ideal => 0.25,
            _ => 0.5,
        }
    }
    let hunker_decision_cadence_sec = hunker_cadence_for(hunker_eff_policy_a)
        .min(hunker_cadence_for(hunker_eff_policy_b));

    // Initialize thorn trap
    if config.attacker_thorn_trap {
        a.next_thorn_trap = 0.5;
    }
    if config.defender_thorn_trap {
        b.next_thorn_trap = 0.5;
    }

    // Initialize toxic trap (activates on cooldown; first activation at t=0)
    if config.attacker_toxic_trap {
        a.next_toxic_trap = 0.0;
    }
    if config.defender_toxic_trap {
        b.next_toxic_trap = 0.0;
    }

    // Initialize frost snare
    let has_any_fortify = config.attacker_fortify || config.defender_fortify;
    let has_any_frost_snare = config.attacker_frost_snare || config.defender_frost_snare;
    if config.attacker_frost_snare {
        a.next_frost_snare = 0.0;
    }
    if config.defender_frost_snare {
        b.next_frost_snare = 0.0;
    }
    let has_any_poison_area = config.attacker_poison_area || config.defender_poison_area;
    if config.attacker_poison_area {
        a.next_poison_area = 0.0;
    }
    if config.defender_poison_area {
        b.next_poison_area = 0.0;
    }
    let has_any_yolk_bomb = config.attacker_yolk_bomb || config.defender_yolk_bomb;
    if config.attacker_yolk_bomb {
        a.next_yolk_bomb = 0.0;
    }
    if config.defender_yolk_bomb {
        b.next_yolk_bomb = 0.0;
    }
    let has_any_divination = config.attacker_divination || config.defender_divination;
    if config.attacker_divination {
        a.next_divination = 0.0;
    }
    if config.defender_divination {
        b.next_divination = 0.0;
    }

    // Initialize aura ticks. Any subtype that maps to a known status counts.
    let attacker_aura_status = config
        .attacker_aura_subtype
        .as_deref()
        .and_then(aura_status_id);
    let defender_aura_status = config
        .defender_aura_subtype
        .as_deref()
        .and_then(aura_status_id);
    let has_any_aura = attacker_aura_status.is_some() || defender_aura_status.is_some();
    if attacker_aura_status.is_some() {
        a.aura_next_tick_at = Some(AURA_TICK_SEC);
        // Corrosion-applying aura was historically called "Radiation" and the
        // breath path filtered Corrosion to avoid double-counting. Keep that
        // for the Corrosion subtype only.
        if config.attacker_aura_subtype.as_deref() == Some("Corrosion") {
            a.filter_corrosion_from_breath = true;
        }
    }
    if defender_aura_status.is_some() {
        b.aura_next_tick_at = Some(AURA_TICK_SEC);
        if config.defender_aura_subtype.as_deref() == Some("Corrosion") {
            b.filter_corrosion_from_breath = true;
        }
    }

    // Initialize Healing Step. TS: state.healingStepNextTickAt =
    // runtime.hasHealingStep ? HEALING_STEP_TICK_SEC : +∞.
    let has_any_healing_step =
        config.attacker_healing_step_value > 0.0 || config.defender_healing_step_value > 0.0;
    if config.attacker_healing_step_value > 0.0 {
        a.healing_step_next_tick_at = Some(HEALING_STEP_TICK_SEC);
    }
    if config.defender_healing_step_value > 0.0 {
        b.healing_step_next_tick_at = Some(HEALING_STEP_TICK_SEC);
    }

    // Initialize Healing Pulse. Owner casts at t=0 regardless of mode.
    let has_any_healing_pulse = config.attacker_healing_pulse || config.defender_healing_pulse;
    if config.attacker_healing_pulse {
        a.next_healing_pulse = 0.0;
    }
    if config.defender_healing_pulse {
        b.next_healing_pulse = 0.0;
    }

    // Initialize damage trails. TS sets state.damageTrailNextTickAt lazily on
    // first updateTrails call (time + DAMAGE_TRAIL_TICK_SEC).
    let attacker_has_damage_trail = config.attacker_flame_trail_value > 0.0
        || config.attacker_frost_trail_value > 0.0
        || config.attacker_plague_trail_value > 0.0
        || config.attacker_toxic_trail_value > 0.0;
    let defender_has_damage_trail = config.defender_flame_trail_value > 0.0
        || config.defender_frost_trail_value > 0.0
        || config.defender_plague_trail_value > 0.0
        || config.defender_toxic_trail_value > 0.0;
    let has_any_damage_trail = attacker_has_damage_trail || defender_has_damage_trail;
    if attacker_has_damage_trail {
        a.damage_trail_next_tick_at = Some(DAMAGE_TRAIL_TICK_SEC);
    }
    if defender_has_damage_trail {
        b.damage_trail_next_tick_at = Some(DAMAGE_TRAIL_TICK_SEC);
    }

    // Initialize Spite-ready-at-start (compare-only toggle). When enabled,
    // the side begins combat with Spite armed and charge ready immediately.
    if config.attacker_spite_ready_at_start && config.attacker_spite_value != 0.0 {
        let has_offensive_payload = !attacker.on_hit_statuses.is_empty();
        if config.attacker_spite_value > 0.0 || has_offensive_payload {
            a.spite_armed = true;
            a.spite_charge_ready_at = 0.0;
            a.spite_cooldown_until = 20.0;
        }
    }
    if config.defender_spite_ready_at_start && config.defender_spite_value != 0.0 {
        let has_offensive_payload = !defender.on_hit_statuses.is_empty();
        if config.defender_spite_value > 0.0 || has_offensive_payload {
            b.spite_armed = true;
            b.spite_charge_ready_at = 0.0;
            b.spite_cooldown_until = 20.0;
        }
    }

    // Initialize rewind
    let has_any_rewind = config.attacker_rewind || config.defender_rewind;
    let has_any_active_ability = has_any_fortify
        || config.attacker_harden
        || config.defender_harden
        || has_any_rewind
        || has_any_hunker
        || has_any_self_destruct
        || has_any_thorn_trap
        || has_any_toxic_trap
        || has_any_frost_snare
        || has_any_poison_area
        || has_any_yolk_bomb
        || has_any_divination
        || has_any_aura
        || has_any_healing_step
        || has_any_healing_pulse
        || has_any_damage_trail
        || config.attacker_cursed_sigil_stacks > 0.0
        || config.defender_cursed_sigil_stacks > 0.0
        || config.attacker_drowsy_area
        || config.defender_drowsy_area
        || config.attacker_unbridled_rage
        || config.defender_unbridled_rage
        || config.attacker_hunters_curse
        || config.defender_hunters_curse
        || config.attacker_life_leech_value > 0.0
        || config.defender_life_leech_value > 0.0
        || config.attacker_warden_rage
        || config.defender_warden_rage
        || config.attacker_adrenaline
        || config.defender_adrenaline
        || config.attacker_lich_mark
        || config.defender_lich_mark
        || config.attacker_spite_value != 0.0
        || config.defender_spite_value != 0.0
        || config.attacker_frost_nova
        || config.defender_frost_nova
        || config.attacker_reflux
        || config.defender_reflux
        || config.attacker_totem
        || config.defender_totem
        || config.attacker_reflect
        || config.defender_reflect
        || config.attacker_cause_fear
        || config.defender_cause_fear
        || config.attacker_grim_lariat
        || config.defender_grim_lariat
        || config.attacker_shadow_barrage_value > 0.0
        || config.defender_shadow_barrage_value > 0.0
        || config.attacker_cocoon
        || config.defender_cocoon;

    // Apply starting statuses
    apply_simple_status_list(0.0, &mut a.statuses, &attacker.starting_statuses);
    apply_simple_status_list(0.0, &mut b.statuses, &defender.starting_statuses);

    // Seed the global weather cataclysm (Heat Wave / Blizzard / Acid Rain)
    // as a single permanent status on each non-immune side. Immunity
    // (Volcanic vs Heat Wave, Frosty vs Blizzard) is resolved on the TS
    // side and delivered via config.*_weather_immune.
    if let Some(weather) = config.weather.as_deref() {
        if let Some(status_id) = crate::statuses::weather_status_id(weather) {
            if !config.attacker_weather_immune {
                crate::statuses::seed_permanent_status(0.0, &mut a.statuses, status_id);
            }
            if !config.defender_weather_immune {
                crate::statuses::seed_permanent_status(0.0, &mut b.statuses, status_id);
            }
        }
    }

    // Storming debuff: a permanent +10%-incoming marker. The terrestrial-self
    // / aquatic-opponent gate is resolved on the TS side; here we only seed
    // the marker when the corresponding flag is set.
    if config.attacker_storming {
        crate::statuses::seed_permanent_status(0.0, &mut a.statuses, "Storming_Status");
    }
    if config.defender_storming {
        crate::statuses::seed_permanent_status(0.0, &mut b.statuses, "Storming_Status");
    }

    // Record initial rewind snapshots
    if has_any_rewind {
        if config.attacker_rewind {
            record_rewind_snapshot(&mut a.rewind_history, 0.0, a.hp, &a.statuses);
        }
        if config.defender_rewind {
            record_rewind_snapshot(&mut b.rewind_history, 0.0, b.hp, &b.statuses);
        }
    }

    ComposableLoopFlags {
        attacker_hunker_enabled,
        defender_hunker_enabled,
        has_any_hunker,
        has_any_self_destruct,
        has_any_thorn_trap,
        has_any_toxic_trap,
        has_any_fortify,
        has_any_frost_snare,
        has_any_poison_area,
        has_any_yolk_bomb,
        has_any_divination,
        has_any_aura,
        has_any_healing_step,
        has_any_healing_pulse,
        has_any_damage_trail,
        has_any_rewind,
        has_any_active_ability,
        hunker_decision_cadence_sec,
        attacker_aura_status,
        defender_aura_status,
    }
}
