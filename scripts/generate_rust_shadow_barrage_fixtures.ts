import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildFinalFromCreatureName, buildRuntimePair } from "../src/engine/engineTestFixtures";
import {
  __test_handleShadowBarrageHit,
  __test_updateShadowBarrage,
} from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_shadow_barrage_fixtures.json");

const pentagloss = buildFinalFromCreatureName("Pentagloss");

const activationFixtures = [
  {
    name: "shadow-barrage-activation-arms-hits",
    attacker: pentagloss,
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 5,
    lastMeleeHitAt: 1,
    lastMeleeHitDamage: 100,
    cooldownUntil: 0,
    remainingHits: 0,
  },
  {
    name: "shadow-barrage-activation-skips-when-last-hit-too-old",
    attacker: pentagloss,
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 20,
    lastMeleeHitAt: 1,
    lastMeleeHitDamage: 100,
    cooldownUntil: 0,
    remainingHits: 0,
  },
];

const hitFixtures = [
  {
    name: "shadow-barrage-first-hit",
    attacker: pentagloss,
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 6,
    baseDamage: 100,
    remainingHits: 5,
    nextHitAt: 6,
  },
  {
    name: "shadow-barrage-second-hit-dropoff",
    attacker: pentagloss,
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 7,
    baseDamage: 100,
    remainingHits: 4,
    nextHitAt: 7,
  },
];

const activationPayload = activationFixtures.map((fixture) => {
  const pair = buildRuntimePair(fixture.attacker, fixture.defender);
  pair.attacker.state.lastMeleeHitAt = fixture.lastMeleeHitAt;
  pair.attacker.state.lastMeleeHitDamage = fixture.lastMeleeHitDamage;
  pair.attacker.state.shadowBarrageCooldownUntil = fixture.cooldownUntil;
  pair.attacker.state.shadowBarrageRemainingHits = fixture.remainingHits;

  __test_updateShadowBarrage(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );

  return {
    name: fixture.name,
    time: fixture.time,
    lastMeleeHitAt: fixture.lastMeleeHitAt,
    lastMeleeHitDamage: fixture.lastMeleeHitDamage,
    cooldownUntil: fixture.cooldownUntil,
    remainingHits: fixture.remainingHits,
    abilityValue: pair.attacker.runtime.abilityValueByName["Shadow Barrage"] ?? 0,
    expected: {
      shadowBarrageCooldownUntil: pair.attacker.state.shadowBarrageCooldownUntil,
      shadowBarrageBaseDamage: pair.attacker.state.shadowBarrageBaseDamage,
      shadowBarrageRemainingHits: pair.attacker.state.shadowBarrageRemainingHits,
      shadowBarrageNextHitAt: pair.attacker.state.shadowBarrageNextHitAt,
      abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Shadow Barrage"] ?? 0,
    },
  };
});

const hitPayload = hitFixtures.map((fixture) => {
  const pair = buildRuntimePair(fixture.attacker, fixture.defender);
  pair.attacker.state.shadowBarrageBaseDamage = fixture.baseDamage;
  pair.attacker.state.shadowBarrageRemainingHits = fixture.remainingHits;
  pair.attacker.state.shadowBarrageNextHitAt = fixture.nextHitAt;

  __test_handleShadowBarrageHit(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );

  return {
    name: fixture.name,
    time: fixture.time,
    defenderStartingHp: fixture.defender.health,
    baseDamage: fixture.baseDamage,
    totalHits: pair.attacker.runtime.abilityValueByName["Shadow Barrage"] ?? fixture.remainingHits,
    remainingHits: fixture.remainingHits,
    nextHitAt: fixture.nextHitAt,
    plushieOnHitStatuses: pair.attacker.runtime.final.plushieStatusOnHit ?? {},
    attackerApplyStatusOnHit: (pair.attacker.runtime.effects.applyStatusOnHit ?? []).map((status) => ({
      statusId: status.statusId,
      stacks: status.stacks,
    })),
    expected: {
      damageDealt: pair.attacker.state.damageDealt,
      defenderHp: pair.defender.state.hp,
      defenderStatuses: pair.defender.state.statuses,
      shadowBarrageRemainingHits: pair.attacker.state.shadowBarrageRemainingHits,
      shadowBarrageNextHitAt: pair.attacker.state.shadowBarrageNextHitAt,
      abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Shadow Barrage"] ?? 0,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify({ activation: activationPayload, hits: hitPayload }, null, 2)}\n`,
  "utf8",
);
console.log(
  `Wrote ${activationPayload.length + hitPayload.length} simple shadow barrage Rust fixtures to ${outputPath}`,
);
