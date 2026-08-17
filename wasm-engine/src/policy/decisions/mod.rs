//! Built-in `TimedDecision` impls - one per ability.
//!
//! These are *examples* of the trait, not part of the engine's
//! contract. User-registered or constructor-built
//! decisions implement the same trait and live in the same registry.
//!
//! Each module here registers its own decision under
//! `builtin.{ability_name}`.

pub mod adrenaline;
pub mod bite_variant;
pub mod cocoon;
pub mod fortify;
pub mod guardians_passage;
pub mod hunker;
pub mod hunters_curse;
pub mod life_leech;
pub mod reflect;
pub mod rewind;
pub mod stance;
pub mod toggle_replay;
pub mod unbridled_rage;
pub mod wardens_rage;

pub use adrenaline::AdrenalineDecision;
pub use bite_variant::BuiltinBiteVariantReplayDecision;
pub use cocoon::CocoonDecision;
pub use fortify::FortifyDecision;
pub use guardians_passage::GuardiansPassageDecision;
pub use hunker::HunkerDecision;
pub use hunters_curse::HuntersCurseDecision;
pub use life_leech::LifeLeechDecision;
pub use reflect::ReflectDecision;
pub use rewind::RewindDecision;
pub use stance::BuiltinStanceReplayDecision;
pub use toggle_replay::BuiltinToggleReplayDecision;
pub use unbridled_rage::UnbridledRageDecision;
pub use wardens_rage::WardensRageDecision;

/// Flat positive utility a "delete-to-gate" decision reports when its gate
/// fires. Any positive constant works - the candidate search compares
/// magnitudes and breaks ties toward the earliest (delay-0) candidate - so the
/// decision fires at the gate condition, delay 0, exactly as ReallyFast does.
pub(crate) const GATE_FIRE_UTILITY: f64 = 1.0;

/// Reduce a timed decision to its gate: a flat positive when the gate says
/// fire, `-inf` otherwise. Used by abilities whose measured `Ideal == ReallyFast
/// == Extreme` on real matchups (see `composable::policy_gate_classification`):
/// the timing search only ever reproduced the gate, so a hand-authored value
/// formula was dead weight. Delegating `utility` to the gate keeps every mode
/// firing at the same instant with nothing to rot on a rebalance.
pub(crate) fn gate_only_utility(gate: Option<bool>) -> f64 {
    if gate == Some(true) {
        GATE_FIRE_UTILITY
    } else {
        f64::NEG_INFINITY
    }
}
