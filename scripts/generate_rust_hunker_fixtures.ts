import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { creatureByName } from "../src/engine/data";
import { __test_updateHunker } from "../src/engine/engineTestApi";
import {
  buildFinalFromStats,
  buildRuntimePair,
  getEngineCreatureStrict,
} from "../src/engine/engineTestFixtures";
import type { FinalStats } from "../src/engine/types";

const outputPath = resolve("wasm-engine", "fixtures", "simple_hunker_fixtures.json");

type FixtureSeed = {
  name: string;
  attacker: FinalStats;
  defender: FinalStats;
  startingHunkerOn?: boolean;
};

function baseStats(stats: FinalStats): FinalStats {
  return {
    tier: 1,
    hasBreath: false,
    breathType: null,
    approxNotes: [],
    appliedTraits: [],
    healthRegen: 0,
    ...stats,
  };
}

function toRustStats(final: FinalStats, hunkerReductionPct: number) {
  return {
    health: final.health,
    weight: final.weight,
    damage: final.damage,
    biteCooldown: final.biteCooldown,
    healthRegen: final.healthRegen ?? 0,
    firstStrikePct: 0,
    firstStrikeHpRatioThreshold: 1,
    hasWardenResistance: false,
    hunkerReductionPct,
    onHitStatuses: [],
    onHitTakenStatuses: [],
    startingStatuses: [],
    statusResistFractions: {},
    plushieStatusBlockFractions: {},
  };
}

const hunkerCreature =
  Object.values(creatureByName).find((creature) =>
    (creature.passiveAbilities ?? []).some((ability) => ability.name === "Hunker"),
  ) ?? getEngineCreatureStrict("Akorbik");

const FIXTURES: FixtureSeed[] = [
  {
    name: "hunker-enable-fragile-vs-dangerous",
    attacker: baseStats({
      name: hunkerCreature.name,
      health: 3000,
      weight: 500,
      damage: 120,
      biteCooldown: 1,
    }),
    defender: baseStats({
      name: "Korathos",
      health: 5000,
      weight: 800,
      damage: 700,
      biteCooldown: 1,
    }),
  },
  {
    name: "hunker-stay-off-dominant-vs-weak",
    attacker: baseStats({
      name: hunkerCreature.name,
      health: 8000,
      weight: 900,
      damage: 900,
      biteCooldown: 1,
    }),
    defender: baseStats({
      name: "Korathos",
      health: 2500,
      weight: 300,
      damage: 80,
      biteCooldown: 1,
    }),
  },
  {
    name: "hunker-disable-when-already-on-and-dominant",
    attacker: baseStats({
      name: hunkerCreature.name,
      health: 8000,
      weight: 900,
      damage: 900,
      biteCooldown: 1,
    }),
    defender: baseStats({
      name: "Korathos",
      health: 2500,
      weight: 300,
      damage: 80,
      biteCooldown: 1,
    }),
    startingHunkerOn: true,
  },
];

const payload = FIXTURES.map((fixture) => {
  const attackerFinal = buildFinalFromStats(fixture.attacker.name, fixture.attacker);
  const defenderFinal = buildFinalFromStats(fixture.defender.name, fixture.defender);
  const pair = buildRuntimePair(attackerFinal, defenderFinal);
  pair.attacker.state.hunkerOn = fixture.startingHunkerOn ?? false;
  const startingAttackerHp = pair.attacker.state.hp;
  const startingDefenderHp = pair.defender.state.hp;
  __test_updateHunker(
    1,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
    true,
  );

  const hunkerValue = pair.attacker.runtime.abilityValueByName["Hunker"];
  const hunkerReductionPct =
    typeof hunkerValue === "number" && Number.isFinite(hunkerValue)
      ? hunkerValue <= 1
        ? hunkerValue * 100
        : hunkerValue
      : 0;

  return {
    name: fixture.name,
    attacker: toRustStats(attackerFinal, hunkerReductionPct),
    defender: toRustStats(defenderFinal, 0),
    attackerCurrentHp: startingAttackerHp,
    defenderCurrentHp: startingDefenderHp,
    startingHunkerOn: fixture.startingHunkerOn ?? false,
    expected: {
      nextHunkerOn: pair.attacker.state.hunkerOn,
      abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Hunker"] ?? 0,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.length} simple hunker Rust fixtures to ${outputPath}`);
