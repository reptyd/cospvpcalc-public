import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import {
  __test_applyStatusToTarget,
  __test_buildCombatantRuntime,
  __test_createCombatantState,
  __test_handleDotTicks,
  __test_initializeStateForRuntime,
} from "../src/engine/engineTestApi";

const FIXTURES = [
  { name: "poison-single-stack", statusId: "Poison_Status", stacks: 1, maxHp: 1000, tickTime: 3 },
  { name: "burn-four-stacks", statusId: "Burn_Status", stacks: 4, maxHp: 1500, tickTime: 3 },
  { name: "corrosion-many-stacks", statusId: "Corrosion_Status", stacks: 8, maxHp: 2000, tickTime: 3 },
  { name: "bleed-two-stacks", statusId: "Bleed_Status", stacks: 2, maxHp: 1200, tickTime: 3 },
  { name: "sticky-teeth-no-stack", statusId: "Sticky_Teeth_Status", stacks: 1, maxHp: 900, tickTime: 3 },
];

const outputPath = resolve("wasm-engine", "fixtures", "simple_status_ticks.json");

const payload = FIXTURES.map((fixture) => {
  const targetFinal = baseStats({
    name: `Status Target ${fixture.name}`,
    health: fixture.maxHp,
    healthRegen: 0,
  });
  const sourceFinal = baseStats({
    name: `Status Source ${fixture.name}`,
    health: fixture.maxHp,
    healthRegen: 0,
  });
  const targetRuntime = __test_buildCombatantRuntime(targetFinal);
  const sourceRuntime = __test_buildCombatantRuntime(sourceFinal);
  const targetState = __test_createCombatantState(targetFinal);
  const sourceState = __test_createCombatantState(sourceFinal);

  __test_initializeStateForRuntime(targetRuntime, targetState);
  __test_initializeStateForRuntime(sourceRuntime, sourceState);
  __test_applyStatusToTarget(0, targetRuntime, targetState, fixture.statusId, fixture.stacks);
  __test_handleDotTicks(fixture.tickTime, targetRuntime, targetState, sourceState);

  const instance = targetState.statuses[fixture.statusId] ?? null;
  return {
    name: fixture.name,
    statusId: fixture.statusId,
    stacks: fixture.stacks,
    maxHp: fixture.maxHp,
    tickTime: fixture.tickTime,
    expected: {
      hpAfter: targetState.hp,
      sourceDamageDealt: sourceState.damageDealt,
      sourceDotDamageDealt: sourceState.dotDamageDealt,
      status: instance
        ? {
            stacks: instance.stacks,
            nextTickAt: instance.nextTickAt,
            remainingSec: instance.remainingSec,
          }
        : null,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.length} simple status Rust fixtures to ${outputPath}`);
