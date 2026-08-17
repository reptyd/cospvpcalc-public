import { breathSpecByName, breathSpecByNormalizedName, statusById } from "./data";
import type { EffectsCatalogByCreature } from "./types";
import { normalizeAbilityName } from "../shared/abilityNameAliases";
import { lookupStatusEngineId } from "./statusCatalog";

type RuntimeLike = {
  final: { breathType?: string | null; breath?: string | null };
  creature?: { breathAbilities?: Array<{ name?: string | null; subtype?: string | null }> };
};

type StateLike = {
  statuses: Record<string, { stacks: number } | undefined>;
};

export function resolveStatusId(name: string): string | null {
  const direct = resolveExactStatusId(name);
  if (direct) return direct;
  // The breath and ability tables spell several ailments with a trailing
  // "Status" word ("Slowed Status", "Freeze Status"). Ids that already end in
  // `_Status` resolve on the first pass; the rest only resolve once the word
  // is dropped, and used to fall through as null.
  const trimmed = name.trim();
  const withoutSuffix = trimmed.replace(/\s+status$/i, "");
  return withoutSuffix === trimmed ? null : resolveExactStatusId(withoutSuffix);
}

function resolveExactStatusId(name: string): string | null {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  for (const status of Object.values(statusById)) {
    const idNorm = status.id.toLowerCase();
    const nameNorm = status.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (idNorm === normalized || nameNorm === normalized) return status.id;
  }
  // Hand aliases cover alt-spellings the wiki status data / catalog don't carry
  // under that exact label (e.g. "slowed", "gale", "blessing's boon").
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
  if (aliases[normalized]) return aliases[normalized];
  // Authoritative fallback: the status catalog (NAME_TO_ENGINE_ID) knows every
  // engine status, including ones added after the wiki status_effects data was
  // last scraped (e.g. Radiation). This is what keeps every name->id caller -
  // Lich Mark payloads, breath/lance ailments, on-hit/defensive status,
  // custom-creature synthesis - resolving new ailments instead of returning
  // null and silently dropping the effect (or leaning on a fragile suffix
  // fallback at the call site).
  return lookupStatusEngineId(name);
}

export type BreathAilment = {
  name: string;
  probability: number;
  stacks?: number | null;
  /** Who the roll lands on. Cloud Breath is the only breath that rolls onto
   *  its own user, and the spec text marks it with a "self-apply" verb. */
  target: "opponent" | "self";
};

// One "<Name> (Probability = N%, ...)" clause. The name is read as the run of
// capitalised words directly in front of the bracket, which is what separates
// it from the lower-case connective ("can also inflict", "and", "the following
// ailments:") that may or may not precede it. Anchoring on a connective
// instead - the previous shape - dropped every ailment introduced by ") and "
// and swallowed the verb into the name when it was introduced by ", and can
// inflict ".
const BREATH_AILMENT_CLAUSE =
  /((?:[A-Z][A-Za-z']*[ -])*[A-Z][A-Za-z']*)\s*,?\s*\(\s*Probability\s*=\s*([0-9.]+)\s*%([^)]*)\)/g;
const BREATH_AILMENT_VERB = /\bself[- ]appl(?:y|ies)\b|\binflicts?\b/gi;

export function parseBreathAilments(raw: string): BreathAilment[] {
  const verbs = [...raw.matchAll(BREATH_AILMENT_VERB)].map((m) => ({
    index: m.index ?? 0,
    self: /^self/i.test(m[0]),
  }));
  const results: BreathAilment[] = [];
  for (const match of raw.matchAll(BREATH_AILMENT_CLAUSE)) {
    const at = match.index ?? 0;
    // A clause inherits the last verb in front of it, so the second half of
    // "self-apply X (...), and Y (...)" stays on the user.
    const verb = verbs.filter((v) => v.index < at).pop();
    const stacksMatch = match[3].match(/stacks?\s*(?:set\s*to|=)\s*([0-9.]+)/i);
    results.push({
      name: match[1].trim(),
      probability: Number(match[2]),
      stacks: stacksMatch ? Number(stacksMatch[1]) : null,
      target: verb?.self ? "self" : "opponent",
    });
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

export { normalizeAbilityName };

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
