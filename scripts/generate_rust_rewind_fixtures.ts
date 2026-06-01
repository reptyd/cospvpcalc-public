import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildRuntimePair } from "../src/engine/engineTestFixtures";
import { __test_updateRewind } from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_rewind_fixtures.json");

type StatusShape = {
  stacks: number;
  nextTickAt: number | null;
  remainingSec: number;
};

const FIXTURES = [
  {
    name: "rewind-heal-and-cleanse",
    attacker: baseStats({ name: "Hellion Warden", health: 8450, weight: 9600, damage: 65, biteCooldown: 1.2 }),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 9,
    currentHp: 4000,
    currentStatuses: {
      Burn_Status: { stacks: 9, nextTickAt: 3, remainingSec: 9 },
      Poison_Status: { stacks: 4, nextTickAt: 3, remainingSec: 9 },
    } satisfies Record<string, StatusShape>,
    snapshotHp: 6000,
    snapshotStatuses: {
      Burn_Status: { stacks: 3, nextTickAt: 3, remainingSec: 9 },
    } satisfies Record<string, StatusShape>,
  },
  {
    name: "rewind-capped-at-quarter-max-heal",
    attacker: baseStats({ name: "Hellion Warden", health: 8450, weight: 9600, damage: 65, biteCooldown: 1.2 }),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 9,
    currentHp: 1000,
    currentStatuses: {},
    snapshotHp: 8450,
    snapshotStatuses: {},
  },
  {
    name: "rewind-can-lower-current-hp",
    attacker: baseStats({ name: "Hellion Warden", health: 8450, weight: 9600, damage: 65, biteCooldown: 1.2 }),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 9,
    currentHp: 7000,
    currentStatuses: {
      Burn_Status: { stacks: 2, nextTickAt: 3, remainingSec: 9 },
    } satisfies Record<string, StatusShape>,
    snapshotHp: 5500,
    snapshotStatuses: {},
  },
];

const payload = FIXTURES.map((fixture) => {
  const pair = buildRuntimePair(fixture.attacker, fixture.defender);
  pair.attacker.state.hp = fixture.currentHp;
  pair.attacker.state.statuses = structuredClone(fixture.currentStatuses);
  pair.attacker.state.rewindHistory = [
    {
      time: 0,
      hp: fixture.snapshotHp,
      statuses: structuredClone(fixture.snapshotStatuses),
    },
  ];

  __test_updateRewind(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );

  return {
    name: fixture.name,
    maxHp: fixture.attacker.health,
    time: fixture.time,
    currentHp: fixture.currentHp,
    currentStatuses: fixture.currentStatuses,
    snapshotHp: fixture.snapshotHp,
    snapshotStatuses: fixture.snapshotStatuses,
    expected: {
      hp: pair.attacker.state.hp,
      statuses: pair.attacker.state.statuses,
      rewindCooldownUntil: pair.attacker.state.rewindCooldownUntil,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.length} simple rewind Rust fixtures to ${outputPath}`);
