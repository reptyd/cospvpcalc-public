import { createTickContext } from "./fightLoopHelpers";
import type { CombatSide } from "./runtimeContext";
import type { AbilityTimingMode } from "./types";
import type { FightLoopDeps } from "./fightLoopTypes";

type StepFightContext = {
  time: number;
  sideA: CombatSide;
  sideB: CombatSide;
  optionsActivesOn: boolean;
  optionsBreathOn: boolean;
  abilityPolicy: AbilityTimingMode;
  nextBreathA: number;
  nextBreathB: number;
};

export function createFightLoopStepRuntime(deps: FightLoopDeps) {
  function runFightStep(ctx: StepFightContext): {
    nextBreathA: number;
    nextBreathB: number;
  } {
    const { time, sideA, sideB, optionsActivesOn, optionsBreathOn, abilityPolicy } = ctx;
    const runtimeA = sideA.runtime;
    const runtimeB = sideB.runtime;
    const stateA = sideA.state;
    const stateB = sideB.state;
    const disabledA = sideA.disabled;
    const disabledB = sideB.disabled;
    let nextBreathA = ctx.nextBreathA;
    let nextBreathB = ctx.nextBreathB;

    deps.updateStateAt(createTickContext(time, sideA, sideB, optionsActivesOn, abilityPolicy));
    deps.updateStateAt(createTickContext(time, sideB, sideA, optionsActivesOn, abilityPolicy));

    const activesEnabledA = optionsActivesOn && !deps.isActivesDisabledByNecro(stateA);
    const activesEnabledB = optionsActivesOn && !deps.isActivesDisabledByNecro(stateB);

    // Use epsilon tolerance to match futureEventAt's `value >= cutoff - 1e-9`
    // scheduling filter: avoids 1-ULP FP drift causing an event to never fire.
    const timeEps = time + 1e-9;
    if (timeEps >= stateA.nextHitAt) {
      const attacked = deps.handleMeleeHit(createTickContext(time, sideA, sideB, activesEnabledA, abilityPolicy));
      if (attacked) stateA.nextHitAt = time + deps.currentBiteCooldown(runtimeA, stateA, activesEnabledA);
    }

    if (timeEps >= stateB.nextHitAt) {
      const attacked = deps.handleMeleeHit(createTickContext(time, sideB, sideA, activesEnabledB, abilityPolicy));
      if (attacked) stateB.nextHitAt = time + deps.currentBiteCooldown(runtimeB, stateB, activesEnabledB);
    }

    if (timeEps >= (stateA.shadowBarrageNextHitAt ?? Number.POSITIVE_INFINITY)) {
      deps.handleShadowBarrageHit(createTickContext(time, sideA, sideB, activesEnabledA, abilityPolicy));
    }
    if (timeEps >= (stateB.shadowBarrageNextHitAt ?? Number.POSITIVE_INFINITY)) {
      deps.handleShadowBarrageHit(createTickContext(time, sideB, sideA, activesEnabledB, abilityPolicy));
    }

    deps.handleDotTicks({ time, target: { runtime: runtimeA, state: stateA, disabled: disabledA }, sourceState: stateB });
    deps.handleDotTicks({ time, target: { runtime: runtimeB, state: stateB, disabled: disabledB }, sourceState: stateA });

    deps.handleChannelingPulse(createTickContext(time, sideA, sideB, activesEnabledA, abilityPolicy));
    deps.handleChannelingPulse(createTickContext(time, sideB, sideA, activesEnabledB, abilityPolicy));

    if (timeEps >= deps.timelineRuntime.nextSelfDestructAt(stateA)) {
      deps.handleSelfDestruct(createTickContext(time, sideA, sideB, activesEnabledA, abilityPolicy));
    }
    if (timeEps >= deps.timelineRuntime.nextSelfDestructAt(stateB)) {
      deps.handleSelfDestruct(createTickContext(time, sideB, sideA, activesEnabledB, abilityPolicy));
    }

    deps.handleTotemTick(createTickContext(time, sideA, sideB, optionsActivesOn, abilityPolicy));
    deps.handleTotemTick(createTickContext(time, sideB, sideA, optionsActivesOn, abilityPolicy));

    const breathAllowedA =
      optionsBreathOn && !deps.isActivesDisabledByNecro(stateA) && !deps.isAbilityDisabled(disabledA, deps.disableBreath);
    const breathAllowedB =
      optionsBreathOn && !deps.isActivesDisabledByNecro(stateB) && !deps.isAbilityDisabled(disabledB, deps.disableBreath);

    if (timeEps >= nextBreathA) {
      deps.applyBreathTick({ ...createTickContext(time, sideA, sideB, activesEnabledA, abilityPolicy), breathOn: breathAllowedA });
      nextBreathA = time + deps.breathTickSec;
    }
    if (timeEps >= nextBreathB) {
      deps.applyBreathTick({ ...createTickContext(time, sideB, sideA, activesEnabledB, abilityPolicy), breathOn: breathAllowedB });
      nextBreathB = time + deps.breathTickSec;
    }

    return {
      nextBreathA,
      nextBreathB,
    };
  }

  return {
    runFightStep,
  };
}
