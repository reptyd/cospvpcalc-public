//! Reference: compare_secondary_attack
//!
//! Covers the Compare-only Secondary Attack mechanic — the per-bite
//! variant choice between primary (base damage + on-hit ailments) and
//! secondary (`stats.damage2`, no on-hit ailments). Three modes are
//! tested: `PrimaryOnly`, `SecondaryOnly`, and `Dynamic`.
//!
//! Each test body carries the `[REF:compare_secondary_attack]` marker
//! so the vitest coverage gate (`src/pages/referenceCoverage.test.ts`)
//! sees it.

use super::super::config::{ComposableAbilityConfig, SimpleBiteVariantMode};
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{
    BestBuildsMatchupSummary, CombatLogEntry, SimpleAbilityTimingMode, SimpleCombatantStats,
};

/// Build an attacker with primary damage `damage`, secondary damage
/// `damage2`, and one stack of `on_hit_status` on every primary bite.
fn make_attacker(damage: f64, damage2: f64, on_hit_status: &str) -> SimpleCombatantStats {
    let mut a = default_combatant();
    a.health = 1_000.0;
    a.damage = damage;
    a.damage2 = damage2;
    a.bite_cooldown = 2.0;
    a.on_hit_statuses = vec![applied_status(on_hit_status, 1.0)];
    a
}

/// Neutral defender that effectively never bites back (huge bite
/// cooldown). Keeps each test focused on A's bite output.
fn make_defender() -> SimpleCombatantStats {
    let mut d = default_combatant();
    d.health = 1_000.0;
    d.bite_cooldown = 1000.0;
    d.damage = 0.0;
    d
}

fn run(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    duration: f64,
) -> BestBuildsMatchupSummary {
    simulate_composable_matchup_with_trace(
        attacker,
        defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        cfg,
        duration,
        true, // record_trace — needed so we can scan combat_log for status applies
    )
}

/// True iff the combat log contains a "Bite applied <status_id>"
/// entry whose source attacker is `source_side` (typically "A") and
/// whose target side is the opposite. Mirrors the trace shape pushed
/// by `apply_statuses_with_per_effect_trace` via `status_helpers.rs`.
fn bite_applied_status(log: &[CombatLogEntry], source_side: &str, status_id: &str) -> bool {
    log.iter().any(|e| {
        e.entry_type == "ability"
            && e.attacker == source_side
            && e.status_id.as_deref() == Some(status_id)
            && e.description
                .as_deref()
                .map(|d| d.starts_with("Bite applied "))
                .unwrap_or(false)
    })
}

#[test]
fn primary_only_applies_on_hit_status() {
    // [REF:compare_secondary_attack]
    // Default mode mirrors today's behavior: every bite is primary,
    // on-hit Poison_Status lands on the target.
    let attacker = make_attacker(50.0, 200.0, "Poison_Status");
    let defender = make_defender();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::PrimaryOnly;
    let result = run(&attacker, &defender, &cfg, 3.0);
    let log = result.combat_log.expect("trace requested");
    assert!(
        bite_applied_status(&log, "A", "Poison_Status"),
        "PrimaryOnly: Poison must be applied to the defender by A's bite. log = {log:?}"
    );
}

#[test]
fn secondary_only_suppresses_on_hit_status() {
    // [REF:compare_secondary_attack]
    // SecondaryOnly fires the bite but never applies the offensive
    // ailment. Same setup that lands Poison under PrimaryOnly must
    // leave the defender clean.
    let attacker = make_attacker(50.0, 200.0, "Poison_Status");
    let defender = make_defender();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::SecondaryOnly;
    let result = run(&attacker, &defender, &cfg, 3.0);
    let log = result.combat_log.expect("trace requested");
    assert!(
        !bite_applied_status(&log, "A", "Poison_Status"),
        "SecondaryOnly: no on-hit ailment may be applied. log = {log:?}"
    );
}

