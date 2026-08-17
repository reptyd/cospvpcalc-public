//! Built-in stance (posture) decision.
//!
//! Reference: posture spec lives in `composable/posture.rs` (settled
//! multipliers, transition durations). The decision in this file
//! answers "which posture transition, if any, should the actor
//! request right now?" - Stay / StartSit / StartLay / StandUp.
//!
//! Why this isn't a `TimedDecision`
//!
//! Posture has four candidate actions per decision moment, not a
//! single fire/wait/skip choice - `VariantDecision` is closer in
//! shape. But unlike Bite-Variant, stance fitness can't be expressed
//! as a closed-form analytic utility: the gain of Lay vs Stand
//! depends on inter-tick regen scheduling, settled-Lay x 1.75
//! incoming penalty accumulation, status-stack decay over the inner
//! replay window, and the opponent's own bite/breath/ability
//! cadence. None of these are captured cleanly by `PolicyState`'s
//! built-in fields.
//!
//! Engine-replay is the durable answer (per
//! `feedback_posture_engine_replay` memory): clone the live state,
//! script the candidate posture transitions across an inner replay
//! horizon, run the real engine forward with
//! `posture_policy_override: ForcedOff` to avoid recursion, score by
//! the surviving HP / outlive duration. New abilities on either side
//! are picked up automatically - no hand-rolled DPS approximation
//! that drifts as the engine evolves.
//!
//! The trait surface in [`crate::policy::traits`] (`StanceDecision`,
//! `StanceSideView`, `StanceReplayer`) lets the decision express
//! "what plans to evaluate" without ever touching composable
//! internals. The engine-side bridge in
//! `composable/stance_bridge.rs` implements the [`StanceReplayer`]
//! over `LoopState` / `LoopParams`.
//!
//! Plans
//!
//! Two layers of candidates:
//!
//! 1. 13 hand-crafted closures encoding domain-knowledge
//!    strategies (sit-prep, status-decay, cyclic pre-tick fire,
//!    sustained sit/lay, ...). Each one is a small heuristic that
//!    targets one matchup shape.
//! 2. 255-path bounded tree search over the next four scheduled
//!    decision moments (`4 actions ^ 4 = 256` paths, minus the
//!    redundant `(Stay,Stay,Stay,Stay)` path which is
//!    fitness-equivalent to the baseline). Catches multi-step
//!    combinations no curated closure encodes.
//!
//! For each plan the decision asks the replayer for the plan's
//! fitness, keeps the best, and returns its IMMEDIATE action at the
//! current decision moment. Plans must beat the Stay baseline by
//! [`POLICY_FITNESS_MARGIN`] HP to flip - protects against numeric
//! noise.

use crate::composable::posture::{LAY_TRANSITION_SEC, SIT_LAY_DIRECT_SEC, SIT_TRANSITION_SEC};
use crate::policy::traits::{
    StanceAction, StanceDecision, StancePosture, StanceReplayer, StanceReplayOutcome, StanceSideView,
};

/// Stable id under which this decision registers in
/// [`crate::policy::registry::DecisionRegistry`].
pub const STANCE_DECISION_ID: &str = "builtin.stance_replay";

/// A stance plan closure: maps the actor's view + decision time to the
/// transition the plan would request at that moment.
type StancePlan = Box<dyn Fn(&dyn StanceSideView, f64) -> StanceAction>;

