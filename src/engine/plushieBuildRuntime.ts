import { plushieByName } from "./data";
import { addApproximationNote, addApproximationNoteOnce } from "./approximationNotes";
import {
  getCreatureSpecificPlushieModifiers,
  getPlushieGrantedOtherAbilities,
  plushieBlockStatusIdForStat,
  plushieStatusIdForStat,
} from "./plushieBuildMappings";
import type { CreatureRuntime } from "./types";

function isDefensivePlushieNote(note: string): boolean {
  const normalized = note.toLowerCase();
  if (normalized.includes("defensive")) return true;
  if (normalized.includes("offensive")) return false;
  return false;
}

function applyPlushieModifier(
  stats: CreatureRuntime["stats"],
  stat: string,
  op: string,
  value: number,
  approxNotes: string[],
  plushieName: string,
  plushieStatusOnHit: Record<string, number>,
  plushieStatusOnHitTaken: Record<string, number>,
  plushieStatusBlockPct: Record<string, number>,
  note: string,
  creatureName: string,
  breathRegenPctAccum: { value: number },
  breathDamagePctAccum: { value: number },
  appetiteDrainPctAccum: { value: number },
  appetiteCapacityPctAccum: { value: number },
  plushieReflectAvgPctAccum: { value: number },
): void {
  const applyPct = (current: number | undefined) => (current ?? 0) * (1 + value / 100);
  const applyFlat = (current: number | undefined) => (current ?? 0) + value;

  switch (stat) {
    case "damagePct":
      stats.damage = op === "addFlat" ? applyFlat(stats.damage) : applyPct(stats.damage);
      break;
    case "hpPct":
    case "healthPct":
      stats.health = op === "addFlat" ? applyFlat(stats.health) : applyPct(stats.health);
      break;
    case "movementSpeedPct":
      stats.walkAndSwimSpeed = op === "addFlat" ? applyFlat(stats.walkAndSwimSpeed) : applyPct(stats.walkAndSwimSpeed);
      stats.sprintSpeed = op === "addFlat" ? applyFlat(stats.sprintSpeed) : applyPct(stats.sprintSpeed);
      break;
    case "weightPct":
      stats.weight = op === "addFlat" ? applyFlat(stats.weight) : applyPct(stats.weight);
      break;
    case "breathResistancePct":
      stats.breathResistance = Math.max(0, Math.min(1, (stats.breathResistance ?? 0) + value / 100));
      break;
    case "stamRegenPct":
      stats.stamRegen = op === "addFlat" ? applyFlat(stats.stamRegen) : applyPct(stats.stamRegen);
      break;
    case "hpRegenPct":
      stats.healthRegen = op === "addFlat" ? applyFlat(stats.healthRegen) : applyPct(stats.healthRegen);
      addApproximationNote(approxNotes, "HP_REGEN_ORDERING_TODO");
      break;
    case "biteCooldownPct":
      stats.biteCooldown =
        Math.max(0.05, op === "addFlat" ? applyFlat(stats.biteCooldown) : stats.biteCooldown * (1 + value / 100));
      break;
    case "breathRegenPct":
      breathRegenPctAccum.value += value;
      break;
    case "breathDamagePct":
      breathDamagePctAccum.value += value;
      break;
    case "muddyDurationBoost":
      // Handled in compareBuffRuntime via countLandPlushies; no stat change here.
      break;
    case "appetiteDrainPct":
      appetiteDrainPctAccum.value += value;
      break;
    case "appetiteCapacityPct":
      appetiteCapacityPctAccum.value += value;
      break;
    case "plushieReflectAvgPct":
      plushieReflectAvgPctAccum.value += value;
      break;
    case "takeoffStaminaCostPct":
      addApproximationNoteOnce(approxNotes, `Plushie ${plushieName} affects takeoff stamina cost (not modeled).`);
      break;
    case "bleedStacks":
    case "burnStacks":
    case "poisonStacks":
    case "necropoisonStacks":
    case "frostbiteStacks": {
      const statusId = plushieStatusIdForStat(stat);
      if (!statusId) {
        addApproximationNoteOnce(approxNotes, `Plushie ${plushieName} modifies ${stat} (unknown status mapping).`);
        break;
      }
      if (isDefensivePlushieNote(note)) {
        plushieStatusOnHitTaken[statusId] = (plushieStatusOnHitTaken[statusId] ?? 0) + value;
      } else {
        plushieStatusOnHit[statusId] = (plushieStatusOnHit[statusId] ?? 0) + value;
      }
      break;
    }
    case "blockBleedPct":
    case "blockBurnPct":
    case "blockPoisonPct":
    case "blockFrostbitePct":
    case "blockNecropoisonPct":
    case "blockInjuryPct": {
      const blockId = plushieBlockStatusIdForStat(stat);
      if (!blockId) {
        addApproximationNoteOnce(approxNotes, `Plushie ${plushieName} modifies ${stat} (unknown status mapping).`);
        break;
      }
      plushieStatusBlockPct[blockId] = (plushieStatusBlockPct[blockId] ?? 0) + value;
      break;
    }
    default:
      addApproximationNoteOnce(approxNotes, `Plushie ${plushieName} stat ${stat} not mapped (ignored) for ${creatureName}.`);
  }
}

