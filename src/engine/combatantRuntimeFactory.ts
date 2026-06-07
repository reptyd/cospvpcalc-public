import { addApproximationNoteOnce } from "./approximationNotes";
import { canonicalizeAbilityValue } from "./abilityValueOptions";
import type { CombatantRuntime } from "./runtimeContext";
import type { EffectsCatalogByCreature, FinalStats, SpecialAbilityDef } from "./types";
import type { CombatantFactoryDeps } from "./combatantFactoryTypes";

export function createCombatantRuntimeFactory(deps: CombatantFactoryDeps) {
  function hasActivatedAbilityName(finalStats: FinalStats, abilityName: string): boolean {
    const normalized = deps.normalizeAbilityName(abilityName);
    const creatureRuntime = deps.creatureByName[finalStats.name];
    return (creatureRuntime?.activatedAbilities ?? []).some(
      (ability) => deps.normalizeAbilityName(ability.name) === normalized,
    );
  }

  function hasRuntimeAbilityName(
    finalStats: FinalStats,
    effects: EffectsCatalogByCreature,
    abilityName: string,
  ): boolean {
    return hasActivatedAbilityName(finalStats, abilityName) || deps.hasAbilityName(effects, abilityName);
  }

  function filterEffectsByDisabled(
    effects: EffectsCatalogByCreature,
    disabled: Set<string>,
  ): EffectsCatalogByCreature {
    const keepByName = <T extends { name: string }>(entries: T[] | undefined) =>
      (entries ?? []).filter((entry) => !deps.isAbilityDisabled(disabled, deps.normalizeAbilityName(entry.name)));
    const keepBySource = <T extends { sourceAbility: string }>(entries: T[] | undefined) =>
      (entries ?? []).filter((entry) => !deps.isAbilityDisabled(disabled, deps.normalizeAbilityName(entry.sourceAbility)));

    return {
      ...effects,
      specialAbilitiesDetailed: keepByName(effects.specialAbilitiesDetailed),
      specialAbilities: keepByName(effects.specialAbilities),
      otherAbilities: keepByName(effects.otherAbilities),
      applyStatusOnHit: keepBySource(effects.applyStatusOnHit),
      applyStatusOnHitTaken: keepBySource(effects.applyStatusOnHitTaken),
      resistStatus: keepBySource(effects.resistStatus),
    };
  }

  function collectSpecialDefs(effects: EffectsCatalogByCreature): SpecialAbilityDef[] {
    const specialDefs: SpecialAbilityDef[] = [];
    const seenSpecialDefKeys = new Set<string>();
    const pushSpecialDef = (def: SpecialAbilityDef | undefined) => {
      if (!def) return;
      const key = JSON.stringify(def);
      if (seenSpecialDefKeys.has(key)) return;
      seenSpecialDefKeys.add(key);
      specialDefs.push(def);
    };
    for (const item of effects.specialAbilitiesDetailed ?? []) {
      pushSpecialDef(item.def);
    }
    for (const item of effects.specialAbilities ?? []) {
      pushSpecialDef(deps.specialAbilities[item.name]);
    }
    for (const item of effects.otherAbilities ?? []) {
      pushSpecialDef(deps.specialAbilities[item.name]);
    }
    return specialDefs;
  }

  function buildAbilityValueByName(
    finalStats: FinalStats,
    effects: EffectsCatalogByCreature,
  ): Record<string, number | string | null> {
    const abilityValueByName: Record<string, number | string | null> = {};
    for (const item of effects.specialAbilitiesDetailed ?? []) {
      abilityValueByName[item.name] = canonicalizeAbilityValue(item.name, item.value ?? null);
      if (item.def?.paramUnknown) {
        addApproximationNoteOnce(finalStats.approxNotes, `Special ability ${item.name} has unknown parameters (approx).`);
      }
    }
    for (const item of effects.specialAbilities ?? []) {
      if (!(item.name in abilityValueByName)) {
        abilityValueByName[item.name] = canonicalizeAbilityValue(item.name, item.value ?? null);
      }
    }
    for (const item of effects.otherAbilities ?? []) {
      if (!(item.name in abilityValueByName)) {
        abilityValueByName[item.name] = canonicalizeAbilityValue(item.name, item.value ?? null);
      }
    }
    return abilityValueByName;
  }

  function buildCombatantRuntime(finalStats: FinalStats, disabled: Set<string> = new Set()): CombatantRuntime {
    const creatureRuntime = deps.creatureByName[finalStats.name];
    const rawEffects = deps.effectsCatalog[finalStats.name] ?? {};
    const augmentedEffects: EffectsCatalogByCreature =
      finalStats.plushieGrantedOtherAbilities && finalStats.plushieGrantedOtherAbilities.length > 0
        ? {
            ...rawEffects,
            otherAbilities: [...(rawEffects.otherAbilities ?? []), ...finalStats.plushieGrantedOtherAbilities],
          }
        : rawEffects;
    const creatureEffects = filterEffectsByDisabled(augmentedEffects, disabled);
    const specialDefs = collectSpecialDefs(creatureEffects);
    const abilityValueByName = buildAbilityValueByName(finalStats, creatureEffects);
    const hasWardenRage = hasRuntimeAbilityName(finalStats, creatureEffects, "Warden's Rage");
    const hasWardenResistance = deps.hasAbilityName(creatureEffects, "Warden's Resistance");
    const hasReflect = hasRuntimeAbilityName(finalStats, creatureEffects, "Reflect");
    const hasTotem = hasRuntimeAbilityName(finalStats, creatureEffects, "Totem");
    const hasDrowsyArea = hasRuntimeAbilityName(finalStats, creatureEffects, "Drowsy Area");
    const hasLichMark = deps.hasAbilityName(creatureEffects, "Lich Mark");
    const hasCursedSigil = hasRuntimeAbilityName(finalStats, creatureEffects, "Cursed Sigil");
    const hasAdrenaline = hasRuntimeAbilityName(finalStats, creatureEffects, "Adrenaline");
    const hasHealingStep = hasRuntimeAbilityName(finalStats, creatureEffects, "Healing Step");
    const hasToxicTrail = deps.hasAbilityName(creatureEffects, "Toxic Trail");
    const hasPlagueTrail = deps.hasAbilityName(creatureEffects, "Plague Trail");
    const hasFlameTrail = deps.hasAbilityName(creatureEffects, "Flame Trail");
    const hasFrostTrail = deps.hasAbilityName(creatureEffects, "Frost Trail");
    const hasSpite = hasRuntimeAbilityName(finalStats, creatureEffects, "Spite");
    const hasCauseFear = hasRuntimeAbilityName(finalStats, creatureEffects, "Cause Fear");
    const hasReflux = hasRuntimeAbilityName(finalStats, creatureEffects, "Reflux");
    const hasRewind = hasRuntimeAbilityName(finalStats, creatureEffects, "Rewind");
    const hasShadowBarrage = hasRuntimeAbilityName(finalStats, creatureEffects, "Shadow Barrage");
    const hasFrostSnare = hasRuntimeAbilityName(finalStats, creatureEffects, "Frost Snare");
    const hasPoisonArea = hasRuntimeAbilityName(finalStats, creatureEffects, "Poison Area");
    const hasYolkBomb = hasRuntimeAbilityName(finalStats, creatureEffects, "Yolk Bomb");
    const hasDivination = hasRuntimeAbilityName(finalStats, creatureEffects, "Divination");
    const hasToxicTrap = hasRuntimeAbilityName(finalStats, creatureEffects, "Toxic Trap");
    const hasHarden = hasRuntimeAbilityName(finalStats, creatureEffects, "Harden");
    const hasHuntersCurse = hasRuntimeAbilityName(finalStats, creatureEffects, "Hunters Curse");
    const hasUnbridledRage = hasRuntimeAbilityName(finalStats, creatureEffects, "Unbridled Rage");
    const hasFortify = hasRuntimeAbilityName(finalStats, creatureEffects, "Fortify");
    const lichMarkValue = abilityValueByName["Lich Mark"] != null ? String(abilityValueByName["Lich Mark"]) : null;
    const yolkBombValue = abilityValueByName["Yolk Bomb"] != null ? String(abilityValueByName["Yolk Bomb"]) : null;
    return {
      creature: creatureRuntime ?? { name: finalStats.name, stats: finalStats },
      effects: creatureEffects,
      final: finalStats,
      specialDefs,
      abilityValueByName,
      hasWardenRage,
      hasWardenResistance,
      hasReflect,
      hasTotem,
      hasDrowsyArea,
      hasLichMark,
      hasCursedSigil,
      hasAdrenaline,
      hasHealingStep,
      hasToxicTrail,
      hasPlagueTrail,
      hasFlameTrail,
      hasFrostTrail,
      hasSpite,
      hasCauseFear,
      hasReflux,
      hasRewind,
      hasShadowBarrage,
      hasFrostSnare,
      hasPoisonArea,
      hasYolkBomb,
      hasDivination,
      hasToxicTrap,
      hasHarden,
      hasHuntersCurse,
      hasUnbridledRage,
      hasFortify,
      lichMarkValue,
      yolkBombValue,
    };
  }

  return {
    buildCombatantRuntime,
  };
}
