// Composable-engine policy bench. Measures what differs between
// `reallyFast`, `fast`, `ideal` on a single Kendyll matchup. Existence
// justified as a targeted composable perf measurement — the
// TS→Rust user observed Kendyll BB at `reallyFast` ~2× slower than
// `fast/ideal` and none of the prior theories (fight length, event count,
// TS fallback) explained the magnitude.
//
// Run:  cargo test --release -p cos-calc-wasm-engine bench_policy_counters -- --nocapture

#[cfg(test)]
mod bench {
    use std::time::Instant;

    use crate::bench_counters;
    use crate::composable::{simulate_composable_matchup, ComposableAbilityConfig};
    use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
    use serde::Deserialize;

    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase", default)]
    struct ActiveProfileSide {
        warden_rage_available: bool,
        adrenaline_available: bool,
        hunters_curse_available: bool,
        unbridled_rage_available: bool,
        frost_nova_available: bool,
        fortify_available: bool,
        rewind_available: bool,
        harden_available: bool,
        spite_value: Option<f64>,
    }

    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase", default)]
    struct ActiveProfilePair {
        attacker: ActiveProfileSide,
        defender: ActiveProfileSide,
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        attacker: SimpleCombatantStats,
        defender: SimpleCombatantStats,
        #[serde(rename = "activeProfile", default)]
        active_profile: ActiveProfilePair,
        #[serde(rename = "maxTimeSec")]
        max_time_sec: f64,
    }

    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase", default)]
    struct LlSide {
        available: bool,
        life_leech_value: f64,
    }

    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase", default)]
    struct LlPair {
        attacker: LlSide,
        defender: LlSide,
    }

    #[derive(Deserialize)]
    struct LlCase {
        name: String,
        attacker: SimpleCombatantStats,
        defender: SimpleCombatantStats,
        #[serde(rename = "attackerBreath", default)]
        attacker_breath: Option<SimpleBreathProfile>,
        #[serde(rename = "defenderBreath", default)]
        defender_breath: Option<SimpleBreathProfile>,
        #[serde(rename = "lifeLeechProfile", default)]
        life_leech_profile: LlPair,
        #[serde(rename = "maxTimeSec")]
        max_time_sec: f64,
    }

    fn config_from_profile(
        pair: &ActiveProfilePair,
        attacker: &SimpleCombatantStats,
        defender: &SimpleCombatantStats,
    ) -> ComposableAbilityConfig {
        ComposableAbilityConfig {
            attacker_warden_rage: pair.attacker.warden_rage_available,
            defender_warden_rage: pair.defender.warden_rage_available,
            attacker_adrenaline: pair.attacker.adrenaline_available,
            defender_adrenaline: pair.defender.adrenaline_available,
            attacker_hunters_curse: pair.attacker.hunters_curse_available,
            defender_hunters_curse: pair.defender.hunters_curse_available,
            attacker_unbridled_rage: pair.attacker.unbridled_rage_available,
            defender_unbridled_rage: pair.defender.unbridled_rage_available,
            attacker_frost_nova: pair.attacker.frost_nova_available,
            defender_frost_nova: pair.defender.frost_nova_available,
            attacker_fortify: pair.attacker.fortify_available,
            defender_fortify: pair.defender.fortify_available,
            attacker_rewind: pair.attacker.rewind_available,
            defender_rewind: pair.defender.rewind_available,
            attacker_harden: pair.attacker.harden_available,
            defender_harden: pair.defender.harden_available,
            attacker_spite_value: pair.attacker.spite_value.unwrap_or(0.0),
            defender_spite_value: pair.defender.spite_value.unwrap_or(0.0),
            attacker_hunker: attacker.hunker_reduction_pct > 0.0,
            defender_hunker: defender.hunker_reduction_pct > 0.0,
            ..Default::default()
        }
    }

