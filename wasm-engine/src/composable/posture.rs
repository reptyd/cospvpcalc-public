//! Posture system: Standing / Sitting / Laying with timed transitions.
//!
//! Compare-only feature (Phase 1: state + multipliers). The policy that
//! drives posture choices and the action gating that prevents bites /
//! breath / ability activations while settled live in later phases.
//!
//! ## Spec (user-arbitrated 2026-05-19)
//!
//! **Effects, applied only when posture is SETTLED** (i.e. `pending ==
//! current` - no active transition):
//!
//! | posture | health_regen × | neg.ailment decay × | incoming bite/breath × |
//! |---------|----------------|---------------------|-----------------------|
//! | Standing| 1.0            | 1.0                 | 1.0                   |
//! | Sitting | 1.5            | 2.0                 | 1.5                   |
//! | Laying  | 2.0            | 4.0                 | 1.75                  |
//!
//! **Transition durations** (Standing → posture):
//!
//! - Standing → Sitting: 1 s
//! - Standing → Laying:  2 s
//! - Sitting ↔ Laying:   1 s (each direction)
//! - any → Standing:     0 s (instant)
//!
//! **During transition**: actions (bite / breath / activate) are NOT
//! blocked, multipliers above do NOT apply yet (treated as standing for
//! math). The ONLY immediate effect of starting a transition is that
//! Hunker auto-deactivates on the transitioning side (handled by the
//! caller - see `phases.rs::phase_posture_*`).
//!
//! After the transition completes, actions become blocked AND multipliers
//! kick in. Standing-up is instant: pending=Standing, settled=Standing,
//! no transition window. Action lock and multipliers disappear in the
//! same tick.


#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Posture {
    #[default]
    Standing,
    Sitting,
    Laying,
}

pub const SIT_TRANSITION_SEC: f64 = 1.0;
pub const LAY_TRANSITION_SEC: f64 = 2.0;
pub const SIT_LAY_DIRECT_SEC: f64 = 1.0;

/// Duration of a transition from `from` to `to`. Standing-up is always
/// instant; sit↔lay direct is 1 s (no need to round-trip through
/// Standing); Standing→Sitting is 1 s, Standing→Laying is 2 s.
pub fn transition_duration(from: Posture, to: Posture) -> f64 {
    if from == to {
        return 0.0;
    }
    match (from, to) {
        (_, Posture::Standing) => 0.0,
        (Posture::Standing, Posture::Sitting) => SIT_TRANSITION_SEC,
        (Posture::Standing, Posture::Laying) => LAY_TRANSITION_SEC,
        (Posture::Sitting, Posture::Laying) | (Posture::Laying, Posture::Sitting) => {
            SIT_LAY_DIRECT_SEC
        }
        // Same-posture pair (Standing, Standing) is already short-
        // circuited above; (Sitting, Sitting) and (Laying, Laying) are
        // unreachable here.
        (Posture::Sitting, Posture::Sitting) | (Posture::Laying, Posture::Laying) => 0.0,
    }
}

/// healthRegen multiplier at the regen tick boundary. Only consulted
/// when posture is settled.
pub fn settled_regen_mult(posture: Posture) -> f64 {
    match posture {
        Posture::Standing => 1.0,
        Posture::Sitting => 1.5,
        Posture::Laying => 2.0,
    }
}

/// Negative-ailment natural-decay rate multiplier. Only consulted when
/// posture is settled.
pub fn settled_decay_mult(posture: Posture) -> f64 {
    match posture {
        Posture::Standing => 1.0,
        Posture::Sitting => 2.0,
        Posture::Laying => 4.0,
    }
}

/// Multiplier applied to incoming bite / breath damage when this side
/// is the defender and posture is settled.
pub fn settled_incoming_damage_mult(posture: Posture) -> f64 {
    match posture {
        Posture::Standing => 1.0,
        Posture::Sitting => 1.5,
        Posture::Laying => 1.75,
    }
}

/// Stable label for a posture, surfaced to the policy read-var
/// `<side>.is_posture.<P>`. The policy engine compares
/// it case-insensitively against the path segment, so a creature
/// reading `opp.is_posture.Laying` gets `1.0` when the opponent is
/// settled-or-not in the `Laying` posture. We expose the *committed*
/// (`posture_current`) value via this label, not the in-flight
/// `posture_pending`, so a mid-transition side still reports the
/// posture it is leaving until the transition settles.
pub(crate) fn posture_label(posture: Posture) -> &'static str {
    match posture {
        Posture::Standing => "Standing",
        Posture::Sitting => "Sitting",
        Posture::Laying => "Laying",
    }
}

