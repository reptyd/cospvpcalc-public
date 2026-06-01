import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { applyRulesAndBuild } from "../src/engine";
import { effectsCatalog } from "../src/engine/data";
import { __test_applyStatusToTarget } from "../src/engine/engineTestApi";
import { buildRuntimeState, getEngineCreatureStrict } from "../src/engine/engineTestFixtures";

const outputPath = resolve("wasm-engine", "fixtures", "simple_status_application_fixtures.json");

type FixtureSeed = {
  name: string;
  creatureName: string;
  statusId: string;
  stacks: number;
  plushies?: string[];
  startingStatus?: { statusId: string; stacks: number };
};

function buildTargetState(seed: FixtureSeed) {
  const creature = getEngineCreatureStrict(seed.creatureName);
  const final = applyRulesAndBuild(creature, {
    venerationStage: 0,
    traits: [],
    ascensionAssignments: ["", "", "", "", ""],
    plushies: seed.plushies ?? [],
  });
  const { runtime, state } = buildRuntimeState(final);
  if (seed.startingStatus) {
    __test_applyStatusToTarget(0, runtime, state, seed.startingStatus.statusId, seed.startingStatus.stacks);
  }
  return { final, runtime, state };
}

function getResistFraction(creatureName: string, statusId: string): number {
  return (effectsCatalog[creatureName]?.resistStatus ?? []).find((entry) => entry.statusId === statusId)?.fraction ?? 0;
}

const seeds: FixtureSeed[] = [
  {
    name: "block-poison-halves",
    creatureName: "Aesho",
    statusId: "Poison_Status",
    stacks: 2.5,
  },
  {
    name: "negative-burn-resist-amplifies",
    creatureName: "Arcabatur",
    statusId: "Burn_Status",
    stacks: 1,
  },
  {
    name: "plushie-burn-block-reduces",
    creatureName: "Korathos",
    statusId: "Burn_Status",
    stacks: 1,
    plushies: ["Sparkler"],
  },
  {
    name: "sticky-teeth-does-not-restack",
    creatureName: "Korathos",
    statusId: "Sticky_Teeth_Status",
    stacks: 1,
    startingStatus: { statusId: "Sticky_Teeth_Status", stacks: 1 },
  },
];

const payload = seeds.map((seed) => {
  const { final, state, runtime } = buildTargetState(seed);
  const startingStatuses = structuredClone(state.statuses);
  __test_applyStatusToTarget(seed.startingStatus ? 1 : 0, runtime, state, seed.statusId, seed.stacks);
  const resistFraction = getResistFraction(seed.creatureName, seed.statusId);
  const plushieBlockFraction = (final.plushieStatusBlockPct?.[seed.statusId] ?? 0) / 100;
  const resistVulnerabilityMultiplier = resistFraction < 0 ? 1 - resistFraction : 1;
  const totalBlockFraction = Math.min(1, Math.max(0, Math.max(0, resistFraction) + plushieBlockFraction));
  const appliedStacks = seed.stacks * resistVulnerabilityMultiplier * Math.max(0, 1 - totalBlockFraction);
  const blockedStacks = seed.stacks > 0 ? seed.stacks - appliedStacks : 0;
  const effectiveFraction = seed.stacks > 0 ? Math.min(1, Math.max(0, blockedStacks / seed.stacks)) : 0;
  return {
    name: seed.name,
    time: seed.startingStatus ? 1 : 0,
    statusId: seed.statusId,
    stacks: seed.stacks,
    startingStatuses,
    resistFraction,
    plushieBlockFraction,
    expected: {
      statuses: state.statuses,
      appliedStacks,
      blockedStacks,
      effectiveFraction,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.length} simple status-application Rust fixtures to ${outputPath}`);
