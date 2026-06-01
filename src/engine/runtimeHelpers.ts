import { breathSpecByName, breathSpecByNormalizedName, statusById } from "./data";
import { addApproximationNoteOnce } from "./approximationNotes";
import type { EffectsCatalogByCreature } from "./types";
import { normalizeAbilityDisplayName } from "../shared/abilityNameAliases";

type RuntimeLike = {
  final: { breathType?: string | null; breath?: string | null };
  creature?: { breathAbilities?: Array<{ name?: string | null; subtype?: string | null }> };
};

type StateLike = {
  statuses: Record<string, { stacks: number } | undefined>;
};

export function resolveStatusId(name: string): string | null {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  for (const status of Object.values(statusById)) {
    const idNorm = status.id.toLowerCase();
    const nameNorm = status.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (idNorm === normalized || nameNorm === normalized) return status.id;
  }
  const aliases: Record<string, string> = {
    poison: "Poison_Status",
    necropoison: "Necropoison_Status",
    burn: "Burn_Status",
    bleed: "Bleed_Status",
    frostbite: "Frostbite_Status",
    confusion: "Confusion_Status",
    fear: "Fear_Status",
    drowsy: "Drowsy_Status",
    corrosion: "Corrosion_Status",
    injury: "Injury_Status",
    disease: "Disease_Status",
    shock: "Shock_Status",
    slowed: "Slow_Status",
    bad_omen: "Bad_Omen",
    blessing_s_boon: "Blessings_Boon",
    blessings_boon: "Blessings_Boon",
    malice_s_mark: "Malices_Mark",
    malices_mark: "Malices_Mark",
    stolen_speed: "Stolen_Speed_Status",
    water_regeneration: "Water_Regeneration_Status",
    flowering: "Flowering_Status",
    broken_bones: "Broken_Bones_Status",
    blurred_vision: "Blurred_Vision_Status",
    gale: "Water_Gale_Status",
  };
  return aliases[normalized] ?? null;
}

export function parseBreathAilments(raw: string): Array<{ name: string; probability: number; stacks?: number | null }> {
  const results: Array<{ name: string; probability: number; stacks?: number | null }> = [];
  const ailmentsStart = raw.search(/ailments\s*:/i);
  const relevant = ailmentsStart >= 0 ? raw.slice(ailmentsStart) : raw;
  const regex = /(?:^|[,:]|\binflict(?:s)?\b)\s*(?:and\s+)?([A-Za-z][A-Za-z' -]*?)\s*,?\s*\(Probability\s*=\s*([0-9.]+)%([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(relevant)) !== null) {
    const name = match[1].trim();
    const probability = Number(match[2]);
    const stacksMatch = match[3].match(/stacks?\s*(?:set\s*to|=)\s*([0-9.]+)/i);
    const stacks = stacksMatch ? Number(stacksMatch[1]) : null;
    results.push({ name, probability, stacks });
  }
  return results;
}

export function getBreathSpec(runtime: RuntimeLike) {
  const breathType = resolveBreathType(runtime);
  if (!breathType) return null;
  return getBreathSpecByType(breathType);
}

export function getBreathSpecByType(breathType: string) {
  return breathSpecByName[breathType] ?? breathSpecByNormalizedName[breathType.toLowerCase()] ?? null;
}

export function resolveBreathType(runtime: RuntimeLike): string | null {
  if (runtime.final.breathType) return runtime.final.breathType;
  if (runtime.final.breath) return runtime.final.breath;
  const breathAbility = runtime.creature?.breathAbilities?.[0];
  return breathAbility?.subtype ?? breathAbility?.name ?? null;
}

export function resolveLanceAilment(runtime: RuntimeLike): string | null {
  const spec = getBreathSpec(runtime);
  const raw = [spec?.raw, runtime.final.breathType, runtime.final.breath].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  ) ?? "";
  const match = raw.match(/Lance[^A-Za-z]*([A-Za-z ]+)/i);
  if (!match) return null;
  return resolveStatusId(match[1]);
}

export function isActivesDisabledByNecro(state: StateLike): boolean {
  const stacks = state.statuses["Necropoison_Status"]?.stacks ?? 0;
  return stacks >= 10;
}

export function normalizeAbilityName(name: string): string {
  const normalized = name.trim().replace(/[’]/g, "'").replace(/\s+/g, " ");
  return normalizeAbilityDisplayName(normalized);
}

export function addApproxNoteOnce(notes: string[], note: string): void {
  addApproximationNoteOnce(notes, note);
}

export function hasAbilityName(effects: EffectsCatalogByCreature, name: string): boolean {
  const normalized = normalizeAbilityName(name);
  return (
    (effects.specialAbilitiesDetailed ?? []).some((item) => normalizeAbilityName(item.name) === normalized) ||
    (effects.specialAbilities ?? []).some((item) => normalizeAbilityName(item.name) === normalized) ||
    (effects.otherAbilities ?? []).some((item) => normalizeAbilityName(item.name) === normalized) ||
    (effects.applyStatusOnHit ?? []).some((item) => normalizeAbilityName(item.sourceAbility) === normalized) ||
    (effects.applyStatusOnHitTaken ?? []).some((item) => normalizeAbilityName(item.sourceAbility) === normalized)
  );
}
