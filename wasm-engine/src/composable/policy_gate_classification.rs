//! Measurement harness: does the precision timing-search add value per
//! ability on real (synthetic) matchups, or is it vestigial?
//!
//! Isolates ONE ability at a time on the attacker (side A) and runs a spread of
//! strong opponents (side B) across a health sweep that brackets near-tie
//! shells (where the winner flips). For each cell it runs the ability disabled
//! ("off"), and enabled under ReallyFast / Ideal / Extreme via the per-ability
//! timing override, and compares winner + death timestamps.
//!
//! Vestigial <=> `Ideal == ReallyFast == Extreme` on the winner: the timing
//! search reproduces the gate, so the hand `utility()` is dead weight and the
//! decision can be reduced to its gate. `Ideal != ReallyFast` on the winner <=>
//! precision changes the outcome => keep the analytic value.
//!
//! Run:
//!   cargo test --lib policy_gate_classification -- --ignored --nocapture

use super::config::ComposableAbilityConfig;
use super::{simulate_composable_matchup, simulate_composable_matchup_with_trace};
use crate::contracts::{
    AbilityPolicyOverrides, SimpleAbilityTimingMode as Mode, SimpleAppliedStatus,
    SimpleCombatantStats, Winner,
};

const MAX_TIME: f64 = 300.0;
const WEIGHT: f64 = 1_000.0; // equal weight -> weight_ratio 1.0 -> bite deals `damage`

#[derive(Clone, Copy, PartialEq)]
struct Outcome {
    winner: Winner,
    da: f64,
    db: f64,
}

impl Outcome {
    fn death_close(a: f64, b: f64) -> bool {
        (a - b).abs() <= 0.01
    }
    /// Full-outcome equality: winner AND both death timestamps (0.01 s grid).
    fn same(&self, o: &Outcome) -> bool {
        self.winner == o.winner
            && Self::death_close(self.da, o.da)
            && Self::death_close(self.db, o.db)
    }
}

/// The abilities under test, each with the config wiring that enables it on the
/// attacker and sets its per-ability timing override.
#[derive(Clone, Copy)]
enum Ability {
    Reflect,
    Cocoon,
    UnbridledRage,
    Adrenaline,
    Rewind,
    LifeLeech,
    HuntersCurse,
    GuardiansPassage,
}

impl Ability {
    fn name(self) -> &'static str {
        match self {
            Ability::Reflect => "Reflect",
            Ability::Cocoon => "Cocoon",
            Ability::UnbridledRage => "Unbridled Rage",
            Ability::Adrenaline => "Adrenaline",
            Ability::Rewind => "Rewind",
            Ability::LifeLeech => "Life Leech",
            Ability::HuntersCurse => "Hunters Curse",
            Ability::GuardiansPassage => "Guardians Passage",
        }
    }

    fn enable(self, cfg: &mut ComposableAbilityConfig) {
        match self {
            Ability::Reflect => cfg.attacker_reflect = true,
            Ability::Cocoon => cfg.attacker_cocoon = true,
            Ability::UnbridledRage => cfg.attacker_unbridled_rage = true,
            Ability::Adrenaline => cfg.attacker_adrenaline = true,
            Ability::Rewind => cfg.attacker_rewind = true,
            Ability::LifeLeech => cfg.attacker_life_leech_value = 0.25,
            Ability::HuntersCurse => cfg.attacker_hunters_curse = true,
            Ability::GuardiansPassage => cfg.attacker_guardians_passage = true,
        }
    }

    fn set_override(self, ov: &mut AbilityPolicyOverrides, mode: Mode) {
        match self {
            Ability::Reflect => ov.reflect = Some(mode),
            Ability::Cocoon => ov.cocoon = Some(mode),
            Ability::UnbridledRage => ov.unbridled_rage = Some(mode),
            Ability::Adrenaline => ov.adrenaline = Some(mode),
            Ability::Rewind => ov.rewind = Some(mode),
            Ability::LifeLeech => ov.life_leech = Some(mode),
            Ability::HuntersCurse => ov.hunters_curse = Some(mode),
            Ability::GuardiansPassage => ov.guardians_passage = Some(mode),
        }
    }
}

