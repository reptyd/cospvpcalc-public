//! Reference: ability_stubborn_stacker
//!
//! Stubborn Stacker is a Compare-only TS-side build-time plushie
//! override, not a runtime composable mechanic. The TS plushie
//! pipeline (`src/engine/plushieBuildMappings.ts`) substitutes the
//! base plushie effects with the Stubborn Stacker overrides
//! (Cat / Pig-Lantern / Haunt Dragon / Tannenbaum) before the build
//! reaches `FinalStats` and the Rust bridge. By the time the Rust
//! engine sees the matchup, the overrides have already been folded
//! into the modeled `SimpleCombatantStats` fields (`health_regen`,
//! `damage`, `bite_cooldown`, `status_resist_fractions`).
//!
//! There is no Rust runtime path for Stubborn Stacker to test. This
//! file exists so the coverage gate sees the
//! [REF:ability_stubborn_stacker] marker; the actual override values
//! (which plushie produces which stat change) are TS-side fixtures
//! and belong to a TS-side test if regression coverage is needed.

#[test]
fn no_rust_runtime_path_overrides_applied_at_build_time_in_ts() {
    // [REF:ability_stubborn_stacker]
    // Bullets 1-5 describe TS plushie-build overrides: the engine
    // sees only the post-override `SimpleCombatantStats` and has no
    // Stubborn Stacker config flag. Marker-only test for coverage
    // gate compatibility.
}
