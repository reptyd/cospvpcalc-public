import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  __test_buildCombatantRuntime,
  __test_createCombatantState,
  __test_updateUnbridledRage,
} from "../src/engine/engineTestApi";
import { creatureByName } from "../src/engine/data";
import {
  buildFinalFromCreatureName,
  buildFinalFromStats,
} from "../src/engine/engineTestFixtures";

function findCreatureWithAbility(name: string): string {
  const found = Object.values(creatureByName).find((creature) =>
    [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.otherAbilities ?? [])].some(
      (ability) => ability.name === name,
    ),
  );
  if (!found) throw new Error(`No creature found with ability ${name}`);
  return found.name;
}

function buildCustomAttacker(name: string) {
  const base = buildFinalFromCreatureName(name);
  return buildFinalFromStats(name, {
    ...base,
    health: 1000,
    damage: 500,
    biteCooldown: 1,
  });
}

function buildCustomDefender(name: string) {
  const base = buildFinalFromCreatureName(name);
  return buildFinalFromStats(name, {
    ...base,
    health: 1000,
    damage: 150,
    biteCooldown: 2,
  });
}

function fixture(
  name: string,
  {
    time,
    attackerHp,
    startingUnbridledRageActiveUntil,
    startingUnbridledRageCooldownUntil,
    disabledAbilities = [],
  }: {
    time: number;
    attackerHp: number;
    startingUnbridledRageActiveUntil: number;
    startingUnbridledRageCooldownUntil: number;
    disabledAbilities?: string[];
  },
) {
  const attackerName = findCreatureWithAbility("Unbridled Rage");
  const attacker = buildCustomAttacker(attackerName);
  const defender = buildCustomDefender("Korathos");

  const attackerRuntime = __test_buildCombatantRuntime(attacker);
  const defenderRuntime = __test_buildCombatantRuntime(defender);
  const attackerState = __test_createCombatantState(attacker);
  const defenderState = __test_createCombatantState(defender);

  attackerState.hp = attackerHp;
  attackerState.unbridledRageActiveUntil = startingUnbridledRageActiveUntil;
  attackerState.unbridledRageCooldownUntil = startingUnbridledRageCooldownUntil;

  __test_updateUnbridledRage(
    time,
    attackerRuntime,
    defenderRuntime,
    attackerState,
    defenderState,
    disabledAbilities,
  );

  return {
    name,
    time,
    activesOn: true,
    abilityDisabled: disabledAbilities.includes("Unbridled Rage"),
    attacker,
    defender,
    attackerHp,
    startingUnbridledRageActiveUntil,
    startingUnbridledRageCooldownUntil,
    expected: {
      unbridledRageActiveUntil: attackerState.unbridledRageActiveUntil,
      unbridledRageCooldownUntil: attackerState.unbridledRageCooldownUntil,
      abilityAppliedCount:
        attackerState.unbridledRageActiveUntil > startingUnbridledRageActiveUntil ||
        attackerState.unbridledRageCooldownUntil > startingUnbridledRageCooldownUntil
          ? 1
          : 0,
    },
  };
}

const fixtures = [
  fixture("unbridled-rage-activates-when-ready", {
    time: 10,
    attackerHp: 1000,
    startingUnbridledRageActiveUntil: 0,
    startingUnbridledRageCooldownUntil: 0,
  }),
  fixture("unbridled-rage-skips-when-attacker-too-low", {
    time: 10,
    attackerHp: 200,
    startingUnbridledRageActiveUntil: 0,
    startingUnbridledRageCooldownUntil: 0,
  }),
  fixture("unbridled-rage-disabled-no-op", {
    time: 10,
    attackerHp: 1000,
    startingUnbridledRageActiveUntil: 0,
    startingUnbridledRageCooldownUntil: 0,
    disabledAbilities: ["Unbridled Rage"],
  }),
];

const outputPath = resolve("wasm-engine/fixtures/simple_unbridled_rage_fixtures.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");

console.log(`Wrote ${fixtures.length} simple unbridled rage fixtures to ${outputPath}`);
