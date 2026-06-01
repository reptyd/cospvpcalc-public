import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildRuntimePair } from "../src/engine/engineTestFixtures";
import { __test_handleThornTrap } from "../src/engine/engineTestApi";
import { creatureByName } from "../src/engine/creatureData";

const outputPath = resolve("wasm-engine", "fixtures", "simple_thorn_trap_fixtures.json");

function toRustStats(final: ReturnType<typeof baseStats>) {
  return {
    health: final.health,
    weight: final.weight,
    damage: final.damage,
    biteCooldown: final.biteCooldown,
    healthRegen: final.healthRegen ?? 0,
    berserkBiteCooldownMultiplier: 1,
    berserkHpRatioThreshold: 0,
    firstStrikePct: 0,
    firstStrikeHpRatioThreshold: 1,
    hasWardenResistance: false,
    hunkerReductionPct: 0,
    onHitStatuses: [],
    onHitTakenStatuses: [],
    startingStatuses: [],
    statusResistFractions: {},
    plushieStatusBlockFractions: {},
  };
}

const thornTrapCarrier = Object.values(creatureByName).find((creature) =>
  [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? [])].some(
    (ability) => ability.name === "Thorn Trap",
  ),
);

if (!thornTrapCarrier) {
  throw new Error("Could not find a creature with Thorn Trap");
}

const attacker = baseStats({ name: thornTrapCarrier.name, health: 1000 });
const defender = baseStats({ name: "Dummy", health: 1000 });

const fixtures = [
  (() => {
    const pair = buildRuntimePair(attacker, defender);
    __test_handleThornTrap(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    return {
      name: "thorn-trap-applies-bleed-and-freeze",
      defender: toRustStats(defender),
      time: 0,
      activesOn: true,
      startingDefenderStatuses: {},
      startingThornTrapCooldownUntil: 0,
      expected: {
        defenderStatuses: pair.defender.state.statuses,
        thornTrapCooldownUntil: pair.attacker.state.thornTrapCooldownUntil,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Thorn Trap"] ?? 0,
      },
    };
  })(),
  (() => {
    const pair = buildRuntimePair(attacker, defender);
    __test_handleThornTrap(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    const firstStatuses = structuredClone(pair.defender.state.statuses);
    __test_handleThornTrap(1, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    return {
      name: "thorn-trap-respects-cooldown",
      defender: toRustStats(defender),
      time: 1,
      activesOn: true,
      startingDefenderStatuses: firstStatuses,
      startingThornTrapCooldownUntil: pair.attacker.state.thornTrapCooldownUntil,
      expected: {
        defenderStatuses: pair.defender.state.statuses,
        thornTrapCooldownUntil: pair.attacker.state.thornTrapCooldownUntil,
        abilityAppliedCount: 0,
      },
    };
  })(),
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Wrote ${fixtures.length} simple thorn trap Rust fixtures to ${outputPath}`);
