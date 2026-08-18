//! Reference: plushie_darkstar
//!
//! Unlike most plushies (whose stat / block contributions bake into
//! `SimpleCombatantStats` at TS build time), Darkstar's effect is
//! engine-native: while the holder is settled sit/lay it accelerates
//! Defiled-Ground-recoverable ailment recovery by x1.25, composed
//! multiplicatively with the Defiled Ground level bonus and the posture
//! decay speed-up. The TS bridge sets `*_compare_dark_star` on the
//! composable config from the build's plushie list; the engine realizes
//! it via `CombatSide::recoverable_recovery_mult` and the status strip
//! seam in `statuses.rs`.

use crate::composable::posture::Posture;
use crate::composable::reference_tests::{default_breath, default_combatant};
use crate::composable::side::CombatSide;

fn side_with(dark_star: bool, posture: Posture) -> CombatSide {
    let stats = default_combatant();
    let breath = default_breath();
    let mut side = CombatSide::new(&stats, Some(&breath));
    side.compare_dark_star = dark_star;
    side.posture_current = posture;
    side.posture_pending = posture;
    side
}

#[test]
fn darkstar_accelerates_recovery_only_while_settled_sit_or_lay() {
    // [REF:plushie_darkstar]
    // The flag reaches the engine (set on CombatSide) and yields x1.25
    // recovery while sitting or laying, x1.0 while standing.
    let laying = side_with(true, Posture::Laying);
    assert!(
        (laying.recoverable_recovery_mult() - 1.25).abs() < 1e-9,
        "Darkstar must give x1.25 recovery while laying: got {}",
        laying.recoverable_recovery_mult()
    );

    let sitting = side_with(true, Posture::Sitting);
    assert!(
        (sitting.recoverable_recovery_mult() - 1.25).abs() < 1e-9,
        "Darkstar must give x1.25 recovery while sitting: got {}",
        sitting.recoverable_recovery_mult()
    );

    let standing = side_with(true, Posture::Standing);
    assert!(
        (standing.recoverable_recovery_mult() - 1.0).abs() < 1e-9,
        "Darkstar must give no bonus while standing: got {}",
        standing.recoverable_recovery_mult()
    );

    // Without the flag, even laying yields no recovery bonus (off-path
    // byte-identical with the pre-feature engine).
    let laying_no_flag = side_with(false, Posture::Laying);
    assert!(
        (laying_no_flag.recoverable_recovery_mult() - 1.0).abs() < 1e-9,
        "no Darkstar must give no bonus: got {}",
        laying_no_flag.recoverable_recovery_mult()
    );
}
