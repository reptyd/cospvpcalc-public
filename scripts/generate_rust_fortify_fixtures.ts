import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildRuntimePair } from "../src/engine/engineTestFixtures";
import { __test_handleFortify } from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_fortify_fixtures.json");

function toRustStatuses(statuses: ReturnType<typeof buildRuntimePair>["attacker"]["state"]["statuses"]) {
  return structuredClone(statuses);
}

const defender = baseStats({ name: "Athulyth", health: 1000 });
const opponent = baseStats({ name: "Korathos", health: 1000 });

const fixtures = [
  (() => {
    const pair = buildRuntimePair(defender, opponent);
    pair.attacker.state.statuses["Burn_Status"] = { stacks: 3, nextTickAt: 3, remainingSec: 12 };
    pair.attacker.state.statuses["Frostbite_Status"] = { stacks: 2, nextTickAt: 3, remainingSec: 12 };
    __test_handleFortify(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    return {
      name: "fortify-clears-removable-statuses",
      time: 0,
      startingStatuses: {
        Burn_Status: { stacks: 3, nextTickAt: 3, remainingSec: 12 },
        Frostbite_Status: { stacks: 2, nextTickAt: 3, remainingSec: 12 },
      },
      startingFortifyCooldownUntil: 0,
      expected: {
        statuses: toRustStatuses(pair.attacker.state.statuses),
        fortifyCooldownUntil: pair.attacker.state.fortifyCooldownUntil,
        fortifyImmuneUntil: pair.attacker.state.fortifyImmuneUntil,
        fortifyWeightBonusUntil: pair.attacker.state.fortifyWeightBonusUntil,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Fortify"] ?? 0,
      },
    };
  })(),
  (() => {
    const pair = buildRuntimePair(defender, opponent);
    pair.attacker.state.statuses["Slow_Status"] = { stacks: 2, nextTickAt: 3, remainingSec: 12 };
    __test_handleFortify(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    return {
      name: "fortify-ignores-non-removable-only-set",
      time: 0,
      startingStatuses: {
        Slow_Status: { stacks: 2, nextTickAt: 3, remainingSec: 12 },
      },
      startingFortifyCooldownUntil: 0,
      expected: {
        statuses: toRustStatuses(pair.attacker.state.statuses),
        fortifyCooldownUntil: pair.attacker.state.fortifyCooldownUntil,
        fortifyImmuneUntil: pair.attacker.state.fortifyImmuneUntil,
        fortifyWeightBonusUntil: pair.attacker.state.fortifyWeightBonusUntil,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Fortify"] ?? 0,
      },
    };
  })(),
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Wrote ${fixtures.length} simple fortify Rust fixtures to ${outputPath}`);
