import type { CombatantRuntime, CombatantState, TickContext } from "./runtimeContext";
import type { AbilityTimingMode } from "./types";
import { advanceCompareHunger } from "./compareHungerMath";
import {
  getDefiledGroundConsumptionMultiplier,
  normalizeCompareDefiledGroundLevel,
} from "./compareDefiledGroundData";
import { syncConditionalPassiveTimeline } from "./conditionalPassiveRuntime";

type StateTickDeps = {
  updateStatusDurations: (
    time: number,
    delta: number,
    runtime: CombatantRuntime,
    state: CombatantState,
    disabled: Set<string>,
  ) => void;
  updateSpite: (
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ) => void;
  updateRadiation: (
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ) => void;
  updateCauseFear: (
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ) => void;
  updateReflux: (
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ) => void;
  updateLanceAura: (
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ) => void;
  updateTrails: (
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ) => void;
  handleThornTrap: (
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ) => void;
  handleCursedSigil: (
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ) => void;
  stateRuntime: {
    updateWardenRage: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    updateHunker: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    updateLifeLeech: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
  };
  activesRuntime: {
    updateReflect: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    updateDrowsyArea: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
      opponentDisabled: Set<string>,
    ) => void;
    updateTotem: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    updateAdrenaline: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    updateLichMark: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    updateHarden: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    updateHuntersCurse: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    updateUnbridledRage: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    handleFrostNova: (
      time: number,
      attacker: CombatantRuntime,
      defender: CombatantRuntime,
      attackerState: CombatantState,
      defenderState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      attackerDisabled: Set<string>,
      defenderDisabled: Set<string>,
    ) => void;
    handleGrimLariat: (
      time: number,
      attacker: CombatantRuntime,
      defender: CombatantRuntime,
      attackerState: CombatantState,
      defenderState: CombatantState,
      activesOn: boolean,
      attackerDisabled: Set<string>,
      defenderDisabled: Set<string>,
    ) => void;
    handleFortify: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    updateRewind: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
    handleFrostSnare: (
      time: number,
      attacker: CombatantRuntime,
      defender: CombatantRuntime,
      attackerState: CombatantState,
      defenderState: CombatantState,
      activesOn: boolean,
      attackerDisabled: Set<string>,
      defenderDisabled: Set<string>,
    ) => void;
    handlePoisonArea: (
      time: number,
      attacker: CombatantRuntime,
      defender: CombatantRuntime,
      attackerState: CombatantState,
      defenderState: CombatantState,
      activesOn: boolean,
      attackerDisabled: Set<string>,
      defenderDisabled: Set<string>,
    ) => void;
    handleYolkBomb: (
      time: number,
      attacker: CombatantRuntime,
      defender: CombatantRuntime,
      attackerState: CombatantState,
      defenderState: CombatantState,
      activesOn: boolean,
      attackerDisabled: Set<string>,
      defenderDisabled: Set<string>,
    ) => void;
    handleDivination: (
      time: number,
      attacker: CombatantRuntime,
      defender: CombatantRuntime,
      attackerState: CombatantState,
      defenderState: CombatantState,
      activesOn: boolean,
      attackerDisabled: Set<string>,
      defenderDisabled: Set<string>,
    ) => void;
    handleToxicTrap: (
      time: number,
      attacker: CombatantRuntime,
      defender: CombatantRuntime,
      attackerState: CombatantState,
      defenderState: CombatantState,
      activesOn: boolean,
      attackerDisabled: Set<string>,
      defenderDisabled: Set<string>,
    ) => void;
    updateShadowBarrage: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      activesOn: boolean,
      abilityPolicy: AbilityTimingMode,
      disabled: Set<string>,
    ) => void;
  };
  regenRuntime: {
    handlePassiveRegen: (time: number, runtime: CombatantRuntime, state: CombatantState) => void;
  };
};

export function createStateTickRuntime(deps: StateTickDeps) {
  function updateCompareHunger(state: CombatantState, delta: number): void {
    if (!state.compareHungerRuleEnabled) return;
    const diseaseStacks = state.statuses["Disease_Status"]?.stacks ?? 0;
    const ownerLevel =
      state.compareDefiledGroundLevel > 0 ? normalizeCompareDefiledGroundLevel(state.compareDefiledGroundLevel) : null;
    const consumptionMultiplier =
      (ownerLevel
        ? getDefiledGroundConsumptionMultiplier(ownerLevel, state.compareDefiledGroundWeaknessEnabled)
        : state.compareDefiledGroundWeaknessEnabled
        ? 1.2
        : 1) * (state.comparePlushieDrainMultiplier ?? 1);
    state.compareHunger = advanceCompareHunger(
      state.compareHunger,
      state.compareAppetiteBase,
      delta,
      diseaseStacks,
      state.compareGourmandizerEnabled,
      consumptionMultiplier,
    );
  }

  function updateStateAt(ctx: TickContext): void {
    const { time, attacker, defender, activesOn, abilityPolicy } = ctx;
    const runtime = attacker.runtime;
    const opponent = defender.runtime;
    const state = attacker.state;
    const opponentState = defender.state;
    const disabled = attacker.disabled;
    const opponentDisabled = defender.disabled;
    if (time <= state.lastUpdateAt) return;
    const delta = time - state.lastUpdateAt;

    updateCompareHunger(state, delta);
    deps.updateStatusDurations(time, delta, runtime, state, disabled);
    deps.stateRuntime.updateWardenRage(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.stateRuntime.updateHunker(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.activesRuntime.updateReflect(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.activesRuntime.updateDrowsyArea(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled, opponentDisabled);
    deps.activesRuntime.updateTotem(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.activesRuntime.updateAdrenaline(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.activesRuntime.updateLichMark(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.activesRuntime.updateHarden(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.updateSpite(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.updateRadiation(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.updateCauseFear(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.updateReflux(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.updateLanceAura(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.updateTrails(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.stateRuntime.updateLifeLeech(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.activesRuntime.updateHuntersCurse(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.activesRuntime.updateUnbridledRage(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.handleThornTrap(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.activesRuntime.handleFrostNova(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled, opponentDisabled);
    deps.activesRuntime.handleGrimLariat(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.activesRuntime.handleFortify(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.activesRuntime.updateRewind(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.activesRuntime.handleFrostSnare(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.activesRuntime.handlePoisonArea(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.activesRuntime.handleYolkBomb(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.activesRuntime.handleDivination(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.activesRuntime.handleToxicTrap(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.activesRuntime.updateShadowBarrage(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, disabled);
    deps.handleCursedSigil(time, runtime, opponent, state, opponentState, activesOn, disabled, opponentDisabled);
    deps.regenRuntime.handlePassiveRegen(time, runtime, state);
    syncConditionalPassiveTimeline(time, runtime, state, disabled, activesOn);
    state.lastUpdateAt = time;
  }

  return {
    updateStateAt,
  };
}
