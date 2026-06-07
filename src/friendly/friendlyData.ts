import type { CreatureRuntime } from "../engine";

export const FRIENDLY_AIR_TYPES = new Set(["Flier", "Glider", "Glider Semi-Aquatic"]);

export function isAirBattleEligible(creature?: CreatureRuntime): boolean {
  return FRIENDLY_AIR_TYPES.has(creature?.stats.type ?? "");
}

export function getCreatureFacetTags(creature: CreatureRuntime): string[] {
  const tags = new Set<string>();
  const type = creature.stats.type?.trim();
  const diet = creature.stats.diet?.trim();

  if (type) {
    tags.add(type);
    if (/aquatic/i.test(type)) tags.add("Aquatic");
    if (/semi-aquatic/i.test(type)) tags.add("Semi-Aquatic");
    if (/glider/i.test(type)) tags.add("Glider");
  }

  if (diet) tags.add(diet);

  return Array.from(tags);
}

export function getAvailableCreatureTypes(creatures: CreatureRuntime[]): string[] {
  const values = new Set<string>();
  for (const creature of creatures) {
    for (const tag of getCreatureFacetTags(creature)) values.add(tag);
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export function buildFriendlyOpponentPool({
  creatures,
  sourceName,
  enemyProfile,
  customTiers,
}: {
  creatures: CreatureRuntime[];
  sourceName: string;
  enemyProfile: "sameTier" | "lowerTiers" | "higherTiers" | "aroundTier" | "custom";
  customTiers: number[];
}): string[] {
  const source = creatures.find((creature) => creature.name === sourceName);
  if (!source) return [];
  const sourceTier = source.stats.tier;

  return creatures
    .filter((creature) => {
      if (creature.name === sourceName) return false;
      const tier = creature.stats.tier;
      if (enemyProfile === "sameTier") return tier === sourceTier;
      if (enemyProfile === "lowerTiers") return tier < sourceTier;
      if (enemyProfile === "higherTiers") return tier > sourceTier;
      if (enemyProfile === "aroundTier") return Math.abs(tier - sourceTier) <= 1;
      return customTiers.includes(tier);
    })
    .map((creature) => creature.name);
}
