import { readFile } from "node:fs/promises";
import path from "node:path";

type Suggestion = {
  creature: string;
  sourceActivated: string[];
  stage2Pct: number;
  stage2Eligible: number;
  stage2Total: number;
  sourceSafeNoOps: string[];
  defenderSafeBreathNoOps: string[];
  manualPassiveBreathBlockers: string[];
};

type Shape = {
  sourceSafeNoOps: string[];
  defenderSafeBreathNoOps: string[];
  manualPassiveBreathBlockers: string[];
};

type ShapeGroup = {
  shape: Shape;
  members: Suggestion[];
  avgStage2Pct: number;
  maxStage2Pct: number;
};

type CliConfig = {
  inputPath: string;
  runtimePath: string;
  limitShapes: number;
  minGroupSize: number;
  format: "text" | "json";
};

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  let inputPath = "logs/rust-rollout-data-pass/20260312-215706/derived/confident-candidates.json";
  let runtimePath = "src/optimizer/rustBestBuildsRuntime.ts";
  let limitShapes = 12;
  let minGroupSize = 1;
  let format: "text" | "json" = "text";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--input") {
      inputPath = args[i + 1] ?? inputPath;
      i += 1;
      continue;
    }
    if (arg === "--runtime") {
      runtimePath = args[i + 1] ?? runtimePath;
      i += 1;
      continue;
    }
    if (arg === "--limit-shapes") {
      limitShapes = Number(args[i + 1] ?? limitShapes);
      i += 1;
      continue;
    }
    if (arg === "--min-group-size") {
      minGroupSize = Number(args[i + 1] ?? minGroupSize);
      i += 1;
      continue;
    }
    if (arg === "--format") {
      format = (args[i + 1] ?? format) as "text" | "json";
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(limitShapes) || limitShapes <= 0) {
    throw new Error(`Unsupported --limit-shapes value: ${limitShapes}`);
  }
  if (!Number.isFinite(minGroupSize) || minGroupSize <= 0) {
    throw new Error(`Unsupported --min-group-size value: ${minGroupSize}`);
  }
  if (!["text", "json"].includes(format)) {
    throw new Error(`Unsupported --format value: ${format}`);
  }

  return {
    inputPath: path.resolve(inputPath),
    runtimePath: path.resolve(runtimePath),
    limitShapes,
    minGroupSize,
    format,
  };
}

function shapeKey(shape: Shape): string {
  return JSON.stringify({
    s: shape.sourceSafeNoOps,
    d: shape.defenderSafeBreathNoOps,
    p: shape.manualPassiveBreathBlockers,
  });
}

function quoteCreatureName(name: string): string {
  return JSON.stringify(name);
}

function abilitySetBlock(abilities: string[]): string {
  if (abilities.length === 1) {
    return `new Set([normalizeAbilityName(${JSON.stringify(abilities[0])})])`;
  }

  const lines = abilities.map((ability) => `  normalizeAbilityName(${JSON.stringify(ability)}),`);
  return `new Set([\n${lines.join("\n")}\n])`;
}

function runtimeSourceSnippet(creature: string, abilities: string[]): string {
  return [
    "PASSIVE_CONTOUR_SOURCE_TS_NO_OP_ACTIVATED_BY_CREATURE.set(",
    `  ${quoteCreatureName(creature)},`,
    `  ${abilitySetBlock(abilities)},`,
    ");",
  ].join("\n");
}

function runtimeDefenderSnippet(creature: string, abilities: string[]): string {
  return [
    "BREATH_DEFENDER_TS_NO_OP_ACTIVATED_BY_SOURCE_CREATURE.set(",
    `  ${quoteCreatureName(creature)},`,
    `  ${abilitySetBlock(abilities)},`,
    ");",
  ].join("\n");
}

function extractAlreadyRolledOutNames(runtimeSource: string): Set<string> {
  const names = new Set<string>();
  for (const match of runtimeSource.matchAll(/(?:PASSIVE_CONTOUR_SOURCE_TS_NO_OP_ACTIVATED_BY_CREATURE|BREATH_DEFENDER_TS_NO_OP_ACTIVATED_BY_SOURCE_CREATURE)\.set\(\s*"([^"]+)"/g)) {
    names.add(match[1]);
  }
  return names;
}

function compareSuggestions(a: Suggestion, b: Suggestion): number {
  return b.stage2Pct - a.stage2Pct || a.creature.localeCompare(b.creature);
}