/// A labelled stance plan in the curated-plans vector.
type LabelledPlan = (&'static str, StancePlan);

/// Anti-jitter HP margin: a non-Stay plan must beat the Stay
/// baseline by this much (in fitness units) to flip. Prevents the
/// decision from oscillating on numeric noise across consecutive
/// decision moments.
///
/// History:
///   - was 25 HP; reduced to 5 (2026-05-22) after benchmark traces
///     showed late-fight lay candidates (e.g., Lay@28 catching the
///     final regen tick) gaining 10-20 HP over the Stay baseline -
///     strictly positive but below the 25-HP threshold.
///   - reduced to 1 (2026-05-22) once the engine was verified
///     to be deterministic for posture decisions (no per-tick RNG;
///     status RNG is pre-rolled deterministically). 5-HP threshold
///     was rejecting real micro-gains that compound across many
///     decision moments. The "never worse than off" 50-HP slack +
///     wider replay horizon (now `f64::INFINITY`, capped only by
///     `max_time_sec`) cushion against any residual float-rounding
///     noise - which is sub-1-HP in practice for typical fight
///     lengths.
pub const POLICY_FITNESS_MARGIN: f64 = 1.0;

/// Built-in stance decision: engine-replay over curated plans plus
/// a bounded tree search.
///
/// Stateless - the actor's runtime state arrives through
/// [`StanceSideView`] per call, the engine-replay primitive arrives
/// through [`StanceReplayer`]. Thread-safe by construction (no
/// interior state).
#[derive(Debug, Default, Clone)]
pub struct BuiltinStanceReplayDecision;

impl BuiltinStanceReplayDecision {
    pub fn new() -> Self {
        Self
    }
}

impl StanceDecision for BuiltinStanceReplayDecision {
    fn id(&self) -> &str {
        STANCE_DECISION_ID
    }

    fn decide(
        &self,
        actor: &dyn StanceSideView,
        decision_time: f64,
        replayer: &mut dyn StanceReplayer,
    ) -> StanceAction {
        // Decision-time captures used by tactical plans.
        let next_tick = if actor.next_regen_at().is_finite() {
            actor.next_regen_at()
        } else {
            f64::INFINITY
        };
        let lay_fire_at = next_tick - LAY_TRANSITION_SEC;
        let sit_fire_at = next_tick - SIT_TRANSITION_SEC;
        let stand_up_at = next_tick + 1e-3;

        let plans: Vec<LabelledPlan> = vec![
            ("stay", Box::new(|_, _| StanceAction::Stay)),
            // "Stand-up now" - distinct from Stay when the actor is
            // currently in a non-Standing pending. Without this the
            // Stay baseline locks the side in Lay forever inside the
            // inner replay and the decision can't see "stand up to
            // escape settled-Lay incoming penalty" as an option.
            (
                "stand-up",
                Box::new(|view: &dyn StanceSideView, _t: f64| {
                    if view.pending_posture() != StancePosture::Standing {
                        StanceAction::StandUp
                    } else {
                        StanceAction::Stay
                    }
                }),
            ),
            // Tactical pre-tick Sit: outer scheduler decisions may
            // drift up to ~1 s from the exact pre-tick moment due to
            // engine-event timing. Closure fires as long as `t` is
            // within [fire_at - tolerance, tick) - late enough to not
            // waste settled-pre-tick incoming, early enough that
            // decision drift doesn't skip the opportunity entirely.
            (
                "tactical-sit",
                Box::new(move |view: &dyn StanceSideView, t: f64| {
                    if t >= stand_up_at - 1e-9 {
                        if view.pending_posture() != StancePosture::Standing {
                            StanceAction::StandUp
                        } else {
                            StanceAction::Stay
                        }
                    } else if t >= sit_fire_at - 1.0
                        && t < next_tick
                        && view.pending_posture() != StancePosture::Sitting
                    {
                        StanceAction::StartSit
                    } else {
                        StanceAction::Stay
                    }
                }),
            ),
            (
                "tactical-lay",
                Box::new(move |view: &dyn StanceSideView, t: f64| {
                    if t >= stand_up_at - 1e-9 {
                        if view.pending_posture() != StancePosture::Standing {
                            StanceAction::StandUp
                        } else {
                            StanceAction::Stay
                        }
                    } else if t >= lay_fire_at - 1.0
                        && t < next_tick
                        && view.pending_posture() != StancePosture::Laying
                    {
                        StanceAction::StartLay
                    } else {
                        StanceAction::Stay
                    }
                }),
            ),
            // Cyclic variants: read `view.next_regen_at()` dynamically
            // each invocation. After a tick fires the engine advances
            // next_regen to the NEXT tick, so the closure naturally
            // re-enters its pre-tick fire window for each upcoming
            // tick across the full inner-replay horizon.
            (
                "tactical-sit-cyclic",
                Box::new(|view: &dyn StanceSideView, t: f64| {
                    let next_tick = view.next_regen_at();
                    if !next_tick.is_finite() {
                        return StanceAction::Stay;
                    }
                    let to_tick = next_tick - t;
                    if view.pending_posture() == StancePosture::Sitting
                        && to_tick > SIT_TRANSITION_SEC + 1.0 + 1e-9
                    {
                        return StanceAction::StandUp;
                    }
                    if to_tick > 0.0
                        && to_tick < SIT_TRANSITION_SEC + 1.0
                        && view.pending_posture() != StancePosture::Sitting
                    {
                        return StanceAction::StartSit;
                    }
                    StanceAction::Stay
                }),
            ),
            (
                "tactical-lay-cyclic",
                Box::new(|view: &dyn StanceSideView, t: f64| {
                    let next_tick = view.next_regen_at();
                    if !next_tick.is_finite() {
                        return StanceAction::Stay;
                    }
                    let to_tick = next_tick - t;
                    if view.pending_posture() == StancePosture::Laying
                        && to_tick > LAY_TRANSITION_SEC + 1.0 + 1e-9
                    {
                        return StanceAction::StandUp;
                    }
                    if to_tick > 0.0
                        && to_tick < LAY_TRANSITION_SEC + 1.0
                        && view.pending_posture() != StancePosture::Laying
                    {
                        return StanceAction::StartLay;
                    }
                    StanceAction::Stay
                }),
            ),
            // Sit-prep composite: pre-tick Sit window gives x1.5 regen
            // for the lead-up period AND a shorter Sit->Lay transition
            // (1 s) than Standing->Lay (2 s), so the side can spend
            // less time exposed to the x1.5 settled-Sit incoming
            // penalty and still land settled-Lay exactly at the tick.
            //
            // Listed BEFORE early-* variants: when sit-prep and
            // early-lay produce equal fitness, the "strictly better"
            // replacement rule favors the first one inserted.
            (
                "sit-prep-lay-cyclic",
                Box::new(|view: &dyn StanceSideView, t: f64| {
                    let next_tick = view.next_regen_at();
                    if !next_tick.is_finite() {
                        return StanceAction::Stay;
                    }
                    let to_tick = next_tick - t;
                    let lay_window = SIT_LAY_DIRECT_SEC + 1.0;
                    let sit_setup_window = 5.0;
                    if view.pending_posture() == StancePosture::Laying
                        && to_tick > LAY_TRANSITION_SEC + 1.0 + 1e-9
                    {
                        return StanceAction::StandUp;
                    }
                    if to_tick >= SIT_LAY_DIRECT_SEC - 1e-9
                        && to_tick <= lay_window
                        && view.pending_posture() == StancePosture::Sitting
                    {
                        return StanceAction::StartLay;
                    }
                    if (LAY_TRANSITION_SEC - 1e-9..=LAY_TRANSITION_SEC + 1.0).contains(&to_tick)
                        && view.pending_posture() == StancePosture::Standing
                    {
                        return StanceAction::StartLay;
                    }
                    if to_tick > lay_window
                        && to_tick <= sit_setup_window
                        && view.pending_posture() == StancePosture::Standing
                    {
                        return StanceAction::StartSit;
                    }
                    StanceAction::Stay
                }),
            ),
            // Broad-window variants: when the live scheduler runs on
            // a coarse 5 s cadence (regen-unaware mode), outer
            // decisions never land in the narrow [tick-3, tick)
            // pre-tick window, so `*-cyclic` returns Stay at every
            // outer decision (the inner replay still fires at the
            // right moment via the every-iter override, but the
            // IMMEDIATE action passed to the real engine is always
            // Stay). The "early-*" candidates widen the window to
            // DECISION_PERIODIC_SEC (5.0) so a decision at t=10 with
            // next_tick=15 fires StartLay@10 - settled-Lay by t=12
            // catches the tick at 15 under x2 regen mult.
            (
                "early-sit-cyclic",
                Box::new(|view: &dyn StanceSideView, t: f64| {
                    let next_tick = view.next_regen_at();
                    if !next_tick.is_finite() {
                        return StanceAction::Stay;
                    }
                    let to_tick = next_tick - t;
                    if view.pending_posture() == StancePosture::Sitting && to_tick > 5.0 + 1e-9 {
                        return StanceAction::StandUp;
                    }
                    if to_tick > 0.0
                        && to_tick <= 5.0
                        && view.pending_posture() != StancePosture::Sitting
                    {
                        return StanceAction::StartSit;
                    }
                    StanceAction::Stay
                }),
            ),
            (
                "early-lay-cyclic",
                Box::new(|view: &dyn StanceSideView, t: f64| {
                    let next_tick = view.next_regen_at();
                    if !next_tick.is_finite() {
                        return StanceAction::Stay;
                    }
                    let to_tick = next_tick - t;
                    if view.pending_posture() == StancePosture::Laying && to_tick > 5.0 + 1e-9 {
                        return StanceAction::StandUp;
                    }
                    if to_tick > 0.0
                        && to_tick <= 5.0
                        && view.pending_posture() != StancePosture::Laying
                    {
                        return StanceAction::StartLay;
                    }
                    StanceAction::Stay
                }),
            ),
            // Status-aware lay: settled Lay decays Fear / Burn /
            // Bleed / Disease / Poison stacks at x4 the natural rate.
            // For matchups where the opponent applies a big initial
            // stack load (Cause Fear -> 10 stacks, Plague Bomb,
            // breath-applied burn cascades), this closure lays the
            // side down to clear the status faster than standing
            // would, then stands up just before each regen tick to
            // avoid the x1.75 settled-Lay incoming penalty
            // compounding during the tick window. Threshold (>= 5
            // stacks) excludes incidental 1-2 stack residuals while
            // catching Cause Fear's 10-stack burst.
            (
                "lay-for-status-decay",
                Box::new(|view: &dyn StanceSideView, t: f64| {
                    let next_tick = view.next_regen_at();
                    let to_tick = if next_tick.is_finite() {
                        next_tick - t
                    } else {
                        f64::INFINITY
                    };
                    let high_stacks = view.total_status_stacks() >= 5.0;
                    let pre_tick = to_tick > 0.0 && to_tick <= LAY_TRANSITION_SEC + 1e-9;
                    if view.pending_posture() == StancePosture::Laying {
                        if pre_tick || !high_stacks {
                            return StanceAction::StandUp;
                        }
                        return StanceAction::Stay;
                    }
                    if high_stacks && !pre_tick {
                        return StanceAction::StartLay;
                    }
                    StanceAction::Stay
                }),
            ),
            // Time-anchored alternating lay/stand cycle (5 s phase
            // aligned with DECISION_PERIODIC_SEC). Targets matchups
            // where the opponent applies sustained status damage
            // (breath burst, repeated status applications). Lay
            // phase relies on x4 decay; stand phase recovers from
            // settled-lay incoming penalty. Gated on total stacks >=
            // 5 so the closure waits for the status load.
            (
                "alternating-status-lay",
                Box::new(|view: &dyn StanceSideView, t: f64| {
                    if view.total_status_stacks() < 5.0 {
                        return StanceAction::Stay;
                    }
                    let phase = (t / 5.0).floor() as i64;
                    let in_lay = phase.rem_euclid(2) == 0;
                    if in_lay {
                        if view.pending_posture() != StancePosture::Laying {
                            StanceAction::StartLay
                        } else {
                            StanceAction::Stay
                        }
                    } else if view.pending_posture() != StancePosture::Standing {
                        StanceAction::StandUp
                    } else {
                        StanceAction::Stay
                    }
                }),
            ),
            (
                "sustained-sit",
                Box::new(|view: &dyn StanceSideView, _t: f64| {
                    if view.pending_posture() != StancePosture::Sitting {
                        StanceAction::StartSit
                    } else {
                        StanceAction::Stay
                    }
                }),
            ),
            (
                "sustained-lay",
                Box::new(|view: &dyn StanceSideView, _t: f64| {
                    if view.pending_posture() != StancePosture::Laying {
                        StanceAction::StartLay
                    } else {
                        StanceAction::Stay
                    }
                }),
            ),
        ];

        let mut best: Option<(StanceAction, f64)> = None;
        let mut baseline_fitness: Option<f64> = None;

        // Death-race confirmation gate (bounded-horizon mode only). When
        // the replayer runs the terminal-value projection, we cannot let
        // the projection alone decide who-died-last trades (the
        // documented Opra/Gimon, Kendyll/Gore matchups). We collect the
        // beating candidates with their projected death timestamps; if
        // the winner is a death-in-tail OR the top-2 are a near-tie, we
        // re-run ONLY those top-2 with the exact unbounded engine. When
        // the flag is OFF `bounded` is false and this whole apparatus is
        // dormant - the loop below is byte-identical to the shipped path
        // (same `replay_with_plan` calls, same invocation count).
        let bounded = replayer.bounded_mode();
        let mut candidates: Vec<DeathRaceCandidate> = Vec::new();

        for (plan_idx, (label, plan)) in plans.iter().enumerate() {
            // Applicability gate (cost optimization).
            //
            // A plan that returns Stay at every inner-replay
            // invocation is fitness-equivalent to the baseline Stay
            // replay (the engine sees the same overrides). Running
            // its full clone-and-replay is wasted compute. Skip
            // those candidates BEFORE the inner replay fires.
            //
            // Gates here are conservative - they only return false
            // when the plan would PROVABLY return Stay throughout
            // the inner replay regardless of the trajectory:
            //
            // - "stand-up": fires only when pending != Standing.
            //   Pending stays Standing throughout the replay when
            //   the override never requests a transition. So if
            //   the actor starts pending=Standing, plan returns
            //   Stay every iter -> skip.
            // - "sustained-sit" / "sustained-lay": symmetric - when
            //   already pending in the target posture, plan
            //   returns Stay every iter.
            // - tactical / cyclic / sit-prep / early-* plans (5
            //   total): all check `view.next_regen_at()` and
            //   return Stay when infinite. `next_regen_at()`
            //   becomes infinite when the side has zero health
            //   regen; health regen is a fixed stat that does not
            //   appear mid-fight, so the infinite-regen check
            //   holds throughout the replay.
            //
            // Status-aware plans (lay-for-status-decay,
            // alternating-status-lay) intentionally NOT gated -
            // status stacks can grow mid-replay even from a
            // zero-stacks start, so gating on stacks at decision
            // time would falsely skip plans that catch a delayed
            // status burst.
            //
            // The "stay" baseline always runs (it sets
            // baseline_fitness for the margin check below). Gate
            // applies to non-Stay plans only.
            if *label != "stay" && !plan_applies(label, actor) {
                continue;
            }

            // Bounded mode wants death timestamps for the gate; the
            // unbounded path uses the lighter fitness-only call so its
            // invocation count and result stay byte-identical.
            let fitness = if bounded {
                replayer.replay_with_plan_detailed(plan.as_ref()).fitness
            } else {
                replayer.replay_with_plan(plan.as_ref())
            };

            if *label == "stay" {
                baseline_fitness = Some(fitness);
                let pending = actor.pending_posture();
                let stay_action = if pending != StancePosture::Standing {
                    StanceAction::StandUp
                } else {
                    StanceAction::Stay
                };
                best = Some((stay_action, fitness));
                continue;
            }

            let baseline = baseline_fitness.unwrap_or(fitness);
            if fitness <= baseline + POLICY_FITNESS_MARGIN {
                continue;
            }

            let immediate_action = plan(actor, decision_time);
            if bounded {
                candidates.push(DeathRaceCandidate {
                    immediate_action,
                    fitness,
                    kind: PlanKind::Curated(plan_idx),
                });
            }
            match best {
                None => best = Some((immediate_action, fitness)),
                Some((_, prev)) if fitness > prev => best = Some((immediate_action, fitness)),
                _ => {}
            }
        }

        // Bounded tree search (depth=4): 4 ^ 4 = 256 paths across the
        // next four scheduled decision moments. Complements the
        // curated closures by SYSTEMATICALLY exploring multi-step
        // combinations (e.g. Sit->Lay->Stand->Lay) no single closure
        // captures.
        //
        // Depth history (each bump tied to a missed beam-ideal shape):
        //   - depth-2 (16 paths) reached ~45 % capture on bench
        //     scenarios 9-12.
        //   - depth-3 (64 paths) caught the late-mid-fight
        //     (Stay@20, Sit@25, Lay@28) shape that depth-2 from
        //     t=15.4 structurally couldn't reach. Reached 52 %
        //     capture on the Opra vs Gimon real-Compare benchmark.
        //   - depth-4 (2026-05-22, this commit): adds the
        //     (Stay@20, Sit@25, Lay@28, Stand@30) and
        //     (Lay@T, Stand@T+5, Lay@T+10, Stand@T+15) endgame-cycle
        //     shapes the rolling-ideal benchmark trajectory uses
        //     (Lay@10..Stand@13..Lay@15..Stand@20..Lay@25 ...). Cost
        //     scales 4x over depth-3 (256 vs 64 paths). Acceptable
        //     for Compare; Best Builds disables posture policy.
        const TREE_ACTIONS: [StanceAction; 4] = [
            StanceAction::Stay,
            StanceAction::StartSit,
            StanceAction::StartLay,
            StanceAction::StandUp,
        ];
        // Per-leaf recorder: the SSSS skip + flip-gate + candidate push + best
        // update, shared by the nested-loop path and the checkpoint DFS so both
        // run the identical selection on the identical candidate set/order.
        let mut record =
            |a1: StanceAction, a2: StanceAction, a3: StanceAction, a4: StanceAction, outcome: StanceReplayOutcome| {
                // The (Stay, Stay, Stay, Stay) path is fitness-equivalent to the
                // baseline "stay" plan already evaluated above.
                if a1 == StanceAction::Stay
                    && a2 == StanceAction::Stay
                    && a3 == StanceAction::Stay
                    && a4 == StanceAction::Stay
                {
                    return;
                }
                let fitness = outcome.fitness;
                let baseline = baseline_fitness.unwrap_or(fitness);
                if fitness <= baseline + POLICY_FITNESS_MARGIN {
                    return;
                }
                if bounded {
                    candidates.push(DeathRaceCandidate {
                        immediate_action: a1,
                        fitness,
                            kind: PlanKind::Tree(a1, a2, a3, a4),
                    });
                }
                match best {
                    None => best = Some((a1, fitness)),
                    Some((_, prev)) if fitness > prev => best = Some((a1, fitness)),
                    _ => {}
                }
            };

        // Exact shared-prefix checkpoint DFS when enabled; else the
        // byte-identical 4-nested-loop search. Both feed the same `record`.
        let used_checkpoint =
            replayer.tree_checkpoint_mode() && replayer.tree_search_checkpointed(&mut record);
        if !used_checkpoint {
            for &a1 in &TREE_ACTIONS {
                for &a2 in &TREE_ACTIONS {
                    for &a3 in &TREE_ACTIONS {
                        for &a4 in &TREE_ACTIONS {
                            if a1 == StanceAction::Stay
                                && a2 == StanceAction::Stay
                                && a3 == StanceAction::Stay
                                && a4 == StanceAction::Stay
                            {
                                continue;
                            }
                            let quad_plan = make_quad_plan(a1, a2, a3, a4);
                            let outcome = if bounded {
                                replayer.replay_with_plan_detailed(&quad_plan)
                            } else {
                                StanceReplayOutcome {
                                    fitness: replayer.replay_with_plan(&quad_plan),
                                    me_death: None,
                                    op_death: None,
                                }
                            };
                            record(a1, a2, a3, a4, outcome);
                        }
                    }
                }
            }
        }

        // Posture<->toggle coordination (Move 2): the augmented "hold Standing
        // with the actor's toggle forced to its optimistic feasible plan"
        // candidate. Emitted only when the replayer reports a posture-gated
        // toggle to coordinate (toggle rollout on). Scored through the SAME
        // replayer and pushed into the SAME candidate pool, so it flows through
        // the death-race gate and is re-confirmed at the exact horizon against
        // the true-OFF floor (which now carries the committed toggle plan) - it
        // can never commit worse than standing up. This breaks the cold-start
        // (Sit, Off) trap where the committed-Off tag hides the toggle's
        // buffered-regen value from every standing candidate.
        if replayer.has_coordinated_toggle() {
            let outcome = replayer.replay_coordinated_standing();
            let baseline = baseline_fitness.unwrap_or(outcome.fitness);
            if outcome.fitness > baseline + POLICY_FITNESS_MARGIN {
                let immediate_action = if actor.pending_posture() != StancePosture::Standing {
                    StanceAction::StandUp
                } else {
                    StanceAction::Stay
                };
                if bounded {
                    candidates.push(DeathRaceCandidate {
                        immediate_action,
                        fitness: outcome.fitness,
                            kind: PlanKind::Coordinated,
                    });
                }
                match best {
                    None => best = Some((immediate_action, outcome.fitness)),
                    Some((_, prev)) if outcome.fitness > prev => {
                        best = Some((immediate_action, outcome.fitness))
                    }
                    _ => {}
                }
            }
        }

        // Death-race confirmation gate (bounded mode only). If the
        // windowed winner is a projected death-in-tail, or the top-2
        // beating candidates are a near-tie (projected death-times within
        // 2 s, or projected fitness within POLICY_FITNESS_MARGIN), the
        // projection is too coarse to trust - re-run ONLY those two
        // plans with the exact unbounded engine and pick by exact
        // fitness.
        if bounded {
            if let Some(resolved) =
                run_death_race_gate(&candidates, &plans, actor, replayer)
            {
                return resolved;
            }
        }

        best.map(|(a, _)| a).unwrap_or(StanceAction::Stay)
    }
}

/// A beating candidate retained for the bounded-mode death-race gate.
struct DeathRaceCandidate {
    immediate_action: StanceAction,
    fitness: f64,
    kind: PlanKind,
}

/// Identifies which plan a candidate came from so the death-race gate
/// can rebuild and re-run it at the exact unbounded horizon.
enum PlanKind {
    /// Index into the curated `plans` vector.
    Curated(usize),
    /// A depth-4 tree path; rebuilt via [`make_quad_plan`].
    Tree(StanceAction, StanceAction, StanceAction, StanceAction),
    /// Move 2: the augmented "hold Standing + toggle optimistic" candidate,
    /// re-run at the exact horizon via [`StanceReplayer::replay_coordinated_standing_exact`].
    Coordinated,
}

/// Build a depth-4 tree-search plan closure: returns `a1..a4` on the
/// first four invocations, then `Stay`. Shared between the tree search
/// and the death-race gate's exact re-run so both reconstruct the same
/// trajectory.
fn make_quad_plan(
    a1: StanceAction,
    a2: StanceAction,
    a3: StanceAction,
    a4: StanceAction,
) -> impl Fn(&dyn StanceSideView, f64) -> StanceAction {
    let counter = std::cell::Cell::new(0u32);
    move |_view: &dyn StanceSideView, _t: f64| {
        let n = counter.get();
        counter.set(n + 1);
        match n {
            0 => a1,
            1 => a2,
            2 => a3,
            3 => a4,
            _ => StanceAction::Stay,
        }
    }
}

/// Re-run a candidate at the exact unbounded horizon and return its
/// exact fitness. Reconstructs the plan from its [`PlanKind`].
fn replay_candidate_exact(
    candidate: &DeathRaceCandidate,
    plans: &[LabelledPlan],
    replayer: &mut dyn StanceReplayer,
) -> f64 {
    match candidate.kind {
        PlanKind::Curated(idx) => replayer.replay_with_plan_exact(plans[idx].1.as_ref()),
        PlanKind::Tree(a1, a2, a3, a4) => {
            let plan = make_quad_plan(a1, a2, a3, a4);
            replayer.replay_with_plan_exact(&plan)
        }
        PlanKind::Coordinated => replayer.replay_coordinated_standing_exact(),
    }
}

/// The death-race confirmation gate. Returns `Some(action)` when it
/// resolves the decision (replacing the windowed winner), or `None`
/// when no gate condition fires (caller keeps the windowed `best`).
///
/// Fires when EITHER:
///   - the windowed winner's projected outcome is a death-in-tail
///     (the actor or the opponent is projected to die), OR
///   - the top-2 beating candidates are a near-tie: projected
///     `|me_death - op_death|` within 2 s on either, or projected
///     fitness within [`POLICY_FITNESS_MARGIN`].
///
/// In all firing cases the top-2 beating candidates (plus the current
/// `best` action if it is the Stay/StandUp baseline) are re-projected
/// at the exact unbounded engine horizon and the highest exact fitness
/// wins.
fn run_death_race_gate(
    candidates: &[DeathRaceCandidate],
    plans: &[LabelledPlan],
    actor: &dyn StanceSideView,
    replayer: &mut dyn StanceReplayer,
) -> Option<StanceAction> {
    // The "no worse than off" invariant is enforced HERE, at decision time, by
    // re-confirming every commit against the EXACT true-off line. The windowed
    // projection that ranks candidates is too coarse to trust on its own - it
    // can mis-price a catastrophic line as "almost even" when the bounded-window
    // edge lands on the survivor's DoT trough (measured ~7000 HP off) - so a
    // commit is never made on the windowed score alone. This runs in every
    // bounded decision (no death-tail / near-tie early-out): the exact floor is
    // cheap insurance and is the only thing that makes the guarantee a runtime
    // contract rather than a sampled property test.

    // Exact TRUE-OFF baseline: plans[1] is the "stand-up" closure (stand up,
    // then hold Standing) - exactly what posture-off does. This is the floor.
    // NOT plans[0] ("stay"), which holds the CURRENT posture: re-confirming a
    // settled-Laying actor against "keep laying" cannot enforce "no worse than
    // OFF" and is the root of the lay-into-death bug.
    let off_exact = replayer.replay_with_plan_exact(plans[1].1.as_ref());
    let off_action = if actor.pending_posture() != StancePosture::Standing {
        StanceAction::StandUp
    } else {
        StanceAction::Stay
    };

    // Exact keep-current baseline: plans[0] ("stay") holds the current posture.
    // Kept in the comparison so a beneficial settled posture (e.g. Sitting for
    // regen) that is itself >= off is preserved rather than forced to stand up.
    let keep_exact = replayer.replay_with_plan_exact(plans[0].1.as_ref());

    // Default to holding the current posture, but never hold one that loses to
    // simply standing up (the floor): if keep-current is worse than off by more
    // than the anti-jitter margin, fall to the off action.
    let (mut best_action, mut best_exact) = if keep_exact + POLICY_FITNESS_MARGIN >= off_exact {
        (StanceAction::Stay, keep_exact)
    } else {
        (off_action, off_exact)
    };
    // Move 2 handoff: whether the confirmed winner is the augmented
    // standing+toggle candidate. Reported to the replayer so the bridge can
    // commit the toggle plan + advance its epoch in the same iteration.
    let mut best_is_coordinated = false;

    // Rank beating candidates by windowed fitness and exact-confirm the top few.
    // A candidate is committed only if it (1) is no worse than off and (2) beats
    // the current default by the anti-jitter margin. The exact off floor makes
    // the committed action >= off regardless of how the windowed ranking evicted
    // candidates, so widening the confirmed pool is a quality lever, not a
    // safety one (left at the top-2 the windowed pass surfaces).
    let mut order: Vec<usize> = (0..candidates.len()).collect();
    order.sort_by(|&i, &j| {
        candidates[j]
            .fitness
            .partial_cmp(&candidates[i].fitness)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut to_confirm: Vec<usize> = order.iter().take(2).copied().collect();
    // The Move 2 augmented candidate is ALWAYS exact-confirmed, even when the
    // bounded window under-ranks it out of the top-2: settled Sit/Lay's x1.5-2
    // regen looks better inside the window but loses the incoming-penalty race
    // by the exact horizon, and the harvest's value only shows up at the exact
    // horizon. Without this the cold-start (Sit, Off) trap never bootstraps -
    // the harvest can't enter the OFF floor until the toggle is committed
    // Harvest, and that commit happens only once this candidate wins.
    if let Some(coord_idx) = candidates
        .iter()
        .position(|c| matches!(c.kind, PlanKind::Coordinated))
    {
        if !to_confirm.contains(&coord_idx) {
            to_confirm.push(coord_idx);
        }
    }
    for idx in to_confirm {
        let candidate = &candidates[idx];
        let exact_fitness = replay_candidate_exact(candidate, plans, replayer);
        if exact_fitness >= off_exact - 1e-9 && exact_fitness > best_exact + POLICY_FITNESS_MARGIN {
            best_action = candidate.immediate_action;
            best_exact = exact_fitness;
            best_is_coordinated = matches!(candidate.kind, PlanKind::Coordinated);
        }
    }

    replayer.note_coordinated_winner(best_is_coordinated);
    Some(best_action)
}

/// Applicability predicate for curated plans (cost gate - see usage
/// in [`BuiltinStanceReplayDecision::decide`]). Returns `false` ONLY
/// when the plan would PROVABLY return `Stay` at every inner-replay
/// decision invocation given the actor's current view; otherwise
/// returns `true` (run the replay).
///
/// Conservatism guideline: when in doubt, return `true`. A
/// false-positive (running an unproductive replay) only costs
/// compute; a false-negative (skipping a productive replay) silently
/// loses policy quality.
fn plan_applies(label: &str, view: &dyn StanceSideView) -> bool {
    match label {
        // "stand-up" fires only when pending != Standing. Pending
        // never changes mid-replay without an override request, so
        // a Standing actor stays Standing and the plan returns Stay
        // throughout.
        "stand-up" => view.pending_posture() != StancePosture::Standing,

        // tactical / cyclic / sit-prep / early-* plans short-circuit
        // to Stay when `next_regen_at()` is infinite. That happens
        // when the side has zero health regen - a fixed stat that
        // does not appear mid-fight, so the infinite-regen check
        // holds throughout.
        "tactical-sit"
        | "tactical-lay"
        | "tactical-sit-cyclic"
        | "tactical-lay-cyclic"
        | "sit-prep-lay-cyclic"
        | "early-sit-cyclic"
        | "early-lay-cyclic" => view.next_regen_at().is_finite(),

        // sustained-sit / sustained-lay return Stay when already in
        // their target pending posture. Pending stays in target
        // unless the override moves it away - but the plan itself
        // never requests StandUp/transition out of target, so once
        // settled the plan stays Stay forever.
        "sustained-sit" => view.pending_posture() != StancePosture::Sitting,
        "sustained-lay" => view.pending_posture() != StancePosture::Laying,

        // Status-aware plans (lay-for-status-decay,
        // alternating-status-lay) and the baseline "stay" always
        // apply. Status stacks can appear mid-replay even from a
        // zero start (opponent applies status), so gating on
        // current stacks would skip productive plans.
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Trivial fake view: standing, no statuses, next_regen at +inf.
    /// Replayer just returns 0.0 for every plan, so the decision
    /// falls back to Stay -> StandUp logic by pending == Standing.
    struct StandingView;
    impl StanceSideView for StandingView {
        fn pending_posture(&self) -> StancePosture {
            StancePosture::Standing
        }
        fn next_regen_at(&self) -> f64 {
            f64::INFINITY
        }
        fn total_status_stacks(&self) -> f64 {
            0.0
        }
    }

    struct ConstReplayer {
        fitness: f64,
        invocations: RefCell<u32>,
    }
    impl StanceReplayer for ConstReplayer {
        fn replay_with_plan(
            &mut self,
            _plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
        ) -> f64 {
            *self.invocations.borrow_mut() += 1;
            self.fitness
        }
    }

    #[test]
    fn id_is_stable_namespaced() {
        assert_eq!(BuiltinStanceReplayDecision::new().id(), "builtin.stance_replay");
    }

    #[test]
    fn no_plan_beats_baseline_returns_stay_when_pending_standing() {
        let d = BuiltinStanceReplayDecision::new();
        let view = StandingView;
        let mut replayer = ConstReplayer { fitness: 100.0, invocations: 0.into() };
        let action = d.decide(&view, 0.0, &mut replayer);
        // Every plan ties at 100.0 -> no plan beats Stay + margin -> Stay.
        assert_eq!(action, StanceAction::Stay);
        // With plan gates active for StandingView (next_regen=inf,
        // pending=Standing):
        //   - "stand-up" skipped (pending == Standing)
        //   - tactical/cyclic/sit-prep/early-* skipped (next_regen inf):
        //     7 plans total
        //   - "sustained-sit" / "sustained-lay" still run (pending !=
        //     Sitting/Laying)
        // 13 plans - 8 skipped = 5 plans run.
        // Tree search: 4^4 = 256 paths - 1 (Stay,Stay,Stay,Stay
        // redundant with baseline) = 255 paths.
        // Total = 5 + 255 = 260 invocations.
        assert_eq!(*replayer.invocations.borrow(), 5 + 255);
    }

    /// Per-plan-label fitness replayer: returns the configured fitness
    /// the first time it sees a plan via the label hint encoded into
    /// the plan's first invocation. (No direct way to tell plans
    /// apart from the replayer; instead we just check that decisions
    /// dispatch through `replay_with_plan` the expected number of
    /// times.)
    struct VariableReplayer {
        sequence: Vec<f64>,
        idx: RefCell<usize>,
    }
    impl StanceReplayer for VariableReplayer {
        fn replay_with_plan(
            &mut self,
            _plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
        ) -> f64 {
            let mut idx = self.idx.borrow_mut();
            let v = self.sequence.get(*idx).copied().unwrap_or(0.0);
            *idx += 1;
            v
        }
    }

    #[test]
    fn plan_beating_baseline_by_margin_flips_decision() {
        // Stay at 0.0 (baseline). Stand-up (2nd plan) at 100.0 ->
        // beats baseline + margin (5.0). Since the view reports
        // pending=Standing, stand-up's immediate action is Stay.
        // So even with stand-up winning, decision is Stay. Use a
        // sitting view instead.
        struct SittingView;
        impl StanceSideView for SittingView {
            fn pending_posture(&self) -> StancePosture {
                StancePosture::Sitting
            }
            fn next_regen_at(&self) -> f64 {
                f64::INFINITY
            }
            fn total_status_stacks(&self) -> f64 {
                0.0
            }
        }
        let d = BuiltinStanceReplayDecision::new();
        let view = SittingView;
        // SittingView (pending=Sitting, next_regen=inf) under plan
        // gates runs: stay, stand-up, lay-for-status-decay,
        // alternating-status-lay, sustained-lay (5 plans). All
        // tactical/cyclic and sustained-sit are skipped.
        //
        // 1st invocation (stay) = baseline 0.0. 2nd (stand-up) =
        // 100.0 - beats baseline + margin, plan returns StandUp
        // (immediate action) since pending != Standing. Other 3
        // plans + 255 tree-search paths return 0.0 - none beat.
        let mut seq = vec![0.0, 100.0];
        seq.extend(std::iter::repeat_n(0.0, 3 + 255));
        let mut replayer = VariableReplayer {
            sequence: seq,
            idx: 0.into(),
        };
        let action = d.decide(&view, 0.0, &mut replayer);
        // Stand-up immediate action on Sitting actor is StandUp.
        assert_eq!(action, StanceAction::StandUp);
    }
}
