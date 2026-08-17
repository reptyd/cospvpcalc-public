import type { AbilityTimingMode, BuildOptions, CreatureRuntime, FinalStats } from "../../engine";
import type { CombatEventPhase } from "../../engine/eventOrdering";
import type { FunnelBattleSettings } from "./funnelCellRunner";
import { creatureByName } from "../../engine/creatureData";
import { simulateBestBuildMatchupWithPath } from "../bestBuildsRuntime";

// ---------------------------------------------------------------------------
// Coarse-screen anchor selection, and the pool's cost profile.
//
// The coarse screen runs every skyline survivor against a handful of opponents,
// so which opponents it picks decides both its cost and whether it can tell two
// builds apart. Those two properties are wildly uneven across a pool: the
// cheapest opponents resolve in a few hundred engine iterations while the
// dearest take hundreds of thousands, and plenty of the cheap ones still
// separate builds cleanly.
//
// So anchors are picked at RUN TIME for the actual (source, pool): probe a few
// spread builds, measure what one fight COSTS THE ENGINE and how far apart the
// probes land, and keep the best discrimination per work unit. Cost is the
// engine's own iteration count off the summary - not wall time - so the same
// inputs pick the same anchors on every machine and every run.
//
// The probe runs in two passes. The first prices every opponent with a single
// build; the second only spends the remaining probe builds on the cheaper half,
// which is where an anchor can come from anyway. The prices from the first pass
// are the pipeline's whole picture of what its pool costs - which opponents are
// affordable at screen volume and which have to wait for the leading band is
// decided from these numbers, not from what abilities anyone carries.
// ---------------------------------------------------------------------------

export type AnchorProbeBuild = {
  build: BuildOptions;
  finalA: FinalStats;
  activesOn: boolean;
  breathOn: boolean;
};

export type AnchorScore = {
  name: string;
  /** Engine work one probe fight charged, averaged over the builds probed. */
  workPerFight: number;
  /** How far apart the probe builds landed: relative metric spread, plus 1 when
   * the probes did not all reach the same verdict. `0` for an opponent the
   * second pass never reached. */
  spread: number;
  /** spread per work unit - the ranking key. */
  score: number;
};

export type AnchorSelection = {
  anchors: string[];
  scores: AnchorScore[];
  probeFights: number;
  /** Engine work the whole probe charged. */
  workUnits: number;
};

const DEFAULT_ANCHOR_COUNT = 5;
/** Floor on a fight's measured work, so a degenerate zero cannot divide. */
const MIN_WORK_PER_FIGHT = 1;

function relativeSpread(values: number[]): number {
  if (values.length < 2) return 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  const mean = Math.abs(sum / values.length);
  if (mean < 1e-9) return 0;
  return (max - min) / mean;
}

/**
 * Pick the spread probe builds the anchor measurement runs against: the extremes
 * and the middle of the survivors' damage-throughput axis, which is the axis the
 * screen most needs to resolve. Deterministic for a given survivor list.
 */
export function selectAnchorProbeBuilds<T extends AnchorProbeBuild>(survivors: readonly T[], count = 3): T[] {
  if (survivors.length === 0) return [];
  const throughput = (stats: FinalStats) =>
    stats.biteCooldown > 0 ? stats.damage / stats.biteCooldown : stats.damage;
  const ordered = [...survivors].sort((a, b) => throughput(a.finalA) - throughput(b.finalA));
  const wanted = Math.max(1, Math.min(count, ordered.length));
  const picked: T[] = [];
  for (let i = 0; i < wanted; i += 1) {
    const idx = wanted === 1 ? 0 : Math.round((i / (wanted - 1)) * (ordered.length - 1));
    const candidate = ordered[idx];
    if (candidate && !picked.includes(candidate)) picked.push(candidate);
  }
  return picked;
}

type ProbeOutcome = { work: number; dps: number; ttk: number; survival: number; winner: string };

