import { readFile, writeFile } from "node:fs/promises";
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
  testPath: string;
  maxGroups: number;
  minGroupSize: number;
};

const RUNTIME_INSERT_MARKER = "const LIFE_LEECH_MELEE_SUPPORTED_ACTIVATED_NAMES = new Set(";
const SOURCE_TEST_INSERT_MARKER =
  'it("treats verified Empiterium source-side Hunters Curse as a TS no-op for passive contour eligibility"';
const DEFENDER_TEST_INSERT_MARKER =
  'it("treats verified Pacedegon defender-side breath blockers as TS no-ops for generic breath eligibility"';

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  let inputPath = "logs/rust-rollout-data-pass/20260312-215706/derived/confident-candidates.json";
  let runtimePath = "src/optimizer/rustBestBuildsRuntime.ts";
  let testPath = "src/optimizer/rustBestBuildsRuntime.test.ts";
  let maxGroups = 1;
  let minGroupSize = 1;

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
    if (arg === "--tests") {
      testPath = args[i + 1] ?? testPath;
      i += 1;
      continue;
    }
    if (arg === "--max-groups") {
      maxGroups = Number(args[i + 1] ?? maxGroups);
      i += 1;
      continue;
    }
    if (arg === "--min-group-size") {
      minGroupSize = Number(args[i + 1] ?? minGroupSize);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    inputPath: path.resolve(inputPath),
    runtimePath: path.resolve(runtimePath),
    testPath: path.resolve(testPath),
    maxGroups,
    minGroupSize,
  };
}

