// Parser for "early change" text - the pre-wiki stat drops the balance team
// posts before the wiki catches up. Turns the human-readable formats into
// structured changes the early-changes tool can preview and apply.
//
// Handles two shapes today:
//   - Delta blocks: a creature name header followed by lines like
//       "Weight from 5600 to 6000", "Addition of Frosty", "Removal of X".
//   - Notion "aside" buffs/nerfs: <aside> ... **Creature** <delta lines>
//     ***Insight: ...* ... </aside>, one bullet per creature.
// A full stat block ("Creature: X / Basic Stats: ...") is recognised but
// left for the tool to route to full-creature import (not parsed here yet).

export type DeltaKind =
  | "stat"
  | "ability-value"
  | "ability-add"
  | "ability-remove"
  | "unknown";

export interface ParsedDelta {
  raw: string;
  kind: DeltaKind;
  /** CreatureStats field, for kind === "stat". */
  field?: string;
  /** Ability display name, for ability-* kinds and ability-value. */
  ability?: string;
  /** Old/new for "stat" and "ability-value". */
  from?: number | string | null;
  to?: number | string | null;
  /** Added ability value, for "ability-add". */
  value?: number | string | null;
  note?: string;
}

export interface ParsedCreatureChange {
  creature: string;
  /** "delta" = header + delta lines; "new-full" = a full stat block (routed
   *  to full-creature import, not parsed into deltas here). */
  kind: "delta" | "new-full";
  deltas: ParsedDelta[];
  insight?: string;
  warnings: string[];
}

export interface ParsedInput {
  format: "delta" | "notion-aside" | "full-creature" | "mixed" | "empty";
  creatures: ParsedCreatureChange[];
  warnings: string[];
}

// Game stat label (lowercased, spaces/underscores stripped) -> CreatureStats
// field. Only unambiguous mappings live here; anything else falls through to
// an ability-value delta or an explicit warning rather than a silent guess.
const STAT_FIELD_BY_LABEL: Record<string, string> = {
  tier: "tier",
  health: "health",
  weight: "weight",
  damage: "damage",
  damage2: "damage2",
  bitecooldown: "biteCooldown",
  healthregen: "healthRegen",
  stamina: "stamina",
  staminaregen: "stamRegen",
  stamregen: "stamRegen",
  speed: "walkAndSwimSpeed",
  walkandswimspeed: "walkAndSwimSpeed",
  sprintspeed: "sprintSpeed",
  flyspeed: "flySpeed",
  flysprintmultiplier: "flySprintMultiplier",
  glideregen: "glideStaminaRegen",
  glidestaminaregen: "glideStaminaRegen",
  takeoff: "takeoffMultiplier",
  takeoffmultiplier: "takeoffMultiplier",
  turn: "turn",
  turnspeed: "turn",
  venerationrate: "venerationRate",
  appetite: "appetite",
  beachspeed: "beachSpeed",
  nightvision: "nightvision",
  ambush: "ambush",
  growthtime: "growthTime",
  hungerdrain: "hungerDrain",
  thirstdrain: "thirstDrain",
  moisturetime: "moistureTime",
  oxygen: "oxygenTime",
  oxygentime: "oxygenTime",
};

// Labels that look like stats but map ambiguously - flagged, never guessed.
const AMBIGUOUS_STAT_LABELS: Record<string, string> = {
  growthrate: "GrowthRate is ambiguous (growthTime vs venerationRate) - set the field manually",
};

function statLabelKey(label: string): string {
  return label.toLowerCase().replace(/[\s_]/g, "");
}

/** Insert spaces at CamelCase boundaries so game tokens match the runtime's
 *  spaced ability names: "BurnAttack" -> "Burn Attack", "AreaWindBlast" ->
 *  "Area Wind Blast". Already-spaced names pass through unchanged. */
export function splitCamelCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function toValue(raw: string): number | string {
  const cleaned = raw.replace(/%/g, "").trim();
  const n = Number.parseFloat(cleaned);
  return Number.isNaN(n) ? raw.trim() : n;
}

/** Parse an ability token that may carry a leading or trailing value:
 *  "AreaWindBlast 200" -> { name: "Area Wind Blast", value: 200 },
 *  "2 BurnAttack" -> { name: "Burn Attack", value: 2 },
 *  "Frosty" -> { name: "Frosty", value: null }. */
export function parseAbilityToken(text: string): { name: string; value: number | string | null } {
  const trimmed = text.trim();
  const leading = trimmed.match(/^([+-]?\d+(?:\.\d+)?%?)\s+(.+)$/);
  if (leading) {
    return { name: splitCamelCase(leading[2]), value: toValue(leading[1]) };
  }
  const trailing = trimmed.match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?%?)$/);
  if (trailing) {
    return { name: splitCamelCase(trailing[1]), value: toValue(trailing[2]) };
  }
  return { name: splitCamelCase(trimmed), value: null };
}

