import { plushieByName } from "./data";
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

// False when the stat reached no case here, or reached one whose status-id
// mapping is missing. A plushie whose stat lands nowhere would otherwise be
// dropped in silence; `plushieStatCoverage.test.ts` reads this to catch it.
function applyPlushieModifier(
  stats: CreatureRuntime["stats"],
  stat: string,
  op: string,
  value: number,
  plushieStatusOnHit: Record<string, number>,
  plushieStatusOnHitTaken: Record<string, number>,
  plushieStatusBlockPct: Record<string, number>,
  note: string,
  breathRegenPctAccum: { value: number },
  breathDamagePctAccum: { value: number },
  appetiteDrainPctAccum: { hunger: number; thirst: number },
  appetiteCapacityPctAccum: { value: number },
  plushieReflectAvgPctAccum: { value: number },
  muddyStrengthBoostPctAccum: { value: number },
): boolean {
  const applyPct = (current: number | undefined) => (current ?? 0) * (1 + value / 100);
  const applyFlat = (current: number | undefined) => (current ?? 0) + value;

  switch (stat) {
    case "damagePct":
      stats.damage = op === "addFlat" ? applyFlat(stats.damage) : applyPct(stats.damage);
      // The secondary bite differs from the primary only in applying no on-hit
      // ailments, so a damage bonus lands on it the same way.
      if (typeof stats.damage2 === "number") {
        stats.damage2 = op === "addFlat" ? applyFlat(stats.damage2) : applyPct(stats.damage2);
      }
      break;
    case "hpPct":
    case "healthPct":
      stats.health = op === "addFlat" ? applyFlat(stats.health) : applyPct(stats.health);
      break;
    // Movement is not part of a fight and no consumer reads the built speeds,
    // so the build path leaves them at the creature's own numbers. Speed Builds
    // owns movement and models these channels properly.
    case "movementSpeedPct":
    case "walkSpeedPct":
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
    case "muddyStrengthBoost":
      // Percent of Muddy's own regen bonus this copy adds. Accumulates
      // because the plushie is stackable and the game's Muddy.OnGet walks
      // every copy it finds.
      muddyStrengthBoostPctAccum.value += value;
      break;
    case "moistureTimePct":
      // Creatures without moisture have no pool to widen, and starting one at
      // zero would hand them a drain timer the game never gives them.
      if (typeof stats.moistureTime === "number") {
        stats.moistureTime = op === "addFlat" ? applyFlat(stats.moistureTime) : applyPct(stats.moistureTime);
      }
      break;
    // The game keeps hunger and thirst on separate stats, and the plushies
    // that touch them mostly touch one: Euvatops is hunger, Aerodon is thirst.
    // `appetiteDrainPct` stays for the ones that move both, like Frost Dragon.
    case "appetiteDrainPct":
      appetiteDrainPctAccum.hunger += value;
      appetiteDrainPctAccum.thirst += value;
      break;
    case "hungerDrainPct":
      appetiteDrainPctAccum.hunger += value;
      break;
    case "thirstDrainPct":
      appetiteDrainPctAccum.thirst += value;
      break;
    case "appetiteCapacityPct":
      appetiteCapacityPctAccum.value += value;
      break;
    case "plushieReflectAvgPct":
      plushieReflectAvgPctAccum.value += value;
      break;
    case "takeoffStaminaCostPct":
      break;
    case "bleedStacks":
    case "burnStacks":
    case "poisonStacks":
    case "necropoisonStacks":
    case "frostbiteStacks": {
      const statusId = plushieStatusIdForStat(stat);
      if (!statusId) return false;
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
      if (!blockId) return false;
      plushieStatusBlockPct[blockId] = (plushieStatusBlockPct[blockId] ?? 0) + value;
      break;
    }
    default:
      return false;
  }
  return true;
}

// Applies plushie STAT modifiers (weight/damage/health/regen/...) into the TS-side build before it is
// handed to Rust as scalars. Plushie status-on-hit / block / reflect / Bear boost are NOT here - those
// live in Rust (contracts.rs, combat.rs); this only forwards their parsed stacks/fractions. The input
// `plushieByName` is already deduped by normalizePlushie (buildData.ts), so each modifier applies once.
export function applyPlushies(
  stats: CreatureRuntime["stats"],
  selectedPlushies: string[],
  plushieStatusOnHit: Record<string, number>,
  plushieStatusOnHitTaken: Record<string, number>,
  plushieStatusBlockPct: Record<string, number>,
  plushieGrantedOtherAbilities: Array<{ name: string; value: number | null; semantics: string }>,
  hasStubbornStacker: boolean,
  breathRegenPctAccum: { value: number },
  breathDamagePctAccum: { value: number },
  appetiteDrainPctAccum: { hunger: number; thirst: number },
  appetiteCapacityPctAccum: { value: number },
  plushieReflectAvgPctAccum: { value: number },
  muddyStrengthBoostPctAccum: { value: number },
): string[] {
  const unhandled: string[] = [];
  if (!selectedPlushies.length) return unhandled;

  const applied: Record<string, number> = {};
  for (const plushieName of selectedPlushies.slice(0, 2)) {
    if (!plushieName) continue;
    const plushie = plushieByName[plushieName];
    if (!plushie) continue;

    const prevCount = applied[plushieName] ?? 0;
    if (prevCount > 0 && plushie.stackRule === "unique") continue;
    applied[plushieName] = prevCount + 1;

    const grantedOtherAbilities = getPlushieGrantedOtherAbilities(plushieName) ?? [];
    for (const ability of grantedOtherAbilities) {
      plushieGrantedOtherAbilities.push({ ...ability });
    }

    const modifiers =
      getCreatureSpecificPlushieModifiers(hasStubbornStacker, plushieName) ?? (plushie.modifiersParsed ?? []);
    if (modifiers.length === 0) continue;

    for (const mod of modifiers) {
      const handled = applyPlushieModifier(
        stats,
        mod.stat,
        mod.op,
        mod.value,
        plushieStatusOnHit,
        plushieStatusOnHitTaken,
        plushieStatusBlockPct,
        mod.note ?? "",
        breathRegenPctAccum,
        breathDamagePctAccum,
        appetiteDrainPctAccum,
        appetiteCapacityPctAccum,
        plushieReflectAvgPctAccum,
        muddyStrengthBoostPctAccum,
      );
      if (!handled) unhandled.push(mod.stat);
    }
  }

  return unhandled;
}
