function baseNormalizeAbilityName(name: string): string {
  return name.trim().replace(/[\u2019]/g, "'").replace(/\s+/g, " ");
}

function aliasKey(name: string): string {
  return baseNormalizeAbilityName(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const ABILITY_NAME_ALIASES = new Map<string, string>([
  ["wingshredder", "Wing Shredder"],
  ["strenghinnumbers", "Strength In Numbers"],
]);

export function normalizeAbilityDisplayName(name: string): string {
  const normalized = baseNormalizeAbilityName(name);
  return ABILITY_NAME_ALIASES.get(aliasKey(normalized)) ?? normalized;
}

export function canonicalAbilityNameKey(name: string): string {
  return aliasKey(normalizeAbilityDisplayName(name));
}
