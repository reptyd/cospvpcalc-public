import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  __test_buildCombatantRuntime,
  __test_createCombatantState,
  __test_updateHuntersCurse,
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
    damage: 600,
    biteCooldown: 1,
  });
}

function buildCustomDefender(name: string) {
  const base = buildFinalFromCreatureName(name);
  return buildFinalFromStats(name, {
    ...base,
    health: 1000,
    damage: 120,
    biteCooldown: 2,
  });
}

function fixture(
  name: string,
  {
    time,
    attackerHp,
    defenderHp,
    startingHuntersCurseActiveUntil,
    startingHuntersCurseCooldownUntil,
    disabledAbilities = [],
  }: {
    time: number;
    attackerHp: number;
    defenderHp: number;
    startingHuntersCurseActiveUntil: number;
    startingHuntersCurseCooldownUntil: number;
    disabledAbilities?: string[];
  },
) {
  const attackerName = findCreatureWithAbility("Hunters Curse");
  const attacker = buildCustomAttacker(attackerName);
  const defender = buildCustomDefender("Korathos");

  const attackerRuntime = __test_buildCombatantRuntime(attacker);
  const defenderRuntime = __test_buildCombatantRuntime(defender);
  const attackerState = __test_createCombatantState(attacker);
  const defenderState = __test_createCombatantState(defender);

  attackerState.hp = attackerHp;
  defenderState.hp = defenderHp;
  attackerState.huntersCurseActiveUntil = startingHuntersCurseActiveUntil;
  attackerState.huntersCurseCooldownUntil = startingHuntersCurseCooldownUntil;

  __test_updateHuntersCurse(
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
    abilityDisabled: disabledAbilities.includes("Hunters Curse"),
    attacker,
    defender,
    attackerHp,
    defenderHp,
    startingHuntersCurseActiveUntil,
    startingHuntersCurseCooldownUntil,
    expected: {
      attackerHp: attackerState.hp,
      huntersCurseActiveUntil: attackerState.huntersCurseActiveUntil,
      huntersCurseCooldownUntil: attackerState.huntersCurseCooldownUntil,
      abilityAppliedCount:
        attackerState.huntersCurseActiveUntil > startingHuntersCurseActiveUntil ||
        attackerState.huntersCurseCooldownUntil > startingHuntersCurseCooldownUntil
          ? 1
          : 0,
    },
  };
}

const fixtures = [
  fixture("hunters-curse-activates-when-ready", {
    time: 10,
    attackerHp: 1000,
    defenderHp: 900,
    startingHuntersCurseActiveUntil: 0,
    startingHuntersCurseCooldownUntil: 0,
  }),
  fixture("hunters-curse-skips-when-attacker-too-low", {
    time: 10,
    attackerHp: 700,
    defenderHp: 900,
    startingHuntersCurseActiveUntil: 0,
    startingHuntersCurseCooldownUntil: 0,
  }),
  fixture("hunters-curse-skips-when-defender-too-low", {
    time: 10,
    attackerHp: 1000,
    defenderHp: 150,
    startingHuntersCurseActiveUntil: 0,
    startingHuntersCurseCooldownUntil: 0,
  }),
  fixture("hunters-curse-disabled-no-op", {
    time: 10,
    attackerHp: 1000,
    defenderHp: 900,
    startingHuntersCurseActiveUntil: 0,
    startingHuntersCurseCooldownUntil: 0,
    disabledAbilities: ["Hunters Curse"],
  }),
];

const outputPath = resolve("wasm-engine/fixtures/simple_hunters_curse_fixtures.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");

console.log(`Wrote ${fixtures.length} simple hunters curse fixtures to ${outputPath}`);
