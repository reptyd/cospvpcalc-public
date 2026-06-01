import { HUNKER_OUTGOING_DAMAGE_MULTIPLIER } from "./subsystems/actives";
import { BAD_OMEN_OUTCOMES } from "./subsystems/statuses";
import { addApproximationNote } from "./approximationNotes";
import type { BadOmenOutcome, SpecialAbilityDef } from "./types";
import type { CombatantRuntime, CombatantState, StatusAggregate } from "./runtimeContext";
import { getStatusDefinition } from "./combatPrimitives";
import { hasAbilityName } from "./runtimeHelpers";
import { getGourmandizerWeightBonusPct } from "./compareHungerMath";

export const HUNKER_EFFECT_DELAY_SEC = 5;

export function isHunkerEffectActive(runtime: CombatantRuntime, state: CombatantState): boolean {
  return state.hunkerOn && hasAbilityName(runtime.effects, "Hunker") && state.lastUpdateAt + 1e-9 >= state.hunkerEffectStartsAt;
}

export function currentBiteCooldown(runtime: CombatantRuntime, state: CombatantState, activesOn: boolean): number {
  if (state.compareAirRuleEnabled && typeof state.compareAirRuleCooldownSec === "number" && Number.isFinite(state.compareAirRuleCooldownSec)) {
    return Math.max(0.1, state.compareAirRuleCooldownSec);
  }
  const mods = aggregateStatusModifiers(state.statuses);
  const frostbiteStacks = state.statuses["Frostbite_Status"]?.stacks ?? 0;
  let multiplier = 1 + mods.biteCooldownIncreasePct / 100 + (mods.biteCooldownIncreasePerStackPct / 100) * frostbiteStacks;

  if (activesOn) {
    const berserk = runtime.specialDefs.find((def) => def.type === "conditionalMultiStat") as
      | Extract<SpecialAbilityDef, { type: "conditionalMultiStat" }>
      | undefined;
    if (berserk) {
      const hpRatio = state.hp / Math.max(1, runtime.final.health);
      const trigger = berserk.trigger;
      const active = (trigger.hpRatioLt != null && hpRatio < trigger.hpRatioLt) || (trigger.hpRatioLte != null && hpRatio <= trigger.hpRatioLte);
      if (active && berserk.mods.biteCooldownMultiplier != null) {
        multiplier *= berserk.mods.biteCooldownMultiplier;
      }
    }
  }

  return Math.max(0.1, runtime.final.biteCooldown * multiplier);
}

export function computeOutgoingDamageMultiplier(
  runtime: CombatantRuntime,
  state: CombatantState,
  mods: StatusAggregate,
  activesOn: boolean,
): number {
  let multiplier = 1 + (mods.damagePct + mods.damageBoostPct) / 100;
  if (isHunkerEffectActive(runtime, state)) {
    multiplier *= HUNKER_OUTGOING_DAMAGE_MULTIPLIER;
  }
  if (state.huntersCurseActiveUntil > state.lastUpdateAt) {
    multiplier *= 2;
  }
  if (state.unbridledRageActiveUntil > state.lastUpdateAt) {
    multiplier *= 1.3;
  }
  if (runtime.hasWardenRage && state.wardenRageStacks > 0) {
    multiplier *= 1 + 7.5 * (state.wardenRageStacks / 100);
  }
  const firstStrike = runtime.specialDefs.find((def) => def.type === "conditionalDamageBoost") as
    | Extract<SpecialAbilityDef, { type: "conditionalDamageBoost" }>
    | undefined;
  if (firstStrike) {
    const hpRatio = state.hp / Math.max(1, runtime.final.health);
    const trigger = firstStrike.trigger;
    const active = (trigger.hpRatioGte != null && hpRatio >= trigger.hpRatioGte) || (trigger.hpRatioGt != null && hpRatio > trigger.hpRatioGt);
    if (active) {
      const value = runtime.abilityValueByName["First Strike"];
      if (firstStrike.paramFromCreatureValue && value == null) {
        addApproximationNote(state.approxNotes, "FIRST_STRIKE_VALUE_MISSING");
      } else if (typeof value !== "number") {
        addApproximationNote(state.approxNotes, "FIRST_STRIKE_VALUE_INVALID");
      } else {
        multiplier *= 1 + value;
      }
    }
  }
  if (activesOn) {
    if (runtime.hasAdrenaline && state.adrenalineActiveUntil > state.lastUpdateAt) {
      multiplier *= 1.2;
    }
  }
  return Math.max(0, multiplier);
}

export function getActiveWeightMultiplier(state: CombatantState): number {
  let multiplier = state.fortifyWeightBonusUntil > state.lastUpdateAt ? 1.05 : 1;
  if (state.hardenActiveUntil > state.lastUpdateAt) {
    multiplier *= 1.35;
  }
  if (state.compareGourmandizerEnabled) {
    multiplier *= 1 + getGourmandizerWeightBonusPct(state.compareHunger, state.compareAppetiteBase) / 100;
  }
  return multiplier;
}

