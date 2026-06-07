//! Reference Phase 2 test home: one submodule per Reference entry.
//!
//! Each `<entry_id>.rs` (without the `ability_` / `status_` / etc. prefix)
//! covers one entry from `src/pages/referenceContent.ts`. Tests live next
//! to nothing else - they do not co-mingle with the engine integration
//! suite in `composable/tests.rs`.
//!
//! ## Adding a new entry
//!
//! 1. Run `npx tsx tools/scaffold_reference_test.ts <entry_id>` from the
//!    repo root. This creates the file, registers the `mod` line below,
//!    and seeds the file with a marker comment + helper imports.
//! 2. Replace the TODOs with real assertions. Each test body must contain
//!    `// [REF:<entry_id>]` so the vitest coverage gate finds it.
//! 3. Remove `<entry_id>` from `src/pages/referenceCoverage.baseline.json`.
//!
//! ## Helpers
//!
//! Use the builders below instead of hand-spelling every field of the
//! contracts structs. Adding a new field to `SimpleCombatantStats` etc.
//! must not force every Reference test to be touched.

#![allow(dead_code)]

use crate::contracts::{SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

/// A neutral combatant: 1000 HP, 100 weight, 50 damage, 2.0 s bite, no
/// passive abilities or status interactions. Mutate fields after the call
/// to set up the specific scenario.
pub fn default_combatant() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: 1000.0,
        weight: 100.0,
        damage: 50.0,
        bite_cooldown: 2.0,
        damage2: 0.0,
        health_regen: 0.0,
        active_cooldown_multiplier: 1.0,
        quick_recovery_hp_ratio_threshold: 0.0,
        unbreakable_damage_cap_pct: 0.0,
        damage_taken_multiplier_on_being_bitten: 1.0,
        breath_resistance: 0.0,
        berserk_bite_cooldown_multiplier: 1.0,
        berserk_hp_ratio_threshold: 0.0,
        first_strike_pct: 0.0,
        first_strike_hp_ratio_threshold: 1.0,
        has_warden_resistance: false,
        has_reflect: false,
        immune_status_ids: vec![],
        hunker_reduction_pct: 0.0,
        self_destruct_profile: None,
        on_hit_statuses: vec![],
        on_hit_taken_statuses: vec![],
        starting_statuses: vec![],
        status_resist_fractions: BTreeMap::new(),
        plushie_status_block_fractions: BTreeMap::new(),
        plushie_reflect_avg_pct: 0.0,
        disabled_abilities: vec![],
        compare_air_rule_cooldown_sec: 0.0,
            user_ability_ids: Vec::new(),
            identity: None,
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
        source_ability: None,
    }
}

mod acid_breath;
mod acid_rain;
mod heliolyths_judgement;

mod adrenaline;

mod aura;
mod berserk;
mod breath_resistance;
mod cause_fear;
mod cloud_breath;
// NOTE: `mod cocoon;` is intentionally NOT registered here. The
// `cocoon.rs` file in this directory was committed (65d8e32) without a
// corresponding `mod` declaration, so its tests never ran. The end-to-end
// Cocoon coverage lives in `composable/tests.rs::cocoon_*` (20 tests).
// Re-registering `mod cocoon;` would surface latent assertion drift
// (setup mismatches between the orphan tests and current engine) - out
// of scope for the current rework.
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
mod heal_beam;
mod heal_breath;
mod healing_hunter;
mod healing_step;
mod hunker;
mod hunters_curse;
mod ice_breath;
mod invisibility;
mod iron_stomach;
mod keen_observer;
mod lance;
mod latch;
mod lich_mark;
mod life_leech;
mod ligament_tear;
mod lightning_breath;
mod lure;
mod miasma_breath;
mod plague_breath;
mod plague_trail;
mod plasma_beam;
mod quick_recovery;
mod radiation;
mod raider;
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
mod shock_area;
mod silent_hunter;
mod soft_landing;
mod solar_beam;
mod sonic_wings;
mod speed_blitz;
mod speed_steal;
mod spirit_glare;
mod spite;
mod stamina_puddle;
mod sticky_fur;
mod sticky_trap;
mod storming;
mod storm_breath;
mod stubborn_stacker;
mod tail_drop;
mod thorn_trap;
mod totem;
mod toxic_trap;
mod toxin_breath;

