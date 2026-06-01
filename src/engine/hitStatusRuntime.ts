import type { TickContext } from "./runtimeContext";
import type { HitRuntimeDeps } from "./hitRuntimeTypes";
import { rules } from "./data";
import { resolveStatusId } from "./runtimeHelpers";
import { statusEngineIdMap } from "./statusCatalog";

export function createHitStatusRuntime(deps: HitRuntimeDeps) {
  const DIRECT_ATTACK_WEIGHT_SCALED_STATUS_IDS = new Set([
    "Corrosion_Status",
    "Disease_Status",
    "Injury_Status",
  ]);
  const DIRECT_ATTACK_WEIGHT_SCALE_POLICY = {
    abilityPayload: true,
    explicitAbilityPayload: true,
    plushiePayload: true,
  } as const;
  const LICH_MARK_STATUS_ID = "Lich_Mark_Status";
  // P5 (2026-05-18): Lich Mark payload mapping now reads from the
  // shared `statusCatalog` (single source of truth across all status
  // pickers). Previously this was a hand-maintained 13-entry table
  // that drifted from the Reference catalog — adding a new modeled
  // status didn't automatically expose it as a Lich Mark payload.
  // The catalog includes every Modeled/Partial entry from
  // `STATUS_REFERENCE_DRAFTS`, so the engine now resolves any of
  // them as a Lich Mark payload value.
  const LICH_MARK_PAYLOAD_STATUS_IDS: Record<string, string> = statusEngineIdMap();

  function hasExternalHealingBlock(state: TickContext["attacker"]["state"]): boolean {
    return (state.statuses["Heartbroken_Status"]?.stacks ?? 0) > 0;
  }

  function getLifeLeechValue(runtime: TickContext["attacker"]["runtime"]): number {
    const value = runtime.abilityValueByName["Life Leech"];
    return typeof value === "number" ? value : 0;
  }

  function getExplicitOnHitStatuses(runtime: TickContext["attacker"]["runtime"]): Array<{
    statusId: string;
    stacks: number;
    sourceAbility: string;
  }> {
    const mapping: Record<string, string> = {
      "Wing Shredder": "Shredded_Wings",
      "Serrated Teeth": "Deep_Wounds_Status",
      "Ligament Tear": "Torn_Ligaments_Status",
    };
    const statuses: Array<{ statusId: string; stacks: number; sourceAbility: string }> = [];
    const seen = new Set<string>();
    const abilities = [
      ...(runtime.effects.otherAbilities ?? []),
      ...((runtime.creature?.passiveAbilities ?? []).map((ability) => ({
        name: ability.name,
        value: typeof ability.value === "number" ? ability.value : null,
        semantics: ability.semantics ?? "neutral",
      }))),
    ];
    for (const ability of abilities) {
      if (seen.has(ability.name)) continue;
      seen.add(ability.name);
      const statusId = mapping[ability.name];
      if (!statusId) continue;
      const stacks = typeof ability.value === "number" ? ability.value : 1;
      statuses.push({ statusId, stacks, sourceAbility: ability.name });
    }
    return statuses;
  }

  function getLichMarkPayloadStatusId(runtime: TickContext["attacker"]["runtime"]): string | null {
    const rawValue = runtime.lichMarkValue?.trim();
    if (!rawValue) return null;
    return (
      LICH_MARK_PAYLOAD_STATUS_IDS[rawValue] ??
      resolveStatusId(rawValue) ??
      `${rawValue.replace(/[^A-Za-z0-9]+/g, "_")}_Status`
    );
  }

  function clearLichMarkPending(defender: TickContext["defender"], time: number): void {
    const pendingStacks = defender.state.statuses[LICH_MARK_STATUS_ID]?.stacks ?? 0;
    if (pendingStacks > 0) {
      deps.applyStatusToTarget({
        time,
        target: defender,
        statusId: LICH_MARK_STATUS_ID,
        stacks: -pendingStacks,
      });
    }
    defender.state.lichMarkPendingPayloadStatusId = null;
  }

  function clearLichMarkOwnedPayload(defender: TickContext["defender"], time: number): void {
    const payloadStatusId = defender.state.lichMarkOwnedPayloadStatusId;
    if (!payloadStatusId) return;
    const ownedStacks = defender.state.statuses[payloadStatusId]?.lichMarkOwnedStacks ?? 0;
    if (ownedStacks > 0) {
      deps.applyStatusToTarget({
        time,
        target: defender,
        statusId: payloadStatusId,
        stacks: -ownedStacks,
      });
    }
    defender.state.lichMarkOwnedPayloadStatusId = null;
  }

  function placeLichMarkPending(ctx: TickContext, payloadStatusId: string): void {
    const { time, attacker, defender } = ctx;
    clearLichMarkPending(defender, time);
    deps.applyStatusToTarget({
      time,
      target: defender,
      statusId: LICH_MARK_STATUS_ID,
      stacks: 1,
      source: attacker.state,
      sourceAbilityName: "Lich Mark",
    });
    defender.state.lichMarkPendingPayloadStatusId = payloadStatusId;
    attacker.state.lichMarkArmedUntil = 0;
  }

  function convertLichMarkPending(ctx: TickContext, payloadStatusId: string): void {
    const { time, attacker, defender } = ctx;
    clearLichMarkPending(defender, time);
    clearLichMarkOwnedPayload(defender, time);
    deps.applyStatusToTarget({
      time,
      target: defender,
      statusId: payloadStatusId,
      stacks: 5,
      lichMarkOwnedStacks: 5,
      source: attacker.state,
      sourceAbilityName: "Lich Mark",
    });
    defender.state.lichMarkOwnedPayloadStatusId = payloadStatusId;
  }

  function applyLichMarkOnHit(ctx: TickContext): void {
    const { time, attacker, defender, activesOn } = ctx;
    if (!activesOn) return;
    const payloadStatusId = getLichMarkPayloadStatusId(attacker.runtime);
    if (!payloadStatusId) return;
    const hasPendingMark =
      (defender.state.statuses[LICH_MARK_STATUS_ID]?.stacks ?? 0) > 0 &&
      defender.state.lichMarkPendingPayloadStatusId === payloadStatusId;
    if (hasPendingMark) {
      convertLichMarkPending(ctx, payloadStatusId);
      return;
    }
    if (attacker.state.lichMarkArmedUntil > time) {
      placeLichMarkPending(ctx, payloadStatusId);
    }
  }

  function applyLifeLeech(ctx: {
    time: number;
    attacker: { runtime: TickContext["attacker"]["runtime"]; state: TickContext["attacker"]["state"] };
    damageDealt: number;
    activesOn: boolean;
  }): void {
    const { time, attacker, damageDealt } = ctx;
    const attackerRuntime = attacker.runtime;
    const attackerState = attacker.state;
    if (damageDealt <= 0) return;
    if (time >= attackerState.lifeLeechActiveUntil) return;
    if (hasExternalHealingBlock(attackerState)) return;
    const leechValue = getLifeLeechValue(attackerRuntime);
    if (leechValue <= 0) return;
    const heal = damageDealt * leechValue;
    if (heal <= 0) return;
    attackerState.hp = Math.min(attackerRuntime.final.health, attackerState.hp + heal);
    attackerState.lifeLeechHealed += heal;
    attackerState.combatLog.push({
      time,
      type: "ability",
      attacker: attackerState.sideLabel,
      damage: 0,
      healing: heal,
      actorHpAfter: attackerState.hp,
      hpSide: attackerState.sideLabel,
      hpAfter: attackerState.hp,
      description: "Life Leech heal",
    });
  }

  function getDirectAttackWeightScale(ctx: TickContext): number {
    const attackerMods = deps.aggregateStatusModifiers(ctx.attacker.state.statuses);
    const defenderMods = deps.aggregateStatusModifiers(ctx.defender.state.statuses);
    const attackerWeight =
      deps.applyWeightModifiers(ctx.attacker.runtime.final.weight, attackerMods) *
      deps.getActiveWeightMultiplier(ctx.attacker.state);
    const defenderWeight =
      deps.applyWeightModifiers(ctx.defender.runtime.final.weight, defenderMods) *
      deps.getActiveWeightMultiplier(ctx.defender.state);
    const weightRatio = Math.min(
      attackerWeight / Math.max(1, defenderWeight),
      rules.damage.melee.weightRatioCap,
    );
    return (1 + weightRatio) / 2;
  }

  function getScaledOffensiveStatusStacks(
    ctx: TickContext,
    statusId: string,
    stacks: number,
    directAttackWeightScaleEnabled: boolean,
  ): number {
    if (!directAttackWeightScaleEnabled || !DIRECT_ATTACK_WEIGHT_SCALED_STATUS_IDS.has(statusId)) {
      return stacks;
    }
    return stacks * getDirectAttackWeightScale(ctx);
  }

  function applyAttackerOnHitStatuses(
    ctx: TickContext,
    statusMultiplier = 1,
    directAttackWeightScale = false,
  ): void {
    const { time, attacker, defender } = ctx;
    if (attacker.state.compareSecondaryAttackOnly) return;
    if (!deps.isAbilityDisabled(attacker.disabled, deps.disableStatusAttacks)) {
      const offensiveStatuses = attacker.runtime.effects.applyStatusOnHit ?? [];
      for (const status of offensiveStatuses) {
        if (deps.isAbilityDisabled(attacker.disabled, deps.normalizeAbilityName(status.sourceAbility))) continue;
        const scaledStacks =
          getScaledOffensiveStatusStacks(
            ctx,
            status.statusId,
            status.stacks,
            directAttackWeightScale && DIRECT_ATTACK_WEIGHT_SCALE_POLICY.abilityPayload,
          ) *
          statusMultiplier;
        deps.applyStatusToTarget({
          time,
          target: defender,
          statusId: status.statusId,
          stacks: scaledStacks,
          source: attacker.state,
          sourceAbilityName: status.sourceAbility,
        });
        deps.markAbilityApplied(attacker.state, status.sourceAbility);
      }

      const explicitStatuses = getExplicitOnHitStatuses(attacker.runtime);
      for (const status of explicitStatuses) {
        if (deps.isAbilityDisabled(attacker.disabled, deps.normalizeAbilityName(status.sourceAbility))) continue;
        const scaledStacks =
          getScaledOffensiveStatusStacks(
            ctx,
            status.statusId,
            status.stacks,
            directAttackWeightScale && DIRECT_ATTACK_WEIGHT_SCALE_POLICY.explicitAbilityPayload,
          ) *
          statusMultiplier;
        deps.applyStatusToTarget({
          time,
          target: defender,
          statusId: status.statusId,
          stacks: scaledStacks,
          source: attacker.state,
          sourceAbilityName: status.sourceAbility,
        });
        deps.markAbilityApplied(attacker.state, status.sourceAbility);
      }
    }

    if (!deps.isAbilityDisabled(attacker.disabled, deps.disablePlushieOff)) {
      const plushieStatuses = attacker.runtime.final.plushieStatusOnHit ?? {};
      for (const [statusId, stacks] of Object.entries(plushieStatuses) as Array<[string, number]>) {
        const scaledStacks =
          getScaledOffensiveStatusStacks(
            ctx,
            statusId,
            stacks,
            directAttackWeightScale && DIRECT_ATTACK_WEIGHT_SCALE_POLICY.plushiePayload,
          ) * statusMultiplier;
        deps.applyStatusToTarget({
          time,
          target: defender,
          statusId,
          stacks: scaledStacks,
          source: attacker.state,
          sourceAbilityName: "Plushie Offensive Procs",
        });
        attacker.state.plushieOffensiveStacksApplied += scaledStacks;
        deps.markAbilityApplied(attacker.state, "Plushie Offensive Procs");
      }
    }

    if (attacker.runtime.hasLichMark && !deps.isAbilityDisabled(attacker.disabled, deps.disableLichMark)) {
      applyLichMarkOnHit(ctx);
    }
  }

  function applyDefenderOnHitTakenStatuses(ctx: TickContext): void {
    const { time, attacker, defender } = ctx;
    if (!deps.isAbilityDisabled(defender.disabled, deps.disableStatusAttacks)) {
      const defensiveStatuses = defender.runtime.effects.applyStatusOnHitTaken ?? [];
      for (const status of defensiveStatuses) {
        if (deps.isAbilityDisabled(defender.disabled, deps.normalizeAbilityName(status.sourceAbility))) continue;
        deps.applyStatusToTarget({
          time,
          target: attacker,
          statusId: status.statusId,
          stacks: status.stacks,
          source: defender.state,
          sourceAbilityName: status.sourceAbility,
        });
        deps.markAbilityApplied(defender.state, status.sourceAbility);
      }

      if (
        deps.hasAbilityName(defender.runtime.effects, "Sticky Fur") &&
        !deps.isAbilityDisabled(defender.disabled, deps.normalizeAbilityName("Sticky Fur"))
      ) {
        deps.applyStatusToTarget({
          time,
          target: attacker,
          statusId: "Sticky_Teeth_Status",
          stacks: 1,
          source: defender.state,
          sourceAbilityName: "Sticky Fur",
        });
        deps.markAbilityApplied(defender.state, "Sticky Fur");
      }
    }
    if (!deps.isAbilityDisabled(defender.disabled, deps.disablePlushieDef)) {
      const plushieDefStatuses = defender.runtime.final.plushieStatusOnHitTaken ?? {};
      for (const [statusId, stacks] of Object.entries(plushieDefStatuses) as Array<[string, number]>) {
        deps.applyStatusToTarget({
          time,
          target: attacker,
          statusId,
          stacks,
          source: defender.state,
          sourceAbilityName: "Plushie Defensive Procs",
        });
        defender.state.plushieDefensiveStacksApplied += stacks;
        deps.markAbilityApplied(defender.state, "Plushie Defensive Procs");
      }
    }
  }

  function applyOnHitStatuses(
    ctx: TickContext,
    statusMultiplier = 1,
    directAttackWeightScale = false,
  ): void {
    applyAttackerOnHitStatuses(ctx, statusMultiplier, directAttackWeightScale);
    applyDefenderOnHitTakenStatuses(ctx);
  }

  return {
    applyLichMarkOnHit,
    applyLifeLeech,
    applyAttackerOnHitStatuses,
    applyDefenderOnHitTakenStatuses,
    applyOnHitStatuses,
    getExplicitOnHitStatuses,
    getLifeLeechValue,
  };
}
