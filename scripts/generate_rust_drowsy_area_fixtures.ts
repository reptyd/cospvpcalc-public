import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildFinalFromCreatureName, buildRuntimePair } from "../src/engine/engineTestFixtures";
import { __test_applyDrowsyArea } from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_drowsy_area_fixtures.json");

const attacker = buildFinalFromCreatureName("Amolis");
const defender = baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 });

const fixtures = [
  (() => {
    const pair = buildRuntimePair(attacker, defender);
    __test_applyDrowsyArea(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state, true);
    return {
      name: "drowsy-area-applies-drowsy",
      time: 0,
      activesOn: true,
      startingDefenderStatuses: {},
      expected: {
        defenderStatuses: pair.defender.state.statuses,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Drowsy Area"] ?? 0,
      },
    };
  })(),
  {
    name: "drowsy-area-disabled-with-actives-off",
    time: 0,
    activesOn: false,
    startingDefenderStatuses: {},
    expected: {
      defenderStatuses: {},
      abilityAppliedCount: 0,
    },
  },
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Wrote ${fixtures.length} simple drowsy area Rust fixtures to ${outputPath}`);
