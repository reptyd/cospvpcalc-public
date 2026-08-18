use std::collections::BTreeMap;

use crate::spec_constants::{FROSTBITE_BITE_COOLDOWN_INCREASE_PCT_PER_STACK, WARDENS_RAGE_CAP_MULTIPLIER};
use crate::{SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats, SimpleStatusInstance};

const SCALE_DIRECT_ATTACK_ABILITY_PAYLOADS: bool = true;
pub const REGEN_BOUNDARY_EPSILON_SEC: f64 = 1e-12;

pub fn is_regen_tick_due(next_regen_at: f64, time: f64) -> bool {
    next_regen_at <= time + REGEN_BOUNDARY_EPSILON_SEC
}

/// Normalizes a raw `unbreakable_damage_cap_pct` value into the
/// fraction in `[0, 1]` it represents.
///
/// The contract field accepts either a fraction (e.g. `0.25` for
/// 25%) or a whole-percent number (e.g. `25.0` for 25%) for
/// historical TS-bridge reasons; values `> 1.0` are interpreted as
/// percent. Returns `None` when no cap should apply at all
/// (non-positive or non-finite input).
fn normalized_unbreakable_damage_cap_fraction(raw: f64) -> Option<f64> {
    if !raw.is_finite() || raw <= 0.0 {
        return None;
    }
    let fraction = if raw > 1.0 { raw / 100.0 } else { raw };
    Some(fraction.clamp(0.0, 1.0))
}

/// Caps incoming `damage` against the target's unbreakable damage
/// cap (a fraction of the target's max HP). Used by every direct-
/// damage code path - bites, breath ticks, reflect, life-leech
/// rescue, self-destruct explosion. Single canonical implementation
/// for the whole engine; both `composable/` and `actives::`
/// self-destruct call this.
pub fn apply_unbreakable_damage_cap(
    damage: f64,
    target_stats: &SimpleCombatantStats,
) -> f64 {
    let damage = damage.max(0.0);
    match normalized_unbreakable_damage_cap_fraction(target_stats.unbreakable_damage_cap_pct) {
        Some(fraction) => damage.min(target_stats.health.max(0.0) * fraction),
        None => damage,
    }
}

/// Warden's Rage strength value derived from the actor's HP ratio.
/// Mirrors the game's `GetRageValue`:
/// `ceil(clamp(map(hp_ratio, 0.5..1 -> 100..1), 1, 100))` - an
/// integer in `[1, 100]`. `100` at or below 50% HP, `1` at full HP,
/// linear in between. Reference: `ability_wardens_rage` HP-scaling
/// rule.
///
/// The field that stores this still carries the historical name
/// `warden_rage_stacks`; it now holds the game value.
pub fn wardens_rage_stacks_from_hp_ratio(hp_ratio: f64) -> i32 {
    // map(x, in_lo, in_hi, out_lo, out_hi) = out_lo + (x - in_lo)
    //   * (out_hi - out_lo) / (in_hi - in_lo). Game call:
    // map(hp_ratio, 0.5, 1.0, 100.0, 1.0).
    let mapped = 100.0 + (hp_ratio - 0.5) * (1.0 - 100.0) / (1.0 - 0.5);
    mapped.clamp(1.0, 100.0).ceil() as i32
}

/// Outgoing-damage multiplier from a Warden's Rage strength value.
/// Mirrors the game's `Damage(value) = max(1, value/100 * 8.5)`.
/// At the full value of 100 the
/// actor deals [`WARDENS_RAGE_CAP_MULTIPLIER`]x bite damage; the
/// multiplier floors at `1.0` (no buff) for low values / full HP.
pub fn wardens_rage_multiplier(value: i32) -> f64 {
    (value as f64 / 100.0 * WARDENS_RAGE_CAP_MULTIPLIER).max(1.0)
}

pub fn corrosion_weight_multiplier(statuses: &BTreeMap<String, SimpleStatusInstance>) -> f64 {
    let corrosion_stacks = statuses
        .get("Corrosion_Status")
        .map(|instance| instance.stacks)
        .unwrap_or(0.0);
    if corrosion_stacks <= 0.0 {
        return 1.0;
    }
    let reduction_pct = (7.5 + corrosion_stacks).min(97.5);
    ((100.0 - reduction_pct) / 100.0).clamp(0.0, 1.0)
}

