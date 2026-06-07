//! Reference: ability_berserk
//!
//! Covers each testable bullet in the "Berserk" entry. Each test body
//! starts with the [REF:ability_berserk] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.

use super::default_combatant;
use crate::combat::current_simple_bite_cooldown_with_statuses;
use std::collections::BTreeMap;

fn berserk_combatant(max_hp: f64) -> crate::contracts::SimpleCombatantStats {
    // Canonical Berserk data (verified uniform across 28 entries in
    // data/effects_catalog.runtime.v2.json on 2026-05-06): trigger
    // hpRatioLt = 0.2, biteCooldownMultiplier = 0.5.
    let mut c = default_combatant();
    c.health = max_hp;
    c.bite_cooldown = 2.0;
    c.berserk_hp_ratio_threshold = 0.2;
    c.berserk_bite_cooldown_multiplier = 0.5;
    c
}

#[test]
fn passive_inactive_above_twenty_percent_hp() {
    // [REF:ability_berserk]
    let stats = berserk_combatant(1_000.0);
    let no_statuses = BTreeMap::new();
    let above_threshold_hp = stats.health * 0.5; // 50% > 20% threshold.
    let cd = current_simple_bite_cooldown_with_statuses(&stats, above_threshold_hp, &no_statuses);
    assert!(
        (cd - stats.bite_cooldown).abs() < 1e-9,
        "Berserk must not modify bite cooldown above 20% HP: expected {}, got {cd}",
        stats.bite_cooldown
    );
}

#[test]
fn active_below_twenty_percent_hp_halves_bite_cooldown() {
    // [REF:ability_berserk]
    let stats = berserk_combatant(1_000.0);
    let no_statuses = BTreeMap::new();
    let below_threshold_hp = stats.health * 0.1; // 10% < 20% threshold.
    let cd = current_simple_bite_cooldown_with_statuses(&stats, below_threshold_hp, &no_statuses);
    let expected = stats.bite_cooldown * 0.5;
    assert!(
        (cd - expected).abs() < 1e-9,
        "Berserk must multiply bite cooldown by 0.5x below 20% HP: expected {expected}, got {cd}"
    );
}
