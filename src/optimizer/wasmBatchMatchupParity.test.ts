/// <reference types="node" />
// Batched matchup rectangle vs. the per-fight export, through the shipped WASM
// bundle. The batch entry point exists purely to amortise marshalling, so the
// only thing that matters is that it changes nothing: same engine call, same
// summary, bit for bit. Pools are deliberately shared across fights (one
// attacker serving several defenders and vice versa) so the index stream, the
// breath sentinel and the config reuse are all exercised.
import { describe, expect, it } from "vitest";
import { loadRustForNode } from "./rustNodeMatchup";
import { stripNullsForWasm } from "./rustMatchupLoader";
import type {
  RustComposableAbilityConfig,
  RustComposableMatchupBatch,
  RustMatchupSummary,
  RustSimpleBreathProfile,
  RustSimpleCombatantStats,
} from "./rustMatchupBridge";

const MAX_TIME_SEC = 480;

const ATTACKERS: RustSimpleCombatantStats[] = [
  {
    health: 60_000,
    weight: 1_000,
    damage: 900,
    biteCooldown: 2,
    healthRegen: 0,
    onHitStatuses: [
      { statusId: "Bleed_Status", stacks: 3 },
      { statusId: "Radiation_Status", stacks: 3 },
    ],
  },
  { health: 45_000, weight: 700, damage: 1_400, biteCooldown: 3, healthRegen: 25 },
];

const DEFENDERS: RustSimpleCombatantStats[] = [
  { health: 120_000, weight: 1_000, damage: 700, biteCooldown: 2, healthRegen: 40 },
  { health: 80_000, weight: 1_400, damage: 1_100, biteCooldown: 2.5, healthRegen: 0 },
];

const ATTACKER_BREATH: RustSimpleBreathProfile = {
  dpsPct: 45,
  capacity: 100,
  regenRate: 6,
  critChancePct: 0,
  chain: 0,
  chainMaxStacks: 0,
};

const CONFIGS: RustComposableAbilityConfig[] = [{ defenderFortify: true }, {}];

/** Every f64 the Best Builds aggregation and the funnel's summary comparison
 * read, plus the verdict. */
function keyFields(summary: RustMatchupSummary) {
  return {
    winner: summary.winner,
    deathTimeA: summary.deathTimeA,
    deathTimeB: summary.deathTimeB,
    damageDealtA: summary.damageDealtA,
    damageDealtB: summary.damageDealtB,
    damageDealtAAtBDeath: summary.damageDealtAAtBDeath,
    extendedDamagePotentialA: summary.extendedDamagePotentialA,
    dpsAtoB: summary.dpsAtoB,
    ttkAtoB: summary.ttkAtoB,
    finalHpA: summary.finalHpA,
    finalHpB: summary.finalHpB,
  };
}

describe("batched matchup rectangle through the WASM bridge", () => {
  it("returns the same summaries as the per-fight export", async () => {
    const rustMod = await loadRustForNode();
    const simulate = rustMod.simulate_composable_matchup_js as (...a: unknown[]) => RustMatchupSummary;
    const simulateBatch = rustMod.simulate_composable_matchup_batch_js as (
      batch: unknown,
    ) => RustMatchupSummary[];

    // attacker, defender, attackerBreath, defenderBreath, config - the same
    // stride the Rust side reads.
    const fights = [
      0, 0, -1, -1, 0,
      0, 1, 0, -1, 1,
      1, 0, -1, -1, 1,
      1, 1, 0, -1, 0,
    ];
    const batch: RustComposableMatchupBatch = {
      attackers: ATTACKERS,
      defenders: DEFENDERS,
      attackerBreaths: [ATTACKER_BREATH],
      defenderBreaths: [],
      configs: CONFIGS,
      abilityPolicy: "ideal",
      maxTimeSec: MAX_TIME_SEC,
      fights,
    };

    const batched = simulateBatch(stripNullsForWasm(batch));
    expect(batched).toHaveLength(fights.length / 5);

    for (let i = 0; i < batched.length; i += 1) {
      const [a, d, ab, db, cfg] = fights.slice(i * 5, i * 5 + 5);
      const reference = simulate(
        stripNullsForWasm(ATTACKERS[a]),
        stripNullsForWasm(DEFENDERS[d]),
        ab < 0 ? undefined : stripNullsForWasm(batch.attackerBreaths[ab]),
        db < 0 ? undefined : stripNullsForWasm(batch.defenderBreaths[db]),
        "ideal",
        stripNullsForWasm(CONFIGS[cfg]),
        MAX_TIME_SEC,
        false,
      );
      expect(keyFields(batched[i]), `fight #${i}`).toEqual(keyFields(reference));
    }

    // A rectangle whose fights all resolve the same way would not prove the
    // index stream is honoured.
    expect(new Set(batched.map((summary) => summary.winner)).size).toBeGreaterThan(1);
  }, 60_000);

  it("rejects a truncated fight stream", async () => {
    const rustMod = await loadRustForNode();
    const simulateBatch = rustMod.simulate_composable_matchup_batch_js as (batch: unknown) => unknown;
    expect(() =>
      simulateBatch(
        stripNullsForWasm({
          attackers: ATTACKERS,
          defenders: DEFENDERS,
          attackerBreaths: [],
          defenderBreaths: [],
          configs: CONFIGS,
          abilityPolicy: "ideal",
          maxTimeSec: MAX_TIME_SEC,
          fights: [0, 0, -1, -1],
        }),
      ),
    ).toThrow();
  }, 60_000);
});
