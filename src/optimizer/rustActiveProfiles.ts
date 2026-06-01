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

const STATUS_BY_ABILITY_NAME: Record<string, string> = {
  "Wing Shredder": "Shredded_Wings",
  "Serrated Teeth": "Deep_Wounds_Status",
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
      const statusId = STATUS_BY_ABILITY_NAME[ability.name];
      if (!statusId) return null;
      return {
        statusId,
        stacks: typeof ability.value === "number" ? ability.value : 1,
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
