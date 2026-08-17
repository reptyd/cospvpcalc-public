// Parse a full creature stat drop (the "Creature: X / Basic Stats: ..." format)
// into a complete CreatureRuntime. Reads every section - Basic / Dietary /
// Advanced / Advanced Mobility / Resistances / Ailments / Effects / Abilities /
// Stat Insight - and maps each label to the runtime field it verifiably
// corresponds to. Labels whose runtime meaning is ambiguous (GrowthRate has no
// direct field; DartData / JumpData are Vector3s) are flagged, never guessed,
// so the mapping stays correct and is easy to extend later.

import type { AbilityRef } from "./manualOverrides";
import type { CreatureRuntime } from "./creatureRoster";
import type { CreatureParseRefs } from "./creatureRefs";
import { guessSemantic, mkAbilityRef } from "./abilityRef";
import { dropValueToRuntime } from "./abilityMatch";
import { parseAbilityToken } from "./earlyChangeParser";

type SectionKind = "stat" | "resist" | "ailment" | "effect" | "ability" | "insight";

const SECTION_BY_HEADER: Record<string, SectionKind> = {
  "basic stats": "stat",
  dietary: "stat",
  "advanced stats": "stat",
  "advanced mobility": "stat",
  resistances: "resist",
  ailments: "ailment",
  effects: "effect",
  abilities: "ability",
  "stat insight": "insight",
  insight: "insight",
};

// Verified against the game creature modules + creatures.runtime.json.
const STAT_FIELD_BY_LABEL: Record<string, string> = {
  type: "type",
  tier: "tier",
  health: "health",
  weight: "weight",
  damage: "damage",
  bitecooldown: "biteCooldown",
  stamina: "stamina",
  speed: "walkAndSwimSpeed",
  sprintspeed: "sprintSpeed",
  flyspeed: "flySpeed",
  flysprintmultiplier: "flySprintMultiplier",
  foodtype: "diet",
  appetite: "appetite",
  healthregen: "healthRegen",
  staminaregen: "stamRegen",
  glideregen: "glideStaminaRegen",
  takeoff: "takeoffMultiplier",
  nightvision: "nightvision",
  turnspeed: "turn",
  oxygen: "oxygenTime",
  dartstamina: "dartStamina",
  jumpstamina: "jumpStamina",
  hunger: "hungerDrain",
  thirst: "thirstDrain",
  beachspeed: "beachSpeed",
};

const STRING_FIELDS = new Set(["type", "diet"]);

// Recognised labels that intentionally do NOT map to a runtime field.
const FLAGGED_LABELS: Record<string, string> = {
  growthrate: "GrowthRate has no direct runtime field (venerationRate/growthTime are derived) - left unset.",
  dartdata: "DartData is a Vector3; which component maps to dartPower is uncertain - set dartPower manually.",
  jumpdata: "JumpData is a Vector3; which component maps to jumpPower is uncertain - set jumpPower manually.",
};

export interface ParsedFullCreature {
  name: string;
  stats: Record<string, number | string | null>;
  passiveAbilities: AbilityRef[];
  activatedAbilities: AbilityRef[];
  breathAbilities: AbilityRef[];
  breath: string | null;
  /** Whether `breath` resolved to a known engine breath name (via refs). */
  breathResolved?: boolean;
  insight?: string;
  warnings: string[];
}

function labelKey(label: string): string {
  return label.toLowerCase().replace(/[\s_]/g, "");
}

function sectionHeader(line: string): SectionKind | null {
  const m = line.match(/^([a-z][a-z\s]*?)\s*:\s*$/i);
  if (!m) return null;
  return SECTION_BY_HEADER[m[1].trim().toLowerCase()] ?? null;
}

function parseStatLine(line: string, creature: ParsedFullCreature): void {
  const colon = line.indexOf(":");
  if (colon < 0) return;
  const label = line.slice(0, colon).trim();
  const rawValue = line.slice(colon + 1).trim();
  const key = labelKey(label);

  if (FLAGGED_LABELS[key]) {
    creature.warnings.push(FLAGGED_LABELS[key]);
    return;
  }
  const field = STAT_FIELD_BY_LABEL[key];
  if (!field) {
    creature.warnings.push(`Unmapped stat "${label}" = "${rawValue}" - skipped.`);
    return;
  }
  if (STRING_FIELDS.has(field)) {
    creature.stats[field] = rawValue;
    return;
  }
  if (rawValue.includes("/")) {
    creature.warnings.push(`"${label}" was "${rawValue}"; took the first number for ${field}.`);
  }
  const n = Number.parseFloat(rawValue.replace(/%/g, ""));
  creature.stats[field] = Number.isNaN(n) ? null : n;
}