/// "Negative" in the sense the user means for the decay boost: any
/// status whose canonical id falls into the ailment family we want the
/// posture system to clear faster. Conservative list - only adds
/// well-known harmful statuses. Healing / Fortify / Blessing's Boon are
/// intentionally excluded.
///
/// Engine convention: status keys are `"<Name>_Status"` or the
/// snake-cased non-suffixed variant (`"Bad_Omen"`, `"Malices_Mark"`,
/// `"Shredded_Wings"`). Matching is done by the raw key as stored on
/// `CombatSide.statuses`.
pub fn is_negative_ailment(status_id: &str) -> bool {
    matches!(
        status_id,
        "Burn_Status"
            | "Bleed_Status"
            | "Disease_Status"
            | "Poison_Status"
            | "Necropoison_Status"
            | "Corrosion_Status"
            | "Frostbite_Status"
            | "Hypothermia_Status"
            | "Freeze_Status"
            | "Shock_Status"
            | "Slow_Status"
            | "Drowsy_Status"
            | "Confusion_Status"
            | "Blurred_Vision_Status"
            | "Fear_Status"
            | "Scared_Status"
            | "Heartbroken_Status"
            | "Heat_Wave_Status"
            | "Injury_Status"
            | "Deep_Wounds_Status"
            | "Broken_Bones_Status"
            | "Broken_Legs_Status"
            | "Torn_Ligaments_Status"
            | "Shredded_Wings"
            | "Sticky_Teeth_Status"
            | "Stolen_Speed_Status"
            | "Water_Gale_Status"
            | "Bad_Omen"
            | "Malices_Mark"
            | "Aftershock"
    )
}

/// True when the side is fully settled in a non-Standing posture. Used
/// by the action-gating phase (Phase 2) and the regen / decay / damage
/// paths (Phase 1) to know when multipliers apply.
pub fn is_settled_non_standing(current: Posture, pending: Posture) -> bool {
    current != Posture::Standing && current == pending
}

/// Mutates the side to begin a transition to `target` posture. Emits a
/// "started <posture>" combat-log entry, computes the completion time
/// from `transition_duration`, and immediately deactivates Hunker on
/// this side (per spec: any transition cancels Hunker the moment the
/// intent is declared, regardless of whether the transition settles).
///
/// Stand-up transitions (target == Standing) are instant: this writes
/// `current = Standing` directly and emits "stood up". No completion
/// callback needed because there is no in-flight transition window.
///
/// Idempotency: requesting the SAME posture this side already holds
/// (or is already transitioning to) is a no-op - no log entry, no
/// Hunker re-trigger.
pub(crate) fn request_posture_transition(
    side: &mut super::CombatSide,
    target: Posture,
    time: f64,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    side_label: &str,
) {
    // Already there (or already heading there) - nothing to do.
    if side.posture_pending == target {
        return;
    }
    // Hunker requires Standing. Any transition kills it the moment it
    // starts - even Standing → Standing (idempotent above so won't
    // reach here) or stand-up from Sitting/Laying.
    side.hunker_on = false;
    let duration = transition_duration(side.posture_current, target);
    side.posture_pending = target;
    if duration <= 0.0 {
        // Stand-up (or any duration-0 transition) settles immediately.
        side.posture_current = target;
        side.posture_transition_complete_at = time;
        if record_trace {
            combat_log.push(crate::contracts::CombatLogEntry {
                time,
                entry_type: "ability".to_string(),
                attacker: side_label.to_string(),
                damage: 0.0,
                healing: None,
                actor_hp_after: side.hp.max(0.0),
                hp_side: side_label.to_string(),
                hp_after: side.hp.max(0.0),
                description: Some(posture_event_description(target, EventPhase::Instant).to_string()),
                detail: None,
                status_id: None,
            });
        }
        return;
    }
    side.posture_transition_complete_at = time + duration;
    if record_trace {
        combat_log.push(crate::contracts::CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: side_label.to_string(),
            damage: 0.0,
            healing: None,
            actor_hp_after: side.hp.max(0.0),
            hp_side: side_label.to_string(),
            hp_after: side.hp.max(0.0),
            description: Some(posture_event_description(target, EventPhase::Start).to_string()),
            detail: None,
            status_id: None,
        });
    }
}

