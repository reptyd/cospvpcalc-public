// Declarative metadata for activated abilities.
//
// Single source of truth for "what kind of ability is X" and "does
// Necropoison disable a fresh activation of it". Pairs with the
// stateless gate function `is_actives_disabled_by_necro` in
// `statuses.rs`; engine sites use `ability_blocked_by_necropoison`
// here so the per-ability decision lives in this table, not as
// inline branches scattered through phases.rs.
//
// In-game rule (the table encodes this, not the other way around):
//   Necropoison ≥ 10 stacks blocks the in-game activation MENU.
//   Passives auto-fire and are never gated. Hunker is a walk-style
//   toggle (Ctrl) that auto-fires after 3 s of hunker-walk - not a
//   menu activation, so Necropoison does not gate it. Warden's Rage
//   is documented in-game as a semi-passive - also not gated.

use std::collections::BTreeMap;

use crate::contracts::SimpleStatusInstance;
use crate::statuses::is_actives_disabled_by_necro;

/// Conceptual ability category. Every ability the sandbox exposes
/// or the engine queries by name has a row in `ABILITY_METADATA`
/// with one of these kinds, so adding a new ability is a one-line
/// declaration of its category instead of a search through phase
/// branches.
///
/// `Active` - in-game menu activation. Necropoison ≥ 10 blocks a
/// *fresh* activation while the status is stacked. Ongoing windows
/// from a previously-fired activation keep running - the gate is
/// strictly on "start a new one", never on "tick the existing one".
///
/// `Passive` - auto-fires every iteration or every bite while
/// configured (e.g. Berserk's threshold boost, First Strike's
/// damage rule, Aura's periodic tick, Life Leech's per-bite heal).
/// Never goes through the Necropoison gate.
///
/// `Special` - code-side active (has a policy decision and a timer)
/// but in-game semi-passive: Hunker is a walk-style toggle with
/// auto-fire after 3 s of hunker-walk, Warden's Rage is documented
/// in-game as a semi-passive. Necropoison never gates these.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbilityKind {
    Passive,
    Active,
    Special,
}

/// Declarative record for one ability. Adding a new menu-activatable
/// ability requires adding a row here; the `cfg(test)` completeness
/// guard at the bottom of this file fails CI until the row exists
/// for every `OVERRIDABLE_ABILITY_FLAGS` entry.
#[derive(Debug, Clone, Copy)]
pub struct AbilityMetadata {
    /// Canonical display name. Must match the name string the engine
    /// passes to `ability_blocked_by_necropoison`.
    pub name: &'static str,
    // Pinned by the `#[cfg(test)]` classification invariants in this file
    // (Special/Passive imply no-block); kept as the documented contract even
    // though no production reader exists yet.
    #[allow(dead_code)]
    pub kind: AbilityKind,
    /// Whether `Necropoison_Status >= 10` blocks a fresh activation.
    /// Always `true` for `Active` (the in-game default). Always
    /// `false` for `Special`. A `cfg(test)` invariant pins this so
    /// the matrix can't drift silently.
    pub necropoison_blocks: bool,
}