/// Tanky bruiser carrier with regen, so defensive/heal abilities engage
/// (drops below the Cocoon 70 % gate, accumulates Rewind history, is worth
/// leeching / reflecting for). Weight matched to opponents.
fn carrier() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: 18_000.0,
        weight: WEIGHT,
        damage: 850.0,
        bite_cooldown: 2.0,
        health_regen: 8.0,
        ..Default::default()
    }
}

fn status(id: &str, stacks: f64) -> SimpleAppliedStatus {
    SimpleAppliedStatus {
        status_id: id.to_string(),
        stacks,
        ..Default::default()
    }
}

/// A spread of strong opponents. `hp` is swept by the caller to bracket the
/// near-tie shell.
fn opponents(hp: f64) -> Vec<(&'static str, SimpleCombatantStats)> {
    let base = |damage: f64, bite_cd: f64| SimpleCombatantStats {
        health: hp,
        weight: WEIGHT,
        damage,
        bite_cooldown: bite_cd,
        ..Default::default()
    };
    let heavy = base(1_500.0, 2.0);
    let mut bleeder = base(1_150.0, 2.0);
    bleeder.on_hit_statuses = vec![status("Bleed_Status", 3.0)];
    let mut radbleed = base(1_050.0, 2.0);
    radbleed.on_hit_statuses = vec![status("Bleed_Status", 2.0), status("Radiation_Status", 2.0)];
    let fast = base(620.0, 0.9);
    vec![
        ("heavy", heavy),
        ("bleeder", bleeder),
        ("radbleed", radbleed),
        ("fast", fast),
    ]
}

fn cfg_for(ability: Ability, enabled: bool, mode: Mode) -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    if enabled {
        ability.enable(&mut cfg);
        ability.set_override(&mut cfg.attacker_ability_policy_overrides, mode);
    }
    cfg
}

fn run_with(a: &SimpleCombatantStats, ability: Ability, opp: &SimpleCombatantStats, enabled: bool, mode: Mode) -> Outcome {
    let cfg = cfg_for(ability, enabled, mode);
    // Baseline session default is SemiIdeal; the per-ability override is what
    // actually drives the isolated ability's timing.
    let s = simulate_composable_matchup(a, opp, None, None, Mode::SemiIdeal, &cfg, MAX_TIME);
    Outcome {
        winner: s.winner,
        da: s.death_time_a.unwrap_or(MAX_TIME),
        db: s.death_time_b.unwrap_or(MAX_TIME),
    }
}

fn run(ability: Ability, opp: &SimpleCombatantStats, enabled: bool, mode: Mode) -> Outcome {
    run_with(&carrier(), ability, opp, enabled, mode)
}

/// First activation time of `desc` for side A (INFINITY if it never fires),
/// used by the probes to prove they exercise the intended divergence regime.
fn first_fire(a: &SimpleCombatantStats, ability: Ability, opp: &SimpleCombatantStats, mode: Mode, desc: &str) -> f64 {
    let cfg = cfg_for(ability, true, mode);
    let s = simulate_composable_matchup_with_trace(a, opp, None, None, Mode::SemiIdeal, &cfg, MAX_TIME, true);
    s.combat_log
        .and_then(|log| {
            log.iter()
                .find(|e| e.attacker == "A" && e.description.as_deref() == Some(desc))
                .map(|e| e.time)
        })
        .unwrap_or(f64::INFINITY)
}

struct Tally {
    n: u32,
    matters: u32,
    ideal_ne_rf_winner: u32,
    ideal_ne_rf_any: u32,
    extreme_ne_rf_winner: u32,
    extreme_ne_rf_any: u32,
    extreme_ne_ideal_any: u32,
}

