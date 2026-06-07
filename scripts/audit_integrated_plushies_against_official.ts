import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCreatureSpecificPlushieModifiers } from "../src/engine/plushieBuildMappings";

type CsvRow = string[];

type OfficialPlushieRow = {
  plushName: string;
  obtainedFrom: string;
  functionality: string;
  stackable: string;
};

type LocalModifier = {
  stat: string;
  op: "addPct" | "addFlat";
  value: number;
  note?: string | null;
};

type LocalPlushie = {
  id: string;
  name: string;
  stackRule: string;
  modifiersParsed?: LocalModifier[];
  rawDescription?: string;
};

type AuditRow = {
  localName: string;
  officialName: string | null;
  sourceFound: boolean;
  sourceFunctionality: string;
  sourceStackable: string;
  localStackRule: string;
  stackableMatch: string;
  integrationType: string;
  localEffectSummary: string;
  sourceKeywords: string;
  localKeywords: string;
  keywordOverlap: string;
  reviewStatus: string;
};

const repoRoot = resolve(import.meta.dirname, "..");
const officialCsvPath = resolve(repoRoot, "data/reference_source/plushies.csv");
const localRuntimePath = resolve(repoRoot, "data/plushies.runtime.json");
const outDir = resolve(repoRoot, "artifacts/reference_audit");
const outCsv = resolve(outDir, "integrated_plushies_audit.csv");
const outMd = resolve(outDir, "integrated_plushies_audit.md");

const OFFICIAL_TO_LOCAL_NAME: Record<string, string> = {
  "Magic Pronghorn": "Magichorn Prongbug",
  "Pig O' Lantern": "Pig-Lantern",
  Dragon: "Haunt Dragon",
};

const GENERIC_OVERRIDE_NAMES = new Set([
  "Astral Quetzal",
  "Ghost",
  "Maple Leaflet",
  "Frost Dragon",
  "Sparkler",
]);

const CREATURE_OVERRIDE_NAMES = new Set([
  "Haunt Dragon",
  "Pig-Lantern",
  "Tannenbaum",
]);

const KEYWORD_RULES: Array<{ pattern: RegExp; keyword: string }> = [
  { pattern: /health\s*regen|hp\s*regen/i, keyword: "hp_regen" },
  { pattern: /damage/i, keyword: "damage" },
  { pattern: /weight/i, keyword: "weight" },
  { pattern: /movement|speed|walkspeed|walk speed|sprint speed|flight speed/i, keyword: "speed" },
  { pattern: /stamina regen|stam regen/i, keyword: "stam_regen" },
  { pattern: /bite\s*cooldown/i, keyword: "bite_cooldown" },
  { pattern: /bleed/i, keyword: "bleed" },
  { pattern: /burn/i, keyword: "burn" },
  { pattern: /poison/i, keyword: "poison" },
  { pattern: /frostbite/i, keyword: "frostbite" },
  { pattern: /necropoison/i, keyword: "necropoison" },
  { pattern: /injury/i, keyword: "injury" },
];

function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }
    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
  }
  return rows;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, "\"\"")}"`;
  return value;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function loadOfficialRows(): OfficialPlushieRow[] {
  const csv = readFileSync(officialCsvPath, "utf8");
  const rows = parseCsv(csv);
  const headerIndex = rows.findIndex((row) => row[0]?.trim() === "Plush Name");
  if (headerIndex < 0) throw new Error("Official plushies header row not found.");
  return rows
    .slice(headerIndex + 1)
    .filter((row) => row[0]?.trim())
    .map((row) => ({
      plushName: row[0]?.trim() ?? "",
      obtainedFrom: row[1]?.trim() ?? "",
      functionality: row[2]?.trim() ?? "",
      stackable: row[3]?.trim() ?? "",
    }));
}

function loadLocalPlushies(): LocalPlushie[] {
  const raw = JSON.parse(readFileSync(localRuntimePath, "utf8")) as { plushies: LocalPlushie[] };
  return raw.plushies ?? [];
}

