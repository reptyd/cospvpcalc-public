import { applyRulesAndBuild, type BuildOptions, type CreatureRuntime, type FinalStats } from "../../engine";
import { creatureByName } from "../../engine/creatureData";
import { RECOMMENDED_COMBAT_EVENT_ORDER } from "../../engine/eventOrdering";
import { BEST_BUILDS_OPPONENT_BUILD } from "../bestBuildsRuntime";
import {
  toRustBreathProfile,
  toRustComposableAbilityConfig,
  toRustStatusMeleeStats,
} from "../rustBestBuildsRuntime";
import { stripNullsForWasm } from "../rustMatchupLoader";

// ---------------------------------------------------------------------------
// Empirical monotonicity probe (the load-bearing guard behind the skyline).
//
// For each candidate skyline axis we sweep that stat on a real source against a
// Fortify-carrying opponent through the real composable engine (full `ideal`)
// and check the outcome never gets worse as the stat improves. An axis that
// stays monotone can safely ORDER the skyline; one that reverses (or that we
// cannot exercise) is demoted to an EXACT-MATCH partition dimension so a prune
// can never cross it.
//
// The runner takes the loaded WASM module rather than importing the node loader,
// so this file carries no node-only imports and stays safe in any graph; the
// test wires `loadRustForNode`.
// ---------------------------------------------------------------------------

const PROBE_BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Bite"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Void", "Void"],
  elder: "Powerful",
};

type RustSim = (...args: unknown[]) => {
  winner: "A" | "B" | "Draw";
  deathTimeA: number | null;
  deathTimeB: number | null;
  maxTimeSec: number;
};

export type RustModuleLike = { simulate_composable_matchup_js: RustSim };

export type ProbeOutcome = { winner: "A" | "B" | "Draw"; ttk: number; survival: number };

export type AxisRole = "order-candidate" | "exact-match-candidate";
export type ProbeVerdict = "CLEAN-MONOTONE" | "NOT-MONOTONE" | "INERT";
export type SkylineRole = "order" | "exact-match";

export type AxisProbe = {
  axis: string;
  role: AxisRole;
  source: string;
  /** Fortify carrier. */
  opponent: string;
  sourceDamageScale: number;
  /** Sweep values in beneficial-ascending order (index 0 = worst). */
  values: number[];
  mutate: (finalStats: FinalStats, value: number, base: FinalStats) => void;
};

export type AxisProbeResult = {
  axis: string;
  role: AxisRole;
  verdict: ProbeVerdict;
  skylineRole: SkylineRole;
  points: Array<{ value: number } & ProbeOutcome>;
};

function cloneCreature(name: string): CreatureRuntime {
  const runtime = creatureByName[name];
  if (!runtime) throw new Error(`Missing creature fixture: ${name}`);
  return {
    ...runtime,
    passiveAbilities: [...(runtime.passiveAbilities ?? [])],
    activatedAbilities: [...(runtime.activatedAbilities ?? [])],
    breathAbilities: [...(runtime.breathAbilities ?? [])],
  };
}

/** Build a fight closure vs a fixed opponent; each call re-marshals the mutated
 * source stats and returns the (winner, ttk, survival) outcome. */
function makeFight(
  rust: RustModuleLike,
  sourceName: string,
  opponentName: string,
  sourceDamageScale: number,
  maxTimeSec: number,
): { base: FinalStats; run: (mutate: (f: FinalStats) => void) => ProbeOutcome } {
  const source = cloneCreature(sourceName);
  const opponent = cloneCreature(opponentName);
  const base = applyRulesAndBuild(source, PROBE_BUILD);
  base.damage *= sourceDamageScale;
  const finalB = applyRulesAndBuild(opponent, BEST_BUILDS_OPPONENT_BUILD);
  const config = stripNullsForWasm({
    ...toRustComposableAbilityConfig(source, opponent),
    combatEventOrder: RECOMMENDED_COMBAT_EVENT_ORDER,
  });
  const defender = stripNullsForWasm(toRustStatusMeleeStats(opponent, finalB));
  const defenderBreath = stripNullsForWasm(toRustBreathProfile(finalB) ?? undefined);

  const run = (mutate: (f: FinalStats) => void): ProbeOutcome => {
    const finalA: FinalStats = {
      ...base,
      plushieStatusOnHit: { ...(base.plushieStatusOnHit ?? {}) },
      plushieStatusOnHitTaken: { ...(base.plushieStatusOnHitTaken ?? {}) },
      plushieStatusBlockPct: { ...(base.plushieStatusBlockPct ?? {}) },
    };
    mutate(finalA);
    const summary = rust.simulate_composable_matchup_js(
      stripNullsForWasm(toRustStatusMeleeStats(source, finalA)),
      defender,
      stripNullsForWasm(toRustBreathProfile(finalA) ?? undefined),
      defenderBreath,
      "ideal",
      config,
      maxTimeSec,
      false,
    );
    return {
      winner: summary.winner,
      ttk: summary.deathTimeB ?? summary.maxTimeSec,
      survival: summary.deathTimeA ?? summary.maxTimeSec,
    };
  };
  return { base, run };
}

const WINNER_SCORE: Record<"A" | "B" | "Draw", number> = { A: 2, Draw: 1, B: 0 };
// One 0.5s engine tick of slack, so grid quantization alone never trips a clean
// axis; the observed DoT-threshold reversals are ~1s, comfortably above this.
const TIME_EPS = 0.6;

