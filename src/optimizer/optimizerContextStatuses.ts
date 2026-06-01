import type { CreatureRuntime } from "../engine";
import { breathSpecByName, effectsCatalog, statusById } from "../engine/data";

function resolveBreathTypeForCreature(creature: CreatureRuntime): string | null {
  const breathAbility = creature.breathAbilities?.[0];
  if (breathAbility?.subtype) return breathAbility.subtype;
  if (breathAbility?.name) return breathAbility.name;
  return creature.stats.breath ?? null;
}

function parseBreathAilmentsRaw(raw: string): string[] {
  const ailments: string[] = [];
  const regex = /([A-Za-z ]+?)\s*\(Probability\s*=\s*([0-9.]+)%/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    ailments.push(match[1].trim());
  }
  return ailments;
}

function statusNameToId(name: string): string | null {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const mapping: Record<string, string> = {
    burn: "Burn_Status",
    poison: "Poison_Status",
    bleed: "Bleed_Status",
    frostbite: "Frostbite_Status",
    necropoison: "Necropoison_Status",
    corrosion: "Corrosion_Status",
    shock: "Shock_Status",
    confusion: "Confusion_Status",
    fear: "Fear_Status",
    drowsy: "Drowsy_Status",
  };
  if (mapping[normalized]) return mapping[normalized];
  for (const status of Object.values(statusById)) {
    if (status.id.toLowerCase() === normalized) return status.id;
  }
  return null;
}

export function collectOpponentStatusIds(creature: CreatureRuntime): Set<string> {
  const statuses = new Set<string>();
  const effects = effectsCatalog[creature.name] ?? {};
  for (const entry of effects.applyStatusOnHit ?? []) {
    statuses.add(entry.statusId);
  }
  const breathType = resolveBreathTypeForCreature(creature);
  const spec = breathType ? breathSpecByName[breathType] : null;
  if (spec?.raw) {
    for (const ailment of parseBreathAilmentsRaw(spec.raw)) {
      const statusId = statusNameToId(ailment);
      if (statusId) statuses.add(statusId);
    }
  }
  return statuses;
}
