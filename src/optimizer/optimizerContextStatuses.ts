import type { CreatureRuntime } from "../engine";
import { breathSpecByName, effectsCatalog } from "../engine/data";
import { parseBreathAilments, resolveStatusId } from "../engine/runtimeHelpers";

function resolveBreathTypeForCreature(creature: CreatureRuntime): string | null {
  const breathAbility = creature.breathAbilities?.[0];
  if (breathAbility?.subtype) return breathAbility.subtype;
  if (breathAbility?.name) return breathAbility.name;
  return creature.stats.breath ?? null;
}

/** Every status id this creature can put on the other side: its on-hit
 *  appliers plus whatever its breath rolls at the target. Best Builds reads
 *  this to decide which ailment blocks are worth spending points on. */
export function collectOpponentStatusIds(creature: CreatureRuntime): Set<string> {
  const statuses = new Set<string>();
  const effects = effectsCatalog[creature.name] ?? {};
  for (const entry of effects.applyStatusOnHit ?? []) {
    statuses.add(entry.statusId);
  }
  const breathType = resolveBreathTypeForCreature(creature);
  const spec = breathType ? breathSpecByName[breathType] : null;
  if (spec?.raw) {
    for (const ailment of parseBreathAilments(spec.raw)) {
      if (ailment.target !== "opponent") continue;
      const statusId = resolveStatusId(ailment.name);
      if (statusId) statuses.add(statusId);
    }
  }
  return statuses;
}