/** Lexicographic outcome goodness: winner, then faster kill, then longer
 * survival. Returns -1/0/1 for a-vs-b with a time epsilon. */
function compareGoodness(a: ProbeOutcome, b: ProbeOutcome): number {
  if (WINNER_SCORE[a.winner] !== WINNER_SCORE[b.winner]) {
    return WINNER_SCORE[a.winner] < WINNER_SCORE[b.winner] ? -1 : 1;
  }
  if (Math.abs(a.ttk - b.ttk) > TIME_EPS) return a.ttk < b.ttk ? 1 : -1; // lower ttk = better
  if (Math.abs(a.survival - b.survival) > TIME_EPS) return a.survival > b.survival ? 1 : -1;
  return 0;
}

export function runAxisProbe(rust: RustModuleLike, probe: AxisProbe, maxTimeSec = 480): AxisProbeResult {
  const fight = makeFight(rust, probe.source, probe.opponent, probe.sourceDamageScale, maxTimeSec);
  const points = probe.values.map((value) => ({
    value,
    ...fight.run((f) => probe.mutate(f, value, fight.base)),
  }));

  let worsened = false;
  let improved = false;
  for (let i = 1; i < points.length; i += 1) {
    const cmp = compareGoodness(points[i], points[i - 1]);
    if (cmp < 0) worsened = true;
    if (cmp > 0) improved = true;
  }

  const verdict: ProbeVerdict = worsened ? "NOT-MONOTONE" : improved ? "CLEAN-MONOTONE" : "INERT";
  // Order candidates keep the order role only when the sweep confirms clean
  // monotonicity; anything else (reversal or no signal) is demoted. Exact-match
  // candidates stay exact-match regardless - the probe just documents why.
  const skylineRole: SkylineRole =
    probe.role === "order-candidate" && verdict === "CLEAN-MONOTONE" ? "order" : "exact-match";

  return { axis: probe.axis, role: probe.role, verdict, skylineRole, points };
}

// Sweep set. The melee axes ride Kendyll vs the Fortify tank Yohsog (a
// competitive, rollout-engaging matchup with a winner transition); breath damage
// needs a breath source (Phantejer); the DoT-stack sweep is slowed down so the
// bleed actually matters before the kill.
export const AXIS_PROBES: readonly AxisProbe[] = [
  {
    axis: "damage", role: "order-candidate", source: "Kendyll", opponent: "Yohsog", sourceDamageScale: 1,
    values: [0.25, 0.3, 0.4, 0.55, 0.75, 1.0, 1.4],
    mutate: (f, v, base) => { f.damage = base.damage * v; },
  },
  {
    axis: "biteCooldown", role: "order-candidate", source: "Kendyll", opponent: "Yohsog", sourceDamageScale: 1,
    values: [1.6, 1.3, 1.1, 0.95, 0.8, 0.65, 0.5],
    mutate: (f, v, base) => { f.biteCooldown = base.biteCooldown * v; },
  },
  {
    axis: "health", role: "order-candidate", source: "Kendyll", opponent: "Yohsog", sourceDamageScale: 1,
    values: [0.5, 0.7, 0.9, 1.0, 1.2, 1.5, 2.0],
    mutate: (f, v, base) => { f.health = base.health * v; },
  },
  {
    axis: "healthRegen", role: "order-candidate", source: "Kendyll", opponent: "Yohsog", sourceDamageScale: 1,
    values: [0, 25, 50, 100, 200, 400, 800],
    mutate: (f, v) => { f.healthRegen = v; },
  },
  {
    axis: "weight", role: "order-candidate", source: "Kendyll", opponent: "Yohsog", sourceDamageScale: 1,
    values: [0.4, 0.6, 0.8, 1.0, 1.4, 2.0, 3.0],
    mutate: (f, v, base) => { f.weight = base.weight * v; },
  },
  {
    axis: "reflect", role: "order-candidate", source: "Kendyll", opponent: "Yohsog", sourceDamageScale: 1,
    values: [0, 5, 15, 30, 50, 75, 100],
    mutate: (f, v) => { f.plushieReflectAvgPct = v; },
  },
  {
    axis: "breathDamagePct", role: "order-candidate", source: "Phantejer", opponent: "Yohsog", sourceDamageScale: 0.2,
    values: [0, 10, 25, 50, 100, 200],
    mutate: (f, v) => { f.breathDamagePct = v; },
  },
  {
    axis: "onHitDotStacks", role: "exact-match-candidate", source: "Kendyll", opponent: "Yohsog", sourceDamageScale: 0.18,
    values: [0, 1, 2, 3, 5, 8, 12, 20, 40],
    mutate: (f, v) => { f.plushieStatusOnHit = { Bleed_Status: v }; },
  },
  {
    axis: "block", role: "exact-match-candidate", source: "Kendyll", opponent: "Yohsog", sourceDamageScale: 1,
    values: [0, 10, 25, 50, 75, 90, 100],
    mutate: (f, v) => { f.plushieStatusBlockPct = { Bleed_Status: v }; },
  },
];

export function runAllAxisProbes(rust: RustModuleLike, maxTimeSec = 480): AxisProbeResult[] {
  return AXIS_PROBES.map((probe) => runAxisProbe(rust, probe, maxTimeSec));
}
