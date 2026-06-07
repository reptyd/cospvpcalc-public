import { addApproximationNote } from "./approximationNotes";
import { comparePolicyStateScore } from "./combatPrimitives";
import { cloneStatuses, getRewindSnapshotAt } from "./combatPrimitives";
import { isActivesDisabledByNecro } from "./runtimeHelpers";
import type { AbilityTimingMode } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { ActivesDeps } from "./activesRuntimeTypes";
import { resolveAbilityTimingModeForAbility } from "./abilityTimingOverrides";

export function createActiveUtilityRuntime(deps: ActivesDeps) {
  function isReallyFastPolicy(abilityPolicy: AbilityTimingMode): boolean {
    return abilityPolicy === "reallyFast";
  }

  function totalFortifyRemovableStacks(state: CombatantState, removable: string[]): number {
    return removable.reduce((sum, statusId) => sum + Math.max(0, state.statuses[statusId]?.stacks ?? 0), 0);
  }

  function shouldSnapDelayedActivationNow(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    chosenDelaySec: number,
    keepScore: { winRank: number; ttk: number; effectiveDamage: number },
    bestScore: { winRank: number; ttk: number; effectiveDamage: number },
    immediateScore: { winRank: number; ttk: number; effectiveDamage: number } | undefined,
    options?: {
      preferImmediateBurstWhenLosing?: boolean;
    },
  ): boolean {
    if (chosenDelaySec <= 0) return false;
    if (!immediateScore) return false;
    const immediateBeatsKeep = comparePolicyStateScore(immediateScore, keepScore) < 0;
    if (!immediateBeatsKeep) {
      if (
        !options?.preferImmediateBurstWhenLosing ||
        keepScore.winRank !== 0 ||
        immediateScore.winRank !== 0 ||
        immediateScore.effectiveDamage < keepScore.effectiveDamage * 1.1
      ) {
        return false;
      }
    }
    if (
      bestScore.winRank === 0 &&
      immediateScore.winRank === 0 &&
      chosenDelaySec >= 1 &&
      immediateScore.effectiveDamage >= bestScore.effectiveDamage * 0.9
    ) {
      return true;
    }
    if (
      options?.preferImmediateBurstWhenLosing &&
      bestScore.winRank === 0 &&
      immediateScore.winRank === 0 &&
      immediateScore.effectiveDamage >= bestScore.effectiveDamage * 1.02 &&
      bestScore.ttk - immediateScore.ttk <= 0.15
    ) {
      return true;
    }
    const incomingDps = deps.policyRuntime.estimateIncomingDps(runtime, opponent, state, opponentState);
    const survivalSec = incomingDps > 0 ? state.hp / incomingDps : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(survivalSec)) return false;
    if (survivalSec > chosenDelaySec + 0.5) {
      return false;
    }
    return comparePolicyStateScore(immediateScore, bestScore) <= 0;
  }

  function scaleCooldown(state: CombatantState, baseSec: number): number {
    return baseSec * (state.activeCooldownMultiplier ?? 1);
  }

  function updateReflect(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    const effectiveAbilityPolicy = resolveAbilityTimingModeForAbility("Reflect", abilityPolicy, state.abilityPolicyOverrides);
    if (!activesOn || !runtime.hasReflect || deps.isAbilityDisabled(disabled, deps.disableReflect) || isActivesDisabledByNecro(state)) return;
    const activeUntil = state.reflectActiveUntil ?? 0;
    if (time < state.reflectCooldownUntil || time < activeUntil) return;

    const shouldActivate =
      isReallyFastPolicy(effectiveAbilityPolicy)
        ? true
        : deps.isPrecisionPolicy(effectiveAbilityPolicy)
        ? deps.policyRuntime.shouldActivateReflectBySearch(runtime, opponent, state, opponentState, effectiveAbilityPolicy)
        : true;
    if (!shouldActivate) return;

    state.reflectActiveUntil = time + deps.reflectDurationSec;
    state.reflectCooldownUntil = time + scaleCooldown(state, deps.reflectCooldownSec);
    deps.markAbilityApplied(state, "Reflect", time);
  }

  function updateDrowsyArea(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    _abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ): void {
    if (!activesOn || !runtime.hasDrowsyArea || deps.isAbilityDisabled(disabled, "Drowsy Area")) return;
    if (time < (state.drowsyAreaCooldownUntil ?? 0)) return;
    if (isActivesDisabledByNecro(state)) {
      // Necro-disabled: can't activate now. Push the "ready at" forward so we
      // don't busy-loop on the same scheduled event; re-check in 1s.
      state.drowsyAreaCooldownUntil = time + 1;
      return;
    }
    deps.applyStatusToTarget(time, opponent, opponentState, "Drowsy_Status", 5, opponentDisabled, state, "Drowsy Area");
    state.drowsyAreaCooldownUntil = time + scaleCooldown(state, deps.drowsyAreaCooldownSec);
    deps.markAbilityApplied(state, "Drowsy Area", time);
  }

  function updateTotem(
    time: number,
    runtime: CombatantRuntime,
    _opponent: CombatantRuntime,
    state: CombatantState,
    _opponentState: CombatantState,
    activesOn: boolean,
    _abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    if (!activesOn || !runtime.hasTotem || deps.isAbilityDisabled(disabled, "Totem") || isActivesDisabledByNecro(state)) return;
    if ((state.totemActiveUntil ?? 0) > time) return;
    if (time < (state.totemCooldownUntil ?? 0)) return;
    state.totemActiveUntil = time + deps.totemDurationSec;
    state.totemNextTickAt = time + deps.totemTickSec;
    state.totemCooldownUntil = time + scaleCooldown(state, deps.totemCooldownSec);
    deps.markAbilityApplied(state, "Totem", time, "Totem activated");
  }

  function updateAdrenaline(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    const effectiveAbilityPolicy = resolveAbilityTimingModeForAbility("Adrenaline", abilityPolicy, state.abilityPolicyOverrides);
    if (!activesOn || !runtime.hasAdrenaline || deps.isAbilityDisabled(disabled, "Adrenaline") || isActivesDisabledByNecro(state)) return;
    if (time < state.adrenalineCooldownUntil || time < state.adrenalineActiveUntil) {
      state.adrenalinePlannedAt = 0;
      return;
    }
    if (state.adrenalinePlannedAt > time + 1e-9) return;
    if (state.adrenalinePlannedAt > 0 && time + 1e-9 >= state.adrenalinePlannedAt) {
      state.adrenalinePlannedAt = 0;
    } else if (isReallyFastPolicy(effectiveAbilityPolicy)) {
      state.adrenalinePlannedAt = 0;
    } else if (deps.isPrecisionPolicy(effectiveAbilityPolicy)) {
      const decision = deps.policyRuntime.decideAdrenalineActivationBySearch(
        runtime,
        opponent,
        state,
        opponentState,
        effectiveAbilityPolicy,
        time,
      );
      if (!decision.shouldActivate) {
        state.adrenalinePlannedAt = 0;
        return;
      }
      const chosenDelaySec = decision.chosenDelaySec ?? Number.POSITIVE_INFINITY;
      if (chosenDelaySec > 1e-9) {
        state.adrenalinePlannedAt = time + chosenDelaySec;
        return;
      }
      state.adrenalinePlannedAt = 0;
    } else {
      state.adrenalinePlannedAt = 0;
      const shouldActivate = deps.policyRuntime.shouldActivateAdrenalineBySearch(
        runtime,
        opponent,
        state,
        opponentState,
        effectiveAbilityPolicy,
      );
      if (!shouldActivate) return;
    }

    state.adrenalineActiveUntil = time + deps.adrenalineDurationSec;
    state.adrenalineCooldownUntil = time + scaleCooldown(state, deps.adrenalineCooldownSec);
    deps.markAbilityApplied(state, "Adrenaline", time);
  }

  function updateLichMark(
    time: number,
    runtime: CombatantRuntime,
    _opponent: CombatantRuntime,
    state: CombatantState,
    _opponentState: CombatantState,
    activesOn: boolean,
    _abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    if (!activesOn || !runtime.hasLichMark || deps.isAbilityDisabled(disabled, "Lich Mark") || isActivesDisabledByNecro(state)) return;
    if (time < state.lichMarkCooldownUntil || time < state.lichMarkArmedUntil) return;
    state.lichMarkArmedUntil = time + deps.lichMarkArmedWindowSec;
    state.lichMarkCooldownUntil = time + scaleCooldown(state, deps.lichMarkCooldownSec);
    deps.markAbilityApplied(state, "Lich Mark", time, "Lich Mark armed");
  }

  function updateHarden(
    time: number,
    runtime: CombatantRuntime,
    _opponent: CombatantRuntime,
    state: CombatantState,
    _opponentState: CombatantState,
    activesOn: boolean,
    _abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    if (!activesOn || deps.isAbilityDisabled(disabled, "Harden") || isActivesDisabledByNecro(state)) return;
    if (!runtime.hasHarden) return;
    if (time < state.hardenCooldownUntil || time < state.hardenActiveUntil) return;
    state.hardenActiveUntil = time + deps.hardenStacks * deps.statusStackDurationSec;
    state.hardenCooldownUntil = time + scaleCooldown(state, deps.hardenCooldownSec);
    deps.markAbilityApplied(state, "Harden", time);
  }

  function updateHuntersCurse(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    const effectiveAbilityPolicy = resolveAbilityTimingModeForAbility("Hunters Curse", abilityPolicy, state.abilityPolicyOverrides);
    if (!activesOn || deps.isAbilityDisabled(disabled, "Hunters Curse") || isActivesDisabledByNecro(state)) return;
    if (!runtime.hasHuntersCurse) return;
    if (time < state.huntersCurseCooldownUntil || time < state.huntersCurseActiveUntil) {
      state.huntersCursePlannedAt = 0;
      return;
    }
    if (state.huntersCursePlannedAt > time + 1e-9) return;
    if (state.huntersCursePlannedAt > 0 && time + 1e-9 >= state.huntersCursePlannedAt) {
      state.huntersCursePlannedAt = 0;
    } else if (isReallyFastPolicy(effectiveAbilityPolicy)) {
      state.huntersCursePlannedAt = 0;
    } else if (deps.isPrecisionPolicy(effectiveAbilityPolicy)) {
      const decision = deps.policyRuntime.decideHuntersCurseActivationBySearch(
        runtime,
        opponent,
        state,
        opponentState,
        effectiveAbilityPolicy,
      );
      if (!decision.shouldActivate) {
        state.huntersCursePlannedAt = 0;
        return;
      }
      const chosenDelaySec = decision.chosenDelaySec ?? Number.POSITIVE_INFINITY;
      const immediateScore = decision.candidates.find((candidate) => candidate.activationDelaySec === 0)?.score;
      if (
        shouldSnapDelayedActivationNow(
          runtime,
          opponent,
          state,
          opponentState,
          chosenDelaySec,
          decision.keepScore,
          decision.bestScore,
          immediateScore,
          { preferImmediateBurstWhenLosing: true },
        )
      ) {
        state.huntersCursePlannedAt = 0;
      } else
      if (chosenDelaySec > 1e-9) {
        state.huntersCursePlannedAt = time + chosenDelaySec;
        return;
      }
      state.huntersCursePlannedAt = 0;
    } else {
      state.huntersCursePlannedAt = 0;
      const shouldActivate = deps.policyRuntime.shouldActivateHuntersCurse(runtime, opponent, opponentState, state);
      if (!shouldActivate) return;
    }

    const hpCost = runtime.final.health * 0.5;
    state.hp = Math.max(1, state.hp - hpCost);
    state.huntersCurseActiveUntil = time + deps.huntersCurseDurationSec;
    state.huntersCurseCooldownUntil = time + scaleCooldown(state, deps.huntersCurseCooldownSec);
    deps.markAbilityApplied(state, "Hunters Curse", time);
  }

  function updateUnbridledRage(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    const effectiveAbilityPolicy = resolveAbilityTimingModeForAbility("Unbridled Rage", abilityPolicy, state.abilityPolicyOverrides);
    if (!activesOn || deps.isAbilityDisabled(disabled, "Unbridled Rage") || isActivesDisabledByNecro(state)) return;
    if (!runtime.hasUnbridledRage) return;
    if (time < state.unbridledRageCooldownUntil || time < state.unbridledRageActiveUntil) {
      state.unbridledRagePlannedAt = 0;
      return;
    }
    if (state.unbridledRagePlannedAt > time + 1e-9) return;
    if (state.unbridledRagePlannedAt > 0 && time + 1e-9 >= state.unbridledRagePlannedAt) {
      state.unbridledRagePlannedAt = 0;
    } else if (isReallyFastPolicy(effectiveAbilityPolicy)) {
      state.unbridledRagePlannedAt = 0;
    } else if (deps.isPrecisionPolicy(effectiveAbilityPolicy)) {
      const decision = deps.policyRuntime.decideUnbridledRageActivationBySearch(
        runtime,
        opponent,
        state,
        opponentState,
        effectiveAbilityPolicy,
      );
      if (!decision.shouldActivate) {
        state.unbridledRagePlannedAt = 0;
        return;
      }
      const chosenDelaySec = decision.chosenDelaySec ?? Number.POSITIVE_INFINITY;
      const immediateScore = decision.candidates.find((candidate) => candidate.activationDelaySec === 0)?.score;
      if (
        shouldSnapDelayedActivationNow(
          runtime,
          opponent,
          state,
          opponentState,
          chosenDelaySec,
          decision.keepScore,
          decision.bestScore,
          immediateScore,
          { preferImmediateBurstWhenLosing: true },
        )
      ) {
        state.unbridledRagePlannedAt = 0;
      } else
      if (chosenDelaySec > 1e-9) {
        state.unbridledRagePlannedAt = time + chosenDelaySec;
        return;
      }
      state.unbridledRagePlannedAt = 0;
    } else {
      state.unbridledRagePlannedAt = 0;
      const shouldActivate = deps.policyRuntime.shouldActivateUnbridledRage(runtime, state);
      if (!shouldActivate) return;
    }

    addApproximationNote(state.approxNotes, "UNBRIDLED_RAGE_STAMINA_UNMODELED");
    state.unbridledRageActiveUntil = time + deps.unbridledRageDurationSec;
    state.unbridledRageCooldownUntil = time + scaleCooldown(state, deps.unbridledRageCooldownSec);
    deps.markAbilityApplied(state, "Unbridled Rage", time);
  }

  function handleFortify(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    const effectiveAbilityPolicy = resolveAbilityTimingModeForAbility("Fortify", abilityPolicy, state.abilityPolicyOverrides);
    if (!activesOn || deps.isAbilityDisabled(disabled, "Fortify") || isActivesDisabledByNecro(state)) return;
    if (!runtime.hasFortify) return;
    if (time < state.fortifyCooldownUntil) return;

    const removable = Object.keys(state.statuses).filter((statusId) => deps.isFortifyRemovableStatus(statusId));
    const removableStacks = totalFortifyRemovableStacks(state, removable);
    const shouldActivate =
      isReallyFastPolicy(effectiveAbilityPolicy)
        ? removableStacks >= 15
        : deps.isPrecisionPolicy(effectiveAbilityPolicy)
        ? deps.policyRuntime.shouldActivateFortifyBySearch(
            runtime,
            opponent,
            state,
            opponentState,
            removable,
            effectiveAbilityPolicy,
          )
        : deps.shouldActivateFortifyHeuristic(removable);
    if (!shouldActivate) return;

    for (const statusId of removable) {
      delete state.statuses[statusId];
      state.compareStatusLastClearedAt[statusId] = time;
    }
    state.fortifyCooldownUntil = time + scaleCooldown(state, deps.fortifyCooldownSec);
    state.fortifyImmuneUntil = time + deps.fortifyStacks * deps.statusStackDurationSec;
    state.fortifyWeightBonusUntil = time + deps.fortifyStacks * deps.statusStackDurationSec;
    deps.markAbilityApplied(state, "Fortify", time);
  }

  function updateRewind(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    const effectiveAbilityPolicy = resolveAbilityTimingModeForAbility("Rewind", abilityPolicy, state.abilityPolicyOverrides);
    if (!activesOn || deps.isAbilityDisabled(disabled, "Rewind") || isActivesDisabledByNecro(state)) return;
    if (!runtime.hasRewind || time < state.rewindCooldownUntil) return;

    const snapshot = getRewindSnapshotAt(state, time, 9);
    if (!snapshot) return;

    const hpDelta = snapshot.hp - state.hp;
    const healedHp = hpDelta > 0 ? Math.min(runtime.final.health * 0.25, hpDelta) : hpDelta;
    const restoredHp = Math.max(0, Math.min(runtime.final.health, state.hp + healedHp));
    const restoredStatuses = cloneStatuses(snapshot.statuses);

    const shouldActivate =
      isReallyFastPolicy(effectiveAbilityPolicy)
        ? state.hp / Math.max(1, runtime.final.health) <= 0.75
        : deps.isPrecisionPolicy(effectiveAbilityPolicy)
        ? deps.policyRuntime.shouldActivateRewindBySearch(
            runtime,
            opponent,
            state,
            opponentState,
            restoredHp,
            restoredStatuses,
            effectiveAbilityPolicy,
          )
        : restoredHp > state.hp || Object.keys(restoredStatuses).length < Object.keys(state.statuses).length;
    if (!shouldActivate) return;

    state.hp = restoredHp;
    state.statuses = restoredStatuses;
    state.rewindCooldownUntil = time + scaleCooldown(state, 100);
    deps.markAbilityApplied(state, "Rewind", time);
  }

  return {
    updateReflect,
    updateDrowsyArea,
    updateTotem,
    updateAdrenaline,
    updateLichMark,
    updateHarden,
    updateHuntersCurse,
    updateUnbridledRage,
    handleFortify,
    updateRewind,
  };
}
