//! Built-in `TimedDecision` impls — one per ability.
//!
//! These are *examples* of the trait, not part of the engine's
//! contract (pillar 3). User-registered or constructor-built
//! decisions implement the same trait and live in the same registry.
//!
//! Each module here registers its own decision under
//! `builtin.{ability_name}`.

pub mod adrenaline;
pub mod bite_variant;
pub mod cocoon;
pub mod fortify;
pub mod hunker;
pub mod hunters_curse;
pub mod life_leech;
pub mod reflect;
pub mod rewind;
pub mod stance;
pub mod unbridled_rage;
pub mod wardens_rage;

pub use adrenaline::AdrenalineDecision;
pub use bite_variant::BuiltinBiteVariantReplayDecision;
pub use cocoon::CocoonDecision;
pub use fortify::FortifyDecision;
pub use hunker::HunkerDecision;
pub use hunters_curse::HuntersCurseDecision;
pub use life_leech::LifeLeechDecision;
pub use reflect::ReflectDecision;
pub use rewind::RewindDecision;
pub use stance::BuiltinStanceReplayDecision;
pub use unbridled_rage::UnbridledRageDecision;
pub use wardens_rage::WardensRageDecision;
