import type { BadOmenOutcome, FinalStats, SimulationDebug, SimulationOptions, SimulationSummary } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";

type ResultDeps = {
  estimateEhp: (runtime: CombatantRuntime, state: CombatantState) => number;
  buildDebug: (
    runtime: CombatantRuntime,
    state: CombatantState,
    opponentFinal: FinalStats,
    disabled: Set<string>,
  ) => SimulationDebug;
  computeExtendedDamagePotential: (
    winnerRuntime: CombatantRuntime,
    winnerState: CombatantState,
    loserRuntime: CombatantRuntime,
    options: SimulationOptions,
  ) => number;
};

type BuildSummaryParams = {
  runtimeA: CombatantRuntime;
  runtimeB: CombatantRuntime;
  stateA: CombatantState;
  stateB: CombatantState;
  options: SimulationOptions;
  maxTime: number;
  time: number;
  deathTimeA: number | null;
  deathTimeB: number | null;
  damageDealtA_untilBDeath: number;
  damageDealtB_untilADeath: number;
  hpA_atBDeath: number;
  hpB_atADeath: number;
  badOmenOutcome: BadOmenOutcome;
  disabledA: Set<string>;
  disabledB: Set<string>;
};

export function createResultRuntime(deps: ResultDeps) {
  function buildSimulationSummary(params: BuildSummaryParams): SimulationSummary {
    const {
      runtimeA,
      runtimeB,
      stateA,
      stateB,
      options,
      maxTime,
      time,
      deathTimeA,
      deathTimeB,
      damageDealtA_untilBDeath,
      damageDealtB_untilADeath,
      hpA_atBDeath,
      hpB_atADeath,
      badOmenOutcome,
      disabledA,
      disabledB,
    } = params;

    const ttkAtoB = deathTimeB ?? maxTime;
    const ttkBtoA = deathTimeA ?? maxTime;
    const damageAAtRelevantEnd = deathTimeB == null ? stateA.damageDealt : damageDealtA_untilBDeath;
    const damageBAtRelevantEnd = deathTimeA == null ? stateB.damageDealt : damageDealtB_untilADeath;
    const dpsWindowA = deathTimeB ?? time;
    const dpsWindowB = deathTimeA ?? time;
    const dpsAtoB = dpsWindowA > 0 ? damageAAtRelevantEnd / dpsWindowA : 0;
    const dpsBtoA = dpsWindowB > 0 ? damageBAtRelevantEnd / dpsWindowB : 0;

    const ehpA = deps.estimateEhp(runtimeA, stateA);
    const ehpB = deps.estimateEhp(runtimeB, stateB);

    const winner =
      deathTimeA != null && deathTimeB != null
        ? deathTimeA === deathTimeB
          ? "Draw"
          : deathTimeA < deathTimeB
            ? "B"
            : "A"
        : deathTimeB != null
          ? "A"
          : deathTimeA != null
            ? "B"
            : "Draw";

    const approxNotes = [...stateA.approxNotes, ...stateB.approxNotes, ...runtimeA.final.approxNotes, ...runtimeB.final.approxNotes];
    const extendedA = winner === "A" ? deps.computeExtendedDamagePotential(runtimeA, stateA, runtimeB, options) : 0;
    const extendedB = winner === "B" ? deps.computeExtendedDamagePotential(runtimeB, stateB, runtimeA, options) : 0;
    const combatLog =
      options.enableCombatLog
        ? [...stateA.combatLog, ...stateB.combatLog].sort((left, right) => left.time - right.time)
        : undefined;

    return {
      dpsAtoB,
      dpsBtoA,
      ttkAtoB,
      ttkBtoA,
      deathTimeA,
      deathTimeB,
      maxTimeSec: maxTime,
      finalHpA: deathTimeA != null ? 0 : Math.max(0, stateA.hp),
      finalHpB: deathTimeB != null ? 0 : Math.max(0, stateB.hp),
      maxHpA: runtimeA.final.health,
      maxHpB: runtimeB.final.health,
      hpAAtBDeath: deathTimeB == null ? Math.max(0, stateA.hp) : hpA_atBDeath,
      hpBAtADeath: deathTimeA == null ? Math.max(0, stateB.hp) : hpB_atADeath,
      ehpA,
      ehpB,
      winner,
      approxNotes: Array.from(new Set(approxNotes)),
      damageDealtA: stateA.damageDealt,
      damageDealtB: stateB.damageDealt,
      damageDealtA_untilBDeath: damageAAtRelevantEnd,
      damageDealtB_untilADeath: damageBAtRelevantEnd,
      damageDealtAAtBDeath: damageAAtRelevantEnd,
      damageDealtBAtADeath: damageBAtRelevantEnd,
      regenHealedA: stateA.regenHealed,
      regenHealedB: stateB.regenHealed,
      regenTicksA: stateA.regenTicks,
      regenTicksB: stateB.regenTicks,
      extendedDamagePotentialA: extendedA,
      extendedDamagePotentialB: extendedB,
      badOmenOutcome,
      combatLog,
      debug: {
        A: deps.buildDebug(runtimeA, stateA, runtimeB.final, disabledA),
        B: deps.buildDebug(runtimeB, stateB, runtimeA.final, disabledB),
      },
    };
  }

  return { buildSimulationSummary };
}
