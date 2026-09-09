//! The two things a breath rolls in the game - whether a tick crits, and
//! whether a tick's ailment lands - and the three ways this engine can resolve
//! them. See [`SimpleBreathRollMode`].
//!
//! Both rolls share one shape: a chance per tick, and a payload the chance
//! carries (a damage multiplier, a stack count). `Pseudo` applies the chance
//! times the payload on every tick. `Even` applies nothing until the chances
//! so far add up to a whole event, then applies the payload in full. `Random`
//! draws the chance on every tick.

use crate::contracts::{SimpleAppliedStatus, SimpleBreathProfile};

use super::config::SimpleBreathRollMode;
use super::side::CombatSide;

/// The multiplier a crit lands: the game's breath crit is 1.5x.
pub(crate) const BREATH_CRIT_MULTIPLIER: f64 = 1.5;

/// Whether the event with probability `p` (0..1) happens on this tick, under
/// `Even`. `accum` holds the chances accumulated since the last event.
fn even_event(accum: &mut f64, p: f64) -> bool {
    if p <= 0.0 {
        return false;
    }
    if p >= 1.0 {
        return true;
    }
    *accum += p;
    if *accum >= 1.0 - 1e-9 {
        *accum -= 1.0;
        true
    } else {
        false
    }
}

fn random_event(rng: &mut u64, p: f64) -> bool {
    if p <= 0.0 {
        return false;
    }
    if p >= 1.0 {
        return true;
    }
    super::aerial_dodge_next_unit(rng) < p
}

/// The factor this tick's breath damage takes for its crit chance, or `None`
/// where the caller's own pseudo-crit formula should stand.
pub(crate) fn crit_factor(
    mode: SimpleBreathRollMode,
    breath: &SimpleBreathProfile,
    actor: &mut CombatSide,
) -> Option<f64> {
    if breath.crit_chance_pct <= 0.0 {
        return None;
    }
    let p = (breath.crit_chance_pct / 100.0).clamp(0.0, 1.0);
    match mode {
        SimpleBreathRollMode::Pseudo => None,
        SimpleBreathRollMode::Even => Some(if even_event(&mut actor.breath_crit_accum, p) {
            BREATH_CRIT_MULTIPLIER
        } else {
            1.0
        }),
        SimpleBreathRollMode::Random => Some(if random_event(&mut actor.breath_roll_rng, p) {
            BREATH_CRIT_MULTIPLIER
        } else {
            1.0
        }),
    }
}

/// What a tick's ailment payload lands as. An entry with no chance of its own
/// is certain, so it passes through unchanged; that covers every application
/// outside a breath and every breath payload the bridge has already averaged.
pub(crate) fn resolve_payload(
    mode: SimpleBreathRollMode,
    actor: &mut CombatSide,
    payload: &[SimpleAppliedStatus],
) -> Option<Vec<SimpleAppliedStatus>> {
    if payload.iter().all(|s| s.probability_pct.is_none()) {
        return None;
    }
    let mut out: Vec<SimpleAppliedStatus> = Vec::with_capacity(payload.len());
    for entry in payload {
        let Some(pct) = entry.probability_pct else {
            out.push(entry.clone());
            continue;
        };
        let p = (pct / 100.0).clamp(0.0, 1.0);
        let stacks = match mode {
            SimpleBreathRollMode::Pseudo => entry.stacks * p,
            SimpleBreathRollMode::Even => {
                let accum = actor
                    .breath_proc_accum
                    .entry(entry.status_id.clone())
                    .or_insert(0.0);
                if even_event(accum, p) {
                    entry.stacks
                } else {
                    0.0
                }
            }
            SimpleBreathRollMode::Random => {
                if random_event(&mut actor.breath_roll_rng, p) {
                    entry.stacks
                } else {
                    0.0
                }
            }
        };
        if stacks > 0.0 {
            out.push(SimpleAppliedStatus {
                stacks,
                probability_pct: None,
                ..entry.clone()
            });
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composable::reference_tests::{default_breath, default_combatant};

    fn side() -> CombatSide {
        CombatSide::new(&default_combatant(), None)
    }

    fn payload(pct: f64, stacks: f64) -> Vec<SimpleAppliedStatus> {
        vec![SimpleAppliedStatus {
            status_id: "Burn_Status".to_string(),
            stacks,
            probability_pct: Some(pct),
            ..Default::default()
        }]
    }

    fn landed(out: &Option<Vec<SimpleAppliedStatus>>) -> f64 {
        out.as_ref()
            .map(|v| v.iter().map(|s| s.stacks).sum())
            .unwrap_or(0.0)
    }

    #[test]
    fn pseudo_spends_the_average_every_tick() {
        let mut s = side();
        let out = resolve_payload(SimpleBreathRollMode::Pseudo, &mut s, &payload(20.0, 1.0));
        assert!((landed(&out) - 0.2).abs() < 1e-9);
    }

    #[test]
    fn even_spends_a_whole_stack_on_the_fifth_tick_of_a_fifth_chance() {
        let mut s = side();
        let mut per_tick = Vec::new();
        for _ in 0..10 {
            let out = resolve_payload(SimpleBreathRollMode::Even, &mut s, &payload(20.0, 1.0));
            per_tick.push(landed(&out));
        }
        assert_eq!(per_tick, vec![0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn ten_ticks_land_the_same_total_either_way() {
        let mut pseudo = side();
        let mut even = side();
        let pseudo_total: f64 = (0..10)
            .map(|_| landed(&resolve_payload(SimpleBreathRollMode::Pseudo, &mut pseudo, &payload(20.0, 1.0))))
            .sum();
        let even_total: f64 = (0..10)
            .map(|_| landed(&resolve_payload(SimpleBreathRollMode::Even, &mut even, &payload(20.0, 1.0))))
            .sum();
        assert!((pseudo_total - even_total).abs() < 1e-9);
    }

    #[test]
    fn a_payload_with_no_chance_of_its_own_is_left_alone() {
        let mut s = side();
        let certain = vec![SimpleAppliedStatus {
            status_id: "Burn_Status".to_string(),
            stacks: 3.0,
            ..Default::default()
        }];
        assert!(resolve_payload(SimpleBreathRollMode::Even, &mut s, &certain).is_none());
    }

    #[test]
    fn even_crits_on_every_fourth_tick_of_a_quarter_chance() {
        let mut s = side();
        let mut breath = default_breath();
        breath.crit_chance_pct = 25.0;
        let factors: Vec<f64> = (0..8)
            .map(|_| crit_factor(SimpleBreathRollMode::Even, &breath, &mut s).unwrap())
            .collect();
        assert_eq!(factors, vec![1.0, 1.0, 1.0, 1.5, 1.0, 1.0, 1.0, 1.5]);
    }

    #[test]
    fn pseudo_leaves_the_crit_to_the_damage_formula() {
        let mut s = side();
        let mut breath = default_breath();
        breath.crit_chance_pct = 25.0;
        assert!(crit_factor(SimpleBreathRollMode::Pseudo, &breath, &mut s).is_none());
    }
}