function parseDeltaLine(rawLine: string): ParsedDelta | null {
  const raw = rawLine.trim();
  if (!raw) return null;

  const add = raw.match(/^addition of\s+(.+)$/i);
  if (add) {
    const { name, value } = parseAbilityToken(add[1]);
    return { raw, kind: "ability-add", ability: name, value };
  }

  const remove = raw.match(/^removal of\s+(.+)$/i);
  if (remove) {
    const { name } = parseAbilityToken(remove[1]);
    return { raw, kind: "ability-remove", ability: name };
  }

  const fromTo = raw.match(/^(.+?)\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (fromTo) {
    const label = fromTo[1].trim();
    const from = toValue(fromTo[2]);
    const to = toValue(fromTo[3]);
    const key = statLabelKey(label);
    if (STAT_FIELD_BY_LABEL[key]) {
      return { raw, kind: "stat", field: STAT_FIELD_BY_LABEL[key], from, to };
    }
    if (AMBIGUOUS_STAT_LABELS[key]) {
      return { raw, kind: "unknown", note: AMBIGUOUS_STAT_LABELS[key], from, to };
    }
    // Not a known stat - treat as an ability's value change (BlockFrostbite,
    // BleedAttack, InjuryAttack, resistances, etc.).
    return { raw, kind: "ability-value", ability: splitCamelCase(label), from, to };
  }

  return null;
}

const INSIGHT_RE = /^\**\s*(?:stat\s+)?insight\s*:\s*(.*)$/i;
const NOISE_RE = /not\s+finalized|avoid\s+sharing|subject\s+to\s+change/i;
// Bold section titles in a Notion post ("**Buffs**", "**Nerfs**") are headings,
// not creatures - dropped up front so they never become a creature block.
const SECTION_HEADER_RE = /^\**\s*(buffs|nerfs|changes|reworks|adjustments|tweaks|balance)\s*\**\s*$/i;

/** Strip Notion decoration from a creature-name bullet: "- **Celeritas**" ->
 *  "Celeritas". Requires the leading list marker so a bold section heading
 *  ("**Buffs**") is not mistaken for a creature. Returns null otherwise. */
function notionNameBullet(line: string): string | null {
  const m = line.match(/^[-*]\s+\*\*(.+?)\*\*\s*$/);
  return m ? m[1].trim() : null;
}

function isFullStatBlockHeader(line: string): string | null {
  const m = line.match(/^creature\s*:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Parse a raw early-change text block (one or many creatures) into structured
 * changes. Pure and side-effect free so the tool can preview before applying.
 */
export function parseEarlyChanges(text: string): ParsedInput {
  const warnings: string[] = [];
  const isNotion = /<aside>/i.test(text) || /^\s*[-*]\s*\*\*.+\*\*\s*$/m.test(text);
  const isFull = /^\s*basic\s+stats\s*:/im.test(text) && /^\s*creature\s*:/im.test(text);

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^<aside>|<\/aside>$/gi, "").trim())
    .filter((l) => l && !/^<img\b/i.test(l) && !NOISE_RE.test(l) && !SECTION_HEADER_RE.test(l));

  const creatures: ParsedCreatureChange[] = [];
  let current: ParsedCreatureChange | null = null;
  let insightLines: string[] = [];
  let collectingInsight = false;

  const flushInsight = () => {
    if (current && insightLines.length) {
      current.insight = insightLines.join(" ").replace(/\*+/g, "").trim();
    }
    insightLines = [];
    collectingInsight = false;
  };

  const startCreature = (name: string, kind: "delta" | "new-full") => {
    flushInsight();
    current = { creature: name, kind, deltas: [], warnings: [] };
    creatures.push(current);
  };

  for (const line of lines) {
    const fullHeader = isFullStatBlockHeader(line);
    if (fullHeader) {
      startCreature(fullHeader, "new-full");
      continue;
    }

    const bullet = notionNameBullet(line);
    if (bullet) {
      startCreature(bullet, "delta");
      continue;
    }

    const insight = line.match(INSIGHT_RE);
    if (insight) {
      collectingInsight = true;
      if (insight[1].trim()) insightLines.push(insight[1].trim());
      continue;
    }
    if (collectingInsight) {
      insightLines.push(line);
      continue;
    }

    if (!current) {
      // A bare leading line with no delta grammar is the creature name header
      // of a delta block (e.g. "Icebreaker Meorlark").
      if (!parseDeltaLine(line)) {
        startCreature(line, "delta");
        continue;
      }
      warnings.push(`Delta line before any creature header, ignored: "${line}"`);
      continue;
    }

    if (current.kind === "new-full") {
      // Body of a full stat block - routed to full-creature import elsewhere.
      continue;
    }

    const delta = parseDeltaLine(line);
    if (delta) {
      if (delta.kind === "unknown" && delta.note) current.warnings.push(delta.note);
      current.deltas.push(delta);
    } else {
      // A bare line inside a delta block that is not delta grammar starts the
      // next creature (Notion nerf lists separate creatures this way).
      startCreature(line, "delta");
    }
  }
  flushInsight();

  // A delta block that produced no deltas and no insight is a stray line
  // (stray heading, blank bullet) - drop it rather than emit a phantom creature.
  for (const entry of creatures) {
    if (entry.kind === "delta" && entry.deltas.length === 0 && !entry.insight) {
      warnings.push(`Ignored a line that looked like a creature but had no changes: "${entry.creature}"`);
    }
  }
  const kept = creatures.filter(
    (entry) => entry.kind !== "delta" || entry.deltas.length > 0 || entry.insight,
  );

  const format: ParsedInput["format"] = kept.length === 0
    ? "empty"
    : isFull
      ? "full-creature"
      : isNotion
        ? "notion-aside"
        : "delta";

  return { format, creatures: kept, warnings };
}