function shapeKey(shape: Shape): string {
  return JSON.stringify({
    s: shape.sourceSafeNoOps,
    d: shape.defenderSafeBreathNoOps,
    p: shape.manualPassiveBreathBlockers,
  });
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

function extractAlreadyRolledOutNames(runtimeSource: string): Set<string> {
  const names = new Set<string>();
  for (const match of runtimeSource.matchAll(/(?:PASSIVE_CONTOUR_SOURCE_TS_NO_OP_ACTIVATED_BY_CREATURE|BREATH_DEFENDER_TS_NO_OP_ACTIVATED_BY_SOURCE_CREATURE)\.set\(\s*"([^"]+)"/g)) {
    names.add(match[1]);
  }
  for (const match of runtimeSource.matchAll(/^\s*\[\s*"([^"]+)"\s*,/gm)) {
    names.add(match[1]);
  }
  return names;
}

function quote(name: string): string {
  return JSON.stringify(name);
}

function abilitySetBlock(abilities: string[]): string {
  if (abilities.length === 1) {
    return `new Set([normalizeAbilityName(${quote(abilities[0])})])`;
  }
  return `new Set([\n${abilities.map((ability) => `    normalizeAbilityName(${quote(ability)}),`).join("\n")}\n  ])`;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function camelCaseCreatureName(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  const parts = ascii.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "creatureEntry";
  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

function runtimeSourceSnippet(creature: string, abilities: string[]): string {
  return [
    "PASSIVE_CONTOUR_SOURCE_TS_NO_OP_ACTIVATED_BY_CREATURE.set(",
    `  ${quote(creature)},`,
    `  ${abilitySetBlock(abilities)},`,
    ");",
  ].join("\n");
}

function runtimeDefenderSnippet(creature: string, abilities: string[]): string {
  return [
    "BREATH_DEFENDER_TS_NO_OP_ACTIVATED_BY_SOURCE_CREATURE.set(",
    `  ${quote(creature)},`,
    `  ${abilitySetBlock(abilities)},`,
    ");",
  ].join("\n");
}

function creatureDeclaration(creatureName: string, abilities: string[], semantics: "neutral" | "offensive"): string {
  const varName = camelCaseCreatureName(creatureName);
  const lines = abilities.map(
    (ability) =>
      `      { abilityId: ${quote(slugify(ability))}, name: ${quote(ability)}, value: null, semantics: ${quote(semantics)}, subtype: null },`,
  );
  return [
    `    const ${varName} = creature(${quote(creatureName)});`,
    `    ${varName}.activatedAbilities = [`,
    ...lines,
    "    ];",
  ].join("\n");
}

function sourceLoopEntries(members: Suggestion[]): string {
  return members
    .map((member) => {
      const varName = camelCaseCreatureName(member.creature);
      return `      [${varName}, { ...finalStats(${quote(member.creature)}), hasBreath: true, breathType: "Fire Breath" } as FinalStats],`;
    })
    .join("\n");
}

function sourceTestBlock(group: ShapeGroup): string {
  if (group.shape.sourceSafeNoOps.length === 0) {
    return "";
  }
  const creatureNames = group.members.map((member) => member.creature);
  const titleNames =
    creatureNames.length === 1
      ? `${creatureNames[0]}`
      : `${creatureNames.slice(0, -1).join(", ")}, and ${creatureNames[creatureNames.length - 1]}`;

  return [
    `  it("treats verified ${titleNames} source-side actives as TS no-ops for passive contour eligibility", () => {`,
    ...group.members.map((member) => creatureDeclaration(member.creature, group.shape.sourceSafeNoOps, "neutral")),
    '    const defender = creature("B");',
    '    const breathB = { ...finalStats("B"), hasBreath: true, breathType: "Fire Breath" } as FinalStats;',
    "",
    "    for (const [sourceCreature, sourceFinal] of [",
    sourceLoopEntries(group.members),
    "    ] as const) {",
    "      expect(",
    "        isRustBreathEligible({",
    "          sourceCreature,",
    "          opponentCreature: defender,",
    "          finalA: sourceFinal,",
    "          finalB: breathB,",
    "          activesOn: true,",
    "        }),",
    "      ).toBe(true);",
    "    }",
    "  });",
  ].join("\n");
}

function defenderTestBlock(group: ShapeGroup): string {
  const creatureNames = group.members.map((member) => member.creature);
  const titleNames =
    creatureNames.length === 1
      ? `${creatureNames[0]}`
      : `${creatureNames.slice(0, -1).join(", ")}, and ${creatureNames[creatureNames.length - 1]}`;

  return [
    `  it("treats verified ${titleNames} defender-side breath blockers as TS no-ops for generic breath eligibility", () => {`,
    ...group.members.map((member) => creatureDeclaration(member.creature, group.shape.sourceSafeNoOps, "neutral")),
    '    const defender = creature("B");',
    "    defender.activatedAbilities = [",
    ...group.shape.defenderSafeBreathNoOps.map(
      (ability) =>
        `      { abilityId: ${quote(slugify(ability))}, name: ${quote(ability)}, value: null, semantics: "offensive", subtype: null },`,
    ),
    "    ];",
    "",
    "    for (const [sourceCreature, sourceFinal] of [",
    sourceLoopEntries(group.members),
    "    ] as const) {",
    "      expect(",
    "        isRustBreathEligible({",
    "          sourceCreature,",
    "          opponentCreature: defender,",
    "          finalA: sourceFinal,",
    '          finalB: { ...finalStats("B"), hasBreath: true, breathType: "Fire Breath" } as FinalStats,',
    "          activesOn: true,",
    "        }),",
    "      ).toBe(true);",
    "    }",
    "  });",
  ].join("\n");
}

function insertBeforeMarker(text: string, marker: string, insertion: string): string {
  const index = text.indexOf(marker);
  if (index < 0) {
    throw new Error(`Could not find insertion marker: ${marker}`);
  }
  return `${text.slice(0, index)}${insertion}\n\n${text.slice(index)}`;
}

async function main(): Promise<void> {
  const config = parseArgs();
  const [inputRaw, runtimeRaw, testRaw] = await Promise.all([
    readFile(config.inputPath, "utf8"),
    readFile(config.runtimePath, "utf8"),
    readFile(config.testPath, "utf8"),
  ]);

  const suggestions = JSON.parse(inputRaw) as Suggestion[];
  const alreadyRolledOut = extractAlreadyRolledOutNames(runtimeRaw);
  const pending = suggestions
    .filter((entry) => entry.manualPassiveBreathBlockers.length === 0)
    .filter((entry) => !alreadyRolledOut.has(entry.creature))
    .sort(compareSuggestions);

  const groups = groupByShape(pending)
    .filter((group) => group.members.length >= config.minGroupSize)
    .slice(0, config.maxGroups);

  if (groups.length === 0) {
    console.log(JSON.stringify({ appliedGroups: 0, creatures: [] }, null, 2));
    return;
  }

  const runtimeInsertion = groups
    .flatMap((group) => [
      ...(
        group.shape.sourceSafeNoOps.length > 0
          ? group.members.map((member) => runtimeSourceSnippet(member.creature, group.shape.sourceSafeNoOps))
          : []
      ),
      ...group.members.map((member) => runtimeDefenderSnippet(member.creature, group.shape.defenderSafeBreathNoOps)),
    ])
    .join("\n\n");

  const sourceTestInsertion = groups.map(sourceTestBlock).filter(Boolean).join("\n\n");
  const defenderTestInsertion = groups.map(defenderTestBlock).join("\n\n");

  const nextRuntime = insertBeforeMarker(runtimeRaw, RUNTIME_INSERT_MARKER, `${runtimeInsertion}`);
  let nextTests = insertBeforeMarker(testRaw, SOURCE_TEST_INSERT_MARKER, sourceTestInsertion);
  nextTests = insertBeforeMarker(nextTests, DEFENDER_TEST_INSERT_MARKER, defenderTestInsertion);

  await Promise.all([writeFile(config.runtimePath, nextRuntime), writeFile(config.testPath, nextTests)]);

  console.log(
    JSON.stringify(
      {
        appliedGroups: groups.length,
        creatures: groups.flatMap((group) => group.members.map((member) => member.creature)),
        groups: groups.map((group) => ({
          count: group.members.length,
          creatures: group.members.map((member) => member.creature),
          sourceSafeNoOps: group.shape.sourceSafeNoOps,
          defenderSafeBreathNoOps: group.shape.defenderSafeBreathNoOps,
          maxStage2Pct: group.maxStage2Pct,
        })),
      },
      null,
      2,
    ),
  );
}

void main();
