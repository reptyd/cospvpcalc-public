//! Reference: compare_gourmandizer
//!
//! Covers each testable bullet in the "Gourmandizer" entry. Each test
//! body starts with the [REF:compare_gourmandizer] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//!
//! - Static (no-hunger-rules) weight factor: `gourmandizer_weight_factor_from_fill_pct`
//!   in `active_runtime.rs:128-135` - reads the starting fill% and
//!   returns 1.0 below 100% fill, scales linearly to 1.15 at 125% fill,
//!   capped above. Wired into the simulation at
//!   `composable/mod.rs:1214-1217`.
//! - Dynamic (hunger-rule) weight factor: `gourmandizer_weight_factor_from_hunger`
//!   in `compare_hunger.rs:127-136` - same shape but reads the
//!   current hunger / appetite_base ratio every tick.

use crate::active_runtime::gourmandizer_weight_factor_from_fill_pct;
use crate::compare_hunger::gourmandizer_weight_factor_from_hunger;

#[test]
fn weight_bonus_zero_at_one_hundred_percent_fill() {
    // [REF:compare_gourmandizer]
    // Bullet 2: "That bonus scales linearly from +0% at 100% fill to
    // +15% at 125% fill." (boundary at 100%).
    let factor = gourmandizer_weight_factor_from_fill_pct(100.0);
    assert!(
        (factor - 1.0).abs() < 1e-12,
        "100% fill must yield 1.0x weight factor (no bonus): got {factor}"
    );
    let below = gourmandizer_weight_factor_from_fill_pct(80.0);
    assert!(
        (below - 1.0).abs() < 1e-12,
        "below 100% fill must yield 1.0x weight factor: got {below}"
    );
}

#[test]
fn weight_bonus_reaches_fifteen_percent_at_one_hundred_twenty_five_percent_fill() {
    // [REF:compare_gourmandizer]
    // Bullet 2 (other endpoint): "+15% at 125% fill."
    let factor = gourmandizer_weight_factor_from_fill_pct(125.0);
    assert!(
        (factor - 1.15).abs() < 1e-12,
        "125% fill must yield 1.15x weight factor: got {factor}"
    );
    // Above the cap stays at 1.15.
    let capped = gourmandizer_weight_factor_from_fill_pct(150.0);
    assert!(
        (capped - 1.15).abs() < 1e-12,
        "fill above 125% must clamp to 1.15x: got {capped}"
    );
}

#[test]
fn weight_bonus_scales_linearly_between_one_hundred_and_one_hundred_twenty_five() {
    // [REF:compare_gourmandizer]
    // Bullet 2 (linear ramp): halfway through (112.5% fill) → +7.5%.
    let factor = gourmandizer_weight_factor_from_fill_pct(112.5);
    assert!(
        (factor - 1.075).abs() < 1e-12,
        "112.5% fill must yield 1.075x (halfway between 1.0 and 1.15): got {factor}"
    );
}

#[test]
fn dynamic_path_reads_current_hunger_when_rule_is_on() {
    // [REF:compare_gourmandizer]
    // Bullet 4: "With hunger rules enabled, the bonus updates
    // dynamically from the current fill instead."
    // The dynamic helper takes (current_hunger, appetite_base). With
    // appetite_base=100 and current_hunger=125 → fill_pct=125% → 1.15x.
    // After drain to 110 → fill_pct=110% → 1.0 + 0.15 * 0.4 = 1.06.
    let full = gourmandizer_weight_factor_from_hunger(125.0, 100.0);
    assert!(
        (full - 1.15).abs() < 1e-12,
        "dynamic factor at 125 hunger / 100 base must be 1.15x: got {full}"
    );
    let mid = gourmandizer_weight_factor_from_hunger(110.0, 100.0);
    assert!(
        (mid - 1.06).abs() < 1e-12,
        "dynamic factor at 110 hunger / 100 base must be 1.06x: got {mid}"
    );
    let low = gourmandizer_weight_factor_from_hunger(100.0, 100.0);
    assert!(
        (low - 1.0).abs() < 1e-12,
        "dynamic factor at 100 hunger (= 100% fill) must be 1.0x: got {low}"
    );
}
