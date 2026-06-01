import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildFinalFromCreatureName, buildFinalFromStats, buildRuntimePair } from "../src/engine/engineTestFixtures";
import { __test_handleMeleeHit, __test_updateLifeLeech } from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_life_leech_fixtures.json");

function toRustStats(final: ReturnType<typeof buildFinalFromCreatureName>) {
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

const attacker = buildFinalFromCreatureName("Korathos");
const defender = baseStats({ name: "Dummy", health: 50000, weight: 50000, damage: 240, biteCooldown: 1 });

const activationFixtures = [
  (() => {
    const pair = buildRuntimePair(attacker, defender);
    pair.attacker.state.hp = attacker.health * 0.3;
    __test_updateLifeLeech(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state, true, "fast");
    return {
      name: "life-leech-activate-low-hp",
      attacker: toRustStats(attacker),
      defender: toRustStats(defender),
      attackerHp: attacker.health * 0.3,
      defenderHp: defender.health,
      time: 0,
      activesOn: true,
      abilityPolicy: "fast",
      startingLifeLeechActiveUntil: 0,
      startingLifeLeechCooldownUntil: 0,
      expected: {
        lifeLeechActiveUntil: pair.attacker.state.lifeLeechActiveUntil,
        lifeLeechCooldownUntil: pair.attacker.state.lifeLeechCooldownUntil,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Life Leech"] ?? 0,
      },
    };
  })(),
  (() => {
    const pair = buildRuntimePair(attacker, defender);
    pair.attacker.state.hp = attacker.health;
    __test_updateLifeLeech(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state, true, "fast");
    return {
      name: "life-leech-skip-full-hp",
      attacker: toRustStats(attacker),
      defender: toRustStats(defender),
      attackerHp: attacker.health,
      defenderHp: defender.health,
      time: 0,
      activesOn: true,
      abilityPolicy: "fast",
      startingLifeLeechActiveUntil: 0,
      startingLifeLeechCooldownUntil: 0,
      expected: {
        lifeLeechActiveUntil: pair.attacker.state.lifeLeechActiveUntil,
        lifeLeechCooldownUntil: pair.attacker.state.lifeLeechCooldownUntil,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Life Leech"] ?? 0,
      },
    };
  })(),
  (() => {
    const searchDefender = buildFinalFromStats(
      "LifeLeechSearchDummy",
      baseStats({ name: "LifeLeechSearchDummy", health: 16000, weight: 50000, damage: 240, biteCooldown: 1, healthRegen: 0 }),
    );
    const pair = buildRuntimePair(attacker, searchDefender);
    pair.attacker.state.hp = attacker.health * 0.45;
    __test_updateLifeLeech(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state, true, "fast");
    return {
      name: "life-leech-fast-skip-mid-hp-search-window",
      attacker: toRustStats(attacker),
      defender: toRustStats(searchDefender),
      attackerHp: attacker.health * 0.45,
      defenderHp: searchDefender.health,
      time: 0,
      activesOn: true,
      abilityPolicy: "fast",
      startingLifeLeechActiveUntil: 0,
      startingLifeLeechCooldownUntil: 0,
      expected: {
        lifeLeechActiveUntil: pair.attacker.state.lifeLeechActiveUntil,
        lifeLeechCooldownUntil: pair.attacker.state.lifeLeechCooldownUntil,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Life Leech"] ?? 0,
      },
    };
  })(),
  (() => {
    const searchDefender = buildFinalFromStats(
      "LifeLeechSearchDummy",
      baseStats({ name: "LifeLeechSearchDummy", health: 16000, weight: 50000, damage: 240, biteCooldown: 1, healthRegen: 0 }),
    );
    const pair = buildRuntimePair(attacker, searchDefender);
    pair.attacker.state.hp = attacker.health * 0.45;
    __test_updateLifeLeech(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state, true, "semiIdeal");
    return {
      name: "life-leech-semi-ideal-activate-mid-hp-search-window",
      attacker: toRustStats(attacker),
      defender: toRustStats(searchDefender),
      attackerHp: attacker.health * 0.45,
      defenderHp: searchDefender.health,
      time: 0,
      activesOn: true,
      abilityPolicy: "semiIdeal",
      startingLifeLeechActiveUntil: 0,
      startingLifeLeechCooldownUntil: 0,
      expected: {
        lifeLeechActiveUntil: pair.attacker.state.lifeLeechActiveUntil,
        lifeLeechCooldownUntil: pair.attacker.state.lifeLeechCooldownUntil,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Life Leech"] ?? 0,
      },
    };
  })(),
];

const hitFixtures = [
  (() => {
    const pair = buildRuntimePair(attacker, defender);
    pair.attacker.state.hp = attacker.health * 0.5;
    pair.attacker.state.lifeLeechActiveUntil = 10;
    const startingHp = pair.attacker.state.hp;
    __test_handleMeleeHit(1, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    return {
      name: "life-leech-hit-heals-during-active-window",
      attacker: toRustStats(attacker),
      attackerHp: startingHp,
      damageDealt: pair.attacker.state.damageDealt,
      time: 1,
      activesOn: true,
      lifeLeechActiveUntil: 10,
      expected: {
        attackerHp: pair.attacker.state.hp,
        lifeLeechHealedDelta: pair.attacker.state.lifeLeechHealed,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Life Leech"] ?? 0,
      },
    };
  })(),
  (() => {
    const pair = buildRuntimePair(attacker, defender);
    pair.attacker.state.hp = attacker.health * 0.5;
    pair.attacker.state.lifeLeechActiveUntil = 0;
    const startingHp = pair.attacker.state.hp;
    __test_handleMeleeHit(1, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    return {
      name: "life-leech-hit-does-not-heal-outside-window",
      attacker: toRustStats(attacker),
      attackerHp: startingHp,
      damageDealt: pair.attacker.state.damageDealt,
      time: 1,
      activesOn: true,
      lifeLeechActiveUntil: 0,
      expected: {
        attackerHp: pair.attacker.state.hp,
        lifeLeechHealedDelta: pair.attacker.state.lifeLeechHealed,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Life Leech"] ?? 0,
      },
    };
  })(),
];

const payload = {
  activation: activationFixtures,
  hits: hitFixtures,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote life leech Rust fixtures to ${outputPath}`);
