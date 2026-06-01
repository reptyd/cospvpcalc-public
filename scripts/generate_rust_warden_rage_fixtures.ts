import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { applyRulesAndBuild } from "../src/engine";
import { creatureByName } from "../src/engine/data";
import { buildRuntimeState, EMPTY_BUILD_0 } from "../src/engine/engineTestFixtures";
import { __test_updateWardenRage } from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_warden_rage_fixtures.json");

function getWardenCreature() {
  const creature = Object.values(creatureByName).find((entry) =>
    (entry.passiveAbilities ?? []).some((ability) => ability.name === "Warden's Rage") ||
    (entry.activatedAbilities ?? []).some((ability) => ability.name === "Warden's Rage"),
  );
  if (!creature) throw new Error("No Warden's Rage creature found");
  return creature;
}

function toRustStats(final: ReturnType<typeof applyRulesAndBuild>) {
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

const creature = getWardenCreature();
const opponent = creatureByName["Korathos"];
if (!opponent) throw new Error("Korathos missing");
const final = applyRulesAndBuild(creature, EMPTY_BUILD_0);
const oppFinal = applyRulesAndBuild(opponent, EMPTY_BUILD_0);

const fixtures = [
  (() => {
    const { runtime, state } = buildRuntimeState(final);
    const { runtime: oppRuntime, state: oppState } = buildRuntimeState(oppFinal);
    state.hp = final.health * 0.8;
    __test_updateWardenRage(1, 1, runtime, oppRuntime, state, oppState, true);
    return {
      name: "warden-rage-does-not-waste-high-hp-window",
      attacker: toRustStats(final),
      attackerHp: final.health * 0.8,
      time: 1,
      activesOn: true,
      startingWardenRageOn: false,
      startingWardenRageStacks: 0,
      startingWardenRageTapUntil: 0,
      startingWardenRageCooldownUntil: 0,
      expected: {
        wardenRageOn: state.wardenRageOn,
        wardenRageStacks: state.wardenRageStacks,
        wardenRageTapUntil: state.wardenRageTapUntil,
        wardenRageCooldownUntil: state.wardenRageCooldownUntil,
        abilityAppliedCount: state.abilityAppliedCounts["Warden's Rage"] ?? 0,
      },
    };
  })(),
  (() => {
    const { runtime, state } = buildRuntimeState(final);
    const { runtime: oppRuntime, state: oppState } = buildRuntimeState(oppFinal);
    state.hp = final.health * 0.4;
    __test_updateWardenRage(1, 1, runtime, oppRuntime, state, oppState, true);
    return {
      name: "warden-rage-enable-low-hp",
      attacker: toRustStats(final),
      attackerHp: final.health * 0.4,
      time: 1,
      activesOn: true,
      startingWardenRageOn: false,
      startingWardenRageStacks: 0,
      startingWardenRageTapUntil: 0,
      startingWardenRageCooldownUntil: 0,
      expected: {
        wardenRageOn: state.wardenRageOn,
        wardenRageStacks: state.wardenRageStacks,
        wardenRageTapUntil: state.wardenRageTapUntil,
        wardenRageCooldownUntil: state.wardenRageCooldownUntil,
        abilityAppliedCount: state.abilityAppliedCounts["Warden's Rage"] ?? 0,
      },
    };
  })(),
  (() => {
    const { runtime, state } = buildRuntimeState(final);
    const { runtime: oppRuntime, state: oppState } = buildRuntimeState(oppFinal);
    state.wardenRageOn = true;
    state.wardenRageStacks = 100;
    state.wardenRageTapUntil = 1;
    state.wardenRageCooldownUntil = 31;
    state.hp = final.health;
    __test_updateWardenRage(2, 1, runtime, oppRuntime, state, oppState, true);
    return {
      name: "warden-rage-disable-high-hp",
      attacker: toRustStats(final),
      attackerHp: final.health,
      time: 2,
      activesOn: true,
      startingWardenRageOn: true,
      startingWardenRageStacks: 100,
      startingWardenRageTapUntil: 1,
      startingWardenRageCooldownUntil: 31,
      expected: {
        wardenRageOn: state.wardenRageOn,
        wardenRageStacks: state.wardenRageStacks,
        wardenRageTapUntil: state.wardenRageTapUntil,
        wardenRageCooldownUntil: state.wardenRageCooldownUntil,
        abilityAppliedCount: state.abilityAppliedCounts["Warden's Rage"] ?? 0,
      },
    };
  })(),
  (() => {
    const { runtime, state } = buildRuntimeState(final);
    const { runtime: oppRuntime, state: oppState } = buildRuntimeState(oppFinal);
    state.hp = final.health * 0.4;
    state.wardenRageCooldownUntil = 20;
    __test_updateWardenRage(1, 1, runtime, oppRuntime, state, oppState, true);
    return {
      name: "warden-rage-respects-cooldown-before-reactivation",
      attacker: toRustStats(final),
      attackerHp: final.health * 0.4,
      time: 1,
      activesOn: true,
      startingWardenRageOn: false,
      startingWardenRageStacks: 0,
      startingWardenRageTapUntil: 0,
      startingWardenRageCooldownUntil: 20,
      expected: {
        wardenRageOn: state.wardenRageOn,
        wardenRageStacks: state.wardenRageStacks,
        wardenRageTapUntil: state.wardenRageTapUntil,
        wardenRageCooldownUntil: state.wardenRageCooldownUntil,
        abilityAppliedCount: state.abilityAppliedCounts["Warden's Rage"] ?? 0,
      },
    };
  })(),
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Wrote ${fixtures.length} simple warden rage Rust fixtures to ${outputPath}`);
