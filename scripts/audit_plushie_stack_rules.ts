import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type CsvRow = string[];

type OfficialPlushieRow = {
  plushName: string;
  stackable: string;
};

type LocalPlushie = {
  name: string;
  stackRule: string;
  rawDescription?: string;
};

type AuditRow = {
  localName: string;
  officialName: string | null;
  sourceFound: boolean;
  officialStack: string;
  localStackRule: string;
  rawDescriptionStack: string;
  sourceVsLocal: string;
  rawVsLocal: string;
  problem: string;
};

const repoRoot = resolve(import.meta.dirname, "..");
const officialCsvPath = resolve(repoRoot, "data/reference_source/plushies.csv");
const localRuntimePath = resolve(repoRoot, "data/plushies.runtime.json");
const outDir = resolve(repoRoot, "artifacts/reference_audit");
const outCsv = resolve(outDir, "plushie_stack_audit.csv");
const outMd = resolve(outDir, "plushie_stack_audit.md");

const OFFICIAL_TO_LOCAL_NAME: Record<string, string> = {
  "Magic Pronghorn": "Magichorn Prongbug",
  "Pig O' Lantern": "Pig-Lantern",
  Dragon: "Haunt Dragon",
  Eggshell: "Egg Shell",
  "Palm Tree": "Palmtree",
};

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
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
      stackable: row[3]?.trim() ?? "",
    }));
}

function loadLocalPlushies(): LocalPlushie[] {
  const raw = JSON.parse(readFileSync(localRuntimePath, "utf8")) as { plushies: LocalPlushie[] };
  return raw.plushies ?? [];
}

function officialToLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes") return "stackable";
  if (normalized === "no") return "unique";
  return "unknown";
}

function inferStackFromRawDescription(rawDescription?: string): string {
  const text = rawDescription ?? "";
  if (!text.trim()) return "unknown";
  if (
    /non-stackable|non stackable|cannot stack|does not stack|not stackable|plushie cannot stack|effects are not stackable/i.test(
      text,
    )
  ) {
    return "unique";
  }
  if (/stackable/i.test(text)) {
    return "stackable";
  }
  return "unknown";
}

function compareLabels(expected: string, actual: string): string {
  if (expected === "unknown" || actual === "unknown") return "unknown";
  return expected === actual ? "match" : "mismatch";
}

function computeProblem(sourceVsLocal: string, rawVsLocal: string, sourceFound: boolean): string {
  if (sourceVsLocal === "mismatch" && rawVsLocal === "mismatch") return "source_and_raw_mismatch";
  if (sourceVsLocal === "mismatch") return "official_stack_mismatch";
  if (rawVsLocal === "mismatch") return "raw_description_stack_mismatch";
  if (!sourceFound) return "missing_official_row";
  if (sourceVsLocal === "unknown" || rawVsLocal === "unknown") return "needs_manual_stack_review";
  return "ok";
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  const officialRows = loadOfficialRows();
  const officialByNormalized = new Map<string, OfficialPlushieRow>();
  for (const row of officialRows) {
    officialByNormalized.set(normalizeName(row.plushName), row);
  }

  const auditRows: AuditRow[] = loadLocalPlushies()
    .map((plushie) => {
      const officialCandidateName =
        Object.entries(OFFICIAL_TO_LOCAL_NAME).find(([, local]) => local === plushie.name)?.[0] ?? plushie.name;
      const official = officialByNormalized.get(normalizeName(officialCandidateName)) ?? null;
      const officialLabel = officialToLabel(official?.stackable ?? "");
      const rawLabel = inferStackFromRawDescription(plushie.rawDescription);
      const sourceVsLocal = compareLabels(officialLabel, plushie.stackRule);
      const rawVsLocal = compareLabels(rawLabel, plushie.stackRule);
      return {
        localName: plushie.name,
        officialName: official?.plushName ?? null,
        sourceFound: official != null,
        officialStack: officialLabel,
        localStackRule: plushie.stackRule,
        rawDescriptionStack: rawLabel,
        sourceVsLocal,
        rawVsLocal,
        problem: computeProblem(sourceVsLocal, rawVsLocal, official != null),
      };
    })
    .sort((a, b) => a.localName.localeCompare(b.localName));

  const csvHeader = [
    "localName",
    "officialName",
    "sourceFound",
    "officialStack",
    "localStackRule",
    "rawDescriptionStack",
    "sourceVsLocal",
    "rawVsLocal",
    "problem",
  ];
  const csvLines = [
    csvHeader.join(","),
    ...auditRows.map((row) =>
      [
        row.localName,
        row.officialName ?? "",
        String(row.sourceFound),
        row.officialStack,
        row.localStackRule,
        row.rawDescriptionStack,
        row.sourceVsLocal,
        row.rawVsLocal,
        row.problem,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  writeFileSync(outCsv, csvLines.join("\n"));

  const problemRows = auditRows.filter((row) => row.problem !== "ok");
  const summaryLines = [
    "# Plushie Stack Audit",
    "",
    `Generated: 2026-04-03`,
    "",
    `Local plushies audited: ${auditRows.length}`,
    `Rows with non-ok stack status: ${problemRows.length}`,
    "",
    "## Problem counts",
    "",
    ...Array.from(
      problemRows.reduce((acc, row) => {
        acc.set(row.problem, (acc.get(row.problem) ?? 0) + 1);
        return acc;
      }, new Map<string, number>()),
    )
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([problem, count]) => `- \`${problem}\`: ${count}`),
    "",
    "## Problem rows",
    "",
    "| Local | Official | Official Stack | Local Stack | Raw Stack | Source vs Local | Raw vs Local | Problem |",
    "|---|---|---|---|---|---|---|---|",
    ...problemRows.map(
      (row) =>
        `| ${row.localName} | ${row.officialName ?? "MISSING"} | ${row.officialStack} | ${row.localStackRule} | ${row.rawDescriptionStack} | ${row.sourceVsLocal} | ${row.rawVsLocal} | ${row.problem} |`,
    ),
    "",
  ];
  writeFileSync(outMd, summaryLines.join("\n"));

  console.log(`Wrote ${outCsv}`);
  console.log(`Wrote ${outMd}`);
  console.table(problemRows);
}

main();
