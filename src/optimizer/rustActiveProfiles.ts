import type { CreatureRuntime } from "../engine";

// Bespoke active / breath / status-melee / life-leech marshaller functions
// (toRustActiveMeleeProfiles, toRustFortifyStatusMeleeProfiles, etc.) were
// deleted on 2026-04-09 after the composable engine became the only Rust
// combat dispatcher. The only helper still live is the explicit-on-hit
// passive extractor, consumed by the shared composable stats marshaller.

export type ExplicitOnHitStatusEntry = {
  statusId: string;
  stacks: number;
  sourceAbility: string;
};

type ExplicitOnHitStatusesProfile = {
  passiveRef: CreatureRuntime["passiveAbilities"];
  explicitOnHitStatuses: ExplicitOnHitStatusEntry[];
};

const explicitOnHitStatusesCache = new WeakMap<CreatureRuntime, ExplicitOnHitStatusesProfile>();

// Default on-hit stack count per passive, used when the creature row carries a
// null value (the usual case). The game's BaseAilmentAmount is the source of
// truth: Serrated Teeth applies 10 stacks of Deep Wounds per hit. Wing
// Shredder's Shredded Wings is a flier debuff that is out of the stand-and-fight
// model, so its count is immaterial - kept at 1 to preserve existing behavior.
const STATUS_BY_ABILITY_NAME: Record<string, { statusId: string; defaultStacks: number }> = {
  "Wing Shredder": { statusId: "Shredded_Wings", defaultStacks: 1 },
  "Serrated Teeth": { statusId: "Deep_Wounds_Status", defaultStacks: 10 },
};

export function getExplicitOnHitStatuses(
  creature: CreatureRuntime,
): ExplicitOnHitStatusEntry[] {
  const cached = explicitOnHitStatusesCache.get(creature);
  if (cached && cached.passiveRef === creature.passiveAbilities) {
    return cached.explicitOnHitStatuses;
  }
  const explicitOnHitStatuses: ExplicitOnHitStatusEntry[] = (creature.passiveAbilities ?? [])
    .map((ability) => {
      const mapping = STATUS_BY_ABILITY_NAME[ability.name];
      if (!mapping) return null;
      return {
        statusId: mapping.statusId,
        stacks: typeof ability.value === "number" ? ability.value : mapping.defaultStacks,
        sourceAbility: ability.name,
      };
    })
    .filter((value): value is ExplicitOnHitStatusEntry => value !== null);

  explicitOnHitStatusesCache.set(creature, {
    passiveRef: creature.passiveAbilities,
    explicitOnHitStatuses,
  });
  return explicitOnHitStatuses;
}
