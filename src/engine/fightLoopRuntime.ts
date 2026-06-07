import type { AbilityTimingMode } from "./types";
import { createCombatSide, reportInfiniteLoop } from "./fightLoopHelpers";
import { createFightLoopStepRuntime } from "./fightLoopStepRuntime";
import { recordRewindSnapshot } from "./combatPrimitives";
import type { FightLoopDeps, FightLoopParams } from "./fightLoopTypes";

export function createFightLoopRuntime(deps: FightLoopDeps) {
  const stepRuntime = createFightLoopStepRuntime(deps);

  function runFightLoop(params: FightLoopParams): {
    time: number;
    deathTimeA: number | null;
    deathTimeB: number | null;
    damageDealtA_untilBDeath: number;
    damageDealtB_untilADeath: number;
    hpA_atBDeath: number;
    hpB_atADeath: number;
  } {
    const {
      attacker,
      defender,
      runtimeA,
      runtimeB,
      stateA,
      stateB,
      options,
      disabledA,
      disabledB,
      maxTime,
    } = params;
    let time = 0;
    let deathTimeA: number | null = null;
    let deathTimeB: number | null = null;
    let damageDealtA_untilBDeath = 0;
    let damageDealtB_untilADeath = 0;
    let hpA_atBDeath = stateA.hp;
    let hpB_atADeath = stateB.hp;

    let iterationCount = 0;
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    const DEBUG_LOOP = proc?.env?.DEBUG_ENGINE_LOOP === "1";
    const MAX_ITERATIONS = DEBUG_LOOP ? 2000 : 100000;
    const stuckHistogram: Map<string, number> = new Map();
    let debugDumpedAt = -1;

    let nextBreathA =
      options.breathOn && !deps.isAbilityDisabled(disabledA, deps.disableBreath) ? deps.breathTickSec : Number.POSITIVE_INFINITY;
    let nextBreathB =
      options.breathOn && !deps.isAbilityDisabled(disabledB, deps.disableBreath) ? deps.breathTickSec : Number.POSITIVE_INFINITY;
    const sideA = createCombatSide(runtimeA, stateA, disabledA);
    const sideB = createCombatSide(runtimeB, stateB, disabledB);
    recordRewindSnapshot(stateA, 0);
    recordRewindSnapshot(stateB, 0);

    while (time <= maxTime && (deathTimeA == null || deathTimeB == null)) {
      iterationCount++;
      if (iterationCount > MAX_ITERATIONS) {
        reportInfiniteLoop({ time, iterationCount, attacker, defender, stateA, stateB });
        if (DEBUG_LOOP) {
          const top = [...stuckHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
          console.error(`[ENGINE] Top event sources (iter->min pairs): ${JSON.stringify(top)}`);
        }
        break;
      }

      const nextEventAt = deps.timelineRuntime.nextEventAt(stateA, stateB, nextBreathA, nextBreathB);
      if (!Number.isFinite(nextEventAt)) break;

      if (DEBUG_LOOP && iterationCount > 500) {
        const describe = (deps.timelineRuntime as unknown as {
          describeEventSources?: (
            a: typeof stateA,
            b: typeof stateB,
            na: number,
            nb: number,
          ) => Array<{ label: string; value: number }>;
        }).describeEventSources;
        if (describe) {
          const sources = describe(stateA, stateB, nextBreathA, nextBreathB);
          const minVal = Math.min(...sources.map((s) => s.value));
          for (const s of sources) {
            if (s.value === minVal && Number.isFinite(minVal)) {
              stuckHistogram.set(s.label, (stuckHistogram.get(s.label) ?? 0) + 1);
            }
          }
          if (iterationCount > 1990 && debugDumpedAt < 0) {
            debugDumpedAt = iterationCount;
            const finite = sources.filter((s) => Number.isFinite(s.value)).sort((a, b) => a.value - b.value).slice(0, 10);
            console.error(`[ENGINE] Near-cap event source snapshot at iter=${iterationCount} time=${time.toFixed(4)}:`);
            console.error(`  lastUpdateAt: A=${stateA.lastUpdateAt.toFixed(4)} B=${stateB.lastUpdateAt.toFixed(4)}`);
            for (const s of finite) console.error(`  ${s.label}=${s.value.toFixed(6)}`);
          }
        }
      }

      if (nextEventAt < time - 1e-9) {
        if (stateA.selfDestructArmedAt !== null && stateA.selfDestructArmedAt <= time) {
          stateA.selfDestructArmedAt = null;
        }
        if (stateB.selfDestructArmedAt !== null && stateB.selfDestructArmedAt <= time) {
          stateB.selfDestructArmedAt = null;
        }
        time += 0.001;
        continue;
      }

      // Normalize to 1ns to absorb sub-ULP FP drift (e.g. 7.7 + 0.3 = 7.999...91).
      // Without this, `time >= scheduledAt` comparisons in handlers miss by 1 ULP,
      // the event never fires, and the outer loop spins forever on the stale branch.
      time = Math.round(nextEventAt * 1e9) / 1e9;

      const abilityPolicy: AbilityTimingMode = options.abilityPolicy ?? "semiIdeal";
      const stepResult = stepRuntime.runFightStep({
        time,
        sideA,
        sideB,
        optionsActivesOn: options.activesOn,
        optionsBreathOn: options.breathOn,
        abilityPolicy,
        nextBreathA,
        nextBreathB,
      });
      nextBreathA = stepResult.nextBreathA;
      nextBreathB = stepResult.nextBreathB;
      recordRewindSnapshot(stateA, time);
      recordRewindSnapshot(stateB, time);

      if (stateA.hp <= 0 && deathTimeA == null) {
        deathTimeA = time;
        damageDealtB_untilADeath = stateB.damageDealt;
        hpB_atADeath = Math.max(0, stateB.hp);
      }
      if (stateB.hp <= 0 && deathTimeB == null) {
        deathTimeB = time;
        damageDealtA_untilBDeath = stateA.damageDealt;
        hpA_atBDeath = Math.max(0, stateA.hp);
      }
      if (deathTimeA != null && deathTimeB != null) break;

      if (deathTimeA != null) {
        stateA.hp = 1;
      }
      if (deathTimeB != null) {
        stateB.hp = 1;
      }

      // Defensive progress guard: if after stepping, the next scheduled event
      // is still at-or-before current time, some handler emitted an event it
      // then bailed out of without advancing its schedule. Bump time by an
      // epsilon to break the potential infinite loop. This should rarely hit
      // in well-behaved code - treat any hit as a bug worth investigating.
      const peekNext = deps.timelineRuntime.nextEventAt(stateA, stateB, nextBreathA, nextBreathB);
      if (Number.isFinite(peekNext) && peekNext <= time + 1e-9) {
        time += 0.001;
      }
    }

    return {
      time,
      deathTimeA,
      deathTimeB,
      damageDealtA_untilBDeath,
      damageDealtB_untilADeath,
      hpA_atBDeath,
      hpB_atADeath,
    };
  }

  return { runFightLoop };
}