fn classify(ability: Ability) -> Tally {
    let mut t = Tally {
        n: 0,
        matters: 0,
        ideal_ne_rf_winner: 0,
        ideal_ne_rf_any: 0,
        extreme_ne_rf_winner: 0,
        extreme_ne_rf_any: 0,
        extreme_ne_ideal_any: 0,
    };
    let mut hp = 9_000.0;
    while hp <= 21_000.0 + 1e-9 {
        for (_label, opp) in opponents(hp) {
            let off = run(ability, &opp, false, Mode::ReallyFast);
            let rf = run(ability, &opp, true, Mode::ReallyFast);
            let ideal = run(ability, &opp, true, Mode::Ideal);
            let extreme = run(ability, &opp, true, Mode::Extreme);

            t.n += 1;
            if rf.winner != off.winner || ideal.winner != off.winner {
                t.matters += 1;
            }
            if ideal.winner != rf.winner {
                t.ideal_ne_rf_winner += 1;
            }
            if !ideal.same(&rf) {
                t.ideal_ne_rf_any += 1;
            }
            if extreme.winner != rf.winner {
                t.extreme_ne_rf_winner += 1;
            }
            if !extreme.same(&rf) {
                t.extreme_ne_rf_any += 1;
            }
            if !extreme.same(&ideal) {
                t.extreme_ne_ideal_any += 1;
            }
        }
        hp += 1_500.0;
    }
    t
}

#[test]
#[ignore = "measurement sweep; run explicitly with --ignored --nocapture"]
fn policy_gate_classification_table() {
    let abilities = [
        Ability::Reflect,
        Ability::Cocoon,
        Ability::UnbridledRage,
        Ability::Adrenaline,
        Ability::Rewind,
        Ability::LifeLeech,
        Ability::HuntersCurse,
        Ability::GuardiansPassage,
    ];
    println!(
        "\n{:<15} {:>3} {:>8} | {:>12} {:>10} | {:>14} {:>12} | {:>14}",
        "ability",
        "N",
        "matters",
        "ideal≠rf(win)",
        "ideal≠rf",
        "extreme≠rf(win)",
        "extreme≠rf",
        "extreme≠ideal"
    );
    for a in abilities {
        let t = classify(a);
        println!(
            "{:<15} {:>3} {:>8} | {:>12} {:>10} | {:>14} {:>12} | {:>14}",
            a.name(),
            t.n,
            t.matters,
            t.ideal_ne_rf_winner,
            t.ideal_ne_rf_any,
            t.extreme_ne_rf_winner,
            t.extreme_ne_rf_any,
            t.extreme_ne_ideal_any,
        );
    }
    println!(
        "\nVestigial ⇔ ideal≠rf(win)=0 AND extreme≠rf(win)=0 (search reproduces the gate).\n\
         Rewind safety: routing Ideal→gate flips a winner iff ideal≠rf(win) > 0.\n"
    );
}

