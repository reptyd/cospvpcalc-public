import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { applyRulesAndBuild, type BuildOptions } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import {
  BEST_BUILDS_BAD_OMEN_OUTCOME,
  BEST_BUILDS_OPPONENT_BUILD,
  buildBestBuildsOpponentFinal,
} from "../src/optimizer/bestBuildsRuntime";
import {
  aggregateBestBuildsMatchupSummary,
} from "../src/optimizer/ranking";
import {
  simulateBestBuildsMatchupContract,
} from "../src/optimizer/bestBuildsMatchupContract";

function requireCreature(name: string) {
  const creature = creatureByName[name];
  if (!creature) {
    throw new Error(`Missing creature: ${name}`);
  }
  return creature;
}

const DEFAULT_BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Weight"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Void", "Void"],
};

const FIXTURE_SPECS = [
  {
    name: "kendyll-vs-korathos",
    source: "Kendyll",
    opponent: "Korathos",
    build: DEFAULT_BUILD,
    activesOn: true,
    breathOn: true,
    maxTimeSec: 30,
    abilityPolicy: "semiIdeal" as const,
  },
  {
    name: "korathos-vs-sigmatox",
    source: "Korathos",
    opponent: "Sigmatox",
    build: DEFAULT_BUILD,
    activesOn: true,
    breathOn: true,
    maxTimeSec: 30,
    abilityPolicy: "semiIdeal" as const,
  },
  {
    name: "oxytalis-vs-korathos",
    source: "Oxytalis",
    opponent: "Korathos",
    build: {
      venerationStage: 5,
      traits: ["Health", "Weight"],
      ascensionAssignments: ["Health", "Health", "Health", "Health", "Health"],
      plushies: ["Void", "Void"],
    },
    activesOn: true,
    breathOn: true,
    maxTimeSec: 30,
    abilityPolicy: "semiIdeal" as const,
  },
];

const outputPath = resolve("wasm-engine", "fixtures", "best_builds_matchup_contract.json");

const fixtures = FIXTURE_SPECS.map((spec) => {
  const finalA = applyRulesAndBuild(requireCreature(spec.source), spec.build);
  const finalB = buildBestBuildsOpponentFinal(requireCreature(spec.opponent));
  const summary = simulateBestBuildsMatchupContract({
    finalA,
    finalB,
    activesOn: spec.activesOn,
    breathOn: spec.breathOn,
    maxTimeSec: spec.maxTimeSec,
    abilityPolicy: spec.abilityPolicy,
    badOmenOutcome: BEST_BUILDS_BAD_OMEN_OUTCOME,
  });

  return {
    name: spec.name,
    input: {
      finalA,
      finalB,
      activesOn: spec.activesOn,
      breathOn: spec.breathOn,
      maxTimeSec: spec.maxTimeSec,
      abilityPolicy: spec.abilityPolicy,
      badOmenOutcome: BEST_BUILDS_BAD_OMEN_OUTCOME,
    },
    summary,
    expectedAggregate: aggregateBestBuildsMatchupSummary(summary),
    opponentBaseline: BEST_BUILDS_OPPONENT_BUILD,
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Wrote ${fixtures.length} Rust matchup fixtures to ${outputPath}`);
