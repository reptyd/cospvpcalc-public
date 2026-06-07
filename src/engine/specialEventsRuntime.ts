import type { CombatantRuntime, CombatantState, TickContext } from "./runtimeContext";
import type { AbilityTimingMode } from "./types";
import { addApproximationNoteOnce } from "./approximationNotes";
import { COMPARE_REFLUX_HUNGER_COST_FRACTION } from "./compareHungerMath";
import {
  DAMAGE_TRAIL_TICK_SEC,
  HEALING_STEP_THRESHOLD_HP_FRACTION,
  HEALING_STEP_TICK_SEC,
  REFLUX_COOLDOWN_SEC,
} from "./subsystems/timing";
import { createSelfDestructRuntime } from "./selfDestructRuntime";
import { createSpecialEventStatusRuntime } from "./specialEventStatusRuntime";
import type { SpecialEventsDeps, StatusEventContext } from "./specialEventTypes";
import { isActivesDisabledByNecro } from "./runtimeHelpers";

export function markAbilityApplied(
  state: CombatantState,
  abilityName: string,
  time?: number,
  description?: string,
): void {
  state.abilityAppliedCounts[abilityName] = (state.abilityAppliedCounts[abilityName] ?? 0) + 1;
  if (time == null) return;
  state.combatLog.push({
    time,
    type: "ability",
    attacker: state.sideLabel,
    damage: 0,
    actorHpAfter: state.hp,
    hpSide: state.sideLabel,
    hpAfter: state.hp,
    description: description ?? `${abilityName} activated`,
  });
}

function appendAbilityDamageLog(
  state: CombatantState,
  time: number,
  damage: number,
  hpAfter: number,
  description: string,
  detail?: string,
): void {
  state.combatLog.push({
    time,
    type: "ability",
    attacker: state.sideLabel,
    damage,
    actorHpAfter: state.hp,
    hpSide: state.sideLabel === "A" ? "B" : "A",
    hpAfter,
    description,
    detail,
  });
}