export function applyPlushies(
  stats: CreatureRuntime["stats"],
  selectedPlushies: string[],
  approxNotes: string[],
  plushieStatusOnHit: Record<string, number>,
  plushieStatusOnHitTaken: Record<string, number>,
  plushieStatusBlockPct: Record<string, number>,
  plushieGrantedOtherAbilities: Array<{ name: string; value: number | null; semantics: string }>,
  creatureName: string,
  hasStubbornStacker: boolean,
  breathRegenPctAccum: { value: number },
  breathDamagePctAccum: { value: number },
  appetiteDrainPctAccum: { value: number },
  appetiteCapacityPctAccum: { value: number },
  plushieReflectAvgPctAccum: { value: number },
): void {
  if (!selectedPlushies.length) return;

  const applied: Record<string, number> = {};
  for (const plushieName of selectedPlushies.slice(0, 2)) {
    if (!plushieName) continue;
    const plushie = plushieByName[plushieName];
    if (!plushie) {
      addApproximationNoteOnce(approxNotes, `Plushie ${plushieName} not found (ignored).`);
      continue;
    }

    const prevCount = applied[plushieName] ?? 0;
    if (prevCount > 0 && plushie.stackRule === "unique") {
      addApproximationNoteOnce(approxNotes, `Plushie ${plushieName} is unique; duplicate ignored.`);
      continue;
    }
    if (prevCount > 0 && plushie.stackRule === "unknown") {
      addApproximationNoteOnce(approxNotes, `Plushie ${plushieName} has unknown stack rule; stacking applied (approx).`);
    }
    applied[plushieName] = prevCount + 1;

    const grantedOtherAbilities = getPlushieGrantedOtherAbilities(plushieName) ?? [];
    for (const ability of grantedOtherAbilities) {
      plushieGrantedOtherAbilities.push({ ...ability });
    }

    const modifiers =
      getCreatureSpecificPlushieModifiers(hasStubbornStacker, plushieName) ?? (plushie.modifiersParsed ?? []);
    if (modifiers.length === 0) {
      addApproximationNoteOnce(approxNotes, `Plushie ${plushieName} has unparsed modifiers; ignored.`);
      continue;
    }

    for (const mod of modifiers) {
      applyPlushieModifier(
        stats,
        mod.stat,
        mod.op,
        mod.value,
        approxNotes,
        plushieName,
        plushieStatusOnHit,
        plushieStatusOnHitTaken,
        plushieStatusBlockPct,
        mod.note ?? "",
        creatureName,
        breathRegenPctAccum,
        breathDamagePctAccum,
        appetiteDrainPctAccum,
        appetiteCapacityPctAccum,
        plushieReflectAvgPctAccum,
      );
    }
  }
}