/// Lance weight-lerp factor. In game Lance passes a precomputed
/// `%-maxHP` amount into `CalculateDamage`, which lerps it 50% toward
/// `amount * weightPct * posture` - i.e. scales it by
/// `0.5 + 0.5 * weightPct * posture`, where
/// `weightPct = clamp(attackerWeight / defenderWeight, 0, 3)` (corrosion-adjusted,
/// like every other weight ratio) and `posture` is the target's sit/lay
/// oncoming-damage multiplier. There is no upper clamp, so a heavy attacker
/// into a laying target scales above the base.
pub fn lance_weight_lerp_factor(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_statuses: &BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &BTreeMap<String, SimpleStatusInstance>,
    target_posture_mult: f64,
) -> f64 {
    let attacker_weight = (attacker.weight * corrosion_weight_multiplier(attacker_statuses)).max(1.0);
    let defender_weight = (defender.weight * corrosion_weight_multiplier(defender_statuses)).max(1.0);
    let weight_pct = (attacker_weight / defender_weight).clamp(0.0, 3.0);
    // The game weight-lerps the %-maxHP base through CalculateDamage and then
    // clamps the result back to that base (ProjectileAOEAbility `_applyDamage`:
    // `clamp(result, 0, maxHP * pct)`). So weight and target posture can only
    // REDUCE Lance below the base %, never amplify it above - cap the factor at
    // 1.0 to match (a heavier attacker or a sitting/laying target stays at base).
    (0.5 + 0.5 * weight_pct * target_posture_mult).min(1.0)
}

/// The `*Attack` passives whose on-hit ailment stacks scale with the
/// attacker/defender weight ratio in game (the `WeightPercent` flag):
/// CorrosionAttack, DiseaseAttack, InjuryAttack, and LigamentTear.
/// Torn Ligaments has no modelled combat effect (stamina/speed, out of
/// model), so scaling its stack count is inert today - included for
/// faithfulness to the game flag and to stay correct if it ever gains one.
pub fn is_weight_scaled_direct_attack_offensive_ailment_status(status_id: &str) -> bool {
    matches!(
        status_id,
        "Corrosion_Status" | "Disease_Status" | "Injury_Status" | "Torn_Ligaments_Status"
    )
}