export function createSpecialEventsRuntime(deps: SpecialEventsDeps) {
  const selfDestructRuntime = createSelfDestructRuntime(deps);
  const statusRuntime = createSpecialEventStatusRuntime(deps);
  const AURA_AILMENT_STACKS = 3;
  const RADIATION_TICK_SEC = 3;
  function scaleCooldown(state: CombatantState, baseSec: number): number {
    return baseSec * (state.activeCooldownMultiplier ?? 1);
  }

  function handleChannelingPulse(_ctx: TickContext): void {}

  function updateSpite(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    void opponent;
    void opponentState;
    void abilityPolicy;
    if (!runtime.hasSpite || !activesOn || disabled.has("Spite") || isActivesDisabledByNecro(state)) {
      state.spiteArmed = false;
      state.spiteChargeReadyAt = 0;
      return;
    }
    if (state.spiteArmed && state.spiteChargeReadyAt <= 0) {
      state.spiteChargeReadyAt = time + 5;
    }
  }

  function tryArmSpiteAfterHit(
    time: number,
    runtime: CombatantRuntime,
    state: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
  ): void {
    if (!runtime.hasSpite || !activesOn || disabled.has("Spite") || isActivesDisabledByNecro(state)) return;
    if (state.spiteArmed || time < state.spiteCooldownUntil) return;
    const spiteValue = runtime.abilityValueByName["Spite"];
    if (typeof spiteValue !== "number" || !Number.isFinite(spiteValue)) return;

    const hasOffensiveStatuses =
      (runtime.effects.applyStatusOnHit?.length ?? 0) > 0 ||
      (runtime.final.plushieStatusOnHit && Object.keys(runtime.final.plushieStatusOnHit).length > 0) ||
      runtime.hasLichMark ||
      (runtime.effects.otherAbilities ?? []).some((ability) => ability.name === "Wing Shredder" || ability.name === "Serrated Teeth");

    if (spiteValue < 0 && !hasOffensiveStatuses) return;

    state.spiteArmed = true;
    state.spiteChargeReadyAt = time + 5;
    state.spiteCooldownUntil = time + scaleCooldown(state, 20);
    deps.markAbilityApplied(state, "Spite", time);
  }

  function resolveRadiationStacks(): number {
    return AURA_AILMENT_STACKS;
  }

  function ensurePeriodicAbilityRegistered(state: CombatantState, abilityName: string, time: number): void {
    if ((state.abilityAppliedCounts[abilityName] ?? 0) > 0) return;
    markAbilityApplied(state, abilityName, time);
  }

  // Map an aura subtype name to its ailment status id. New "Aura (X)" support
  // adds one entry here, mirroring the Rust aura_status_id() function in
  // wasm-engine/src/composable/mod.rs.
  const AURA_SUBTYPE_TO_STATUS_ID: Record<string, string> = {
    Disease: "Disease_Status",
    Corrosion: "Corrosion_Status",
  };

  function findActiveAuraSubtype(
    runtime: CombatantRuntime,
    disabled: Set<string>,
  ): { subtype: string; statusId: string; abilityName: string } | null {
    const candidates: string[] = [];
    for (const list of [
      runtime.creature?.activatedAbilities ?? [],
      runtime.creature?.passiveAbilities ?? [],
    ]) {
      for (const ability of list) candidates.push(ability.name);
    }
    for (const entry of (runtime.effects.otherAbilities ?? [])) candidates.push(entry.name);
    for (const name of candidates) {
      const match = name?.trim().match(/^Aura \(([^)]+)\)$/);
      if (!match) continue;
      const subtype = match[1].trim();
      const statusId = AURA_SUBTYPE_TO_STATUS_ID[subtype];
      if (!statusId) continue;
      if (disabled.has(name)) continue;
      return { subtype, statusId, abilityName: name };
    }
    return null;
  }

  function updateRadiation(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ): void {
    const auraMatch = findActiveAuraSubtype(runtime, disabled);
    if (!activesOn || !auraMatch) {
      state.radiationNextTickAt = null;
      return;
    }
    if (state.radiationNextTickAt == null) {
      ensurePeriodicAbilityRegistered(state, auraMatch.abilityName, time);
      state.radiationNextTickAt = time + RADIATION_TICK_SEC;
      return;
    }
    if (time < state.radiationNextTickAt) return;
    ensurePeriodicAbilityRegistered(state, auraMatch.abilityName, time);
    const stacks = auraMatch.subtype === "Corrosion" ? resolveRadiationStacks() : AURA_AILMENT_STACKS;
    deps.applyStatusToTarget({
      time,
      target: { runtime: opponent, state: opponentState, disabled: opponentDisabled },
      statusId: auraMatch.statusId,
      stacks,
      source: state,
      sourceAbilityName: auraMatch.abilityName,
    });
    state.radiationNextTickAt = time + RADIATION_TICK_SEC;
  }

  function updateReflux(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ): void {
    if (!runtime.hasReflux || !activesOn || disabled.has("Reflux")) {
      state.refluxArmed = false;
      state.refluxChargeReadyAt = 0;
      state.refluxPuddleUntil = 0;
      state.refluxNextTickAt = null;
      return;
    }
    const necroBlocked = isActivesDisabledByNecro(state);
    if (necroBlocked && state.refluxPuddleUntil <= time) {
      state.refluxArmed = false;
      state.refluxChargeReadyAt = 0;
    }

    // Hunger is currently outside the stand-and-fight model. To avoid infinite
    // spam from an unmodeled resource, treat Reflux as one armed cast at a time.
    if (
      !necroBlocked &&
      !state.refluxArmed &&
      state.refluxChargeReadyAt <= 0 &&
      state.refluxPuddleUntil <= time &&
      time >= state.refluxCooldownUntil
    ) {
      if (state.compareHungerRuleEnabled) {
        const refluxCost = state.compareAppetiteBase * COMPARE_REFLUX_HUNGER_COST_FRACTION;
        if (state.compareHunger + 1e-9 < refluxCost) {
          return;
        }
        state.compareHunger = Math.max(0, state.compareHunger - refluxCost);
      } else {
        addApproximationNoteOnce(state.approxNotes, "REFLUX_HUNGER_UNMODELED");
      }
      state.refluxArmed = true;
      state.refluxChargeReadyAt = time + 5;
      deps.markAbilityApplied(state, "Reflux", time, "Reflux charge started");
      return;
    }

    if (!necroBlocked && state.refluxArmed && time >= state.refluxChargeReadyAt) {
      const impactDamage = opponent.final.health * 0.05;
      const hpBefore = opponentState.hp;
      const actualDamage = Math.max(0, Math.min(hpBefore, impactDamage));
      opponentState.hp = hpBefore - actualDamage;
      state.damageDealt += actualDamage;
      appendAbilityDamageLog(
        state,
        time,
        actualDamage,
        opponentState.hp,
        "Reflux impact",
        "5% maxHP direct hit + Slow 2",
      );
      deps.applyStatusToTarget({
        time,
        target: { runtime: opponent, state: opponentState, disabled: opponentDisabled },
        statusId: "Slow_Status",
        stacks: 2,
        source: state,
        sourceAbilityName: "Reflux",
      });
      state.refluxArmed = false;
      state.refluxChargeReadyAt = 0;
      state.refluxCooldownUntil = time + scaleCooldown(state, REFLUX_COOLDOWN_SEC);
      state.refluxPuddleUntil = time + 10;
      state.refluxNextTickAt = time + 1;
      return;
    }

    if (state.refluxPuddleUntil > time && state.refluxNextTickAt != null && time >= state.refluxNextTickAt) {
      const puddleDamage = opponent.final.health * 0.015;
      const hpBefore = opponentState.hp;
      const actualDamage = Math.max(0, Math.min(hpBefore, puddleDamage));
      opponentState.hp = hpBefore - actualDamage;
      state.damageDealt += actualDamage;
      appendAbilityDamageLog(
        state,
        time,
        actualDamage,
        opponentState.hp,
        "Reflux puddle tick",
        "1.5% maxHP puddle damage + Corrosion 0.5",
      );
      deps.applyStatusToTarget({
        time,
        target: { runtime: opponent, state: opponentState, disabled: opponentDisabled },
        statusId: "Corrosion_Status",
        stacks: 0.5,
        source: state,
        sourceAbilityName: "Reflux",
      });
      state.refluxNextTickAt = time + 1;
      if (state.refluxNextTickAt >= state.refluxPuddleUntil) {
        state.refluxNextTickAt = null;
      }
    }

    // Safety: if puddle has already expired, null out any stale tick schedule
    // so it can't keep re-surfacing as the "next event" and starve progress.
    if (state.refluxPuddleUntil <= time && state.refluxNextTickAt != null) {
      state.refluxNextTickAt = null;
    }
  }

  function updateLanceAura(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ): void {
    if (!activesOn || disabled.has("Lance")) {
      state.lanceAuraUntil = 0;
      state.lanceAuraNextTickAt = null;
      return;
    }
    if (state.lanceAuraUntil < time || state.lanceAuraNextTickAt == null) {
      state.lanceAuraUntil = 0;
      state.lanceAuraNextTickAt = null;
      return;
    }
    if (time < state.lanceAuraNextTickAt) return;

    const ailmentStatusId = deps.resolveLanceAilment(runtime);
    const auraDamage = opponent.final.health * 0.01;
    const hpBefore = opponentState.hp;
    const actualDamage = Math.max(0, Math.min(hpBefore, auraDamage));
    opponentState.hp = hpBefore - actualDamage;
    state.damageDealt += actualDamage;
    appendAbilityDamageLog(
      state,
      time,
      actualDamage,
      opponentState.hp,
      "Lance aura tick",
      ailmentStatusId ? `1% maxHP aura damage + ${ailmentStatusId} 1` : "1% maxHP aura damage",
    );
    if (ailmentStatusId) {
      deps.applyStatusToTarget({
        time,
        target: { runtime: opponent, state: opponentState, disabled: opponentDisabled },
        statusId: ailmentStatusId,
        stacks: 1,
        source: state,
        sourceAbilityName: "Lance",
      });
    }
    deps.markAbilityApplied(state, "Lance", time, "Lance aura tick");
    state.lanceAuraNextTickAt = time + 1;
    if (state.lanceAuraNextTickAt > state.lanceAuraUntil) {
      state.lanceAuraNextTickAt = null;
    }
  }

  function updateCauseFear(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ): void {
    if (!runtime.hasCauseFear || !activesOn || disabled.has("Cause Fear") || isActivesDisabledByNecro(state)) {
      return;
    }
    if (time < state.causeFearCooldownUntil) {
      return;
    }
    deps.applyStatusToTarget({
      time,
      target: { runtime: opponent, state: opponentState, disabled: opponentDisabled },
      statusId: "Fear_Status",
      stacks: 10,
      source: state,
      sourceAbilityName: "Cause Fear",
    });
    state.causeFearCooldownUntil = time + scaleCooldown(state, 120);
    deps.markAbilityApplied(state, "Cause Fear", time, "Cause Fear activated");
  }

  function normalizeTrailThresholdFraction(value: number | string | null): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    return value > 1 ? value / 100 : value;
  }

  type DamageTrailSpec = { abilityName: string; has: boolean; statusId: string };

  function collectDamageTrails(runtime: CombatantRuntime): DamageTrailSpec[] {
    return [
      { abilityName: "Toxic Trail", has: runtime.hasToxicTrail, statusId: "Poison_Status" },
      { abilityName: "Plague Trail", has: runtime.hasPlagueTrail, statusId: "Disease_Status" },
      { abilityName: "Flame Trail", has: runtime.hasFlameTrail, statusId: "Burn_Status" },
      { abilityName: "Frost Trail", has: runtime.hasFrostTrail, statusId: "Frostbite_Status" },
    ];
  }

  function isDamageTrailActive(runtime: CombatantRuntime, state: CombatantState, spec: DamageTrailSpec): boolean {
    if (!spec.has) return false;
    const threshold = normalizeTrailThresholdFraction(runtime.abilityValueByName[spec.abilityName] ?? null);
    if (threshold == null) return false;
    const maxHp = runtime.final.health;
    if (maxHp <= 0) return false;
    return state.hp / maxHp <= threshold + 1e-9;
  }

  function isHealingStepActive(runtime: CombatantRuntime, state: CombatantState): boolean {
    if (!runtime.hasHealingStep) return false;
    const maxHp = runtime.final.health;
    if (maxHp <= 0) return false;
    return state.hp / maxHp <= HEALING_STEP_THRESHOLD_HP_FRACTION + 1e-9;
  }

  function hasAnyTrailCapability(runtime: CombatantRuntime): boolean {
    return (
      runtime.hasToxicTrail ||
      runtime.hasPlagueTrail ||
      runtime.hasFlameTrail ||
      runtime.hasFrostTrail ||
      runtime.hasHealingStep
    );
  }

  function applyTrailsFacetankOverride(state: CombatantState, anyActive: boolean): void {
    if (anyActive && !state.trailsFacetankOverrideActive) {
      state.trailsFacetankOverridePrev = state.compareNoMoveFacetank;
      state.compareNoMoveFacetank = false;
      state.trailsFacetankOverrideActive = true;
    } else if (!anyActive && state.trailsFacetankOverrideActive) {
      if (state.trailsFacetankOverridePrev != null) {
        state.compareNoMoveFacetank = state.trailsFacetankOverridePrev;
      }
      state.trailsFacetankOverridePrev = null;
      state.trailsFacetankOverrideActive = false;
    }
  }

  function updateTrails(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
    opponentDisabled: Set<string>,
  ): void {
    void disabled;
    if (!hasAnyTrailCapability(runtime) || !activesOn || !state.compareTrailsEnabled) {
      applyTrailsFacetankOverride(state, false);
      state.damageTrailNextTickAt = null;
      state.healingStepNextTickAt = Number.POSITIVE_INFINITY;
      return;
    }

    const damageTrails = collectDamageTrails(runtime);
    const activeDamageTrails = damageTrails.filter((spec) => isDamageTrailActive(runtime, state, spec));
    const healingActive = isHealingStepActive(runtime, state);
    const anyActive = activeDamageTrails.length > 0 || healingActive;
    applyTrailsFacetankOverride(state, anyActive);

    const hasDamageTrailAbility =
      runtime.hasToxicTrail || runtime.hasPlagueTrail || runtime.hasFlameTrail || runtime.hasFrostTrail;
    if (hasDamageTrailAbility) {
      if (state.damageTrailNextTickAt == null) {
        state.damageTrailNextTickAt = time + DAMAGE_TRAIL_TICK_SEC;
      } else {
        while (state.damageTrailNextTickAt != null && time >= state.damageTrailNextTickAt - 1e-9) {
          const tickAt: number = state.damageTrailNextTickAt;
          const activeAtTick = damageTrails.filter((spec) => isDamageTrailActive(runtime, state, spec));
          for (const spec of activeAtTick) {
            const dmg = opponent.final.health * 0.02;
            const hpBefore = opponentState.hp;
            const actual = Math.max(0, Math.min(hpBefore, dmg));
            opponentState.hp = hpBefore - actual;
            state.damageDealt += actual;
            appendAbilityDamageLog(
              state,
              tickAt,
              actual,
              opponentState.hp,
              `${spec.abilityName} tick`,
              `2% maxHP trail damage + ${spec.statusId} 2`,
            );
            deps.applyStatusToTarget({
              time: tickAt,
              target: { runtime: opponent, state: opponentState, disabled: opponentDisabled },
              statusId: spec.statusId,
              stacks: 2,
              source: state,
              sourceAbilityName: spec.abilityName,
            });
            ensurePeriodicAbilityRegistered(state, spec.abilityName, tickAt);
          }
          state.damageTrailNextTickAt = tickAt + DAMAGE_TRAIL_TICK_SEC;
        }
      }
    } else {
      state.damageTrailNextTickAt = null;
    }

    if (runtime.hasHealingStep) {
      if (state.healingStepNextTickAt === Number.POSITIVE_INFINITY) {
        state.healingStepNextTickAt = time + HEALING_STEP_TICK_SEC;
      } else {
        while (time >= state.healingStepNextTickAt - 1e-9) {
          const tickAt = state.healingStepNextTickAt;
          const heartbroken = (state.statuses["Heartbroken_Status"]?.stacks ?? 0) > 0;
          if (isHealingStepActive(runtime, state) && !heartbroken) {
            const rawValue = runtime.abilityValueByName["Healing Step"];
            const percent = typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;
            const heal = runtime.final.health * (percent / 100);
            if (heal > 0) {
              const hpBefore = state.hp;
              state.hp = Math.min(runtime.final.health, hpBefore + heal);
              const healed = state.hp - hpBefore;
              state.combatLog.push({
                time: tickAt,
                type: "ability",
                attacker: state.sideLabel,
                damage: 0,
                actorHpAfter: state.hp,
                hpSide: state.sideLabel,
                hpAfter: state.hp,
                description: "Healing Step tick",
                detail: `${percent}% maxHP heal`,
              });
              void healed;
              ensurePeriodicAbilityRegistered(state, "Healing Step", tickAt);
            }
          }
          state.healingStepNextTickAt = tickAt + HEALING_STEP_TICK_SEC;
        }
      }
    } else {
      state.healingStepNextTickAt = Number.POSITIVE_INFINITY;
    }
  }

  function handleThornTrap(
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ): void {
    const ctx: StatusEventContext = {
      time,
      attacker,
      defender,
      attackerState,
      defenderState,
      activesOn,
      attackerDisabled,
      defenderDisabled,
    };
    statusRuntime.handleThornTrap(ctx);
  }

  function handleCursedSigil(
    time: number,
    attacker: CombatantRuntime,
    defender: CombatantRuntime,
    attackerState: CombatantState,
    defenderState: CombatantState,
    activesOn: boolean,
    attackerDisabled: Set<string>,
    defenderDisabled: Set<string>,
  ): void {
    const ctx: StatusEventContext = {
      time,
      attacker,
      defender,
      attackerState,
      defenderState,
      activesOn,
      attackerDisabled,
      defenderDisabled,
    };
    statusRuntime.handleCursedSigil(ctx);
  }

  function handleTotemTick(ctx: TickContext): void {
    statusRuntime.handleTotemTick({
      time: ctx.time,
      attacker: ctx.attacker.runtime,
      defender: ctx.defender.runtime,
      attackerState: ctx.attacker.state,
      defenderState: ctx.defender.state,
      activesOn: ctx.activesOn,
      attackerDisabled: ctx.attacker.disabled,
      defenderDisabled: ctx.defender.disabled,
    });
  }

  return {
    handleChannelingPulse,
    handleSelfDestruct: selfDestructRuntime.handleSelfDestruct,
    updateSpite,
    tryArmSpiteAfterHit,
    updateRadiation,
    updateCauseFear,
    updateReflux,
    updateLanceAura,
    updateTrails,
    handleThornTrap,
    handleCursedSigil,
    handleTotemTick,
  };
}