    fn label_of(policy: SimpleAbilityTimingMode) -> &'static str {
        match policy {
            SimpleAbilityTimingMode::ReallyFast => "reallyFast",
            SimpleAbilityTimingMode::Fast => "fast",
            SimpleAbilityTimingMode::SemiIdeal => "semiIdeal",
            SimpleAbilityTimingMode::Ideal => "ideal",
            SimpleAbilityTimingMode::Extreme => "extreme",
        }
    }

    fn run_one<F>(case_name: &str, policy: SimpleAbilityTimingMode, iterations: u32, mut run: F)
    where
        F: FnMut(SimpleAbilityTimingMode) -> crate::contracts::BestBuildsMatchupSummary,
    {
        bench_counters::reset();
        let start = Instant::now();
        let mut last = None;
        for _ in 0..iterations {
            last = Some(run(policy));
        }
        let elapsed = start.elapsed();
        let snap = bench_counters::snapshot();
        let s = last.unwrap();
        println!(
            "[bench][{name}][{label:>10}] iters={iter} elapsed={ms:8.2}ms per_sim={per:6.3}ms \
             loop_iters={li:>10} proj_calls={pj:>10} decide_calls={dc:>8} winner={win:?} ttk={ttk:.3}",
            name = case_name,
            label = label_of(policy),
            iter = iterations,
            ms = elapsed.as_secs_f64() * 1000.0,
            per = (elapsed.as_secs_f64() * 1000.0) / iterations as f64,
            li = snap.loop_iterations,
            pj = snap.project_policy_window_calls,
            dc = snap.should_activate_calls,
            win = s.winner,
            ttk = s.ttk_a_to_b,
        );
    }

    fn run_policy(
        case: &Case,
        config: &ComposableAbilityConfig,
        policy: SimpleAbilityTimingMode,
        iterations: u32,
    ) {
        run_one(&case.name, policy, iterations, |p| {
            simulate_composable_matchup(
                &case.attacker,
                &case.defender,
                None,
                None,
                p,
                config,
                case.max_time_sec,
            )
        });
    }

    fn run_ll_policy(
        case: &LlCase,
        config: &ComposableAbilityConfig,
        policy: SimpleAbilityTimingMode,
        iterations: u32,
    ) {
        run_one(&case.name, policy, iterations, |p| {
            simulate_composable_matchup(
                &case.attacker,
                &case.defender,
                case.attacker_breath.as_ref(),
                case.defender_breath.as_ref(),
                p,
                config,
                case.max_time_sec,
            )
        });
    }

    #[test]
    fn bench_policy_counters() {
        let json = include_str!(
            "../fixtures/rust_v2_active_melee_boreal_warden_defender_bestbuild_attacker_kendyll_live_red_matchups.json"
        );
        let cases: Vec<Case> = serde_json::from_str(json).expect("parse Kendyll fixture");
        let case = cases
            .first()
            .expect("fixture must contain at least one case");
        let config = config_from_profile(&case.active_profile, &case.attacker, &case.defender);

        // Warmup (JIT / branch predictor) then timed runs.
        let warmup_iters = 200;
        bench_counters::reset();
        for _ in 0..warmup_iters {
            let _ = simulate_composable_matchup(
                &case.attacker,
                &case.defender,
                None,
                None,
                SimpleAbilityTimingMode::Fast,
                &config,
                case.max_time_sec,
            );
        }

        let iterations = 5_000;
        println!("[bench] === Kendyll vs Boreal Warden (active melee, WR on defender, no LL) ===");
        run_policy(case, &config, SimpleAbilityTimingMode::ReallyFast, iterations);
        run_policy(case, &config, SimpleAbilityTimingMode::Fast, iterations);
        run_policy(case, &config, SimpleAbilityTimingMode::SemiIdeal, iterations);
        run_policy(case, &config, SimpleAbilityTimingMode::Ideal, iterations);

        // Second case: LL-breath matchup. LL is analytic on `ideal` — we expect
        // `ideal` to reduce loop iterations vs `reallyFast`.
        let ll_json = include_str!("../fixtures/simple_life_leech_breath_matchups.json");
        let ll_cases: Vec<LlCase> =
            serde_json::from_str(ll_json).expect("parse LL-breath fixture");
        let ll_case = ll_cases
            .first()
            .expect("LL fixture must contain at least one case");
        let mut ll_config = ComposableAbilityConfig::default();
        if ll_case.life_leech_profile.attacker.available {
            ll_config.attacker_life_leech_value = ll_case.life_leech_profile.attacker.life_leech_value;
        }
        if ll_case.life_leech_profile.defender.available {
            ll_config.defender_life_leech_value = ll_case.life_leech_profile.defender.life_leech_value;
        }

        println!("[bench] === Korathos vs Morthorax (breath, LL on both sides) ===");
        run_ll_policy(ll_case, &ll_config, SimpleAbilityTimingMode::ReallyFast, iterations);
        run_ll_policy(ll_case, &ll_config, SimpleAbilityTimingMode::Fast, iterations);
        run_ll_policy(ll_case, &ll_config, SimpleAbilityTimingMode::SemiIdeal, iterations);
        run_ll_policy(ll_case, &ll_config, SimpleAbilityTimingMode::Ideal, iterations);
    }

    /// CI perf-regression guard (deterministic — runs in `cargo test --lib`).
    ///
    /// `loop_iterations` counts composable event-loop iterations for one
    /// simulation of a fixed reference matchup. Unlike wall-time it is
    /// deterministic: the same fixture + config + policy yields the identical
    /// count on any machine, debug or release (the count is logic-driven, not
    /// timing-driven). A jump means the engine's event loop got longer per
    /// simulation — an *algorithmic* regression.
    ///
    /// Scope, stated honestly: this catches loop-*length* growth, NOT
    /// constant-factor per-iteration cost. A constant-factor
    /// per-iteration regression (e.g. per-matchup `CombatSide` clones)
    /// would leave this count unchanged. Catching per-iteration cost
    /// needs wall-time or allocation instrumentation (T2 perf), which is
    /// intentionally out of scope here to keep the gate flake-free.
    ///
    /// Only `loop_iterations` is asserted: the sibling `bench_counters`
    /// (`project_policy_window_calls` / `should_activate_calls`) currently
    /// have no live increment sites — they are dormant policy-search
    /// instrumentation, so a budget on them would guard nothing.
    ///
    /// `Ideal` is used as the heaviest-policy reference. The budget is the
    /// measured count, used as a ceiling: an optimization that LOWERS it
    /// should lower the budget too (lock in the win); an INCREASE fails the
    /// gate. Update the budget in the SAME commit as any intentional change,
    /// and say why — never relax it just to silence a surprise.
    #[test]
    fn perf_guard_reference_matchup_loop_budget() {
        let json = include_str!(
            "../fixtures/rust_v2_active_melee_boreal_warden_defender_bestbuild_attacker_kendyll_live_red_matchups.json"
        );
        let cases: Vec<Case> = serde_json::from_str(json).expect("parse Kendyll fixture");
        let case = cases
            .first()
            .expect("fixture must contain at least one case");
        let config = config_from_profile(&case.active_profile, &case.attacker, &case.defender);

        bench_counters::reset();
        let _ = simulate_composable_matchup(
            &case.attacker,
            &case.defender,
            None,
            None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            case.max_time_sec,
        );
        let snap = bench_counters::snapshot();

        // Measured on the reference matchup. Ceiling, not equality.
        const LOOP_ITERATIONS_BUDGET: u64 = 117;

        assert!(
            snap.loop_iterations <= LOOP_ITERATIONS_BUDGET,
            "loop_iterations {} exceeds budget {} — the event loop got longer per simulation \
             (algorithmic regression?). If intentional, bump the budget in this commit and explain why.",
            snap.loop_iterations,
            LOOP_ITERATIONS_BUDGET
        );
    }
}