function localModifiersForAudit(plushie: LocalPlushie): { integrationType: string; modifiers: LocalModifier[] } | null {
  const parsed = plushie.modifiersParsed ?? [];
  if (parsed.length > 0) return { integrationType: "parsed", modifiers: parsed };
  if (GENERIC_OVERRIDE_NAMES.has(plushie.name)) {
    const modifiers = getCreatureSpecificPlushieModifiers("__audit__", plushie.name) ?? [];
    return modifiers.length > 0 ? { integrationType: "generic_override", modifiers } : null;
  }
  if (CREATURE_OVERRIDE_NAMES.has(plushie.name)) {
    const modifiers = getCreatureSpecificPlushieModifiers("Pentagloss", plushie.name) ?? [];
    return modifiers.length > 0 ? { integrationType: "creature_override", modifiers } : null;
  }
  return null;
}

function localStackableLabel(stackRule: string): string {
  if (stackRule === "stackable") return "Yes";
  if (stackRule === "unique") return "No";
  return "Unknown";
}

function statToSummary(mod: LocalModifier): string {
  const sign = mod.value >= 0 ? "+" : "";
  switch (mod.stat) {
    case "hpRegenPct":
      return `${sign}${mod.value}% HP regen`;
    case "damagePct":
      return `${sign}${mod.value}% damage`;
    case "weightPct":
      return `${sign}${mod.value}% weight`;
    case "movementSpeedPct":
      return `${sign}${mod.value}% movement speed`;
    case "stamRegenPct":
      return `${sign}${mod.value}% stamina regen`;
    case "biteCooldownPct":
      return `${sign}${mod.value}% bite cooldown`;
    case "bleedStacks":
      return `${sign}${mod.value} offensive bleed`;
    case "burnStacks":
      return `${sign}${mod.value} offensive burn`;
    case "poisonStacks":
      return `${sign}${mod.value} offensive poison`;
    case "necropoisonStacks":
      return `${sign}${mod.value} offensive necropoison`;
    case "frostbiteStacks":
      return `${sign}${mod.value} offensive frostbite`;
    case "blockBleedPct":
      return `${sign}${mod.value}% bleed block`;
    case "blockBurnPct":
      return `${sign}${mod.value}% burn block`;
    case "blockPoisonPct":
      return `${sign}${mod.value}% poison block`;
    case "blockFrostbitePct":
      return `${sign}${mod.value}% frostbite block`;
    case "blockNecropoisonPct":
      return `${sign}${mod.value}% necropoison block`;
    case "blockInjuryPct":
      return `${sign}${mod.value}% injury block`;
    default:
      return `${mod.stat} ${sign}${mod.value}`;
  }
}

function extractKeywords(text: string): string[] {
  const found = new Set<string>();
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(text)) found.add(rule.keyword);
  }
  return [...found].sort();
}

