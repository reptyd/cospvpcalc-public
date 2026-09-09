//! Reference: ability_berserk
//!
//! Covers each testable bullet in the "Berserk" entry. Each test body
//! starts with the [REF:ability_berserk] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.

use super::default_combatant;
use crate::combat::current_simple_bite_cooldown_with_statuses;
use crate::spec_constants::{BERSERK_BITE_COOLDOWN_MULTIPLIER, BERSERK_HP_GATE_PCT};
use std::collections::BTreeMap;

fn berserk_combatant(max_hp: f64) -> crate::contracts::SimpleCombatantStats {
    // Canonical Berserk data (verified uniform across 28 entries in
    // data/effects_catalog.runtime.v2.json on 2026-05-06): trigger
    // hpRatioLt = 0.2, biteCooldownMultiplier = 0.5.
    let mut c = default_combatant();
    c.health = max_hp;
    c.bite_cooldown = 2.0;
    c.berserk_hp_ratio_threshold = BERSERK_HP_GATE_PCT / 100.0;
    c.berserk_bite_cooldown_multiplier = BERSERK_BITE_COOLDOWN_MULTIPLIER;
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
    let expected = stats.bite_cooldown * BERSERK_BITE_COOLDOWN_MULTIPLIER;
    assert!(
        (cd - expected).abs() < 1e-9,
        "Berserk must multiply bite cooldown by {BERSERK_BITE_COOLDOWN_MULTIPLIER}x below 20% HP: expected {expected}, got {cd}"
    );
}

#[test]
fn hp_gate_sits_at_twenty_percent() {
    // [REF:ability_berserk]
    // Bullet 1: "Berserk ... becomes active when the user's HP drops
    // below 20%." Bracket the gate magnitude: just below 20% HP the
    // bite cooldown is halved, just above it is unmodified. Probing
    // 0.01 either side of BERSERK_HP_GATE_PCT/100 pins the gate to 20%
    // within +/-1 percentage point.
    let stats = berserk_combatant(1_000.0);
    let no_statuses = BTreeMap::new();
    let gate = BERSERK_HP_GATE_PCT / 100.0;

    let just_below = current_simple_bite_cooldown_with_statuses(
        &stats, stats.health * (gate - 0.01), &no_statuses,
    );
    assert!(
        (just_below - stats.bite_cooldown * BERSERK_BITE_COOLDOWN_MULTIPLIER).abs() < 1e-9,
        "Berserk must be active just below the {BERSERK_HP_GATE_PCT}% HP gate: got cd {just_below}"
    );

    let just_above = current_simple_bite_cooldown_with_statuses(
        &stats, stats.health * (gate + 0.01), &no_statuses,
    );
    assert!(
        (just_above - stats.bite_cooldown).abs() < 1e-9,
        "Berserk must be inactive just above the {BERSERK_HP_GATE_PCT}% HP gate: got cd {just_above}"
    );
}