/// Rewind gate-routing safety, divergence regime.
///
/// The historical utility-Ideal fired Rewind the instant `restored_hp_delta > 0`
/// at ANY HP; the gate waits for HP <= 75 % (and, since the delta-sign guard was
/// added, also requires `restored_hp_delta > 0`). The main table's strong
/// opponents blow the carrier below 75 % before the first (t=9) snapshot is
/// available, so gate and utility coincide there. This probe uses GENTLE,
/// high-regen carriers that stay above 75 % past t=9 with a positive delta, so
/// the historical utility-Ideal would have fired earlier than the gate - the
/// regime where routing Ideal->gate could regress. We confirm the regime is
/// exercised (Ideal fires strictly before RF in >=1 cell) and count winner flips.
#[test]
#[ignore = "measurement probe; run explicitly with --ignored --nocapture"]
fn rewind_gate_routing_safety_probe() {
    let carrier = |regen: f64| SimpleCombatantStats {
        health: 16_000.0,
        weight: WEIGHT,
        damage: 520.0,
        bite_cooldown: 2.0,
        health_regen: regen,
        ..Default::default()
    };
    let mut cells = 0u32;
    let mut winner_flips = 0u32;
    let mut regime_hits = 0u32; // Ideal fires strictly before RF (divergence live)
    for regen in [12.0_f64, 18.0, 24.0] {
        let a = carrier(regen);
        let mut hp = 7_000.0;
        while hp <= 16_000.0 + 1e-9 {
            for damage in [300.0_f64, 420.0, 560.0] {
                let opp = SimpleCombatantStats {
                    health: hp,
                    weight: WEIGHT,
                    damage,
                    bite_cooldown: 2.0,
                    ..Default::default()
                };
                let rf = run_with(&a, Ability::Rewind, &opp, true, Mode::ReallyFast);
                let ideal = run_with(&a, Ability::Rewind, &opp, true, Mode::Ideal);
                let t_rf = first_fire(&a, Ability::Rewind, &opp, Mode::ReallyFast, "Rewind activated");
                let t_ideal = first_fire(&a, Ability::Rewind, &opp, Mode::Ideal, "Rewind activated");
                cells += 1;
                if t_ideal + 0.05 < t_rf {
                    regime_hits += 1;
                }
                if ideal.winner != rf.winner {
                    winner_flips += 1;
                    println!(
                        "  FLIP regen={regen} hp={hp} dmg={damage}: rf={:?}@{t_rf:.1} ideal={:?}@{t_ideal:.1}",
                        rf.winner, ideal.winner
                    );
                }
            }
            hp += 1_500.0;
        }
    }
    // Pre-change this printed 63/63 divergence hits, 0 winner flips (utility-Ideal
    // fired above the 75% gate but never changed the outcome). Post-delete-to-gate
    // Ideal IS the gate, so divergence hits collapse to 0 - the eliminated timing
    // difference. Winner flips stay 0 either way. Print-only (measurement, not a gate).
    println!(
        "\nRewind probe: {cells} cells, divergence-regime hits (Ideal fires < RF)={regime_hits}, \
         winner flips (Ideal vs gate)={winner_flips}\n"
    );
}

/// Cocoon survival-check safety, divergence regime.
///
/// Cocoon's `utility()` returns `-inf` when the 5 s Ph1 lockdown's incoming
/// damage would kill the actor, so precision modes SKIP a fatal cast while
/// ReallyFast fires anyway. The main table's tanky carrier survives Ph1
/// trivially, so the check never binds. This probe uses low-HP-at-trigger
/// carriers against high-burst opponents so Ph1 CAN be lethal, exercising the
/// survival skip, and counts winner flips (Ideal-skip vs RF-fire).
#[test]
#[ignore = "measurement probe; run explicitly with --ignored --nocapture"]
fn cocoon_survival_check_safety_probe() {
    let mut cells = 0u32;
    let mut winner_flips = 0u32;
    let mut regime_hits = 0u32; // Ideal skips a Cocoon that RF fires
    for max_hp in [4_000.0_f64, 6_000.0, 9_000.0] {
        let a = SimpleCombatantStats {
            health: max_hp,
            weight: WEIGHT,
            damage: 700.0,
            bite_cooldown: 2.0,
            ..Default::default()
        };
        let mut opp_hp = 6_000.0;
        while opp_hp <= 16_000.0 + 1e-9 {
            for (damage, bite_cd) in [(2_600.0_f64, 1.4_f64), (1_800.0, 1.0), (3_400.0, 1.6)] {
                let opp = SimpleCombatantStats {
                    health: opp_hp,
                    weight: WEIGHT,
                    damage,
                    bite_cooldown: bite_cd,
                    ..Default::default()
                };
                let rf = run_with(&a, Ability::Cocoon, &opp, true, Mode::ReallyFast);
                let ideal = run_with(&a, Ability::Cocoon, &opp, true, Mode::Ideal);
                let t_rf = first_fire(&a, Ability::Cocoon, &opp, Mode::ReallyFast, "Cocoon activated");
                let t_ideal = first_fire(&a, Ability::Cocoon, &opp, Mode::Ideal, "Cocoon activated");
                cells += 1;
                // RF fires but Ideal declines (survival skip) at least until later.
                if t_rf.is_finite() && t_ideal > t_rf + 0.05 {
                    regime_hits += 1;
                }
                if ideal.winner != rf.winner {
                    winner_flips += 1;
                    println!(
                        "  FLIP maxHp={max_hp} oppHp={opp_hp} dmg={damage}: rf={:?}@{t_rf:.1} ideal={:?}@{t_ideal:.1}",
                        rf.winner, ideal.winner
                    );
                }
            }
            opp_hp += 2_000.0;
        }
    }
    println!(
        "\nCocoon probe: {cells} cells, survival-skip-regime hits (RF fires, Ideal defers)={regime_hits}, \
         winner flips (Ideal vs gate)={winner_flips}\n"
    );
}

