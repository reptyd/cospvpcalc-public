//! Reference: status_malices_mark
//!
//! Covers each testable bullet in the "Malice's Mark" entry. Each
//! test body starts with the [REF:status_malices_mark] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `combat.rs:131-143` `outgoing_damage_pct_from_statuses`
//! returns -15 when `Malices_Mark` is present. That sum feeds the
//! melee multiplier as `1 + sum/100 = 0.85`.

use super::default_combatant;
use crate::combat::compute_melee_damage_per_hit_with_actor_and_target_statuses;
use crate::contracts::SimpleStatusInstance;
use std::collections::BTreeMap;

fn instance(stacks: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec: 100.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn reduces_outgoing_damage_by_fifteen_percent() {
    // [REF:status_malices_mark]
    // Bullet 1: "Malice's Mark reduces outgoing damage by 15% while
    // it is active."
    let mut atk = default_combatant();
    atk.damage = 100.0;
    let def = default_combatant();
    let mut atk_st: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    atk_st.insert("Malices_Mark".to_string(), instance(1.0));
    let baseline = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &atk, &def, atk.health, &BTreeMap::new(), &BTreeMap::new(),
    );
    let with_mark = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &atk, &def, atk.health, &atk_st, &BTreeMap::new(),
    );
    let ratio = with_mark / baseline;
    assert!(
        (ratio - 0.85).abs() < 1e-9,
        "Malice's Mark must multiply outgoing damage by 0.85 (-15%): got ratio {ratio} (with={with_mark}, base={baseline})"
    );
}
