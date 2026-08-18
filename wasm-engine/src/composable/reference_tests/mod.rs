//! Reference Phase 2 test home: one submodule per Reference entry.
//!
//! Each `<entry_id>.rs` (without the `ability_` / `status_` / etc. prefix)
//! covers one entry from `src/pages/referenceContent.ts`. Tests live next
//! to nothing else - they do not co-mingle with the engine integration
//! suite in `composable/tests.rs`.
//!
//! Adding a new entry
//!
//! 1. Run `npx tsx tools/scaffold_reference_test.ts <entry_id>` from the
//!    repo root. This creates the file, registers the `mod` line below,
//!    and seeds the file with a marker comment + helper imports.
//! 2. Replace the TODOs with real assertions. Each test body must contain
//!    `// [REF:<entry_id>]` so the vitest coverage gate finds it. The gate
//!    reads that marker only from a file that asserts something, so a body
//!    carrying nothing but the marker leaves the entry uncovered - if there
//!    is genuinely nothing to assert here, do not add the file at all.
//! 3. Remove `<entry_id>` from `src/pages/referenceCoverage.baseline.json`.
//!
//! Plushie and ability entries are diffed against the decompiled game facts
//! in `src/pages/referenceContent.{plushies,abilities}.oracle.ts` instead,
//! one rule across all entries rather than one file each, and the gate reads
//! the ids those rules compared a number on.
//!
//! Helpers
//!
//! Use the builders below instead of hand-spelling every field of the
//! contracts structs. Adding a new field to `SimpleCombatantStats` etc.
//! must not force every Reference test to be touched.

#![allow(dead_code)]

use crate::contracts::{SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats};

/// A neutral combatant: 1000 HP, 100 weight, 50 damage, 2.0 s bite, no
/// passive abilities or status interactions. Mutate fields after the call
/// to set up the specific scenario.
pub fn default_combatant() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: 1000.0,
        weight: 100.0,
        damage: 50.0,
        bite_cooldown: 2.0,
        ..Default::default()
    }
}

/// A breath profile with no damage, no statuses, no special kind. Set
/// `dps_pct`, `capacity`, `regen_rate`, `crit_chance_pct`, and
/// `special_statuses` to describe the specific breath under test.
pub fn default_breath() -> SimpleBreathProfile {
    SimpleBreathProfile {
        dps_pct: 0.0,
        capacity: 0.0,
        regen_rate: 0.0,
        crit_chance_pct: 0.0,
        chain: 0.0,
        chain_max_stacks: 0.0,
        special_kind: None,
        special_statuses: vec![],
        self_heal_pct: 0.0,
        cleanse_stacks: 0.0,
        lance_charge_sec: 0.0,
        lance_damage_pct: 0.0,
        lance_cooldown_sec: 0.0,
        lance_status_id: None,
        auto_fire_delay_sec: 0.0,
        auto_fire_cooldown_sec: 0.0,
        charges_max: 0.0,
        charge_regen_sec: 0.0,
    }
}

pub fn applied_status(status_id: &str, stacks: f64) -> SimpleAppliedStatus {
    SimpleAppliedStatus {
        status_id: status_id.to_string(),
        stacks,
        ..Default::default()
    }
}

/// What the target carries after exactly one tick of `breath`. A breath states
/// its secondary payload per damage tick, so a single tick is what that number
/// has to be read against - after two the answer is the sum, and after enough
/// of them decay has taken a bite out of it.
pub fn stacks_from_one_breath_tick(
    breath: &SimpleBreathProfile,
) -> std::collections::BTreeMap<String, f64> {
    use super::config::ComposableAbilityConfig;
    use super::sandbox::{SandboxAutomationMode, SandboxRuntime, SandboxSide};
    use crate::contracts::SimpleAbilityTimingMode;

    let mut side = default_combatant();
    // Neither side acts on its own: the forced breath is the only event, so
    // nothing else can put stacks on the target.
    side.health = 10_000_000.0;
    side.damage = 0.0;
    side.bite_cooldown = 1_000.0;
    let mut rt = SandboxRuntime::new(
        side.clone(),
        side,
        Some(breath.clone()),
        None,
        ComposableAbilityConfig::default(),
        SimpleAbilityTimingMode::Ideal,
        SandboxAutomationMode::Manual,
        120.0,
        // The forced breath stops on the tick counter, which the engine only
        // keeps while it is tracing.
        true,
    );
    rt.force_breath(SandboxSide::A);
    rt.snapshot_view()
        .side_b
        .statuses
        .iter()
        .map(|s| (s.id.clone(), s.stacks))
        .collect()
}