/// Canonical metadata table. Order is for readability - semantically
/// this is a lookup-by-name set.
pub const ABILITY_METADATA: &[AbilityMetadata] = &[
    // ---- Self-buff / cleanse actives ----
    AbilityMetadata { name: "Fortify",        kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Harden",         kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Adrenaline",     kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Rewind",         kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Reflect",        kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Cocoon",         kind: AbilityKind::Active,  necropoison_blocks: true },

    // ---- Offensive actives ----
    AbilityMetadata { name: "Hunters Curse",  kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Unbridled Rage", kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Frost Nova",     kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Reflux",         kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Totem",          kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Cause Fear",     kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Lich Mark",      kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Grim Lariat",    kind: AbilityKind::Active,  necropoison_blocks: true },
    // Divination is an activation that opens a 3-bite buff window
    // (flat damage bonus on the next 3 bites). Necropoison blocks a
    // fresh cast; an already-open window keeps ticking.
    AbilityMetadata { name: "Divination",     kind: AbilityKind::Active,  necropoison_blocks: true },

    // ---- Breath ----
    // Breath is the canonical Active that's gated alongside menu
    // activations - `breath.rs:139` checks the gate before firing.
    AbilityMetadata { name: "Breath",         kind: AbilityKind::Active,  necropoison_blocks: true },

    // ---- Value-bearing actives (from OVERRIDABLE_ABILITY_VALUES) ----
    // Cursed Sigil - `*_cursed_sigil_stacks > 0` arms the cast; the
    // cast itself goes through the activation gate.
    AbilityMetadata { name: "Cursed Sigil",   kind: AbilityKind::Active,  necropoison_blocks: true },
    // Spite - consumed on a bite under condition (`*_spite_value > 0`
    // pairs with the spite_ready latch). Fresh re-arm is a gated activation.
    AbilityMetadata { name: "Spite",          kind: AbilityKind::Active,  necropoison_blocks: true },
    // Shadow Barrage - `*_shadow_barrage_value > 0` triggers a damage
    // barrage on cast.
    AbilityMetadata { name: "Shadow Barrage", kind: AbilityKind::Active,  necropoison_blocks: true },
    // Life Leech - activation opens a 12 s window during which the
    // owner's bites heal by `life_leech_value`% of damage dealt;
    // 60 s cooldown gates fresh re-activation. Routed through
    // `LIFE_LEECH_DECISION_ID` policy, gated by Necropoison like
    // any other menu activation.
    AbilityMetadata { name: "Life Leech",     kind: AbilityKind::Active,  necropoison_blocks: true },

    // ---- Compare-only / area actives (NOT in sandbox override tables) ----
    // These are matchup-pair effects (placed-once-then-decays areas
    // the opponent walks into, or compare-window healing). They have
    // engine activation sites in phases.rs gated by Necropoison and
    // therefore need metadata rows for the per-ability gate helper -
    // even though the sandbox completeness test (which only inspects
    // OVERRIDABLE_* tables) doesn't require them. Listed here so the
    // centralized Necropoison gate (`ability_blocked_by_necropoison`)
    // returns the correct answer for these activation paths.
    AbilityMetadata { name: "Thorn Trap",     kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Toxic Trap",     kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Frost Snare",    kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Poison Area",    kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Yolk Bomb",      kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Drowsy Area",    kind: AbilityKind::Active,  necropoison_blocks: true },
    AbilityMetadata { name: "Healing Pulse",  kind: AbilityKind::Active,  necropoison_blocks: true },

    // ---- Special: code-side actives that are in-game semi-passives ----
    AbilityMetadata { name: "Hunker",         kind: AbilityKind::Special, necropoison_blocks: false },
    AbilityMetadata { name: "Warden Rage",    kind: AbilityKind::Special, necropoison_blocks: false },

    // ---- Passives (from OVERRIDABLE_PASSIVE_ABILITIES) ----
    AbilityMetadata { name: "Berserk",             kind: AbilityKind::Passive, necropoison_blocks: false },
    AbilityMetadata { name: "Quick Recovery",      kind: AbilityKind::Passive, necropoison_blocks: false },
    AbilityMetadata { name: "Warden's Resistance", kind: AbilityKind::Passive, necropoison_blocks: false },
    AbilityMetadata { name: "First Strike",        kind: AbilityKind::Passive, necropoison_blocks: false },
    AbilityMetadata { name: "Unbreakable",         kind: AbilityKind::Passive, necropoison_blocks: false },

    // ---- Value-bearing passive (from OVERRIDABLE_ABILITY_VALUES, passive shape) ----
    // Aura - `*_aura_subtype` selects a status applied periodically
    // (every AURA_TICK_SEC); auto-fires on the tick scheduler.
    AbilityMetadata { name: "Aura",           kind: AbilityKind::Passive, necropoison_blocks: false },
];

/// Per-ability Necropoison gate. Returns `true` when this ability
/// cannot fresh-activate because (a) it's configured to be blocked
/// by Necropoison and (b) `Necropoison_Status` is at threshold.
///
/// Unknown ability names return `false` - defensive default. The
/// `cfg(test)` completeness guard below ensures every ability the
/// engine queries by name has an entry.
pub fn ability_blocked_by_necropoison(
    ability_name: &str,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> bool {
    for entry in ABILITY_METADATA {
        if entry.name == ability_name {
            return entry.necropoison_blocks && is_actives_disabled_by_necro(statuses);
        }
    }
    false
}

/// Lookup ability kind by canonical name. Returns `None` for names
/// not in the table (passives that legitimately aren't here, or
/// typos).
// Pinned by the `#[cfg(test)]` classification invariants in this file
// (Special/Passive imply no-block); kept as the documented contract even
// though no production reader exists yet.
#[allow(dead_code)]
pub fn ability_kind(ability_name: &str) -> Option<AbilityKind> {
    ABILITY_METADATA
        .iter()
        .find(|entry| entry.name == ability_name)
        .map(|entry| entry.kind)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composable::sandbox;
    use crate::contracts::SimpleStatusInstance;
    use std::collections::{BTreeMap, HashSet};

    fn status_with_necro(stacks: f64) -> BTreeMap<String, SimpleStatusInstance> {
        let mut s = BTreeMap::new();
        s.insert(
            "Necropoison_Status".to_string(),
            SimpleStatusInstance {
                stacks,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 100.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        s
    }

    #[test]
    fn special_kind_implies_no_necropoison_block() {
        for entry in ABILITY_METADATA {
            if matches!(entry.kind, AbilityKind::Special) {
                assert!(
                    !entry.necropoison_blocks,
                    "Special ability {:?} must have necropoison_blocks=false - that's what Special encodes in this table",
                    entry.name
                );
            }
        }
    }

    #[test]
    fn passive_kind_implies_no_necropoison_block() {
        for entry in ABILITY_METADATA {
            if matches!(entry.kind, AbilityKind::Passive) {
                assert!(
                    !entry.necropoison_blocks,
                    "Passive ability {:?} must have necropoison_blocks=false - passives auto-fire and bypass the gate by definition",
                    entry.name
                );
            }
        }
    }

    #[test]
    fn names_are_unique() {
        for (i, a) in ABILITY_METADATA.iter().enumerate() {
            for b in &ABILITY_METADATA[i + 1..] {
                assert_ne!(
                    a.name, b.name,
                    "duplicate ability name in ABILITY_METADATA: {:?}",
                    a.name
                );
            }
        }
    }

    /// Completeness against every sandbox override table - flag,
    /// value, and passive. Adding a new ability through any of the
    /// three sandbox declarative tables without also adding a
    /// metadata record is a CI failure: kind classification is
    /// mandatory for every ability the sandbox can expose.
    #[test]
    fn every_sandbox_overridable_ability_has_metadata() {
        let known: HashSet<&'static str> = ABILITY_METADATA.iter().map(|e| e.name).collect();
        let mut missing: Vec<String> = Vec::new();

        // 1. OVERRIDABLE_ABILITY_FLAGS - bool actives.
        for (canonical, aliases) in sandbox::overridable_ability_flag_iter() {
            let has = known.contains(canonical) || aliases.iter().any(|a| known.contains(a));
            if !has {
                missing.push(format!("flag:{canonical}"));
            }
        }
        // 2. OVERRIDABLE_ABILITY_VALUES - value-bearing abilities (both
        // active and passive shapes).
        for (canonical, _kind) in sandbox::overridable_ability_value_specs() {
            if !known.contains(canonical) {
                missing.push(format!("value:{canonical}"));
            }
        }
        // 3. OVERRIDABLE_PASSIVE_ABILITIES - stat-field passives.
        for (canonical, _kind) in sandbox::overridable_passive_specs() {
            if !known.contains(canonical) {
                missing.push(format!("passive:{canonical}"));
            }
        }

        assert!(
            missing.is_empty(),
            "Sandbox-exposed abilities without ABILITY_METADATA: {:?}. \
             Every sandbox override table entry must declare its kind.",
            missing
        );
    }

    #[test]
    fn active_abilities_block_at_or_above_threshold() {
        let s = status_with_necro(15.0);
        assert!(ability_blocked_by_necropoison("Cause Fear", &s));
        assert!(ability_blocked_by_necropoison("Lich Mark", &s));
        assert!(ability_blocked_by_necropoison("Fortify", &s));
        assert!(ability_blocked_by_necropoison("Breath", &s));
    }

    #[test]
    fn special_abilities_are_never_blocked() {
        let s = status_with_necro(30.0);
        assert!(!ability_blocked_by_necropoison("Hunker", &s));
        assert!(!ability_blocked_by_necropoison("Warden Rage", &s));
    }

    #[test]
    fn unknown_ability_name_is_not_blocked() {
        let s = status_with_necro(30.0);
        assert!(!ability_blocked_by_necropoison("Some Future Ability", &s));
    }

    #[test]
    fn below_threshold_no_block_for_any_metadata_entry() {
        let s = status_with_necro(9.0);
        for entry in ABILITY_METADATA {
            assert!(
                !ability_blocked_by_necropoison(entry.name, &s),
                "{:?} must not be blocked when Necropoison < 10 stacks",
                entry.name
            );
        }
    }

    #[test]
    fn no_necropoison_status_at_all_no_block_for_any() {
        let s: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        for entry in ABILITY_METADATA {
            assert!(
                !ability_blocked_by_necropoison(entry.name, &s),
                "{:?} must not be blocked when there is no Necropoison status",
                entry.name
            );
        }
    }

    #[test]
    fn ability_kind_lookup_matches_table() {
        assert_eq!(ability_kind("Hunker"), Some(AbilityKind::Special));
        assert_eq!(ability_kind("Warden Rage"), Some(AbilityKind::Special));
        assert_eq!(ability_kind("Cause Fear"), Some(AbilityKind::Active));
        assert_eq!(ability_kind("Nonexistent"), None);
    }
}
