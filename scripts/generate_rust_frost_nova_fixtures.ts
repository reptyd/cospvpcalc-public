import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildFinalFromCreatureName, buildRuntimePair } from "../src/engine/engineTestFixtures";
import { __test_handleFrostNova } from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_frost_nova_fixtures.json");

type StatusShape = {
  stacks: number;
  nextTickAt: number | null;
  remainingSec: number;
};

const attacker = buildFinalFromCreatureName("Avothius");
const defender = baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 });

const fixtures = [
  {
    name: "frost-nova-deals-burst-and-applies-frostbite",
    time: 0,
    activesOn: true,
    startingDefenderHp: defender.health,
    startingDefenderStatuses: {} as Record<string, StatusShape>,
    startingFrostNovaCooldownUntil: 0,
  },
  {
    name: "frost-nova-respects-cooldown",
    time: 5,
    activesOn: true,
    startingDefenderHp: defender.health,
    startingDefenderStatuses: {} as Record<string, StatusShape>,
    startingFrostNovaCooldownUntil: 10,
  },
];

const payload = fixtures.map((fixture) => {
  const pair = buildRuntimePair(attacker, defender);
  pair.attacker.state.frostNovaCooldownUntil = fixture.startingFrostNovaCooldownUntil;
  pair.defender.state.hp = fixture.startingDefenderHp;
  pair.defender.state.statuses = structuredClone(fixture.startingDefenderStatuses);

  __test_handleFrostNova(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );

  return {
    name: fixture.name,
    time: fixture.time,
    attacker: {
      health: pair.attacker.runtime.final.health,
      weight: pair.attacker.runtime.final.weight,
      damage: pair.attacker.runtime.final.damage,
      biteCooldown: pair.attacker.runtime.final.biteCooldown,
      healthRegen: pair.attacker.runtime.final.healthRegen ?? 0,
      damageTakenMultiplierOnBeingBitten: 1,
      berserkBiteCooldownMultiplier: 1,
      berserkHpRatioThreshold: 0,
      firstStrikePct: 0,
      firstStrikeHpRatioThreshold: 1,
      hasWardenResistance: false,
      immuneStatusIds: [],
      hunkerReductionPct: 0,
      onHitStatuses: [],
      onHitTakenStatuses: [],
      startingStatuses: [],
      statusResistFractions: {},
      plushieStatusBlockFractions: {},
    },
    defender: {
      health: defender.health,
      weight: defender.weight,
      damage: defender.damage,
      biteCooldown: defender.biteCooldown,
      healthRegen: defender.healthRegen ?? 0,
      damageTakenMultiplierOnBeingBitten: 1,
      berserkBiteCooldownMultiplier: 1,
      berserkHpRatioThreshold: 0,
      firstStrikePct: 0,
      firstStrikeHpRatioThreshold: 1,
      hasWardenResistance: false,
      immuneStatusIds: [],
      hunkerReductionPct: 0,
      onHitStatuses: [],
      onHitTakenStatuses: [],
      startingStatuses: [],
      statusResistFractions: {},
      plushieStatusBlockFractions: {},
    },
    activesOn: fixture.activesOn,
    frostNovaValue: pair.attacker.runtime.abilityValueByName["Frost Nova"] ?? null,
    startingDefenderHp: fixture.startingDefenderHp,
    startingDefenderStatuses: fixture.startingDefenderStatuses,
    startingFrostNovaCooldownUntil: fixture.startingFrostNovaCooldownUntil,
    expected: {
      defenderHp: pair.defender.state.hp,
      defenderStatuses: pair.defender.state.statuses,
      frostNovaCooldownUntil: pair.attacker.state.frostNovaCooldownUntil,
      abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Frost Nova"] ?? 0,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.length} simple frost nova Rust fixtures to ${outputPath}`);