export function computeIncomingDamageMultiplier(
  runtime: CombatantRuntime,
  state: CombatantState,
  mods: StatusAggregate,
  _activesOn: boolean,
): number {
  let multiplier = 1 - mods.damageReductionPct / 100;
  if (isHunkerEffectActive(runtime, state)) {
    const reductionPct = getHunkerReductionPct(runtime);
    multiplier *= 1 - reductionPct / 100;
  }
  const guilt = runtime.specialDefs.find((def) => def.type === "damageTakenMultiplier") as
    | Extract<SpecialAbilityDef, { type: "damageTakenMultiplier" }>
    | undefined;
  if (guilt && guilt.multiplier != null) {
    multiplier *= guilt.multiplier;
  }
  return Math.max(0, multiplier);
}

export function getHunkerReductionPct(runtime: CombatantRuntime): number {
  const value = runtime.abilityValueByName["Hunker"];
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const asPct = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, asPct));
}

export function aggregateStatusModifiers(statuses: CombatantState["statuses"]): StatusAggregate {
  const aggregate: StatusAggregate = {
    damagePct: 0,
    damageBoostPct: 0,
    damageReductionPct: 0,
    biteCooldownIncreasePct: 0,
    biteCooldownIncreasePerStackPct: 0,
    weightReductionBasePct: 0,
    weightReductionPerStackPct: 0,
    weightReductionCapPct: 0,
    weightBoostPct: 0,
    weightBoostPerStackPct: 0,
    reflectsMeleeDamage: false,
    hpRegenDebuffPct: 0,
    hpRegenDebuffPerStackPct: 0,
    hpRegenBoostPct: 0,
    stamRegenPct: 0,
    disablesHpRegen: false,
  };

  for (const [statusId, instance] of Object.entries(statuses)) {
    const status = getStatusDefinition(statusId);
    const mods = status?.parsed?.modifiers;
    if (!mods) continue;
    const effectiveWeightBoostStacks =
      statusId === "Defensive_Status" && instance.stackValueMode === "durationOnly"
        ? Math.min(Math.max(instance.stacks, 0), 1)
        : instance.stacks;

    if (typeof mods.damagePct === "number") aggregate.damagePct += mods.damagePct;
    if (typeof mods.damageBoostPct === "number") aggregate.damageBoostPct += mods.damageBoostPct;
    if (typeof mods.damageReductionPct === "number") aggregate.damageReductionPct += mods.damageReductionPct;
    if (typeof mods.biteCooldownIncreasePct === "number") aggregate.biteCooldownIncreasePct += mods.biteCooldownIncreasePct;
    if (typeof mods.biteCooldownIncreasePerStackPct === "number") {
      aggregate.biteCooldownIncreasePerStackPct += mods.biteCooldownIncreasePerStackPct;
    }
    if (typeof mods.weightReductionBasePct === "number") aggregate.weightReductionBasePct += mods.weightReductionBasePct;
    if (typeof mods.weightReductionPerStackPct === "number") aggregate.weightReductionPerStackPct += mods.weightReductionPerStackPct * instance.stacks;
    if (typeof mods.weightReductionCapPct === "number") aggregate.weightReductionCapPct = Math.max(aggregate.weightReductionCapPct, mods.weightReductionCapPct);
    if (typeof mods.weightBoostPct === "number") aggregate.weightBoostPct += mods.weightBoostPct;
    if (typeof mods.weightBoostPerStackPct === "number") {
      aggregate.weightBoostPerStackPct += mods.weightBoostPerStackPct * effectiveWeightBoostStacks;
    }
    if (mods.reflectsMeleeDamage === true) aggregate.reflectsMeleeDamage = true;
    if (mods.disablesHpRegen === true) aggregate.disablesHpRegen = true;
    if (typeof mods.hpRegenDebuffPct === "number") aggregate.hpRegenDebuffPct += mods.hpRegenDebuffPct;
    if (typeof mods.hpRegenDebuffPerStackPct === "number") {
      aggregate.hpRegenDebuffPerStackPct += mods.hpRegenDebuffPerStackPct * instance.stacks;
    }
    if (typeof mods.hpRegenBoostPct === "number") aggregate.hpRegenBoostPct += mods.hpRegenBoostPct;
    if (typeof mods.stamRegenPct === "number") aggregate.stamRegenPct += mods.stamRegenPct;
  }

  return aggregate;
}

export function applyWeightModifiers(baseWeight: number, mods: StatusAggregate): number {
  const boost = mods.weightBoostPct + mods.weightBoostPerStackPct;
  const reduction = mods.weightReductionBasePct + mods.weightReductionPerStackPct;
  const capped = mods.weightReductionCapPct > 0 ? Math.min(reduction, mods.weightReductionCapPct) : reduction;
  return baseWeight * Math.max(0.01, (1 + boost / 100) * (1 - capped / 100));
}

export function resolveBadOmenOutcome(forced?: BadOmenOutcome | null): BadOmenOutcome {
  return forced?.statusId ? forced : BAD_OMEN_OUTCOMES[Math.floor(Math.random() * BAD_OMEN_OUTCOMES.length)];
}

export function getBreathResistance(target: CombatantRuntime): number {
  const breathRes = target.specialDefs.find((def) => def.type === "breathDamageReduction") as
    | Extract<SpecialAbilityDef, { type: "breathDamageReduction" }>
    | undefined;
  let total = 0;
  if (breathRes) {
    const value = target.abilityValueByName["Breath Resistance"];
    if (breathRes.paramFromCreatureValue && typeof value === "number") total += value;
  }
  if (typeof target.final.breathResistance === "number") total += target.final.breathResistance;
  return Math.max(0, Math.min(1, total));
}
