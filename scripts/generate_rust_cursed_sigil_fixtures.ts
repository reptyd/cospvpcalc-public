import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildRuntimePair } from "../src/engine/engineTestFixtures";
import { __test_handleCursedSigil } from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_cursed_sigil_fixtures.json");

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

const attacker = baseStats({ name: "Anutill", health: 1000 });
const defender = baseStats({ name: "Dummy", health: 1000 });

const fixtures = [
  (() => {
    const pair = buildRuntimePair(attacker, defender);
    __test_handleCursedSigil(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    return {
      name: "cursed-sigil-applies-bad-omen-and-starts-cooldown",
      defender: toRustStats(defender),
      time: 0,
      activesOn: true,
      cursedSigilStacks: pair.attacker.runtime.abilityValueByName["Cursed Sigil"] ?? 0,
      startingDefenderStatuses: {},
      startingCursedSigilCooldownUntil: 0,
      expected: {
        defenderStatuses: pair.defender.state.statuses,
        cursedSigilCooldownUntil: pair.attacker.state.cursedSigilCooldownUntil,
        abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Cursed Sigil"] ?? 0,
      },
    };
  })(),
  (() => {
    const pair = buildRuntimePair(attacker, defender);
    __test_handleCursedSigil(0, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    const firstStatuses = structuredClone(pair.defender.state.statuses);
    __test_handleCursedSigil(1, pair.attacker.runtime, pair.defender.runtime, pair.attacker.state, pair.defender.state);
    return {
      name: "cursed-sigil-respects-cooldown",
      defender: toRustStats(defender),
      time: 1,
      activesOn: true,
      cursedSigilStacks: pair.attacker.runtime.abilityValueByName["Cursed Sigil"] ?? 0,
      startingDefenderStatuses: firstStatuses,
      startingCursedSigilCooldownUntil: 85,
      expected: {
        defenderStatuses: pair.defender.state.statuses,
        cursedSigilCooldownUntil: pair.attacker.state.cursedSigilCooldownUntil,
        abilityAppliedCount: 0,
      },
    };
  })(),
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Wrote ${fixtures.length} simple cursed sigil Rust fixtures to ${outputPath}`);