/// If a transition was in flight and its completion time has elapsed,
/// promote `posture_current` to `posture_pending` and emit the
/// "is now <posture>" combat-log entry. Idempotent - calling on a
/// settled side is a no-op.
pub(crate) fn process_posture_settle(
    side: &mut super::CombatSide,
    time: f64,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    side_label: &str,
) {
    if side.posture_current == side.posture_pending {
        return; // settled
    }
    if time + 1e-9 < side.posture_transition_complete_at {
        return; // still in flight
    }
    side.posture_current = side.posture_pending;
    if record_trace {
        // Log timestamp comes from `posture_transition_complete_at`,
        // not `state.time`. The settle is event-driven (this function
        // is called lazily during a later iter where state.time has
        // jumped to the next scheduler event), so `state.time` reflects
        // when the engine NOTICED the settle, not when the settle
        // MATHEMATICALLY happened. UI users saw "Laying down @5.0,
        // Now laying @7.2" and asked why a 2-s lay-transition took
        // 2.2 s - fix is cosmetic but matches Reference spec
        // (Standing → Laying transition = exactly 2 s).
        //
        // Settled-posture multipliers ALREADY use the correct moment
        // - `process_posture_settle` is called from the pre-damage
        // phase before bite / breath / DoT damage applies, so any
        // event landing in [complete_at, state.time] window picks up
        // the new posture's multiplier. This change only fixes the
        // displayed timestamp.
        combat_log.push(crate::contracts::CombatLogEntry {
            time: side.posture_transition_complete_at,
            entry_type: "ability".to_string(),
            attacker: side_label.to_string(),
            damage: 0.0,
            healing: None,
            actor_hp_after: side.hp.max(0.0),
            hp_side: side_label.to_string(),
            hp_after: side.hp.max(0.0),
            description: Some(posture_event_description(side.posture_current, EventPhase::Complete).to_string()),
            detail: None,
            status_id: None,
        });
    }
}

enum EventPhase {
    Start,
    Complete,
    Instant,
}

fn posture_event_description(target: Posture, phase: EventPhase) -> &'static str {
    match (target, phase) {
        (Posture::Standing, EventPhase::Start) => "Standing up",
        (Posture::Standing, EventPhase::Complete) => "Stood up",
        (Posture::Standing, EventPhase::Instant) => "Stood up",
        (Posture::Sitting, EventPhase::Start) => "Sitting down",
        (Posture::Sitting, EventPhase::Complete) => "Now sitting",
        (Posture::Sitting, EventPhase::Instant) => "Now sitting",
        (Posture::Laying, EventPhase::Start) => "Laying down",
        (Posture::Laying, EventPhase::Complete) => "Now laying",
        (Posture::Laying, EventPhase::Instant) => "Now laying",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standing_up_is_instant_from_any_posture() {
        assert_eq!(transition_duration(Posture::Sitting, Posture::Standing), 0.0);
        assert_eq!(transition_duration(Posture::Laying, Posture::Standing), 0.0);
        assert_eq!(transition_duration(Posture::Standing, Posture::Standing), 0.0);
    }

    #[test]
    fn standing_to_sit_takes_one_second_lay_takes_two() {
        assert_eq!(transition_duration(Posture::Standing, Posture::Sitting), 1.0);
        assert_eq!(transition_duration(Posture::Standing, Posture::Laying), 2.0);
    }

    #[test]
    fn sit_lay_direct_one_second_each_way() {
        assert_eq!(transition_duration(Posture::Sitting, Posture::Laying), 1.0);
        assert_eq!(transition_duration(Posture::Laying, Posture::Sitting), 1.0);
    }

    #[test]
    fn settled_multipliers_match_spec() {
        assert_eq!(settled_regen_mult(Posture::Standing), 1.0);
        assert_eq!(settled_regen_mult(Posture::Sitting), 1.5);
        assert_eq!(settled_regen_mult(Posture::Laying), 2.0);

        assert_eq!(settled_decay_mult(Posture::Standing), 1.0);
        assert_eq!(settled_decay_mult(Posture::Sitting), 2.0);
        assert_eq!(settled_decay_mult(Posture::Laying), 4.0);

        assert_eq!(settled_incoming_damage_mult(Posture::Standing), 1.0);
        assert_eq!(settled_incoming_damage_mult(Posture::Sitting), 1.5);
        assert_eq!(settled_incoming_damage_mult(Posture::Laying), 1.75);
    }

    #[test]
    fn is_settled_non_standing_only_when_fully_in_non_standing_posture() {
        // Standing always returns false (it's the default).
        assert!(!is_settled_non_standing(Posture::Standing, Posture::Standing));
        // Mid-transition: pending != current → not settled yet.
        assert!(!is_settled_non_standing(Posture::Standing, Posture::Laying));
        // Fully laid:
        assert!(is_settled_non_standing(Posture::Laying, Posture::Laying));
        // Fully sitting:
        assert!(is_settled_non_standing(Posture::Sitting, Posture::Sitting));
        // sit↔lay direct in flight:
        assert!(!is_settled_non_standing(Posture::Sitting, Posture::Laying));
    }
}
