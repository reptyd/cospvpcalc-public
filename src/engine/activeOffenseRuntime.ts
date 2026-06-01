import { addApproximationNote, addApproximationNoteOnce } from "./approximationNotes";
import { isActivesDisabledByNecro } from "./runtimeHelpers";
import type { AbilityTimingMode } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { ActivesDeps } from "./activesRuntimeTypes";

export function createActiveOffenseRuntime(deps: ActivesDeps) {
  function isReallyFastPolicy(abilityPolicy: AbilityTimingMode): boolean {
    return abilityPolicy === "reallyFast";
  }

  function scaleCooldown(state: CombatantState, baseSec: number): number {
    return baseSec * (state.activeCooldownMultiplier ?? 1);
  }

  function hasCreatureAbility(runtime: CombatantRuntime, abilityName: string): boolean {
    return (runtime.creature?.activatedAbilities ?? []).some((ability) => ability.name === abilityName);
  }

  function handleFrostNova(
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ): void {
    while (
      attackerState.frostNovaNextTickAt != null &&
      attackerState.frostNovaActiveUntil > 0 &&
      attackerState.frostNovaNextTickAt <= attackerState.frostNovaActiveUntil + 1e-9 &&
      attackerState.frostNovaNextTickAt <= time + 1e-9
    ) {
      deps.applyStatusToTarget(
        attackerState.frostNovaNextTickAt,
        defender,
        defenderState,
        "Frostbite_Status",
        3,
        defenderDisabled,
        attackerState,
        "Frost Nova",
      );
      const nextTickAt = attackerState.frostNovaNextTickAt + deps.frostNovaTickSec;
      attackerState.frostNovaNextTickAt =
        nextTickAt <= attackerState.frostNovaActiveUntil + 1e-9 ? nextTickAt : null;
    }

    if (attackerState.frostNovaActiveUntil > 0 && time + 1e-9 >= attackerState.frostNovaActiveUntil) {
      attackerState.frostNovaNextTickAt = null;
    }

    if (!activesOn || deps.isAbilityDisabled(attackerDisabled, "Frost Nova") || isActivesDisabledByNecro(attackerState)) return;
    if (!deps.hasAbilityName(attacker.effects, "Frost Nova")) return;
    if (time < attackerState.frostNovaCooldownUntil) return;
    if (time < attackerState.frostNovaActiveUntil) return;

    if (typeof attacker.abilityValueByName["Frost Nova"] !== "number") {
      addApproximationNote(attackerState.approxNotes, "FROST_NOVA_VALUE_MISSING");
    }
    const shouldActivate =
      isReallyFastPolicy(abilityPolicy)
        ? true
        : deps.isPrecisionPolicy(abilityPolicy)
        ? true
        : true;
    if (!shouldActivate) return;

    attackerState.frostNovaActiveUntil = time + deps.frostNovaDurationSec;
    attackerState.frostNovaCooldownUntil = time + scaleCooldown(attackerState, deps.frostNovaCooldownSec);
    attackerState.frostNovaNextTickAt = time + deps.frostNovaTickSec;
    deps.markAbilityApplied(attackerState, "Frost Nova", time);
  }

  function handleFrostSnare(
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ): void {
    if (!activesOn || deps.isAbilityDisabled(attackerDisabled, "Frost Snare") || isActivesDisabledByNecro(attackerState)) return;
    if (!attacker.hasFrostSnare) return;
    if (time < attackerState.frostSnareCooldownUntil) return;
    deps.applyStatusToTarget(time, defender, defenderState, "Frostbite_Status", 5, defenderDisabled, attackerState, "Frost Snare");
    attackerState.frostSnareCooldownUntil = time + scaleCooldown(attackerState, 205);
    deps.markAbilityApplied(attackerState, "Frost Snare", time);
  }

  function handlePoisonArea(
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ): void {
    if (!activesOn || deps.isAbilityDisabled(attackerDisabled, "Poison Area") || isActivesDisabledByNecro(attackerState)) return;
    if (!attacker.hasPoisonArea) return;
    if (time < attackerState.poisonAreaCooldownUntil) return;
    deps.applyStatusToTarget(time, defender, defenderState, "Poison_Status", 5, defenderDisabled, attackerState, "Poison Area");
    attackerState.poisonAreaCooldownUntil = time + scaleCooldown(attackerState, 15);
    deps.markAbilityApplied(attackerState, "Poison Area", time);
  }

  function resolveYolkBombRouting(
    value: string | null,
  ): { statusId: string | null; targetIsSelf: boolean; isFortify: boolean } {
    switch (value) {
      case "Healing Pulse":
        return { statusId: "Healing_Pulse_Status", targetIsSelf: true, isFortify: false };
      case "Stamina Boost":
        return { statusId: "Stamina_Boost_Status", targetIsSelf: true, isFortify: false };
      case "Fortify":
        return { statusId: null, targetIsSelf: true, isFortify: true };
      case "BlurredVision":
        return { statusId: "Blurred_Vision_Status", targetIsSelf: false, isFortify: false };
      case "BadOmen":
        return { statusId: "Bad_Omen", targetIsSelf: false, isFortify: false };
      case "Fear":
        return { statusId: "Scared_Status", targetIsSelf: false, isFortify: false };
      case "Hypothermia":
        return { statusId: "Hypothermia_Status", targetIsSelf: false, isFortify: false };
      case "Confusion":
        return { statusId: "Confusion_Status", targetIsSelf: false, isFortify: false };
      case "Deep Wounds":
        return { statusId: "Deep_Wounds_Status", targetIsSelf: false, isFortify: false };
      case "Drowsy":
        return { statusId: "Drowsy_Status", targetIsSelf: false, isFortify: false };
      case "Frostbite":
        return { statusId: "Frostbite_Status", targetIsSelf: false, isFortify: false };
      case "Necropoison":
        return { statusId: "Necropoison_Status", targetIsSelf: false, isFortify: false };
      case "Aftershock":
        return { statusId: "Aftershock", targetIsSelf: false, isFortify: false };
      case "Burn":
        return { statusId: "Burn_Status", targetIsSelf: false, isFortify: false };
      case "Heatwave":
        return { statusId: "Heat_Wave_Status", targetIsSelf: false, isFortify: false };
      default:
        return { statusId: null, targetIsSelf: false, isFortify: false };
    }
  }

  function handleYolkBomb(
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ): void {
    if (!activesOn || deps.isAbilityDisabled(attackerDisabled, "Yolk Bomb") || isActivesDisabledByNecro(attackerState)) return;
    if (!attacker.hasYolkBomb) return;
    if (time < attackerState.yolkBombCooldownUntil) return;

    const routing = resolveYolkBombRouting(attacker.yolkBombValue);
    const stacks = 4;
    const slowStacks = 2;

    if (routing.isFortify) {
      const durationSec = stacks * deps.statusStackDurationSec;
      attackerState.fortifyImmuneUntil = Math.max(attackerState.fortifyImmuneUntil, time + durationSec);
      attackerState.fortifyWeightBonusUntil = Math.max(attackerState.fortifyWeightBonusUntil, time + durationSec);
      deps.applyStatusToTarget(time, attacker, attackerState, "Slow_Status", slowStacks, attackerDisabled, attackerState, "Yolk Bomb");
    } else if (routing.targetIsSelf) {
      if (routing.statusId) {
        deps.applyStatusToTarget(time, attacker, attackerState, routing.statusId, stacks, attackerDisabled, attackerState, "Yolk Bomb");
      }
      deps.applyStatusToTarget(time, attacker, attackerState, "Slow_Status", slowStacks, attackerDisabled, attackerState, "Yolk Bomb");
    } else {
      if (routing.statusId) {
        deps.applyStatusToTarget(time, defender, defenderState, routing.statusId, stacks, defenderDisabled, attackerState, "Yolk Bomb");
      }
      deps.applyStatusToTarget(time, defender, defenderState, "Slow_Status", slowStacks, defenderDisabled, attackerState, "Yolk Bomb");
    }

    attackerState.yolkBombCooldownUntil = time + scaleCooldown(attackerState, 30);
    deps.markAbilityApplied(attackerState, "Yolk Bomb", time);
  }

  function handleDivination(
    time: number,
    attacker: CombatantRuntime,
    _defender: CombatantRuntime,
    attackerState: CombatantState,
    _defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    _defenderDisabled: Set<string>,
  ): void {
    void _defender;
    void _defenderState;
    void _defenderDisabled;
    if (!activesOn || deps.isAbilityDisabled(attackerDisabled, "Divination") || isActivesDisabledByNecro(attackerState)) return;
    if (!attacker.hasDivination) return;
    if (attackerState.divinationChargesLeft > 0) return;
    if (time < attackerState.divinationCooldownUntil) return;
    attackerState.divinationChargesLeft = 3;
    attackerState.divinationCooldownUntil = time + scaleCooldown(attackerState, 120);
    deps.markAbilityApplied(attackerState, "Divination", time);
  }

  function handleToxicTrap(
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ): void {
    // Process any due Poison ticks first
    while (
      attackerState.toxicTrapBitesRemaining > 0 &&
      attackerState.toxicTrapNextTickAt != null &&
      attackerState.toxicTrapNextTickAt <= time + 1e-9
    ) {
      deps.applyStatusToTarget(
        attackerState.toxicTrapNextTickAt,
        defender,
        defenderState,
        "Poison_Status",
        5,
        defenderDisabled,
        attackerState,
        "Toxic Trap",
      );
      attackerState.toxicTrapNextTickAt = attackerState.toxicTrapNextTickAt + 3;
    }
    if (attackerState.toxicTrapBitesRemaining <= 0) {
      attackerState.toxicTrapNextTickAt = null;
    }

    if (!activesOn || deps.isAbilityDisabled(attackerDisabled, "Toxic Trap") || isActivesDisabledByNecro(attackerState)) return;
    if (!attackerState.compareTrapsEnabled) return;
    if (!attacker.hasToxicTrap) return;
    if (attackerState.toxicTrapBitesRemaining > 0) return;
    if (time < attackerState.toxicTrapCooldownUntil) return;
    attackerState.toxicTrapBitesRemaining = 25;
    attackerState.toxicTrapCooldownUntil = time + scaleCooldown(attackerState, 75);
    attackerState.toxicTrapNextTickAt = time + 3;
    deps.markAbilityApplied(attackerState, "Toxic Trap", time);
  }

  function handleGrimLariat(
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ): void {
    if (!activesOn || deps.isAbilityDisabled(attackerDisabled, "Grim Lariat") || isActivesDisabledByNecro(attackerState)) return;
    if (!deps.hasAbilityName(attacker.effects, "Grim Lariat") && !hasCreatureAbility(attacker, "Grim Lariat")) return;
    if (time < attackerState.grimLariatCooldownUntil) return;

    const damage = attacker.final.damage * 0.5;
    defenderState.hp -= damage;
    attackerState.damageDealt += damage;
    deps.applyStatusToTarget(time, defender, defenderState, "Heartbroken_Status", 8, defenderDisabled, attackerState, "Grim Lariat");
    attackerState.grimLariatCooldownUntil = time + scaleCooldown(attackerState, 60);
    deps.markAbilityApplied(attackerState, "Grim Lariat", time);
  }

  function updateShadowBarrage(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    _abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    void opponent;
    void opponentState;
    if (!activesOn || deps.isAbilityDisabled(disabled, "Shadow Barrage") || isActivesDisabledByNecro(state)) return;
    if (!runtime.hasShadowBarrage || time < state.shadowBarrageCooldownUntil) return;
    if (state.shadowBarrageRemainingHits > 0) return;
    if (time - state.lastMeleeHitAt > 10) return;
    if (state.lastMeleeHitDamage <= 0) return;

    const hitCount = runtime.abilityValueByName["Shadow Barrage"];
    const count = typeof hitCount === "number" && hitCount > 0 ? Math.floor(hitCount) : 0;
    if (count <= 0) return;

    addApproximationNoteOnce(state.approxNotes, "SHADOW_BARRAGE_CADENCE_ASSUMED");
    state.shadowBarrageCooldownUntil = time + scaleCooldown(state, 30);
    state.shadowBarrageBaseDamage = state.lastMeleeHitDamage;
    state.shadowBarrageRemainingHits = count;
    state.shadowBarrageNextHitAt = time + 1;
    deps.markAbilityApplied(state, "Shadow Barrage", time);
  }

  return {
    handleFrostNova,
    handleFrostSnare,
    handlePoisonArea,
    handleYolkBomb,
    handleDivination,
    handleToxicTrap,
    handleGrimLariat,
    updateShadowBarrage,
  };
}