function groupByShape(suggestions: Suggestion[]): ShapeGroup[] {
  const groups = new Map<string, ShapeGroup>();
  for (const suggestion of suggestions) {
    const shape: Shape = {
      sourceSafeNoOps: [...suggestion.sourceSafeNoOps],
      defenderSafeBreathNoOps: [...suggestion.defenderSafeBreathNoOps],
      manualPassiveBreathBlockers: [...suggestion.manualPassiveBreathBlockers],
    };
    const key = shapeKey(shape);
    const current = groups.get(key);
    if (current) {
      current.members.push(suggestion);
      continue;
    }
    groups.set(key, { shape, members: [suggestion], avgStage2Pct: 0, maxStage2Pct: 0 });
  }

  return [...groups.values()]
    .map((group) => {
      const members = [...group.members].sort(compareSuggestions);
      const totalPct = members.reduce((sum, member) => sum + member.stage2Pct, 0);
      return {
        ...group,
        members,
        avgStage2Pct: totalPct / members.length,
        maxStage2Pct: members[0]?.stage2Pct ?? 0,
      };
    })
    .sort((a, b) => {
      return (
        b.members.length - a.members.length ||
        b.maxStage2Pct - a.maxStage2Pct ||
        b.avgStage2Pct - a.avgStage2Pct ||
        a.members[0]!.creature.localeCompare(b.members[0]!.creature)
      );
    });
}

function toText(groups: ShapeGroup[], alreadyRolledOutCount: number, pendingCount: number): string {
  const lines: string[] = [];
  lines.push(`Already rolled out in runtime: ${alreadyRolledOutCount}`);
  lines.push(`Pending confident creatures after filter: ${pendingCount}`);

  groups.forEach((group, index) => {
    const names = group.members.map((member) => member.creature);
    lines.push("");
    lines.push(`Shape #${index + 1}`);
    lines.push(`Members (${group.members.length}): ${names.join(", ")}`);
    lines.push(`Stage2 pct: max=${group.maxStage2Pct.toFixed(2)} avg=${group.avgStage2Pct.toFixed(2)}`);
    lines.push(`Source no-ops: ${group.shape.sourceSafeNoOps.join(", ") || "(none)"}`);
    lines.push(`Defender breath no-ops: ${group.shape.defenderSafeBreathNoOps.join(", ") || "(none)"}`);
    if (group.shape.manualPassiveBreathBlockers.length > 0) {
      lines.push(`Manual passive blockers: ${group.shape.manualPassiveBreathBlockers.join(", ")}`);
    }
    lines.push("Runtime source snippets:");
    for (const member of group.members) {
      lines.push(runtimeSourceSnippet(member.creature, group.shape.sourceSafeNoOps));
      lines.push("");
    }
    lines.push("Runtime defender snippets:");
    for (const member of group.members) {
      lines.push(runtimeDefenderSnippet(member.creature, group.shape.defenderSafeBreathNoOps));
      lines.push("");
    }
  });

  return `${lines.join("\n").trim()}\n`;
}

async function main(): Promise<void> {
  const config = parseArgs();
  const [inputRaw, runtimeRaw] = await Promise.all([
    readFile(config.inputPath, "utf8"),
    readFile(config.runtimePath, "utf8"),
  ]);

  const suggestions = JSON.parse(inputRaw) as Suggestion[];
  const alreadyRolledOut = extractAlreadyRolledOutNames(runtimeRaw);
  const pending = suggestions
    .filter((entry) => entry.manualPassiveBreathBlockers.length === 0)
    .filter((entry) => !alreadyRolledOut.has(entry.creature))
    .sort(compareSuggestions);

  const groups = groupByShape(pending)
    .filter((group) => group.members.length >= config.minGroupSize)
    .slice(0, config.limitShapes);

  if (config.format === "json") {
    console.log(
      JSON.stringify(
        {
          alreadyRolledOutCount: alreadyRolledOut.size,
          pendingCount: pending.length,
          groups: groups.map((group) => ({
            count: group.members.length,
            maxStage2Pct: group.maxStage2Pct,
            avgStage2Pct: group.avgStage2Pct,
            sourceSafeNoOps: group.shape.sourceSafeNoOps,
            defenderSafeBreathNoOps: group.shape.defenderSafeBreathNoOps,
            creatures: group.members.map((member) => member.creature),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  process.stdout.write(toText(groups, alreadyRolledOut.size, pending.length));
}

void main();
