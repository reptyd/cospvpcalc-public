//! Reference: compare_defiled_ground
//!
//! Defiled Ground is split across layers:
//!
//! - HP / weight bonuses are applied at TS build time
//!   (`src/engine/compareDefiledGroundData.ts`) before
//!   `SimpleCombatantStats` crosses the WASM boundary; the Rust engine
//!   receives those values already baked into `health` / `weight`.
//!
//! - Hunger drain reduction (20/50/80% at level 1/2/3) lives in Rust at
//!   `wasm-engine/src/compare_hunger.rs`
//!   (`defiled_ground_consumption_multiplier`). The +20% opponent-Weakness
//!   bump now rides on the Sickly ailment: Defiled Ground seeds a permanent
//!   Sickly on the afflicted side and `advance_side_hunger` reads its
//!   presence, rather than a hardcoded setup flag. Sickly also carries the
//!   -20% HealthRegen penalty (game DefiledSickly, one ailment, every stat).
//!
//! - Ailment recovery is realized in the Rust composable engine as a
//!   sit/lay-gated per-tick strip multiplier on the recoverable-ailment
//!   set (x1.10 / x1.20 / x1.30 at level 1 / 2 / 3), composed
//!   multiplicatively with the posture decay speed-up and the Darkstar
//!   plushie. See `CombatSide::recoverable_recovery_mult` and the strip
//!   seam in `statuses.rs`.
//!
//! Each test body starts with the [REF:compare_defiled_ground]
//! marker so the vitest coverage gate sees it.

use crate::compare_hunger::{
    defiled_ground_owner_drain_multiplier, DEFILED_GROUND_INTERVAL_LEVEL_1,
    DEFILED_GROUND_INTERVAL_LEVEL_2, DEFILED_GROUND_INTERVAL_LEVEL_3,
};
use crate::composable::posture::Posture;
use crate::composable::reference_tests::{default_breath, default_combatant};
use crate::composable::side::CombatSide;
use crate::contracts::SimpleStatusInstance;
use std::collections::BTreeMap;

#[test]
fn the_three_levels_stretch_the_drain_interval() {
    // [REF:compare_defiled_ground]
    // "If Use hunger rules is enabled, the user also uses 16.7% / 33.3% /
    // 44.4% less hunger or thirst depending on the selected level. The game
    // states this as a longer interval between appetite units - 1.2x / 1.5x /
    // 1.8x - so a 1.5x interval is a third less consumed, not a half."
    for (level, interval) in [
        (1, DEFILED_GROUND_INTERVAL_LEVEL_1),
        (2, DEFILED_GROUND_INTERVAL_LEVEL_2),
        (3, DEFILED_GROUND_INTERVAL_LEVEL_3),
    ] {
        let got = defiled_ground_owner_drain_multiplier(level);
        assert!(
            (got - 1.0 / interval).abs() < 1e-9,
            "level {level} must drain at 1/{interval}: got {got}"
        );
    }
    // The reduction is the reciprocal, not the interval read as a percentage.
    let lvl2_reduction_pct = (1.0 - defiled_ground_owner_drain_multiplier(2)) * 100.0;
    assert!(
        (lvl2_reduction_pct - 100.0 / 3.0).abs() < 1e-6,
        "level 2 must consume a third less, not a half: got {lvl2_reduction_pct}%"
    );
}

#[test]
fn no_contaminated_land_leaves_the_drain_alone() {
    // [REF:compare_defiled_ground]
    // "Both halves need the user to own Defiled Ground. A creature that does
    // not takes no contaminated-land bonus, and its opponent takes no Sickly."
    assert_eq!(defiled_ground_owner_drain_multiplier(0), 1.0);
}