// ---- Anti-rot guards (run in `cargo test --lib`, not #[ignore]) --------------

/// The delete-to-gate abilities must stay decision-equivalent to their gate:
/// `Ideal == ReallyFast` on winner AND death timestamps. If a future rebalance
/// reintroduces genuine timing sensitivity, precision (Ideal) will diverge from
/// the gate (ReallyFast) and this guard reds - the signal to restore a real
/// value model rather than let the reduced-to-gate decision silently mis-time.
/// Cheap: one carrier vs the opponent spread, Ideal + ReallyFast only.
#[test]
fn delete_to_gate_abilities_stay_gate_equivalent() {
    let gated = [
        Ability::Reflect,
        Ability::Cocoon,
        Ability::UnbridledRage,
        Ability::Adrenaline,
        Ability::Rewind,
        Ability::GuardiansPassage,
    ];
    for a in gated {
        let mut hp = 10_000.0;
        while hp <= 16_000.0 + 1e-9 {
            for (label, opp) in opponents(hp) {
                let rf = run(a, &opp, true, Mode::ReallyFast);
                let ideal = run(a, &opp, true, Mode::Ideal);
                assert!(
                    ideal.same(&rf),
                    "{} lost gate-equivalence vs {label}@{hp}: rf=({:?},{:.2},{:.2}) \
                     ideal=({:?},{:.2},{:.2}) — precision diverged from the gate; restore a \
                     value model instead of routing this ability to its gate",
                    a.name(),
                    rf.winner, rf.da, rf.db,
                    ideal.winner, ideal.da, ideal.db,
                );
            }
            hp += 3_000.0;
        }
    }
}

/// The kept analytic abilities (Life Leech, Hunters Curse) must keep their
/// precision search CONVERGED: `Ideal == Extreme` on winner + death timestamps.
/// Extreme's ~150-candidate grid is the reference; if a rebalance moves the
/// optimum off Ideal's coarser lattice, Extreme will diverge and this guard reds
/// - a cue to re-tune the Ideal grid (the value model itself is still sound).
///
/// This does NOT prove the analytic value equals the true engine value - that
/// needs a per-ability engine fork oracle, which only Fortify + the toggles
/// have a replay bridge for today. That stronger agreement guard is scoped out
/// as a follow-up (see the classification report); this convergence check is the
/// tractable anti-rot available without building fork infra.
#[test]
fn analytic_abilities_precision_stays_converged() {
    for a in [Ability::LifeLeech, Ability::HuntersCurse] {
        for hp in [12_000.0_f64, 18_000.0] {
            for (label, opp) in opponents(hp) {
                let ideal = run(a, &opp, true, Mode::Ideal);
                let extreme = run(a, &opp, true, Mode::Extreme);
                assert!(
                    ideal.same(&extreme),
                    "{} precision no longer converged vs {label}@{hp}: ideal=({:?},{:.2},{:.2}) \
                     extreme=({:?},{:.2},{:.2}) — Extreme found value Ideal missed; re-tune the \
                     Ideal delay grid",
                    a.name(),
                    ideal.winner, ideal.da, ideal.db,
                    extreme.winner, extreme.da, extreme.db,
                );
            }
        }
    }
}
