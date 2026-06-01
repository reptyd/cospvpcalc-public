import {
  DISABLE_STATUS_ATTACKS,
  DISABLE_TOTEM,
  isAbilityDisabled,
} from "./subsystems/actives";
import { BAD_OMEN_STATUS_ID } from "./subsystems/statuses";
import { THORN_TRAP_COOLDOWN_SEC } from "./subsystems/timing";
import { hasAbilityName, isActivesDisabledByNecro } from "./runtimeHelpers";
import type { StatusEventContext } from "./specialEventTypes";
import type { SpecialEventsDeps } from "./specialEventTypes";
import { markAbilityApplied } from "./specialEventsRuntime";

export function createSpecialEventStatusRuntime(deps: SpecialEventsDeps) {
  function scaleCooldown(state: StatusEventContext["attackerState"], baseSec: number): number {
    return baseSec * (state.activeCooldownMultiplier ?? 1);
  }

  function handleThornTrap(ctx: StatusEventContext): void {
    const { time, attacker, defender, attackerState, defenderState, activesOn, attackerDisabled, defenderDisabled } = ctx;
    if (!activesOn || isAbilityDisabled(attackerDisabled, "Thorn Trap") || isActivesDisabledByNecro(attackerState)) return;
    if (!attackerState.compareTrapsEnabled) return;
    if (!hasAbilityName(attacker.effects, "Thorn Trap")) return;
    if (time < attackerState.thornTrapCooldownUntil) return;

    deps.applyStatusToTarget({
      time,
      target: { runtime: defender, state: defenderState, disabled: defenderDisabled },
      statusId: "Bleed_Status",
      stacks: 6,
      source: attackerState,
      sourceAbilityName: "Thorn Trap",
    });
    deps.applyStatusToTarget({
      time,
      target: { runtime: defender, state: defenderState, disabled: defenderDisabled },
      statusId: "Freeze_Status",
      stacks: 2,
      source: attackerState,
      sourceAbilityName: "Thorn Trap",
    });
    attackerState.thornTrapCooldownUntil = time + scaleCooldown(attackerState, THORN_TRAP_COOLDOWN_SEC);
    markAbilityApplied(attackerState, "Thorn Trap", time);
  }

  function handleCursedSigil(ctx: StatusEventContext): void {
    const { time, attacker, defender, attackerState, defenderState, activesOn, attackerDisabled, defenderDisabled } = ctx;
    if (!activesOn || !attacker.hasCursedSigil || isActivesDisabledByNecro(attackerState)) return;
    if (isAbilityDisabled(attackerDisabled, "Cursed Sigil")) return;
    if (time < attackerState.cursedSigilCooldownUntil) return;
    const stacks = attacker.abilityValueByName["Cursed Sigil"];
    if (typeof stacks !== "number" || stacks === 0) return;
    deps.applyStatusToTarget({
      time,
      target: { runtime: defender, state: defenderState, disabled: defenderDisabled },
      statusId: BAD_OMEN_STATUS_ID,
      stacks,
      source: attackerState,
      sourceAbilityName: "Cursed Sigil",
    });
    attackerState.cursedSigilCooldownUntil = time + scaleCooldown(attackerState, 85);
    markAbilityApplied(attackerState, "Cursed Sigil", time);
  }

  function handleTotemTick(ctx: StatusEventContext): void {
    const { time, attacker, defender, attackerState, activesOn, attackerDisabled } = ctx;
    if (!activesOn || !attacker.hasTotem || isAbilityDisabled(attackerDisabled, DISABLE_TOTEM) || isActivesDisabledByNecro(attackerState)) return;
    if (attackerState.totemNextTickAt == null || time < attackerState.totemNextTickAt) return;
    if (attackerState.totemActiveUntil != null && time > attackerState.totemActiveUntil) return;
    if (!isAbilityDisabled(attackerDisabled, DISABLE_STATUS_ATTACKS)) {
      deps.applyStatusToTarget({
        time,
        target: { runtime: defender, state: ctx.defenderState, disabled: ctx.defenderDisabled },
        statusId: "Poison_Status",
        stacks: 2,
        source: attackerState,
        sourceAbilityName: "Totem",
      });
      markAbilityApplied(attackerState, "Totem");
    }
    attackerState.totemNextTickAt = time + 3;
  }

  return {
    handleThornTrap,
    handleCursedSigil,
    handleTotemTick,
  };
}