function pushAbility(
  creature: ParsedFullCreature,
  section: SectionKind,
  line: string,
  refs?: CreatureParseRefs,
): void {
  const breath = line.match(/^breath\s+(.+)$/i);
  if (section === "ability" && breath) {
    const rawType = breath[1].trim().replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    const canon = refs?.canonicalBreath(rawType) ?? null;
    const type = canon ?? rawType;
    creature.breath = type;
    creature.breathResolved = canon !== null;
    creature.breathAbilities.push({ abilityId: "Breath", name: type, value: null, semantics: "neutral", subtype: type });
    return;
  }
  let { name, value } = parseAbilityToken(line);
  // A value-less multi-word token can be an "ability + status-subtype" pair the
  // runtime files as name + value ("Lich Mark Broken Legs" -> "Lich Mark" /
  // "Broken Legs"). Only split when the prefix is a known value-carrying ability.
  if (value === null && refs) {
    const sub = refs.matchSubtypeAbility(name);
    if (sub) ({ name, value } = sub);
  }
  const category = section === "ability" ? "activated" : "passive";
  const ref = mkAbilityRef(name, dropValueToRuntime(name, value), category);
  // Section-specific semantics reads better than the name heuristic for resist
  // (blocks) and ailment (attacks) lines.
  if (section === "resist") ref.semantics = "block";
  else if (section === "ailment") ref.semantics = guessSemantic(name) === "neutral" ? "offensive" : guessSemantic(name);
  (category === "activated" ? creature.activatedAbilities : creature.passiveAbilities).push(ref);
}

function newCreature(name: string): ParsedFullCreature {
  return { name, stats: {}, passiveAbilities: [], activatedAbilities: [], breathAbilities: [], breath: null, warnings: [] };
}

/** Parse one or more full creature blocks (split on "Creature:" headers). */
export function parseFullCreatures(text: string, refs?: CreatureParseRefs): ParsedFullCreature[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^<aside>|<\/aside>$/gi, "").trim())
    .filter((l) => l && !/not\s+finalized|avoid\s+sharing|subject\s+to\s+change/i.test(l));

  const creatures: ParsedFullCreature[] = [];
  let current: ParsedFullCreature | null = null;
  let section: SectionKind | null = null;
  let insightLines: string[] = [];

  const flushInsight = () => {
    if (current && insightLines.length) current.insight = insightLines.join(" ").replace(/\*+/g, "").trim();
    insightLines = [];
  };

  for (const line of lines) {
    const header = line.match(/^creature\s*:\s*(.+)$/i);
    if (header) {
      flushInsight();
      current = newCreature(header[1].trim());
      creatures.push(current);
      section = null;
      continue;
    }
    if (!current) continue;

    // The insight header often carries its text on the same line
    // ("Stat Insight: ..."), so match it before the bare-header check.
    const insightHeader = line.match(/^\**\s*(?:stat\s+)?insight\s*:\s*(.*)$/i);
    if (insightHeader) {
      section = "insight";
      if (insightHeader[1].trim()) insightLines.push(insightHeader[1].trim());
      continue;
    }

    const nextSection = sectionHeader(line);
    if (nextSection) {
      flushInsight();
      section = nextSection;
      continue;
    }

    if (section === "insight") {
      insightLines.push(line);
      continue;
    }
    if (section === "stat") {
      parseStatLine(line, current);
      continue;
    }
    if (section === "resist" || section === "ailment" || section === "effect" || section === "ability") {
      pushAbility(current, section, line, refs);
    }
  }
  flushInsight();
  return creatures;
}

// Every CreatureStats field, so a materialised creature carries the full shape
// (missing optionals default to null, strings to "").
const NUMERIC_STAT_FIELDS = [
  "damage2", "healthRegen", "stamina", "stamRegen", "walkAndSwimSpeed", "sprintSpeed",
  "turn", "venerationRate", "appetite", "beachSpeed", "flySpeed", "flySprintMultiplier",
  "glideStaminaRegen", "takeoffMultiplier", "jumpPower", "jumpStamina", "jumpAge",
  "dartPower", "dartStamina", "nightvision", "ambush", "growthTime", "hungerDrain",
  "thirstDrain", "moistureTime", "oxygenTime",
];
const REQUIRED_STAT_FIELDS = ["tier", "health", "weight", "damage", "biteCooldown"];

export interface NewCreatureResult {
  creature: CreatureRuntime;
  warnings: string[];
}

/** Build a full CreatureRuntime from a parsed full creature. Required stats
 *  missing from the drop are flagged and defaulted so the entry stays valid. */
export function materializeNewCreature(parsed: ParsedFullCreature): NewCreatureResult {
  const warnings = [...parsed.warnings];
  const src = parsed.stats;
  const num = (field: string): number | null => (typeof src[field] === "number" ? (src[field] as number) : null);

  const stats: Record<string, number | string | null> = {};
  for (const field of REQUIRED_STAT_FIELDS) {
    const value = num(field);
    if (value === null) {
      warnings.push(`Required stat "${field}" missing from the drop - defaulted to ${field === "biteCooldown" ? 1 : 0}.`);
      stats[field] = field === "biteCooldown" ? 1 : 0;
    } else {
      stats[field] = value;
    }
  }
  for (const field of NUMERIC_STAT_FIELDS) stats[field] = num(field);
  stats.diet = typeof src.diet === "string" ? src.diet : "";
  stats.type = typeof src.type === "string" ? src.type : "";
  stats.mobilityOverride = "";
  stats.breath = parsed.breath ?? "N/A";
  if (parsed.breath && parsed.breathResolved === false)
    warnings.push(`Breath "${parsed.breath}" - unrecognised; verify it matches an engine breath name.`);

  return {
    creature: {
      name: parsed.name,
      stats,
      passiveAbilities: parsed.passiveAbilities,
      activatedAbilities: parsed.activatedAbilities,
      breathAbilities: parsed.breathAbilities,
    },
    warnings,
  };
}
