type PlushieModifierDef = { stat: string; op: "addPct" | "addFlat"; value: number; note?: string | null };
type PlushieOtherAbilityDef = { name: string; value: number | null; semantics: string };

const PLUSHIE_STATUS_IDS: Record<string, string> = {
  bleedStacks: "Bleed_Status",
  burnStacks: "Burn_Status",
  poisonStacks: "Poison_Status",
  necropoisonStacks: "Necropoison_Status",
  frostbiteStacks: "Frostbite_Status",
};

const PLUSHIE_BLOCK_STATUS_IDS: Record<string, string> = {
  blockBleedPct: "Bleed_Status",
  blockBurnPct: "Burn_Status",
  blockPoisonPct: "Poison_Status",
  blockFrostbitePct: "Frostbite_Status",
  blockNecropoisonPct: "Necropoison_Status",
  blockInjuryPct: "Injury_Status",
};

const STUBBORN_STACKER_OVERRIDES: Record<string, PlushieModifierDef[]> = {
  Cat: [
    { stat: "hpRegenPct", op: "addPct", value: 10, note: "Stubborn Stacker override" },
    { stat: "blockBleedPct", op: "addPct", value: 5, note: "Stubborn Stacker override" },
  ],
  "Pig-Lantern": [
    { stat: "damagePct", op: "addPct", value: 5, note: "Stubborn Stacker override" },
    { stat: "blockBurnPct", op: "addPct", value: 5, note: "Stubborn Stacker override" },
  ],
  "Haunt Dragon": [
    { stat: "stamRegenPct", op: "addPct", value: 25, note: "Stubborn Stacker override" },
    { stat: "blockPoisonPct", op: "addPct", value: 5, note: "Stubborn Stacker override" },
  ],
  Tannenbaum: [
    { stat: "biteCooldownPct", op: "addPct", value: -5, note: "Stubborn Stacker override" },
    { stat: "blockFrostbitePct", op: "addPct", value: 5, note: "Stubborn Stacker override" },
  ],
};

const GENERIC_PLUSHIE_OVERRIDES: Record<string, PlushieModifierDef[]> = {
  "Astral Quetzal": [
    { stat: "breathResistancePct", op: "addPct", value: 50, note: "Astral Quetzal override" },
    { stat: "blockBleedPct", op: "addPct", value: 50, note: "Astral Quetzal override" },
    { stat: "movementSpeedPct", op: "addPct", value: -5, note: "Astral Quetzal override" },
    { stat: "hpRegenPct", op: "addPct", value: -25, note: "Astral Quetzal override" },
  ],
  Ghost: [
    { stat: "blockBleedPct", op: "addPct", value: 7.5, note: "Ghost override" },
  ],
  "Maple Leaflet": [
    { stat: "blockInjuryPct", op: "addPct", value: 22.5, note: "Maple Leaflet override" },
  ],
  "Frost Dragon": [
    { stat: "blockFrostbitePct", op: "addPct", value: 25, note: "Frost Dragon override" },
  ],
  Sparkler: [
    { stat: "blockPoisonPct", op: "addPct", value: 15, note: "Sparkler override" },
    { stat: "blockFrostbitePct", op: "addPct", value: 15, note: "Sparkler override" },
    { stat: "blockBurnPct", op: "addPct", value: 15, note: "Sparkler override" },
    { stat: "blockBleedPct", op: "addPct", value: -20, note: "Sparkler override" },
  ],
};

const GENERIC_PLUSHIE_OTHER_ABILITIES: Record<string, PlushieOtherAbilityDef[]> = {
  Goldfish: [{ name: "Iron Stomach", value: null, semantics: "neutral" }],
  "Minty Wiggler": [{ name: "Frosty", value: null, semantics: "neutral" }],
  "Pie Chomper": [{ name: "Serrated Teeth", value: null, semantics: "offensive" }],
};

export function plushieStatusIdForStat(stat: string): string | null {
  return PLUSHIE_STATUS_IDS[stat] ?? null;
}

export function plushieBlockStatusIdForStat(stat: string): string | null {
  return PLUSHIE_BLOCK_STATUS_IDS[stat] ?? null;
}

export function getCreatureSpecificPlushieModifiers(
  hasStubbornStacker: boolean,
  plushieName: string,
): PlushieModifierDef[] | null {
  if (hasStubbornStacker) {
    const creatureSpecific = STUBBORN_STACKER_OVERRIDES[plushieName];
    if (creatureSpecific) return creatureSpecific;
  }
  return GENERIC_PLUSHIE_OVERRIDES[plushieName] ?? null;
}

export function getPlushieGrantedOtherAbilities(plushieName: string): PlushieOtherAbilityDef[] | null {
  return GENERIC_PLUSHIE_OTHER_ABILITIES[plushieName] ?? null;
}

export function plushiesGrantAbility(plushies: string[], abilityName: string): boolean {
  return plushies.some((p) => GENERIC_PLUSHIE_OTHER_ABILITIES[p]?.some((a) => a.name === abilityName));
}
