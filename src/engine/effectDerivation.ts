// Shared status-effect derivation: the single name->statusId mapping used by
// both the official catalog generator (tools/sync_effects_catalog.ts, via
// tools/effects_catalog_rules.ts) and the custom-creature synthesis
// (customCreatureEffectSynthesis.ts). Keeping one table here is what stops a
// custom creature and a catalog creature from resolving the same ability name
// two different ways.

// `Block X` passive -> the status id its `fraction` resists. Necropoison is
// deliberately distinct from Poison (the engine treats Necropoison_Status as a
// separate status).
export const BLOCK_STATUS_MAP: Record<string, string> = {
  "Block Bleed": "Bleed_Status",
  "Block Burn": "Burn_Status",
  "Block Disease": "Disease_Status",
  "Block Frostbite": "Frostbite_Status",
  "Block Injury": "Injury_Status",
  "Block Necropoison": "Necropoison_Status",
  "Block Poison": "Poison_Status",
  "Block Radiation": "Radiation_Status",
};

// `X Attack` / `Ligament Tear` passive -> status applied on bite.
export const ATTACK_STATUS_MAP: Record<string, string> = {
  "Bleed Attack": "Bleed_Status",
  "Burn Attack": "Burn_Status",
  "Corrosion Attack": "Corrosion_Status",
  "Disease Attack": "Disease_Status",
  "Frostbite Attack": "Frostbite_Status",
  "Injury Attack": "Injury_Status",
  "Necropoison Attack": "Necropoison_Status",
  "Poison Attack": "Poison_Status",
  "Radiation Attack": "Radiation_Status",
  "Ligament Tear": "Torn_Ligaments_Status",
};

// `Defensive X` passive -> status applied to the attacker on being bitten.
export const DEFENSIVE_STATUS_MAP: Record<string, string> = {
  "Defensive Bleed": "Bleed_Status",
  "Defensive Burn": "Burn_Status",
  "Defensive Corrosion": "Corrosion_Status",
  "Defensive Disease": "Disease_Status",
  "Defensive Frostbite": "Frostbite_Status",
  "Defensive Injury": "Injury_Status",
  "Defensive Necropoison": "Necropoison_Status",
  "Defensive Paralyze": "Paralyze_Status",
  "Defensive Poison": "Poison_Status",
  "Defensive Radiation": "Radiation_Status",
};

// A status-applier ability ("Bleed Attack" / "Defensive Burn" / "Block Poison")
// is just the game's name for an on-hit / on-hit-taken / resist status. In the
// custom-creature editor those effects are entered canonically in the Statuses
// tab, so the ability picker hides them - the same effect can't be entered as
// BOTH an ability and a status (which then silently collapse). Special-named
// appliers (e.g. Ligament Tear -> Torn Ligaments) don't match the patterns, so
// they stay available as named abilities.
export function isStatusApplierAbilityName(name: string): boolean {
  const n = name.trim();
  return /\s+Attack$/i.test(n) || /^Defensive\s+/i.test(n) || /^Block\s+/i.test(n);
}

export function resolveBlockStatusId(sourceAbility: string): string | null {
  return BLOCK_STATUS_MAP[sourceAbility] ?? null;
}

export function resolveAttackStatusId(sourceAbility: string): string | null {
  return ATTACK_STATUS_MAP[sourceAbility] ?? null;
}

export function resolveDefensiveStatusId(sourceAbility: string): string | null {
  return DEFENSIVE_STATUS_MAP[sourceAbility] ?? null;
}

// A block/resist fraction is meaningful only up to 1.0 (100% block) - the
// engine caps it at `apply_status_application_in_place` (statuses.rs). Cap the
// top here so the stored value matches what the engine does, instead of letting
// the display show an unreachable "10000%". Negative fractions are a deliberate
// weakness (the engine amplifies incoming stacks by `1 - fraction`), so the
// lower end is left untouched.
export function clampBlockFraction(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.min(value, 1);
}

// Migration helper: bring a stored effects object's block fractions into the
// engine's domain on load. Custom creatures persisted before the clamp existed
// kept a raw fraction (e.g. 100 = a fictional "10000%"); applying the cap on
// load makes the display and the engine agree without a storage rewrite. Pure
// and boot-safe - used by the localStorage restore and share-code decode paths.
export function clampEffectsBlockFractions<
  T extends { resistStatus?: Array<{ fraction: number }> },
>(effects: T): T {
  const resist = effects.resistStatus;
  if (!resist || resist.length === 0) return effects;
  let changed = false;
  const capped = resist.map((entry) => {
    const fraction = clampBlockFraction(entry.fraction);
    if (fraction !== entry.fraction) changed = true;
    return fraction === entry.fraction ? entry : { ...entry, fraction };
  });
  return changed ? { ...effects, resistStatus: capped } : effects;
}
