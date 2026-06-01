import type { BreathTickContext, CombatantRuntime, CombatantState, TickContext } from "./runtimeContext";
import type { AbilityTimingMode, FinalStats, SimulationOptions } from "./types";

type ExtendedDamageDeps = {
  breathTickSec: number;
  createCombatantState: (finalStats: FinalStats) => CombatantState;
  nextEventAtSingle: (state: CombatantState, nextBreath: number) => number;
  updateStateAt: (ctx: TickContext) => void;
  isActivesDisabledByNecro: (state: CombatantState) => boolean;
  handleMeleeHit: (ctx: TickContext) => boolean;
  currentBiteCooldown: (runtime: CombatantRuntime, state: CombatantState, activesOn: boolean) => number;
  handleDotTicks: (ctx: { time: number; target: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> } }) => void;
  handleChannelingPulse: (ctx: TickContext) => void;
  handleSelfDestruct: (ctx: TickContext) => void;
  handleTotemTick: (ctx: TickContext) => void;
  applyBreathTick: (ctx: BreathTickContext) => void;
};

export function createExtendedDamageRuntime(deps: ExtendedDamageDeps) {
  function nextBreathHeartbeatAfter(time: number): number {
    if (!Number.isFinite(time) || deps.breathTickSec <= 0) return Number.POSITIVE_INFINITY;
    const tick = deps.breathTickSec;
    const epsilon = 1e-9;
    const elapsedTicks = Math.floor((time + epsilon) / tick);
    const nextHeartbeat = (elapsedTicks + 1) * tick;
    return nextHeartbeat > time + epsilon ? nextHeartbeat : nextHeartbeat + tick;
  }

  function computeExtendedDamagePotential(
    winnerRuntime: CombatantRuntime,
    winnerState: CombatantState,
    loserRuntime: CombatantRuntime,
    options: SimulationOptions,
  ): number {
    const winnerStateCopy = JSON.parse(JSON.stringify(winnerState)) as CombatantState;
    const startTime = winnerStateCopy.lastUpdateAt;
    const extraMaxSec = startTime + 30;
    const dummyRuntime: CombatantRuntime = {
      ...loserRuntime,
      creature: { ...loserRuntime.creature, name: "Dummy" },
      effects: {},
      hasWardenRage: false,
      hasWardenResistance: false,
      hasReflect: false,
      hasTotem: false,
      hasDrowsyArea: false,
      hasLichMark: false,
      hasCursedSigil: false,
      hasAdrenaline: false,
      hasHealingStep: false,
      hasToxicTrail: false,
      hasPlagueTrail: false,
      hasFlameTrail: false,
      hasFrostTrail: false,
      hasSpite: false,
      hasCauseFear: false,
      hasReflux: false,
      hasRewind: false,
      hasShadowBarrage: false,
      hasFrostSnare: false,
      hasPoisonArea: false,
      hasYolkBomb: false,
      hasDivination: false,
      hasToxicTrap: false,
      lichMarkValue: null,
      yolkBombValue: null,
    };
    const dummyState = deps.createCombatantState(loserRuntime.final);
    dummyState.hp = 1e9;
    dummyState.nextHitAt = Number.POSITIVE_INFINITY;

    const startDamage = winnerStateCopy.damageDealt;

    let time = startTime;
    let nextBreath =
      options.breathOn && winnerRuntime.final.hasBreath ? nextBreathHeartbeatAfter(startTime) : Number.POSITIVE_INFINITY;
    const abilityPolicy: AbilityTimingMode = options.abilityPolicy ?? "semiIdeal";
    while (time <= extraMaxSec && winnerStateCopy.hp > 0) {
      const nextEventAt = deps.nextEventAtSingle(winnerStateCopy, nextBreath);
      if (!Number.isFinite(nextEventAt)) break;
      time = nextEventAt;

      deps.updateStateAt({ time, attacker: { runtime: winnerRuntime, state: winnerStateCopy, disabled: new Set() }, defender: { runtime: dummyRuntime, state: dummyState, disabled: new Set() }, activesOn: options.activesOn, abilityPolicy });
      const activesEnabled = options.activesOn && !deps.isActivesDisabledByNecro(winnerStateCopy);

      if (time >= winnerStateCopy.nextHitAt) {
        deps.handleMeleeHit({ time, attacker: { runtime: winnerRuntime, state: winnerStateCopy, disabled: new Set() }, defender: { runtime: dummyRuntime, state: dummyState, disabled: new Set() }, activesOn: activesEnabled, abilityPolicy });
        winnerStateCopy.nextHitAt = time + deps.currentBiteCooldown(winnerRuntime, winnerStateCopy, activesEnabled);
      }

      deps.handleDotTicks({ time, target: { runtime: winnerRuntime, state: winnerStateCopy, disabled: new Set() } });
      deps.handleChannelingPulse({ time, attacker: { runtime: winnerRuntime, state: winnerStateCopy, disabled: new Set() }, defender: { runtime: dummyRuntime, state: dummyState, disabled: new Set() }, activesOn: activesEnabled, abilityPolicy });
      deps.handleSelfDestruct({ time, attacker: { runtime: winnerRuntime, state: winnerStateCopy, disabled: new Set() }, defender: { runtime: dummyRuntime, state: dummyState, disabled: new Set() }, activesOn: activesEnabled, abilityPolicy });
      deps.handleTotemTick({ time, attacker: { runtime: winnerRuntime, state: winnerStateCopy, disabled: new Set() }, defender: { runtime: dummyRuntime, state: dummyState, disabled: new Set() }, activesOn: activesEnabled, abilityPolicy });

      if (time >= nextBreath) {
        deps.applyBreathTick({ time, attacker: { runtime: winnerRuntime, state: winnerStateCopy, disabled: new Set() }, defender: { runtime: dummyRuntime, state: dummyState, disabled: new Set() }, breathOn: options.breathOn, activesOn: activesEnabled, abilityPolicy });
        nextBreath = time + deps.breathTickSec;
      }
    }

    return Math.max(0, winnerStateCopy.damageDealt - startDamage);
  }

  return {
    computeExtendedDamagePotential,
  };
}