pub fn direct_attack_weight_scale(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_statuses: &BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> f64 {
    // The game reads both sides through `GetWithModifiers("Weight")`, so
    // Corrosion on either creature moves this ratio while it is up.
    let effective_attacker_weight =
        (attacker.weight * corrosion_weight_multiplier(attacker_statuses)).max(1.0);
    let effective_defender_weight =
        (defender.weight * corrosion_weight_multiplier(defender_statuses)).max(1.0);
    let weight_ratio_cap = 3.0_f64;
    let weight_ratio =
        (effective_attacker_weight / effective_defender_weight).min(weight_ratio_cap);
    // No floor: the game lerps halfway to the ratio and stops there, so a
    // lighter attacker lands fewer stacks. The ratio's own clamp holds the
    // factor between 0.5 and 2.
    (1.0 + weight_ratio) / 2.0
}

pub fn scale_direct_attack_offensive_ailment_statuses(
    applied: &[SimpleAppliedStatus],
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_statuses: &BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> Vec<SimpleAppliedStatus> {
    scale_direct_attack_offensive_ailment_statuses_with_policy(
        applied,
        attacker,
        defender,
        attacker_statuses,
        defender_statuses,
        SCALE_DIRECT_ATTACK_ABILITY_PAYLOADS,
    )
}

fn scale_direct_attack_offensive_ailment_statuses_with_policy(
    applied: &[SimpleAppliedStatus],
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_statuses: &BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &BTreeMap<String, SimpleStatusInstance>,
    scale_enabled: bool,
) -> Vec<SimpleAppliedStatus> {
    let scale =
        direct_attack_weight_scale(attacker, defender, attacker_statuses, defender_statuses);
    applied
        .iter()
        .map(|status| SimpleAppliedStatus {
            status_id: status.status_id.clone(),
            stacks: if scale_enabled
                && is_weight_scaled_direct_attack_offensive_ailment_status(&status.status_id)
            {
                status.stacks * scale
            } else {
                status.stacks
            },
            source_ability: status.source_ability.clone(),
            ..Default::default()
        })
        .collect()
}

/// Per-status INCOMING damage amplifier (percent) read from the DEFENDER's
/// statuses - the receiving-side mirror of `outgoing_damage_multiplier_from_statuses`.
/// Storming (a terrestrial caught in water too long, fighting an Aquatic
/// species) makes the afflicted side take +10% from every damage source
/// (bite + breath). The terrestrial-self / aquatic-opponent gate is resolved
/// on the TS side at setup; the engine only sees the `Storming_Status` marker.
pub(crate) fn incoming_damage_pct_from_statuses(statuses: &BTreeMap<String, SimpleStatusInstance>) -> f64 {
    statuses.iter().fold(0.0, |acc, (status_id, instance)| {
        let builtin = match status_id.as_str() {
            "Storming_Status" => 10.0,
            _ => 0.0,
        };
        acc + builtin + user_status_incoming_damage_pct(status_id, instance)
    })
}

/// Multiplier the attacker's statuses put on the damage it deals.
///
/// Each status that targets Damage takes the running value and hands back its
/// own multiple of it, so two of them compound: Aggressive with Fear is
/// `1.25 x 0.55`, not `1 + 0.25 - 0.45`. A single status reads the same either
/// way, which is why the difference stayed invisible.
pub(crate) fn outgoing_damage_multiplier_from_statuses(
    statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> f64 {
    statuses.iter().fold(1.0, |acc, (status_id, instance)| {
        let builtin = match status_id.as_str() {
            "Aggressive_Status" => 25.0,
            // 2026-05-12: Bear plushie boost formula is now
            // `base * 1.1 + 10` (multiplier then flat always-positive),
            // not the old flat `+10`. Aggressive: 25 * 1.1 + 10 = 37.5.
            "Aggressive_Bear_Status" => 37.5,
            "Malices_Mark" => -15.0,
            // Scared: -50 * 1.1 + 10 = -45 (sign preserved through the
            // multiplier; flat +10 always pushes numerically up).
            "Scared_Bear_Status" => -45.0,
            "Scared_Status" => -50.0,
            "Fear_Status" => -45.0,
            // Aftershock: flat -20% outgoing damage while present, regardless of
            // stack count (stacks only extend its duration). Delivered to the
            // ENEMY via Yolk Bomb (Zeoarex) / Lich Mark (Garluhmoat). Registry
            // row + Reference: status_aftershock. Keep in sync with
            // ENGINE_TIMED_STATUS_IDS in engine_status_registry_parity.rs.
            "Aftershock" => -20.0,
            _ => 0.0,
        };
        let pct = builtin + user_status_outgoing_damage_pct(status_id, instance);
        acc * (1.0 + pct / 100.0).max(0.0)
    })
}

// A user status's `incoming_damage_mult` / `outgoing_damage_mult`
// (1.0 = neutral) folds into the same additive-percent accumulator as the
// built-in amplifiers as `(mult - 1) * 100`, so a custom 1.5x incoming
// composes additively with Storming etc. - matching how the engine already
// sums status damage modifiers. Gated on the `user.` prefix inside
// `user_status_spec`, so built-in ids cost only a `starts_with` check.
fn user_status_incoming_damage_pct(status_id: &str, instance: &SimpleStatusInstance) -> f64 {
    crate::statuses::user_status_spec(status_id).map_or(0.0, |spec| {
        // Phase 9: an Expr-resolved override (cached on the instance) takes
        // precedence over the static knob; None => static (byte-identical).
        let mult = instance
            .resolved_scalars
            .as_ref()
            .and_then(|r| r.incoming_damage_mult)
            .unwrap_or(spec.incoming_damage_mult);
        (mult - 1.0) * 100.0
    })
}

fn user_status_outgoing_damage_pct(status_id: &str, instance: &SimpleStatusInstance) -> f64 {
    crate::statuses::user_status_spec(status_id).map_or(0.0, |spec| {
        let mult = instance
            .resolved_scalars
            .as_ref()
            .and_then(|r| r.outgoing_damage_mult)
            .unwrap_or(spec.outgoing_damage_mult);
        (mult - 1.0) * 100.0
    })
}

pub fn compute_melee_damage_per_hit(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_hp: f64,
) -> f64 {
    let weight_ratio_cap = 3.0_f64;
    let attacker_weight = attacker.weight;
    let defender_weight = defender.weight.max(1.0);
    let weight_ratio = (attacker_weight / defender_weight).min(weight_ratio_cap);
    let mut final_damage = (attacker.damage * (1.0 + weight_ratio)) / 2.0;
    if attacker.first_strike_pct > 0.0 {
        let hp_ratio = attacker_hp / attacker.health.max(1.0);
        if hp_ratio >= attacker.first_strike_hp_ratio_threshold {
            final_damage *= 1.0 + attacker.first_strike_pct;
        }
    }
    final_damage *= defender.damage_taken_multiplier_on_being_bitten.max(0.0);
    final_damage.max(0.0)
}

pub fn compute_melee_damage_per_hit_with_actor_and_target_statuses(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_hp: f64,
    attacker_statuses: &BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> f64 {
    let effective_attacker_weight =
        (attacker.weight * corrosion_weight_multiplier(attacker_statuses)).max(1.0);
    let effective_defender_weight =
        (defender.weight * corrosion_weight_multiplier(defender_statuses)).max(1.0);
    let weight_ratio_cap = 3.0_f64;
    let weight_ratio =
        (effective_attacker_weight / effective_defender_weight).min(weight_ratio_cap);
    let mut final_damage = (attacker.damage * (1.0 + weight_ratio)) / 2.0;
    if attacker.first_strike_pct > 0.0 {
        let hp_ratio = attacker_hp / attacker.health.max(1.0);
        if hp_ratio >= attacker.first_strike_hp_ratio_threshold {
            final_damage *= 1.0 + attacker.first_strike_pct;
        }
    }
    final_damage *= outgoing_damage_multiplier_from_statuses(attacker_statuses);
    final_damage *= defender.damage_taken_multiplier_on_being_bitten.max(0.0);
    // Storming (and any future incoming-damage debuff) amplifies all damage
    // the defender receives, including bites.
    final_damage *= (1.0 + incoming_damage_pct_from_statuses(defender_statuses) / 100.0).max(0.0);
    final_damage.max(0.0)
}

pub fn simple_breath_tick_sec(breath: &SimpleBreathProfile) -> f64 {
    if !matches!(
        breath.special_kind.as_deref(),
        Some("lance") | Some("solar_beam") | Some("spirit_glare")
    ) {
        0.5
    } else {
        1.0
    }
}

pub fn simple_breath_capacity_step(breath: &SimpleBreathProfile) -> f64 {
    let _ = breath;
    // Capacity is denominated in seconds of continuous fire: 1 capacity unit
    // covers one second of firing. Every breath damage-ticks at 0.5 s in the
    // runtime loop, so the per-tick step is 0.5 (= 1 cap / 2 ticks-per-sec).
    //
    // Pre-2026-05 the step was a flat 1.0 and capacity drained per damage
    // tick - that drained at 2/sec, halving every breath's real in-game
    // duration. Heliolyth's Judgement capacity halved (20 -> 10) in
    // `data/breath_specs.runtime.json` to preserve its observed 10s duration
    // under the corrected model.
    0.5
}

#[allow(clippy::too_many_arguments)]
pub fn compute_simple_breath_extended_damage(
    winner: &SimpleCombatantStats,
    loser: &SimpleCombatantStats,
    winner_breath: Option<&SimpleBreathProfile>,
    current_time: f64,
    next_hit_at: f64,
    next_breath_at: f64,
    current_breath_capacity: f64,
    breath_regen_at: f64,
    initial_chain_stacks: f64,
) -> f64 {
    let extra_max_sec = 30.0_f64;
    let horizon_end = current_time + extra_max_sec;
    let bite_cooldown = winner.bite_cooldown.max(0.0001);
    let melee_damage = compute_melee_damage_per_hit(winner, loser, winner.health);
    let mut time = current_time;
    let mut next_hit = if next_hit_at.is_finite() && next_hit_at > current_time {
        next_hit_at
    } else {
        current_time + bite_cooldown
    };
    let mut next_breath = next_breath_at;
    let mut next_regen = breath_regen_at;
    let mut breath_capacity = current_breath_capacity.max(0.0);
    let mut chain_stacks = initial_chain_stacks.max(0.0);
    // Burst-model scratch state. The oracle is an OnAvailability what-if
    // projection, so `bursting`/`recast` only carry the chain-reset signal;
    // the full-bar charging state is never entered here.
    let mut breath_bursting = false;
    let mut breath_recast_until = 0.0_f64;
    let mut total = 0.0_f64;

    while time <= horizon_end {
        let next_time = next_hit.min(next_breath).min(next_regen);
        if !next_time.is_finite() {
            break;
        }
        if next_time > horizon_end {
            break;
        }
        if next_time <= time {
            time += 0.001;
            continue;
        }
        time = next_time;

        if time >= next_regen {
            if let Some(breath) = winner_breath {
                if crate::composable::breath::breath_continuous_regen_enabled()
                    && crate::composable::breath::is_standard_breath(breath)
                {
                    // Continuous model folds regen into the next_breath tick;
                    // the discrete regen timer is unused.
                    next_regen = f64::INFINITY;
                } else {
                    breath_capacity = (breath_capacity + simple_breath_capacity_step(breath))
                        .min(breath.capacity.max(0.0));
                    next_regen = f64::INFINITY;
                    next_breath = if breath_capacity > 0.0 {
                        time + simple_breath_tick_sec(breath)
                    } else {
                        f64::INFINITY
                    };
                }
            }
        }

        if time >= next_hit {
            total += melee_damage;
            next_hit = time + bite_cooldown;
        }

        if time >= next_breath {
            if let Some(breath) = winner_breath {
                let burst_std = crate::composable::breath::breath_burst_model_enabled()
                    && crate::composable::breath::is_standard_breath(breath);
                let continuous_std = crate::composable::breath::breath_continuous_regen_enabled()
                    && crate::composable::breath::is_standard_breath(breath);
                if burst_std {
                    // Shared burst stepper (no-clamp drain + chain reset on
                    // stop). Availability semantics: the meter fires whenever
                    // positive and regenerates otherwise.
                    let tick_sec = simple_breath_tick_sec(breath);
                    let fire = crate::composable::breath::breath_burst_fuel_step_availability(
                        time,
                        breath.capacity.max(0.0),
                        breath.regen_rate,
                        tick_sec,
                        &mut breath_capacity,
                        &mut chain_stacks,
                        &mut breath_bursting,
                        &mut breath_recast_until,
                    );
                    if fire {
                        if !matches!(breath.special_kind.as_deref(), Some("heal") | Some("cloud")) {
                            total += compute_simple_breath_damage(
                                winner, loser, breath, &mut chain_stacks,
                            );
                            breath_chain_advance(&mut chain_stacks, breath);
                        }
                        breath_capacity -= simple_breath_capacity_step(breath);
                    }
                    next_breath = time + tick_sec;
                } else if continuous_std && breath_capacity <= 0.0 {
                    // Empty meter: regenerate one tick's worth of fuel, do not
                    // fire, and keep ticking so regen keeps accruing.
                    let max_capacity = breath.capacity.max(0.0);
                    if breath.regen_rate > 0.0 {
                        breath_capacity = (breath_capacity
                            + simple_breath_tick_sec(breath) / breath.regen_rate)
                            .min(max_capacity);
                    }
                    next_breath = time + simple_breath_tick_sec(breath);
                } else if breath_capacity > 0.0 {
                    if !matches!(breath.special_kind.as_deref(), Some("heal") | Some("cloud")) {
                        total +=
                            compute_simple_breath_damage(winner, loser, breath, &mut chain_stacks);
                    }
                    breath_capacity =
                        (breath_capacity - simple_breath_capacity_step(breath)).max(0.0);
                    if !continuous_std && breath_capacity <= 0.0 {
                        next_breath = f64::INFINITY;
                        next_regen = if matches!(
                            breath.special_kind.as_deref(),
                            Some("solar_beam") | Some("spirit_glare")
                        ) {
                            time + breath.auto_fire_cooldown_sec.max(120.0)
                        } else {
                            time + breath.regen_rate.max(0.0)
                        };
                    } else {
                        next_breath = time + simple_breath_tick_sec(breath);
                    }
                } else {
                    next_breath = f64::INFINITY;
                }
            } else {
                next_breath = f64::INFINITY;
            }
        }
    }

    total.max(0.0)
}

/// Reference: `status_heartbroken` - "Heartbroken blocks all healing
/// sources except the creature's natural health regeneration."
///
/// Returns `true` while `Heartbroken_Status` has stacks > 0. Callers
/// at every external-heal site (Heal Breath / Cloud Breath / Miasma
/// self-heal, Healing_Ailment ticks, Life Leech melee + breath,
/// Blessing's Boon ticks) consult this gate and skip the heal when
/// it returns true. Mirrors TS `hasExternalHealingBlock` in
/// `breathSpecialRuntime.ts:24-26`, `hitStatusRuntime.ts:34-36`, and
/// the matching inline checks in `specialEventsRuntime.ts:511` and
/// `statusDotRuntime.ts:90`. Natural passive regen (`handle_simple_regen_with_statuses`)
/// is the documented exception and is NOT gated by this helper.
pub fn is_external_healing_blocked(statuses: &BTreeMap<String, SimpleStatusInstance>) -> bool {
    statuses
        .get("Heartbroken_Status")
        .map(|instance| instance.stacks > 0.0)
        .unwrap_or(false)
}

pub fn hp_regen_multiplier_from_statuses(statuses: &BTreeMap<String, SimpleStatusInstance>) -> f64 {
    let mut multiplier = 1.0_f64;
    // Registry-driven regen modifiers from the catalog. Source of
    // truth: NAME_TO_EFFECT_META.effect -> codegen ->
    // regen_modifier_pct / regen_modifier_per_stack_pct. Adding a
    // new regen-affecting status only needs one row in the TS
    // catalog plus `npm run gen:registry`; no edit to this fn.
    //
    // Flat add_pct examples in the catalog today: Muddy +25,
    // Clean Water +20, Refreshed +5, Bad Omen -25, Disease -25
    // (constant x0.75 regardless of stack count - the game ignores
    // Disease stacks for regen), Bleed -100 (collapses multiplier to
    // 0 - the Bleed "blocks regen" rule expressed as a -100% flat
    // modifier).
    //
    // Per-stack per_stack_pct example: Burn -10/stack. Composed with
    // live stack count and clamped >= 0 so 10 Burn stacks fully zero
    // the multiplier.
    for (status_id, instance) in statuses.iter() {
        // User statuses carry their regen modifier on the spec
        // (flat + per-stack), composed multiplicatively like the built-ins.
        // They're never in the generated registry, so resolve + continue.
        if let Some(spec) = crate::statuses::user_status_spec(status_id) {
            // Phase 9: Expr-resolved override (cached on the instance) wins;
            // None => static base+per-stack formula (byte-identical).
            let pct = instance
                .resolved_scalars
                .as_ref()
                .and_then(|r| r.regen_mod_pct)
                .unwrap_or_else(|| spec.regen_mod_total_pct(instance.stacks.max(0.0)));
            multiplier *= (1.0 + pct / 100.0).max(0.0);
            continue;
        }
        if let Some(pct) = crate::effects_registry::regen_modifier_pct(status_id) {
            multiplier *= 1.0 + pct / 100.0;
        }
        if let Some(per_stack_pct) =
            crate::effects_registry::regen_modifier_per_stack_pct(status_id)
        {
            multiplier *=
                (1.0 + per_stack_pct * instance.stacks.max(0.0) / 100.0).max(0.0);
        }
    }
    // After Item 2 (Sickly + 8 other engine-only statuses got
    // Reference + NAME_TO_EFFECT_META rows), Sickly_Status flows
    // through the registry path above with a -20% healthRegenPct
    // add_pct modifier. No hardcoded regen check remains in this
    // function - the catalog drives every regen modifier.
    multiplier.max(0.0)
}

/// The Oceanwing plushie's lift on an active Muddy, as a factor to fold on top
/// of [`hp_regen_multiplier_from_statuses`].
///
/// The game keeps Muddy's strength on the ailment rather than on the plushie:
/// `DATA_AilmentData.Muddy.OnGet` walks the wearer's plushies and raises the
/// 1.25 multiplier by 0.125 for every Oceanwing it finds. `boost_pct` is that
/// lift measured against Muddy's own bonus and summed over the equipped copies
/// - 50 for one Oceanwing (+25% regen becomes +37.5%), 100 for two (+50%).
///
/// Expressed as the ratio between the boosted and the base Muddy factor so the
/// registry stays the only place Muddy's magnitude is written down, and so the
/// modifier loop above stays purely catalog-driven. Returns exactly 1.0 with
/// no plushie or no Muddy, leaving the unboosted path byte-identical.
fn muddy_strength_boost_factor(
    boost_pct: f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> f64 {
    if boost_pct == 0.0 || !statuses.contains_key("Muddy_Status") {
        return 1.0;
    }
    let Some(base_pct) = crate::effects_registry::regen_modifier_pct("Muddy_Status") else {
        return 1.0;
    };
    let base = 1.0 + base_pct / 100.0;
    if base == 0.0 {
        return 1.0;
    }
    (1.0 + base_pct * (1.0 + boost_pct / 100.0) / 100.0) / base
}

/// Passive-only regen multiplier: statuses (`hp_regen_multiplier_from_statuses`)
/// composed with the Oceanwing lift on Muddy and the Quick Recovery low-HP
/// boost. Active-timer modifiers like
/// Harden 1.25x are intentionally NOT included here - projection callers
/// (`policy_framework::project_policy_window`, `actives::evaluate_*`,
/// `compute_status_aware_breath_extended_damage` via
/// `handle_simple_regen_with_statuses`) consume this narrow form so they stay
/// blind to active-timer state, mirroring TS `computeRegenMultiplier` in
/// `src/engine/regenRuntime.ts:31`. The live composable engine uses
/// `effective_hp_regen_multiplier_with_actives` instead.
pub fn effective_hp_regen_multiplier(
    stats: &SimpleCombatantStats,
    hp: f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> f64 {
    let mut multiplier = hp_regen_multiplier_from_statuses(statuses);
    multiplier *= muddy_strength_boost_factor(stats.muddy_strength_boost_pct, statuses);
    let threshold = stats.quick_recovery_hp_ratio_threshold;
    if threshold > 0.0 {
        let hp_ratio = hp / stats.health.max(1.0);
        // Game (DATA_AilmentData QuickRecovery.OnGet): the boost applies ONLY
        // below the HP gate. Above it there is no boost; below it the multiplier
        // ramps linearly from 1x at the gate down to 2x at 0 HP.
        if hp_ratio < threshold {
            // `.max(lo).min(hi)` coerces NaN to the bound; clamp() would propagate NaN.
            #[allow(clippy::manual_clamp)]
            let progress = ((threshold - hp_ratio) / threshold).max(0.0).min(1.0);
            multiplier *= 1.0 + progress;
        }
    }
    multiplier.max(0.0)
}

/// Active-aware regen multiplier: passive multiplier (statuses + Quick
/// Recovery, clamped non-negative) composed with active-timer modifiers
/// currently in effect. Used by the live composable regen tick. Mirrors TS
/// `handlePassiveRegen` in `src/engine/regenRuntime.ts:74-77`, where
/// `computeRegenMultiplier(...) * hardenMultiplier` is the canonical
/// composition. Projection callers must NOT use this - they intentionally
/// stay blind to active-timer state, matching the TS projection
/// (`src/engine/policyProjectionMath.ts:41, 202, 430` all call
/// `computeRegenMultiplier`, never `handlePassiveRegen`).
///
/// Active modifiers consumed:
/// - Harden: while active, passive regen x 1.25 (Reference: `ability_harden`).
pub fn effective_hp_regen_multiplier_with_actives(
    stats: &SimpleCombatantStats,
    hp: f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
    time: f64,
    harden_active_until: f64,
) -> f64 {
    let mut multiplier = effective_hp_regen_multiplier(stats, hp, statuses);
    if harden_active_until > 0.0 && harden_active_until > time {
        multiplier *= 1.25;
    }
    multiplier
}

pub fn handle_simple_regen_with_statuses(
    time: f64,
    stats: &SimpleCombatantStats,
    hp: &mut f64,
    next_regen_at: &mut f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
) {
    if stats.health_regen <= 0.0 {
        *next_regen_at = f64::INFINITY;
        return;
    }

    while is_regen_tick_due(*next_regen_at, time) {
        if *hp < stats.health {
            let heal =
                (stats.health * stats.health_regen * effective_hp_regen_multiplier(stats, *hp, statuses))
                    / 100.0;
            if heal > 0.0 {
                *hp = (*hp + heal).min(stats.health);
            }
        }
        *next_regen_at += 15.0;
    }
}

/// Advance a breath chain by one landed hit, capped at `chain_max_stacks`.
/// The burst model calls this at the landed-hit site (real loop) and after
/// a fired oracle tick, in place of the in-compute increment. A no-op for
/// non-chain breaths.
pub fn breath_chain_advance(chain_stacks: &mut f64, breath: &SimpleBreathProfile) {
    if breath.chain > 0.0 && breath.chain_max_stacks > 0.0 {
        *chain_stacks = (*chain_stacks + 1.0).min(breath.chain_max_stacks);
    }
}

pub fn compute_simple_breath_damage(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    chain_stacks: &mut f64,
) -> f64 {
    compute_simple_breath_damage_with_statuses(
        attacker,
        defender,
        breath,
        chain_stacks,
        &BTreeMap::new(),
    )
}

pub fn compute_simple_breath_damage_with_statuses(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    chain_stacks: &mut f64,
    defender_statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> f64 {
    compute_simple_breath_damage_with_actor_and_target_statuses(
        attacker,
        defender,
        breath,
        chain_stacks,
        &BTreeMap::new(),
        defender_statuses,
    )
}

pub fn compute_simple_breath_damage_with_actor_and_target_statuses(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    chain_stacks: &mut f64,
    attacker_statuses: &BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> f64 {
    let attacker_weight =
        (attacker.weight * corrosion_weight_multiplier(attacker_statuses)).max(1.0);
    let defender_weight =
        (defender.weight * corrosion_weight_multiplier(defender_statuses)).max(1.0);
    // Breath weight scaling caps the ratio at 3:1, identical to the melee
    // weight formula (`direct_attack_weight_scale`). Without the cap a very
    // heavy attacker against a light target scales breath damage unbounded.
    let weight_ratio_cap = 3.0_f64;
    let weight_ratio = (attacker_weight / defender_weight).min(weight_ratio_cap);
    let defender_max_hp = defender.health.max(1.0);
    let base_damage = (defender_max_hp * (1.0 + weight_ratio)) / 2.0;
    let mut damage = (base_damage / 100.0) * breath.dps_pct;
    // TS (breathHelpersRuntime.ts:51) uses `spec.effect.dps / 2` as the per-hit
    // multiplier when no explicit `perHit` is defined. For Spirit Glare the
    // hardcoded perHit is 1, which equals dps(2)/2. Either way the per-tick
    // damage is (base/100 * dps) * 0.5. lance/heal/cloud go through their own
    // code paths and do not reach this computation.
    if !matches!(
        breath.special_kind.as_deref(),
        Some("lance") | Some("heal") | Some("cloud")
    ) {
        damage *= 0.5;
    }
    damage *= (1.0 - defender.breath_resistance).max(0.0);
    // Global breath pseudo-crit multiplier was 2.0x (so the expected-
    // value factor was `1 + p x (2 - 1) = 1 + p`). 2026-05-19: lowered
    // to 1.5x per user balance pass, making the factor `1 + p x 0.5`.
    // Every breath that previously had `crit_chance_pct > 0` now does
    // less damage by the corresponding amount; reference-test expected
    // values were recomputed in the same commit.
    if breath.crit_chance_pct > 0.0 {
        damage *= 1.0 + (breath.crit_chance_pct / 100.0) * 0.5;
    }
    if breath.chain > 0.0 && breath.chain_max_stacks > 0.0 {
        // The game reads the chain multiplier with the CURRENT stack count and
        // increments afterwards. So the first chained tick uses 0 stacks
        // (1.0x) and the count is bumped after, capped at chain_max_stacks.
        damage *= 1.0 + (breath.chain / 100.0) * *chain_stacks;
        // Under the burst model the increment moves to the landed-hit site
        // (the game increments only on a hit that deals more than 0), so the
        // read here stays pure. With the flag off it advances in place, as before.
        if !crate::composable::breath::breath_burst_model_enabled() {
            breath_chain_advance(chain_stacks, breath);
        }
    }
    // Storming amplifies all incoming damage on the defender, breath included.
    damage *= (1.0 + incoming_damage_pct_from_statuses(defender_statuses) / 100.0).max(0.0);
    // Guilt reduces all incoming direct damage in-game (Guilt.OnDamage -> x0.5),
    // so it halves breath too, not just bites (the bite side lives in
    // `damage_taken_multiplier_on_being_bitten`). 1.0 = no reduction.
    damage *= defender.damage_taken_multiplier_on_breath.max(0.0);
    damage.max(0.0)
}

pub fn current_simple_bite_cooldown_with_statuses(
    stats: &SimpleCombatantStats,
    attacker_hp: f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> f64 {
    // Compare-only Fixed Bite Cadence: bypasses all
    // status and berserk modifiers. Mirrors TS currentBiteCooldown early-return.
    if stats.compare_air_rule_cooldown_sec > 0.0 && stats.compare_air_rule_cooldown_sec.is_finite() {
        return stats.compare_air_rule_cooldown_sec.max(0.1);
    }
    // Each status that targets BiteCooldown takes the running cooldown and hands
    // back its own multiple of it, so two of them compound rather than add.
    // Sticky Teeth and Drowsy are flat whatever their stack count; Frostbite is
    // the one that scales, and it scales on the stack count itself.
    let mut multiplier = 1.0_f64;
    if statuses.contains_key("Sticky_Teeth_Status") {
        multiplier *= 1.65;
    }
    if statuses.contains_key("Drowsy_Status") {
        multiplier *= 1.35;
    }
    if let Some(frostbite) = statuses.get("Frostbite_Status") {
        let stacks = frostbite.stacks.max(0.0);
        multiplier *= 1.0 + FROSTBITE_BITE_COOLDOWN_INCREASE_PCT_PER_STACK / 100.0 * stacks;
    }
    // User-status bite-cooldown multipliers (1.0 = neutral)
    // compose multiplicatively onto the cooldown, alongside berserk below.
    for (status_id, instance) in statuses.iter() {
        if let Some(spec) = crate::statuses::user_status_spec(status_id) {
            let mult = instance
                .resolved_scalars
                .as_ref()
                .and_then(|r| r.bite_cooldown_mult)
                .unwrap_or(spec.bite_cooldown_mult);
            multiplier *= mult;
        }
    }
    // Berserk is a passive conditional modifier, not a new active cast.
    // Necropoison blocks ability activations, but it must not suppress passive
    // effects that are already implied by current HP/status state.
    if stats.berserk_hp_ratio_threshold > 0.0
        && stats.berserk_bite_cooldown_multiplier > 0.0
        && (attacker_hp / stats.health.max(1.0)) < stats.berserk_hp_ratio_threshold
    {
        multiplier *= stats.berserk_bite_cooldown_multiplier;
    }
    (stats.bite_cooldown * multiplier).max(0.1)
}