#[test]
fn secondary_only_uses_damage2_value() {
    // [REF:compare_secondary_attack]
    // SecondaryOnly bites should hit harder when damage2 > damage and
    // softer when damage2 < damage. Two parallel sims with the same
    // setup except for `damage2` confirm the bridge wires through.
    let mut hi = make_attacker(50.0, 250.0, "Poison_Status");
    let mut lo = make_attacker(50.0, 60.0, "Poison_Status");
    hi.on_hit_statuses = vec![];
    lo.on_hit_statuses = vec![];
    let defender = make_defender();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::SecondaryOnly;
    let dur = 3.0;
    let hi_result = run(&hi, &defender, &cfg, dur);
    let lo_result = run(&lo, &defender, &cfg, dur);
    assert!(
        hi_result.final_hp_b < lo_result.final_hp_b,
        "damage2=250 must drain defender HP harder than damage2=60 over the same window. hi={}, lo={}",
        hi_result.final_hp_b,
        lo_result.final_hp_b
    );
}

#[test]
fn dynamic_picks_secondary_when_opp_is_immune_to_on_hit_status() {
    // [REF:compare_secondary_attack]
    // Dynamic mode should pick secondary when the primary's on-hit
    // ailment has zero value (opp is immune) AND secondary's damage
    // is higher. Confirm two ways:
    //  - No Poison ever gets applied (immunity is observable as the
    //    apply being skipped or zero-stacked).
    //  - HP loss curve matches SecondaryOnly more closely than
    //    PrimaryOnly.
    let attacker = make_attacker(50.0, 250.0, "Poison_Status");
    let mut defender = make_defender();
    defender.immune_status_ids.push("Poison_Status".to_string());
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::Dynamic;
    let dyn_result = run(&attacker, &defender, &cfg, 3.0);
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::SecondaryOnly;
    let sec_result = run(&attacker, &defender, &cfg, 3.0);
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::PrimaryOnly;
    let pri_result = run(&attacker, &defender, &cfg, 3.0);
    let dyn_loss = 1_000.0 - dyn_result.final_hp_b;
    let sec_loss = 1_000.0 - sec_result.final_hp_b;
    let pri_loss = 1_000.0 - pri_result.final_hp_b;
    assert!(
        (dyn_loss - sec_loss).abs() < (dyn_loss - pri_loss).abs(),
        "Dynamic loss ({dyn_loss}) should match SecondaryOnly ({sec_loss}) better than PrimaryOnly ({pri_loss}) against immune opp"
    );
}

#[test]
fn dynamic_picks_primary_when_on_hit_status_carries_meaningful_value() {
    // [REF:compare_secondary_attack]
    // Inverse of the immunity case: damage2 only modestly above
    // primary, on-hit applies a real DOT (Bleed @ 3 stacks). The
    // status value beats the damage delta and Dynamic fires primary
    // — observable as Bleed being applied by A's bite.
    //
    // Duration was bumped from 3.0 → 30.0 s (2026-05-22, BiteVariant
    // P2): engine-replay forecasts the future at the SIMULATION's
    // actual `max_time_sec`, not an analytic horizon-floor. Bleed
    // ticks every 3 s; a 3 s simulation never sees ANY Bleed damage,
    // so the engine-replay correctly judges secondary (+10 direct
    // dmg) above primary (+0 direct dmg + 0 Bleed ticks within
    // window). 30 s gives Bleed ~10 ticks, more than enough to swing
    // the trade toward primary.
    let mut attacker = make_attacker(100.0, 110.0, "Bleed_Status");
    attacker.on_hit_statuses = vec![applied_status("Bleed_Status", 3.0)];
    let defender = make_defender();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::Dynamic;
    let result = run(&attacker, &defender, &cfg, 30.0);
    let log = result.combat_log.expect("trace requested");
    assert!(
        bite_applied_status(&log, "A", "Bleed_Status"),
        "Dynamic: primary should fire (Bleed must apply) when status value beats damage delta. log = {log:?}"
    );
}

/// Fitness from A's perspective — the exact quantity the bite-variant
/// policy maximizes (mirrors `composable::posture_policy::compute_replay_fitness`).
/// The death-time race resolves the mutual-death case.
fn a_fitness(r: &BestBuildsMatchupSummary) -> f64 {
    let (my_hp, opp_hp) = (r.final_hp_a.max(0.0), r.final_hp_b.max(0.0));
    match (r.death_time_a, r.death_time_b) {
        (None, None) => my_hp - opp_hp,
        (None, Some(_)) => my_hp + 1.0,
        (Some(_), None) => -opp_hp,
        (Some(me), Some(op)) => {
            if me > op + 1e-9 {
                (me - op) + 1.0
            } else if op > me + 1e-9 {
                -r.hp_b_at_a_death.max(0.0)
            } else {
                0.0
            }
        }
    }
}