export function selectCoarseAnchors({
  sourceCreature,
  pool,
  probes,
  anchorCount = DEFAULT_ANCHOR_COUNT,
  opponentBaselineBuild,
  combatEventOrder,
  maxTimeSec,
  abilityPolicy,
  screenFortifyFast,
  extras,
}: {
  sourceCreature: CreatureRuntime;
  pool: readonly string[];
  probes: readonly AnchorProbeBuild[];
  anchorCount?: number;
  opponentBaselineBuild?: BuildOptions;
  combatEventOrder?: CombatEventPhase[];
  maxTimeSec: number;
  /** Prices have to be measured on the policy the screen will actually run. */
  abilityPolicy: AbilityTimingMode;
  screenFortifyFast?: boolean;
  /** Battle-settings channels, so the prices the anchors are picked on are the
   * prices the run will actually pay. */
  extras?: FunnelBattleSettings;
}): AnchorSelection {
  const scores: AnchorScore[] = [];
  let probeFights = 0;
  let workUnits = 0;
  if (probes.length === 0) return { anchors: [], scores, probeFights, workUnits };

  const fight = (opponentCreature: CreatureRuntime, probe: AnchorProbeBuild): ProbeOutcome => {
    const { summary } = simulateBestBuildMatchupWithPath({
      sourceCreature,
      sourceBuild: probe.build,
      finalA: probe.finalA,
      opponentCreature,
      opponentBaselineBuild,
      activesOn: probe.activesOn,
      breathOn: probe.breathOn,
      maxTimeSec,
      abilityPolicy,
      combatEventOrder,
      screenFortifyFast,
      ...extras,
    });
    probeFights += 1;
    const work = summary.workUnits ?? 0;
    workUnits += work;
    return {
      work,
      dps: summary.dpsAtoB,
      ttk: summary.ttkAtoB,
      survival: summary.deathTimeA ?? summary.maxTimeSec,
      winner: summary.winner,
    };
  };

  // Pass 1: price every opponent with one build.
  const priced: { name: string; creature: CreatureRuntime; first: ProbeOutcome }[] = [];
  for (const name of pool) {
    const creature = creatureByName[name];
    if (!creature) continue;
    priced.push({ name, creature, first: fight(creature, probes[0]) });
  }
  if (priced.length === 0) return { anchors: [], scores, probeFights, workUnits };

  // Pass 2: spend the remaining probe builds on the cheaper half. An anchor is
  // screened against every survivor, so a dear opponent could never pay for
  // itself there however well it discriminates.
  const byWork = [...priced].sort((a, b) => a.first.work - b.first.work);
  const medianWork = byWork[Math.floor((byWork.length - 1) / 2)].first.work;
  for (const entry of priced) {
    const outcomes = [entry.first];
    if (entry.first.work <= medianWork) {
      for (const probe of probes.slice(1)) outcomes.push(fight(entry.creature, probe));
    }
    const meanWork = Math.max(
      MIN_WORK_PER_FIGHT,
      outcomes.reduce((sum, o) => sum + o.work, 0) / outcomes.length,
    );
    const metricSpread = Math.max(
      relativeSpread(outcomes.map((o) => o.dps)),
      relativeSpread(outcomes.map((o) => o.ttk)),
      relativeSpread(outcomes.map((o) => o.survival)),
    );
    const distinctWinners = new Set(outcomes.map((o) => o.winner)).size;
    const spread = Math.round(metricSpread * 1000) / 1000 + (distinctWinners > 1 ? 1 : 0);
    scores.push({ name: entry.name, workPerFight: meanWork, spread, score: spread / meanWork });
  }

  scores.sort((a, b) => b.score - a.score || a.workPerFight - b.workPerFight || a.name.localeCompare(b.name));

  const discriminating = scores.filter((entry) => entry.spread > 0);
  const anchors = discriminating.slice(0, anchorCount).map((entry) => entry.name);
  if (anchors.length < anchorCount) {
    // Nothing (or too little) separated the probes - fall back to the cheapest
    // opponents so the screen still spans the pool instead of running blind.
    const byCost = [...scores].sort(
      (a, b) => a.workPerFight - b.workPerFight || a.name.localeCompare(b.name),
    );
    for (const entry of byCost) {
      if (anchors.length >= anchorCount) break;
      if (!anchors.includes(entry.name)) anchors.push(entry.name);
    }
  }

  return { anchors, scores, probeFights, workUnits };
}
