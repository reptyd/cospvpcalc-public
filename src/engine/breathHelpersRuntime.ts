import { addApproximationNote, addApproximationNoteOnce } from "./approximationNotes";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { BreathRuntimeDeps, BreathSpecLike } from "./breathRuntimeTypes";
import { applyReflectedDamage } from "./reflectRuntime";

export function createBreathHelpersRuntime(deps: BreathRuntimeDeps) {
  const ignoredBreathAilmentPatterns = [
    /injury/i,
    /freeze/i,
    /blurred\s*vision/i,
    /muddy/i,
    /shredded\s*wings/i,
    /tunnel\s*vision/i,
    /shock/i,
    /\bslow(?:ed)?\b/i,
    /fear/i,
  ];

  function isIgnoredBreathAilment(name: string): boolean {
    return ignoredBreathAilmentPatterns.some((pattern) => pattern.test(name));
  }

  function parsePerHitMultiplier(rawPerHit: string | undefined): number | null {
    if (!rawPerHit) return null;
    const match = rawPerHit.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function estimateBreathMultiplier(attacker: CombatantRuntime): number {
    if (!attacker.final.hasBreath) return 0;
    const breathType = deps.resolveBreathType(attacker);
    if (!breathType) {
      deps.addApproxNoteOnce(attacker.final.approxNotes, "BREATH_TYPE_MISSING");
      return 0.5;
    }
    const spec = deps.getBreathSpecByType(breathType);
    const perHit = parsePerHitMultiplier(spec?.effect?.perHit);
    if (perHit != null) return perHit;

    if (breathType === "Solar Beam") return 1.5;
    if (breathType === "Spirit Glare") return 1;
    if (breathType === "Heal Breath" || breathType === "Cloud Breath") return 0;

    if (typeof spec?.effect?.dps === "number") {
      deps.addApproxNoteOnce(
        attacker.final.approxNotes,
        `Breath per-hit multiplier missing for ${breathType}; approximating from legacy DPS.`,
      );
      return spec.effect.dps / 2;
    }

    deps.addApproxNoteOnce(attacker.final.approxNotes, `Breath spec missing for ${breathType}; using 0.5x approx.`);
    return 0.5;
  }

  function breathCritMultiplier(spec: BreathSpecLike): number {
    const critChance = spec?.stats?.critChancePct ?? 0;
    if (critChance <= 0) return 1;
    return 1 + (critChance / 100);
  }

  function breathChainMultiplier(state: CombatantState, spec: BreathSpecLike): number {
    const chain = spec?.stats?.chain;
    const maxStacks = spec?.stats?.chainMaxStacks;
    if (!chain || !maxStacks) return 1;
    state.breathChainStacks = Math.min(maxStacks, (state.breathChainStacks ?? 0) + 1);
    return 1 + (chain / 100) * state.breathChainStacks;
  }

  function applyBreathAilments(
    time: number,
    defender: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> },
    spec: BreathSpecLike,
    attackerState: CombatantState,
    defenderDisabled?: Set<string>,
  ): void {
    const ailments = deps.parseBreathAilments(spec?.raw ?? "");
    for (const ailment of ailments) {
      if (isIgnoredBreathAilment(ailment.name)) continue;
      const statusId = deps.resolveStatusId(ailment.name);
      if (!statusId) {
        addApproximationNoteOnce(
          attackerState.approxNotes,
          `Breath ailment ${ailment.name} not mapped; breath damage still modeled (approx).`,
        );
        continue;
      }
      const expectedStacks = (ailment.probability / 100) * (ailment.stacks ?? 1);
      deps.applyStatusToTarget({
        time,
        target: { runtime: defender.runtime, state: defender.state, disabled: defenderDisabled ?? defender.disabled },
        statusId,
        stacks: expectedStacks,
        source: attackerState,
        sourceAbilityName: spec?.name ?? "Breath",
      });
    }
  }

  function applyBreathSelfEffects(attacker: CombatantRuntime, attackerState: CombatantState, spec: BreathSpecLike): void {
    const raw = spec?.raw ?? "";
    if (/heals\s+5\s+status\s+stacks/i.test(raw) || /heal.*status.*stacks/i.test(raw)) {
      deps.healStatusStacks({
        time: 0,
        target: { runtime: attacker, state: attackerState, disabled: new Set() },
        stacksToHeal: 5,
      });
      deps.markAbilityApplied(attackerState, "Breath Self-Cleanse");
    }
  }

  function applyBreathImpact(
    time: number,
    attacker: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> },
    defender: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> },
    spec: BreathSpecLike,
    breathMultiplier: number,
    activesOn: boolean,
  ): void {
    const attackerRuntime = attacker.runtime;
    const defenderRuntime = defender.runtime;
    const attackerState = attacker.state;
    const defenderState = defender.state;
    const breathResistance = deps.getBreathResistance(defenderRuntime);
    const attackerWeight =
      deps.applyWeightModifiers(attackerRuntime.final.weight, deps.aggregateStatusModifiers(attackerState.statuses)) *
      deps.getActiveWeightMultiplier(attackerState);
    const defenderWeight =
      deps.applyWeightModifiers(defenderRuntime.final.weight, deps.aggregateStatusModifiers(defenderState.statuses)) *
      deps.getActiveWeightMultiplier(defenderState);

    const breathDamageBoost = attackerRuntime.final.breathDamagePct
      ? 1 + attackerRuntime.final.breathDamagePct / 100
      : 1;
    let damage = deps.computeBreathDamage(
      attackerRuntime.final,
      defenderRuntime.final,
      breathMultiplier * breathDamageBoost,
      breathResistance,
      attackerWeight,
      defenderWeight,
    );
    damage *= breathCritMultiplier(spec);
    damage *= breathChainMultiplier(attackerState, spec);

    const defenderHpBefore = defenderState.hp;
    const reflectedBaseDamage =
      deps.isReflectActiveAt(defenderState, time) ? Math.max(0, Math.min(defenderHpBefore, damage)) : 0;
    const actualDamage = deps.isReflectActiveAt(defenderState, time) ? 0 : Math.max(0, Math.min(defenderHpBefore, damage));
    defenderState.hp -= actualDamage;
    attackerState.damageDealt += actualDamage;
    deps.applyLifeLeech({ time, attacker, damageDealt: actualDamage, activesOn });
    if (reflectedBaseDamage > 0) {
      applyReflectedDamage(time, reflectedBaseDamage, "breath", defender, attacker);
    }
    if (actualDamage > 0 && !defenderState.hunkerOn) {
      const reflectAvgPct = defenderRuntime.final.plushieReflectAvgPct ?? 0;
      if (reflectAvgPct > 0) {
        const reflectDamage = Math.max(0, Math.min(attackerState.hp, actualDamage * (reflectAvgPct / 100)));
        if (reflectDamage > 0) {
          attackerState.hp -= reflectDamage;
          defenderState.combatLog.push({
            time,
            type: "ability",
            attacker: defenderState.sideLabel,
            damage: reflectDamage,
            actorHpAfter: Math.max(0, defenderState.hp),
            hpSide: attackerState.sideLabel,
            hpAfter: Math.max(0, attackerState.hp),
            description: "Knight Reflect (avg)",
          });
          addApproximationNoteOnce(defenderState.approxNotes, "KNIGHT_REFLECT_APPROX");
        }
      }
    }
    applyBreathAilments(time, defender, spec, attackerState, defender.disabled);
    applyBreathSelfEffects(attackerRuntime, attackerState, spec);

    if (breathResistance > 0) addApproximationNote(attackerState.approxNotes, "BREATH_RESISTANCE_APPLIED");
    if (time === deps.breathTickSec) addApproximationNote(attackerState.approxNotes, "BREATH_TICK_RESOLUTION");
  }

  return {
    estimateBreathMultiplier,
    applyBreathImpact,
  };
}
