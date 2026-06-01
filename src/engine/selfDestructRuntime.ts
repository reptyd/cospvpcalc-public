import {
  DISABLE_STATUS_ATTACKS,
  isAbilityDisabled,
} from "./subsystems/actives";
import { SELF_DESTRUCT_DELAY_SEC } from "./subsystems/timing";
import { addApproximationNote } from "./approximationNotes";
import { isActivesDisabledByNecro } from "./runtimeHelpers";
import type { TickContext } from "./runtimeContext";
import type { SpecialAbilityDef } from "./types";
import type { SpecialEventsDeps } from "./specialEventTypes";
import { markAbilityApplied } from "./specialEventsRuntime";

export function createSelfDestructRuntime(deps: SpecialEventsDeps) {
  function handleSelfDestruct(ctx: TickContext): void {
    const { time, attacker, defender, activesOn } = ctx;
    const attackerRuntime = attacker.runtime;
    const defenderRuntime = defender.runtime;
    const attackerState = attacker.state;
    const defenderState = defender.state;
    const attackerDisabled = attacker.disabled;
    if (!activesOn) return;
    const selfDestruct = attackerRuntime.specialDefs.find((def) => def.type === "conditionalDelayedExplosion") as
      | Extract<SpecialAbilityDef, { type: "conditionalDelayedExplosion" }>
      | undefined;
    if (!selfDestruct || attackerState.selfDestructUsed) return;

    if (isActivesDisabledByNecro(attackerState)) {
      attackerState.selfDestructArmedAt = null;
      return;
    }

    const hpRatio = attackerState.hp / Math.max(1, attackerRuntime.final.health);
    const trigger = selfDestruct.trigger;
    const active =
      (trigger.hpRatioLte != null && hpRatio <= trigger.hpRatioLte) ||
      (trigger.hpRatioLt != null && hpRatio < trigger.hpRatioLt);

    if (!active) {
      attackerState.selfDestructArmedAt = null;
      return;
    }

    if (attackerState.selfDestructArmedAt == null) {
      attackerState.selfDestructArmedAt = time + SELF_DESTRUCT_DELAY_SEC;
      addApproximationNote(attackerState.approxNotes, "SELF_DESTRUCT_DELAY_DEFAULTED");
      return;
    }

    if (attackerState.selfDestructArmedAt < time) {
      attackerState.selfDestructArmedAt = time + SELF_DESTRUCT_DELAY_SEC;
      return;
    }

    if (time < attackerState.selfDestructArmedAt) return;

    const damage = defenderRuntime.final.health * (selfDestruct.onExplode.dealDamage.pct / 100);
    defenderState.hp -= damage;
    attackerState.damageDealt += damage;
    markAbilityApplied(attackerState, "Self-Destruct", time);

    for (const apply of selfDestruct.onExplode.applyStatus ?? []) {
      if (isAbilityDisabled(attackerDisabled, DISABLE_STATUS_ATTACKS)) continue;
      deps.applyStatusToTarget({
        time,
        target: defender,
        statusId: apply.statusId,
        stacks: apply.stacks,
        source: attackerState,
        sourceAbilityName: "Self-Destruct",
      });
    }

    attackerState.hp = Math.max(
      attackerState.hp,
      attackerRuntime.final.health * (selfDestruct.selfAfterExplode.hpFloorPct / 100),
    );
    attackerState.selfDestructUsed = true;
    attackerState.selfDestructArmedAt = null;
  }

  return {
    handleSelfDestruct,
  };
}
