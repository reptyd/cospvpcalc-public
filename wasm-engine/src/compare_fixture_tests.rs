/// Compare-path parity tests.
///
/// Fixtures in `wasm-engine/fixtures/compare_matchup_contract.json` are produced by
/// `scripts/generate_rust_compare_fixtures.ts`. The generator runs the Compare
/// TS oracle (`simulateFight` with all Compare options), captures the projected
/// `BestBuildsMatchupSummary`, and stores the Rust arguments produced by
/// `toRustComposableArgsFromCompare`. This test loads that fixture, runs
/// `simulate_composable_matchup` on the mapped arguments, and asserts parity.
///
/// Parity scope: fixtures pin to the Rust-supported feature surface —
/// no per-ability policy overrides. Other Compare knobs (buffs, specials,
/// first-tick, disabledAbilities, hunger family, trails, traps, charges,
/// badOmenOutcome, air rule, secondary-attack-only) are in scope.
#[cfg(test)]
#[allow(clippy::module_inception)] // established test-module name; renaming churns all use-paths for no gain
mod compare_fixture_tests {
    use crate::composable::{simulate_composable_matchup, ComposableAbilityConfig};
    use crate::contracts::{
        BestBuildsMatchupSummary, SimpleAbilityTimingMode, SimpleBreathProfile,
        SimpleCombatantStats,
    };
    use serde::Deserialize;

    const FLOAT_TOL: f64 = 0.05;

    #[derive(Deserialize)]
    struct CompareCase {
        name: String,
        attacker: SimpleCombatantStats,
        defender: SimpleCombatantStats,
        #[serde(rename = "attackerBreath", default)]
        attacker_breath: Option<SimpleBreathProfile>,
        #[serde(rename = "defenderBreath", default)]
        defender_breath: Option<SimpleBreathProfile>,
        #[serde(rename = "abilityPolicy")]
        ability_policy: String,
        #[serde(rename = "abilityConfig")]
        ability_config: ComposableAbilityConfig,
        #[serde(rename = "maxTimeSec")]
        max_time_sec: f64,
        #[serde(rename = "expectedSummary")]
        expected: BestBuildsMatchupSummary,
    }

    fn policy_from_str(s: &str) -> SimpleAbilityTimingMode {
        match s {
            "ideal" => SimpleAbilityTimingMode::Ideal,
            "extreme" => SimpleAbilityTimingMode::Extreme,
            "fast" => SimpleAbilityTimingMode::Fast,
            "reallyFast" => SimpleAbilityTimingMode::ReallyFast,
            _ => SimpleAbilityTimingMode::SemiIdeal,
        }
    }

    fn assert_summary_approx(
        got: &BestBuildsMatchupSummary,
        exp: &BestBuildsMatchupSummary,
        case: &str,
    ) {
        assert_eq!(got.winner, exp.winner, "[{case}] winner mismatch");
        assert!(
            (got.ttk_a_to_b - exp.ttk_a_to_b).abs() < FLOAT_TOL,
            "[{case}] ttkAtoB: got={:.3} exp={:.3} diff={:.4}",
            got.ttk_a_to_b, exp.ttk_a_to_b, (got.ttk_a_to_b - exp.ttk_a_to_b).abs()
        );
        if let Some(exp_death) = exp.death_time_a {
            let got_death = got.death_time_a.unwrap_or(got.max_time_sec);
            assert!(
                (got_death - exp_death).abs() < FLOAT_TOL,
                "[{case}] deathTimeA: got={:.3} exp={:.3}",
                got_death, exp_death
            );
        }
    }

    #[test]
    fn fixture_compare_matchup_contract() {
        let json = include_str!("../fixtures/compare_matchup_contract.json");
        let cases: Vec<CompareCase> =
            serde_json::from_str(json).expect("parse compare_matchup_contract");
        for c in &cases {
            let got = simulate_composable_matchup(
                &c.attacker,
                &c.defender,
                c.attacker_breath.as_ref(),
                c.defender_breath.as_ref(),
                policy_from_str(&c.ability_policy),
                &c.ability_config,
                c.max_time_sec,
            );
            assert_summary_approx(&got, &c.expected, &c.name);
        }
    }

}