#[test]
fn sickly_presence_drives_the_weakness_hunger_bump() {
    // [REF:compare_defiled_ground]
    // "Sickly also makes the opponent use 25% more hunger or thirst - the game
    // multiplies the seconds-per-unit interval by 0.8." The bump rides on the
    // ailment: a side carrying Sickly drains exactly 1/0.8 faster than the same
    // side without it, and it reaches the drain through the status registry
    // rather than a flag read at the call site.
    use crate::composable::status_helpers::advance_side_hunger;

    fn drain(sickly_present: bool) -> f64 {
        let stats = default_combatant();
        let mut side = CombatSide::new(&stats, None);
        side.compare_hunger_rule_enabled = true;
        side.compare_appetite_base = 100.0;
        side.compare_hunger = 100.0;
        side.last_hunger_update_at = 0.0;
        if sickly_present {
            side.statuses.insert(
                "Sickly_Status".to_string(),
                SimpleStatusInstance {
                    stacks: 1.0,
                    next_tick_at: None,
                    next_decay_at: None,
                    remaining_sec: 100.0,
                    stack_value_mode: None,
                    lich_mark_owned_stacks: None,
                    no_decay: true,
                    resolved_scalars: None,
                },
            );
        }
        advance_side_hunger(&mut side, 10.0);
        100.0 - side.compare_hunger
    }
    let with_sickly = drain(true);
    let without = drain(false);
    assert!(without > 0.0, "baseline must drain something to compare against");
    assert!(
        (with_sickly / without - 1.0 / 0.8).abs() < 1e-6,
        "Sickly must raise hunger drain by exactly 25%: with={with_sickly}, without={without}"
    );
}

// --- Ailment recovery (sit/lay-gated, Rust-native) -------------------------

fn fresh_side() -> CombatSide {
    let stats = default_combatant();
    let breath = default_breath();
    CombatSide::new(&stats, Some(&breath))
}

fn settle(side: &mut CombatSide, posture: Posture) {
    side.posture_current = posture;
    side.posture_pending = posture;
}

/// Seed a single Poison instance armed to decay one window at `t = 3.0`,
/// then advance status durations once with the given recovery multiplier
/// and return the number of stacks stripped in that single window.
fn poison_strip_for(recovery_mult: f64) -> f64 {
    let start_stacks = 50.0;
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert(
        "Poison_Status".to_string(),
        SimpleStatusInstance {
            stacks: start_stacks,
            next_tick_at: Some(6.0), // beyond `time`, so the DOT-tick defer gate is inert
            next_decay_at: Some(3.0),
            remaining_sec: start_stacks * 3.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        },
    );
    // Posture speed-up disabled (1.0) so we isolate the recovery factor:
    // strip == recovery_mult for the single decay window crossed at t = 3.0.
    crate::statuses::update_simple_status_durations_full(
        3.0,
        &mut statuses,
        false,
        None,
        1.0,
        recovery_mult,
    );
    let remaining = statuses.get("Poison_Status").map(|s| s.stacks).unwrap_or(0.0);
    start_stacks - remaining
}

#[test]
fn defiled_ground_l3_accelerates_poison_recovery_only_while_laying() {
    // [REF:compare_defiled_ground]
    // Laying + Defiled Ground L3 -> recovery x1.30; standing -> no bonus.
    let mut laying = fresh_side();
    settle(&mut laying, Posture::Laying);
    laying.compare_defiled_ground_level = 3;
    let lay_mult = laying.recoverable_recovery_mult();
    assert!((lay_mult - 1.30).abs() < 1e-9, "laying L3 recovery must be 1.30: got {lay_mult}");

    let mut standing = fresh_side();
    standing.compare_defiled_ground_level = 3;
    let stand_mult = standing.recoverable_recovery_mult();
    assert!(
        (stand_mult - 1.0).abs() < 1e-9,
        "standing must get no recovery bonus even at L3: got {stand_mult}"
    );

    // The strip seam must actually move more stacks while laying.
    let lay_strip = poison_strip_for(lay_mult);
    let stand_strip = poison_strip_for(stand_mult);
    assert!(
        (lay_strip - 1.30).abs() < 1e-9,
        "laying L3 must strip 1.30 stacks per Poison window: got {lay_strip}"
    );
    assert!(
        (stand_strip - 1.0).abs() < 1e-9,
        "standing must strip the plain 1.0 stack per window: got {stand_strip}"
    );
    assert!(lay_strip > stand_strip, "laying must clear Poison faster than standing");
}