function computeReviewStatus(sourceFound: boolean, stackableMatch: string, overlap: string[], integrationType: string): string {
  if (!sourceFound) return "missing_source_row";
  if (stackableMatch === "mismatch") return "stack_rule_mismatch";
  if (integrationType === "creature_override") return "manual_review_creature_specific";
  if (overlap.length === 0) return "manual_review_effect_mismatch";
  return "manual_review_numeric_check";
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  const officialRows = loadOfficialRows();
  const officialByNormalized = new Map<string, OfficialPlushieRow>();
  for (const row of officialRows) {
    officialByNormalized.set(normalizeName(row.plushName), row);
  }

  const auditRows: AuditRow[] = [];
  for (const plushie of loadLocalPlushies()) {
    const integrated = localModifiersForAudit(plushie);
    if (!integrated) continue;

    const officialCandidateName =
      Object.entries(OFFICIAL_TO_LOCAL_NAME).find(([, local]) => local === plushie.name)?.[0] ?? plushie.name;
    const official = officialByNormalized.get(normalizeName(officialCandidateName)) ?? null;

    const localSummary = integrated.modifiers.map(statToSummary).join("; ");
    const sourceKeywords = extractKeywords(official?.functionality ?? "");
    const localKeywords = extractKeywords(localSummary);
    const overlap = sourceKeywords.filter((keyword) => localKeywords.includes(keyword));
    const sourceStackable = official?.stackable || "";
    const localStackable = localStackableLabel(plushie.stackRule);
    const stackableMatch =
      !sourceStackable || localStackable === "Unknown"
        ? "unknown"
        : sourceStackable.toLowerCase() === localStackable.toLowerCase()
        ? "match"
        : "mismatch";

    auditRows.push({
      localName: plushie.name,
      officialName: official?.plushName ?? null,
      sourceFound: official != null,
      sourceFunctionality: official?.functionality ?? "",
      sourceStackable,
      localStackRule: localStackable,
      stackableMatch,
      integrationType: integrated.integrationType,
      localEffectSummary: localSummary,
      sourceKeywords: sourceKeywords.join("|"),
      localKeywords: localKeywords.join("|"),
      keywordOverlap: overlap.join("|"),
      reviewStatus: computeReviewStatus(official != null, stackableMatch, overlap, integrated.integrationType),
    });
  }

  auditRows.sort((a, b) => a.localName.localeCompare(b.localName));

  const csvHeader = [
    "localName",
    "officialName",
    "sourceFound",
    "sourceFunctionality",
    "sourceStackable",
    "localStackRule",
    "stackableMatch",
    "integrationType",
    "localEffectSummary",
    "sourceKeywords",
    "localKeywords",
    "keywordOverlap",
    "reviewStatus",
  ];
  const csvLines = [
    csvHeader.join(","),
    ...auditRows.map((row) =>
      [
        row.localName,
        row.officialName ?? "",
        String(row.sourceFound),
        row.sourceFunctionality,
        row.sourceStackable,
        row.localStackRule,
        row.stackableMatch,
        row.integrationType,
        row.localEffectSummary,
        row.sourceKeywords,
        row.localKeywords,
        row.keywordOverlap,
        row.reviewStatus,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  writeFileSync(outCsv, csvLines.join("\n"));

  const summaryLines = [
    "# Integrated Plushies Audit",
    "",
    `Generated: 2026-04-03`,
    "",
    `Integrated local plushies audited: ${auditRows.length}`,
    "",
    "## Review statuses",
    "",
    ...Array.from(
      auditRows.reduce((acc, row) => {
        acc.set(row.reviewStatus, (acc.get(row.reviewStatus) ?? 0) + 1);
        return acc;
      }, new Map<string, number>()),
    )
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([status, count]) => `- \`${status}\`: ${count}`),
    "",
    "## Rows",
    "",
    "| Local | Official | Type | Stack | Local Effect | Source Effect | Review |",
    "|---|---|---|---|---|---|---|",
    ...auditRows.map(
      (row) =>
        `| ${row.localName} | ${row.officialName ?? "MISSING"} | ${row.integrationType} | ${row.stackableMatch} | ${row.localEffectSummary.replace(/\|/g, "/")} | ${(row.sourceFunctionality || "").replace(/\|/g, "/")} | ${row.reviewStatus} |`,
    ),
    "",
  ];
  writeFileSync(outMd, summaryLines.join("\n"));

  console.log(`Wrote ${outCsv}`);
  console.log(`Wrote ${outMd}`);
  console.table(
    auditRows.map((row) => ({
      localName: row.localName,
      officialName: row.officialName ?? "MISSING",
      integrationType: row.integrationType,
      stackableMatch: row.stackableMatch,
      keywordOverlap: row.keywordOverlap,
      reviewStatus: row.reviewStatus,
    })),
  );
}

main();
