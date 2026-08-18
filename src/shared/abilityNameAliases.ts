function baseNormalizeAbilityName(name: string): string {
  return name.trim().replace(/[\u2019]/g, "'").replace(/\s+/g, " ");
}

function aliasKey(name: string): string {
  return baseNormalizeAbilityName(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const ABILITY_NAME_ALIASES = new Map<string, string>([
  ["wingshredder", "Wing Shredder"],
  ["strenghinnumbers", "Strength In Numbers"],
  // The wiki module spells this "Two Faced"; the engine matches the hyphenated
  // canonical via hasAbilityName, which keeps the hyphen. Without the alias the
  // trait silently never fires for newly synced owners.
  ["twofaced", "Two-Faced"],
  // Same shape: the module spells it "Self Destruct", the effects catalog keys
  // the explosion definition off "Self-Destruct". Unaliased, a newly synced
  // owner lands in `otherAbilities` as a bare name and never explodes.
  ["selfdestruct", "Self-Destruct"],
]);

export function normalizeAbilityDisplayName(name: string): string {
  const normalized = baseNormalizeAbilityName(name);
  return ABILITY_NAME_ALIASES.get(aliasKey(normalized)) ?? normalized;
}

// Canonical ability-name normalizer used across the optimizer and engine runtime.
// Identical to normalizeAbilityDisplayName; this is the consumer-facing name the
// rest of the codebase imports, so the normalization logic lives in one place.
export const normalizeAbilityName = normalizeAbilityDisplayName;

export function canonicalAbilityNameKey(name: string): string {
  return aliasKey(normalizeAbilityDisplayName(name));
}