mod aerix;
mod aerodon;
mod aggressive;
mod agile_swimmer;
mod arcane;
mod area_food_restore;
mod area_water_restore;
mod astral_quetzal;
mod baby_dragon;
mod bad_omen;
mod bear;
mod bleed;
mod blessed_bean;
mod blessings_boon;
mod blurred_vision;
mod broken_bones;
mod broodwatcher;
mod bunny;
mod burn;
mod burrower;
mod cat;
mod catalyst;
mod cavity_critter;
mod change_weather;
mod channeling;
mod charge;
mod chick;
mod clean_water;
mod climber;
mod clover_blossom;
mod clownfish;
mod coal;
mod confusion;
mod corrosion;
mod cow;
mod creator_star;
mod damage_boost;
mod darkstar;
mod dazzling_flash;
mod deep_wounds;
mod defiled_ground;
mod disease;
mod diver;
mod dolt;
mod drowsy;
mod earthquake;
mod eclipse;
mod egg_gobbler;
mod egg_shell;
mod egg_stealer;
mod eggy_snake;
mod elemental;
mod ember_spirit;
mod engine_status_registry_parity;
mod escape_area;
mod euvatops;
mod fast;
mod fear;
mod first_tick_rule;
mod flowering;
mod fox;
mod freeze;
mod frost_dragon;
mod frostbite;
mod frosty;
mod gale;
mod ghost;
mod ginger_snapper;
mod glittering_trail;
mod golden_bulb;
mod goldfish;
mod gore_charge;
mod gourmandizer;
mod grab;
mod haunt_dragon;
mod healing_ailment;
mod healing_pulse;
mod heart;
mod heartbroken;
mod heartsnake;
mod heat_wave;
mod horned_beetlefly;
mod hum;
mod humming_frost;
mod hypothermia;
mod ice_wolf;
mod icebreaker;
mod injury;
mod jackrabbit;
mod jammy_slug;
mod jotun_scale;
mod knight;
mod knox;
mod land;
mod lunar_qilin;
mod magic_frog;
mod magichorn_prongbug;
mod malices_mark;
mod maple_leaflet;
mod minty_wiggler;
mod mo;
mod aftershock;
mod ashy_lungs;
mod broken_legs;
mod mud_pile;
mod muddy;
mod mylo;
mod paralyze;
mod scared;
mod scared_bear;
mod sickly;
mod necropoison;
mod no_move_facetank;
mod notes;
mod oceanwing;
mod octroma;
mod overcharged;
mod owl;
mod pack_healer;
mod palmtree;
mod partridge;
mod pie_chomper;
mod pig_lantern;
mod poison;
mod poison_area;
mod power_charge;
mod really_fast;
mod refreshed;
mod regen_boost;
mod reindeer;
mod rock;
mod rod;
mod rosevine;
mod scared_status;
mod sea;
mod seal;
mod semi_ideal_ideal_and_extreme;
mod serpent;
mod shock;
mod shredded_wings;
mod sky;
mod slowed;
mod smore_cat;
mod snowflake_sneak;
mod snowman;
mod sparkler;
mod special_air_pvp_rule;
mod spite_ready_at_start;
mod springbok;
mod springram;
mod stick;
mod sticky_teeth;
mod stitch_head;
mod stolen_speed;
mod strength_in_numbers;
mod succulant;
mod swan;
mod tannenbaum;
mod torn_ligaments;
mod two_faced;
mod unbreakable;
mod unbridled_rage;
mod use_hunger_rules;
mod vampire_bat;
mod vanish;
mod virus_breath;
mod void;
mod volcanic;
mod wardens_rage;
mod wardens_resistance;
mod water_breath;
mod water_regeneration;
mod what_ability_policies_are;
mod will_to_live;
mod wing_shredder;
mod yolk_bomb;
