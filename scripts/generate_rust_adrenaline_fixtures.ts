import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  __test_buildCombatantRuntime,
  __test_createCombatantState,
  __test_updateAdrenaline,
} from "../src/engine/engineTestApi";
import { creatureByName } from "../src/engine/data";
import { buildFinalFromCreatureName } from "../src/engine/engineTestFixtures";

function findCreatureWithAbility(name: string): string {
  const found = Object.values(creatureByName).find((creature) =>
    [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.otherAbilities ?? [])].some(
      (ability) => ability.name === name,
    ),
  );
  if (!found) throw new Error(`No creature found with ability ${name}`);
  return found.name;
}

function fixture(
  name: string,
  time: number,
  startingAdrenalineActiveUntil: number,
  startingAdrenalineCooldownUntil: number,
  disabledAbilities: string[] = [],
) {
  const attackerName = findCreatureWithAbility("Adrenaline");
  const attacker = buildFinalFromCreatureName(attackerName);
  const defender = buildFinalFromCreatureName("Korathos");

  const attackerRuntime = __test_buildCombatantRuntime(attacker);
  const defenderRuntime = __test_buildCombatantRuntime(defender);
  const attackerState = __test_createCombatantState(attacker);
  const defenderState = __test_createCombatantState(defender);

  attackerState.adrenalineActiveUntil = startingAdrenalineActiveUntil;
  attackerState.adrenalineCooldownUntil = startingAdrenalineCooldownUntil;

  __test_updateAdrenaline(
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
    abilityDisabled: disabledAbilities.includes("Adrenaline"),
    startingAdrenalineActiveUntil,
    startingAdrenalineCooldownUntil,
    expected: {
      adrenalineActiveUntil: attackerState.adrenalineActiveUntil,
      adrenalineCooldownUntil: attackerState.adrenalineCooldownUntil,
      abilityAppliedCount:
        attackerState.adrenalineActiveUntil > startingAdrenalineActiveUntil ||
        attackerState.adrenalineCooldownUntil > startingAdrenalineCooldownUntil
          ? 1
          : 0,
    },
  };
}

const fixtures = [
  fixture("adrenaline-activates-when-ready", 10, 0, 0),
  fixture("adrenaline-does-not-reactivate-during-active-window", 11, 25, 90),
  fixture("adrenaline-disabled-no-op", 10, 0, 0, ["Adrenaline"]),
];

const outputPath = resolve("wasm-engine/fixtures/simple_adrenaline_fixtures.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");

console.log(`Wrote ${fixtures.length} simple adrenaline fixtures to ${outputPath}`);