#[test]
fn darkstar_flag_accelerates_poison_recovery_while_laying() {
    // [REF:compare_defiled_ground] (Darkstar plushie, engine-native flag)
    // Laying + Darkstar (no Defiled Ground) -> recovery x1.25.
    let mut laying = fresh_side();
    settle(&mut laying, Posture::Laying);
    laying.compare_dark_star = true;
    let mult = laying.recoverable_recovery_mult();
    assert!((mult - 1.25).abs() < 1e-9, "laying Darkstar recovery must be 1.25: got {mult}");
    let strip = poison_strip_for(mult);
    assert!((strip - 1.25).abs() < 1e-9, "Darkstar must strip 1.25 stacks per window: got {strip}");
}

#[test]
fn defiled_ground_and_darkstar_compose_multiplicatively() {
    // [REF:compare_defiled_ground]
    // Laying + Defiled Ground L3 (x1.30) + Darkstar (x1.25) -> x1.625.
    let mut laying = fresh_side();
    settle(&mut laying, Posture::Laying);
    laying.compare_defiled_ground_level = 3;
    laying.compare_dark_star = true;
    let mult = laying.recoverable_recovery_mult();
    assert!(
        (mult - 1.30 * 1.25).abs() < 1e-9,
        "L3 + Darkstar must compose to 1.30 × 1.25 = 1.625: got {mult}"
    );
    let strip = poison_strip_for(mult);
    assert!(
        (strip - 1.625).abs() < 1e-9,
        "composed factor must strip 1.625 stacks per window: got {strip}"
    );
}

#[test]
fn standing_creature_with_dg_and_darkstar_gets_no_acceleration() {
    // [REF:compare_defiled_ground]
    // The bonus is sit/lay-gated: a standing side with BOTH sources still
    // gets x1.0, leaving the strip rate byte-identical with the off-path.
    let mut standing = fresh_side();
    standing.compare_defiled_ground_level = 3;
    standing.compare_dark_star = true;
    let mult = standing.recoverable_recovery_mult();
    assert!((mult - 1.0).abs() < 1e-9, "standing must get no acceleration: got {mult}");
    let strip = poison_strip_for(mult);
    assert!((strip - 1.0).abs() < 1e-9, "standing must strip the plain 1.0 stack: got {strip}");
}

#[test]
fn recovery_bonus_only_touches_the_recoverable_set_not_other_ailments() {
    // [REF:compare_defiled_ground]
    // Shock is a negative ailment but NOT Defiled-Ground-recoverable, so
    // the recovery multiplier must leave its strip rate at 1.0 even while
    // laying with both sources active.
    let start_stacks = 20.0;
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert(
        "Shock_Status".to_string(),
        SimpleStatusInstance {
            stacks: start_stacks,
            next_tick_at: Some(6.0),
            next_decay_at: Some(3.0),
            remaining_sec: start_stacks * 3.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        },
    );
    // Posture decay 1.0, recovery 1.625 (L3 + Darkstar) - but Shock is not
    // in the recoverable set, so the recovery factor is a no-op for it.
    crate::statuses::update_simple_status_durations_full(3.0, &mut statuses, false, None, 1.0, 1.625);
    let remaining = statuses.get("Shock_Status").map(|s| s.stacks).unwrap_or(0.0);
    assert!(
        ((start_stacks - remaining) - 1.0).abs() < 1e-9,
        "non-recoverable Shock must strip exactly 1.0 stack regardless of recovery factor: stripped {}",
        start_stacks - remaining
    );
}