/// Assert the tick handed the target `expected` stacks of `status_id`.
pub fn assert_tick_stacks(
    applied: &std::collections::BTreeMap<String, f64>,
    status_id: &str,
    expected: f64,
) {
    let got = applied.get(status_id).copied().unwrap_or(0.0);
    assert!(
        (got - expected).abs() < 1e-9,
        "one damage tick must apply {expected} stacks of {status_id}, got {got}"
    );
}

/// Appetite units each meter loses over one plain drain interval while the
/// given statuses are on the side. With nothing applied both come back 1.0, so
/// a status that stretches its interval reads as the fraction of a unit it now
/// costs.
pub fn meter_drain_over_one_interval(status_ids: &[&str]) -> (f64, f64) {
    use crate::compare_hunger::COMPARE_METER_DRAIN_UNITS_PER_SEC;
    use crate::composable::side::CombatSide;
    use crate::composable::status_helpers::advance_side_hunger;
    use crate::contracts::SimpleStatusInstance;

    let mut side = CombatSide::new(&default_combatant(), None);
    side.compare_hunger_rule_enabled = true;
    side.compare_appetite_base = 1_000.0;
    side.compare_hunger = 1_000.0;
    side.compare_thirst = 1_000.0;
    for status_id in status_ids {
        side.statuses.insert(
            (*status_id).to_string(),
            SimpleStatusInstance {
                stacks: 1.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 1_000.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: true,
                resolved_scalars: None,
            },
        );
    }
    advance_side_hunger(&mut side, 1.0 / COMPARE_METER_DRAIN_UNITS_PER_SEC);
    (1_000.0 - side.compare_hunger, 1_000.0 - side.compare_thirst)
}

mod ability_payload_stacks;
mod acid_breath;
mod acid_rain;
mod heliolyths_judgement;

mod adrenaline;

mod aerial_dodge;

mod ailment_block;

mod aura;
mod berserk;
mod breath_resistance;
mod broodwatcher;
mod cause_fear;
mod cloud_breath;
mod crystal_breath;
mod cursed_sigil;
mod divination;

mod drowsy_area;
mod fire_breath;

mod energy_breath;
mod expunge;
mod first_strike;
mod flame_trail;
mod fortify;
mod frost_nova;
mod frost_snare;
mod frost_trail;
mod glacier_breath;
mod gold_breath;
mod green_fire_breath;
mod grim_lariat;
mod guilt;
mod harden;
mod haunt_breath;
mod heal_breath;
mod healing_step;
mod hunker;
mod hunters_curse;
mod ice_breath;
mod lance;
mod lich_mark;
mod life_leech;
mod ligament_tear;
mod lightning_breath;
mod miasma_breath;
mod plague_breath;
mod plague_trail;
mod plasma_beam;
mod quick_recovery;
mod radiation;
mod reflect;
mod reflux;
mod toxic_trail;

mod rewind;
mod rock_breath;
mod sand_breath;
mod secondary_attack;
mod self_destruct;
mod serrated_teeth;
mod shadow_barrage;
mod solar_beam;
mod spirit_glare;
mod spite;
mod sticky_fur;
mod timing_modes;
mod sticky_trap;
mod storming;
mod storm_breath;
mod thorn_trap;
mod totem;
mod tracked_only_statuses;
mod toxic_trap;
mod toxin_breath;

mod aggressive;
mod bad_omen;
mod bleed;
mod blessings_boon;
mod burn;
mod clean_water;
mod corrosion;
mod darkstar;
mod deep_wounds;
mod defiled_ground;
mod disease;
mod drowsy;
mod engine_status_registry_parity;
mod fear;
mod first_tick_rule;
mod frostbite;
mod gore_charge;
mod gourmandizer;
mod head_start;
mod head_start_adversarial;
mod healing_ailment;
mod healing_pulse;
mod heartbroken;
mod heat_wave;
mod hypothermia;
mod injury;
mod malices_mark;
mod aftershock;
mod ashy_lungs;
mod broken_bones;
mod broken_legs;
mod muddy;
mod paralyze;
mod scared;
mod scared_bear;
mod sickly;
mod natural_regen;
mod necropoison;
mod no_move_facetank;
mod oxygen_moisture;
mod oceanwing;
mod poison;
mod plushie_weakness;
mod poison_area;
mod power_charge;
mod refreshed;
mod shredded_wings;
mod special_air_pvp_rule;
mod spite_ready_at_start;
mod sticky_teeth;
mod torn_ligaments;
mod unbreakable;
mod unbridled_rage;
mod use_hunger_rules;
mod virus_breath;
mod wardens_rage;
mod wardens_resistance;
mod water_breath;
mod wing_shredder;
mod yolk_bomb;

mod guardians_passage;
mod guardians_seal;

mod hungry;
mod satiated;
mod territory;
mod thirsty;

mod newborn;
mod reflect_response;
mod spring_water;
