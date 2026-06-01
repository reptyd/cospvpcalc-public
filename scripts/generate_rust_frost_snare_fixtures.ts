import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildFinalFromCreatureName, buildRuntimePair } from "../src/engine/engineTestFixtures";
import { __test_handleFrostSnare } from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_frost_snare_fixtures.json");

type StatusShape = {
  stacks: number;
  nextTickAt: number | null;
  remainingSec: number;
};

const frigilinx = buildFinalFromCreatureName("Frigilinx");

const FIXTURES = [
  {
    name: "frost-snare-applies-five-frostbite",
    attacker: frigilinx,
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 0,
    startingStatuses: {},
    startingCooldownUntil: 0,
  },
  {
    name: "frost-snare-respects-existing-cooldown",
    attacker: frigilinx,
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 10,
    startingStatuses: {},
    startingCooldownUntil: 120,
  },
  {
    name: "frost-snare-stacks-onto-existing-frostbite",
    attacker: frigilinx,
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 0,
    startingStatuses: {
      Frostbite_Status: { stacks: 2, nextTickAt: null, remainingSec: 6 },
    } satisfies Record<string, StatusShape>,
    startingCooldownUntil: 0,
  },
];

const payload = FIXTURES.map((fixture) => {
  const pair = buildRuntimePair(fixture.attacker, fixture.defender);
  pair.attacker.state.frostSnareCooldownUntil = fixture.startingCooldownUntil;
  pair.defender.state.statuses = structuredClone(fixture.startingStatuses);

  __test_handleFrostSnare(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );

  return {
    name: fixture.name,
    time: fixture.time,
    startingCooldownUntil: fixture.startingCooldownUntil,
    startingStatuses: fixture.startingStatuses,
    expected: {
      frostSnareCooldownUntil: pair.attacker.state.frostSnareCooldownUntil,
      defenderStatuses: pair.defender.state.statuses,
      abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Frost Snare"] ?? 0,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.length} simple frost snare Rust fixtures to ${outputPath}`);
