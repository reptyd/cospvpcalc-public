/// Compare-path regression tests.
///
/// `wasm-engine/fixtures/compare_matchup_contract.json` is meant to hold golden
/// snapshots of full Compare matchups: each entry stores the Rust arguments the
/// Compare mapping (`toRustComposableArgsFromCompare`) produces alongside the
/// expected `BestBuildsMatchupSummary`, so a regression in the end-to-end Compare
/// path fails here. The case shape (`CompareCase`) is ready, but the fixture is
/// not yet populated - the original TS Compare oracle that would have seeded
/// it is retired. The intended end-to-end coverage is the roster golden matrix
/// (see `docs/internal/architecture_backlog.md`); until it lands, the test below
/// asserts the fixture is an empty placeholder rather than silently passing over
/// zero cases (which would read as real Compare coverage).
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

    /// Runs each stored Compare matchup through the engine and asserts its summary.
    /// While the fixture is the empty placeholder, this instead asserts emptiness
    /// (honest "no coverage yet") and flips red the moment cases are added, which
    /// forces the real per-case assertions to be wired in at that point.
    #[test]
    fn fixture_compare_matchup_contract() {
        let json = include_str!("../fixtures/compare_matchup_contract.json");
        let cases: Vec<CompareCase> =
            serde_json::from_str(json).expect("parse compare_matchup_contract");
        // Placeholder guard (see module header). Remove it once the fixture is
        // populated so the per-case assertions below run; until then it keeps the
        // empty contract honest and flips red the moment cases are added.
        assert!(
            cases.is_empty(),
            "compare_matchup_contract.json now has cases - remove the placeholder \
             guard above so the per-case summary assertions run"
        );
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