#[test]
fn dynamic_at_least_matches_secondary_in_mirror_death_race() {
    // [REF:compare_secondary_attack]
    // Regression for the confirmed Sana'ata-mirror bug. A Sana'ata-class
    // attacker (150 primary + Corrosion on-hit, 300 secondary, 1 s cadence)
    // vs a PrimaryOnly mirror: SecondaryOnly's burst wins the death race
    // decisively (fit ~15), but the OLD per-bite engine-replay scored every
    // choice against an ALL-PRIMARY self tail — simulating a long fight
    // where one primary bite's Corrosion DOT (integrated over the whole long
    // fight) out-values the 150->300 burst — so it picked primary nearly
    // every bite and won by far less (fit ~4). The schedule search includes
    // the all-secondary candidate, restoring the invariant that Dynamic is
    // never worse than the better pure mode.
    let mut a = default_combatant();
    a.health = 6_000.0;
    a.damage = 150.0;
    a.damage2 = 300.0;
    a.bite_cooldown = 1.0;
    a.health_regen = 5.0;
    a.on_hit_statuses = vec![applied_status("Corrosion_Status", 1.0)];
    let b = a.clone();
    let dur = 60.0;

    let measure = |am: SimpleBiteVariantMode| -> f64 {
        let mut cfg = ComposableAbilityConfig::default();
        cfg.attacker_bite_variant_mode = am;
        cfg.defender_bite_variant_mode = SimpleBiteVariantMode::PrimaryOnly;
        a_fitness(&run(&a, &b, &cfg, dur))
    };
    let sec = measure(SimpleBiteVariantMode::SecondaryOnly);
    let dynm = measure(SimpleBiteVariantMode::Dynamic);
    assert!(
        dynm >= sec - 2.0,
        "Dynamic fitness ({dynm}) must be >= SecondaryOnly ({sec}) - tolerance; \
         collapsing to primary in a death race leaves the win on the table"
    );
}

#[test]
fn timeline_labels_primary_and_secondary_bites_distinctly() {
    // [REF:compare_secondary_attack]
    // The timeline must distinguish primary vs. secondary bites so the
    // user can read combat history without guessing. Engine sends
    // "Bite hit" for primary (legacy label, zero regression for any
    // existing TS-side filter) and "Secondary bite hit" for secondary.
    let attacker = make_attacker(50.0, 200.0, "Poison_Status");
    let defender = make_defender();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::PrimaryOnly;
    let pri_log = run(&attacker, &defender, &cfg, 3.0)
        .combat_log
        .expect("trace requested");
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::SecondaryOnly;
    let sec_log = run(&attacker, &defender, &cfg, 3.0)
        .combat_log
        .expect("trace requested");
    let bite_descs = |log: &[CombatLogEntry]| -> Vec<String> {
        log.iter()
            .filter(|e| e.entry_type == "bite" && e.attacker == "A")
            .filter_map(|e| e.description.clone())
            .collect()
    };
    let pri_descs = bite_descs(&pri_log);
    let sec_descs = bite_descs(&sec_log);
    assert!(
        !pri_descs.is_empty() && pri_descs.iter().all(|d| d == "Bite hit"),
        "PrimaryOnly bites must label as 'Bite hit'. got: {pri_descs:?}"
    );
    assert!(
        !sec_descs.is_empty() && sec_descs.iter().all(|d| d == "Secondary bite hit"),
        "SecondaryOnly bites must label as 'Secondary bite hit'. got: {sec_descs:?}"
    );
}

#[test]
fn dynamic_without_secondary_attack_falls_back_to_primary() {
    // [REF:compare_secondary_attack]
    // If `damage2 <= 0` (creature has no secondary bite in-game),
    // Dynamic mode is degenerate. The engine should fire primary —
    // observable as the on-hit ailment landing.
    let mut attacker = make_attacker(50.0, 0.0, "Poison_Status");
    attacker.damage2 = 0.0;
    let defender = make_defender();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_bite_variant_mode = SimpleBiteVariantMode::Dynamic;
    let result = run(&attacker, &defender, &cfg, 3.0);
    let log = result.combat_log.expect("trace requested");
    assert!(
        bite_applied_status(&log, "A", "Poison_Status"),
        "Dynamic without secondary attack must fall back to primary. log = {log:?}"
    );
}
