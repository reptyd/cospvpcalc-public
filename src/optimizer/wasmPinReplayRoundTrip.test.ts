/// <reference types="node" />
// Best Builds pin-replay round-trip through the shipped WASM bridge (Phase 2a).
//
// Phase 1 proved in cargo that a captured defensive schedule, replayed under
// `GateOnly`, reproduces the full-`ideal` fight bit-for-bit. This test proves
// that guarantee survives the JS boundary: it (a) runs a full `ideal` reference
// via `simulate_composable_matchup_js`, (b) captures the schedule via
// `capture_defensive_pin_schedule_js`, and (c) replays it pinned via
// `simulate_composable_matchup_pinned_js`, then asserts the pinned summary is
// bit-identical to the reference. The fixture is the BB-length multi-fire
// Fortify case from `bestbuilds_pin_replay_tests.rs`, so Fortify fires several
// times and the schedule pin carries real work across the bridge.
import { describe, expect, it } from "vitest";
import { loadRustForNode } from "./rustNodeMatchup";
import { stripNullsForWasm } from "./rustMatchupLoader";
import type {
  RustComposableAbilityConfig,
  RustMatchupSummary,
  RustPinnedDefensiveSchedule,
  RustSimpleCombatantStats,
} from "./rustMatchupBridge";

const MAX_TIME_SEC = 480;

// Mirror of `bestbuilds_pin_replay_tests::combatant`: attacker stacks Bleed +
// Radiation on hit, defender fortifies. Chosen because the cargo test proves
// this exact fixture drives Fortify into its multi-fire regime.
const ATTACKER: RustSimpleCombatantStats = {
  health: 60_000,
  weight: 1_000,
  damage: 900,
  biteCooldown: 2,
  healthRegen: 0,
  onHitStatuses: [
    { statusId: "Bleed_Status", stacks: 3 },
    { statusId: "Radiation_Status", stacks: 3 },
  ],
};

const DEFENDER: RustSimpleCombatantStats = {
  health: 120_000,
  weight: 1_000,
  damage: 700,
  biteCooldown: 2,
  healthRegen: 40,
};

const CONFIG: RustComposableAbilityConfig = { defenderFortify: true };

/** The fields the Phase-1 cargo test compares for exact f64 equality. */
function keyFields(s: RustMatchupSummary) {
  return {
    winner: s.winner,
    deathTimeA: s.deathTimeA,
    deathTimeB: s.deathTimeB,
    damageDealtA: s.damageDealtA,
    damageDealtB: s.damageDealtB,
    finalHpA: s.finalHpA,
    finalHpB: s.finalHpB,
    hpAAtBDeath: s.hpAAtBDeath,
    hpBAtADeath: s.hpBAtADeath,
  };
}

describe("pin-replay round-trip through the WASM bridge", () => {
  it("captured schedule, replayed pinned, is bit-identical to full ideal", async () => {
    const rustMod = await loadRustForNode();
    const simulate = rustMod.simulate_composable_matchup_js as (...a: unknown[]) => RustMatchupSummary;
    const capture = rustMod.capture_defensive_pin_schedule_js as (...a: unknown[]) => RustPinnedDefensiveSchedule;
    const pinned = rustMod.simulate_composable_matchup_pinned_js as (...a: unknown[]) => RustMatchupSummary;

    const a = stripNullsForWasm(ATTACKER);
    const b = stripNullsForWasm(DEFENDER);
    const cfg = stripNullsForWasm(CONFIG);

    // (a) Full ideal reference.
    const reference = simulate(a, b, undefined, undefined, "ideal", cfg, MAX_TIME_SEC, false);

    // (b) Capture the committed defensive schedule.
    const schedule = capture(a, b, undefined, undefined, cfg, MAX_TIME_SEC);

    // The fixture must actually exercise the multi-fire regime, else the
    // round-trip proves nothing about the schedule pin.
    const defenderFires = schedule.defender.fortify?.fires ?? [];
    expect(defenderFires.length, `expected multi-fire Fortify, got ${JSON.stringify(defenderFires)}`).toBeGreaterThanOrEqual(2);

    // (c) Replay pinned under GateOnly with the captured schedule.
    const replay = pinned(a, b, undefined, undefined, cfg, stripNullsForWasm(schedule), MAX_TIME_SEC, false);

    expect(keyFields(replay)).toEqual(keyFields(reference));

    // Surface the numbers so the round-trip result is visible in test output.
    console.log(
      `[pin-replay bridge] winner=${reference.winner} ` +
        `deathB=${reference.deathTimeB} finalHpA=${reference.finalHpA} finalHpB=${reference.finalHpB} ` +
        `fortifyFires(B)=${JSON.stringify(defenderFires)}`,
    );
  }, 60_000);
});
