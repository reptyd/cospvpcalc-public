import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildFinalFromCreatureName, buildRuntimePair } from "../src/engine/engineTestFixtures";
import { __test_handleMeleeHit } from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_spite_fixtures.json");

function getExplicitOnHitStatuses(runtime: ReturnType<typeof buildRuntimePair>["attacker"]["runtime"]) {
  const statuses: Array<{ statusId: string; stacks: number }> = [];
  for (const ability of runtime.effects.otherAbilities ?? []) {
    if (ability.name === "Wing Shredder") {
      statuses.push({ statusId: "Shredded_Wings", stacks: typeof ability.value === "number" ? ability.value : 1 });
    }
    if (ability.name === "Serrated Teeth") {
      statuses.push({ statusId: "Deep_Wounds_Status", stacks: typeof ability.value === "number" ? ability.value : 1 });
    }
  }
  return statuses;
}

const activationFixtures = [
  {
    name: "spite-positive-arms-after-hit",
    attacker: buildFinalFromCreatureName("Dunklaestus"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1200, damage: 50, biteCooldown: 1 }),
    time: 1,
  },
  {
    name: "spite-negative-with-payload-arms-after-hit",
    attacker: buildFinalFromCreatureName("Leurimess"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 1,
  },
  {
    name: "spite-skips-when-cooldown-active",
    attacker: buildFinalFromCreatureName("Dunklaestus"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1200, damage: 50, biteCooldown: 1 }),
    time: 1,
    presetCooldownUntil: 99,
  },
];

const biteFixtures = [
  {
    name: "spite-positive-full-charge-bite",
    attacker: buildFinalFromCreatureName("Dunklaestus"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1200, damage: 50, biteCooldown: 1 }),
    firstHitAt: 1,
    spiteHitAt: 6,
  },
  {
    name: "spite-negative-full-charge-bite",
    attacker: buildFinalFromCreatureName("Leurimess"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    firstHitAt: 1,
    spiteHitAt: 6,
  },
];

const waitPolicyFixtures = [
  {
    name: "spite-high-positive-delays-for-full-charge",
    attacker: buildFinalFromCreatureName("Fernifly"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    firstHitAt: 1,
  },
];

const activationPayload = activationFixtures.map((fixture) => {
  const pair = buildRuntimePair(fixture.attacker, fixture.defender);
  if (fixture.presetCooldownUntil) {
    pair.attacker.state.spiteCooldownUntil = fixture.presetCooldownUntil;
  }
  __test_handleMeleeHit(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );

  return {
    name: fixture.name,
    time: fixture.time,
    spiteValue: pair.attacker.runtime.abilityValueByName["Spite"] ?? 0,
    cooldownUntil: fixture.presetCooldownUntil ?? 0,
    alreadyArmed: false,
    hasOffensivePayload:
      (pair.attacker.runtime.effects.applyStatusOnHit?.length ?? 0) > 0 ||
      (pair.attacker.runtime.final.plushieStatusOnHit && Object.keys(pair.attacker.runtime.final.plushieStatusOnHit).length > 0) ||
      pair.attacker.runtime.hasLichMark ||
      getExplicitOnHitStatuses(pair.attacker.runtime).length > 0,
    expected: {
      spiteArmed: pair.attacker.state.spiteArmed,
      spiteChargeReadyAt: pair.attacker.state.spiteChargeReadyAt,
      spiteCooldownUntil: pair.attacker.state.spiteCooldownUntil,
      abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Spite"] ?? 0,
    },
  };
});

const bitePayload = biteFixtures.map((fixture) => {
  const pair = buildRuntimePair(fixture.attacker, fixture.defender);
  __test_handleMeleeHit(
    fixture.firstHitAt,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );
  const firstHitDamage = pair.attacker.state.damageDealt;
  const defenderStartingStatuses = structuredClone(pair.defender.state.statuses);
  const defenderHpBeforeSpite = pair.defender.state.hp;
  const damageBeforeSpite = pair.attacker.state.damageDealt;
  const startingAbilityAppliedCount = pair.attacker.state.abilityAppliedCounts["Spite"] ?? 0;

  __test_handleMeleeHit(
    fixture.spiteHitAt,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );

  return {
    name: fixture.name,
    time: fixture.spiteHitAt,
    baseDamage: firstHitDamage,
    spiteValue: pair.attacker.runtime.abilityValueByName["Spite"] ?? 0,
    spiteChargeReadyAt: fixture.firstHitAt + 5,
    defenderStartingHp: defenderHpBeforeSpite,
    defenderMaxHp: fixture.defender.health,
    attackerApplyStatusOnHit: (pair.attacker.runtime.effects.applyStatusOnHit ?? []).map((status) => ({
      statusId: status.statusId,
      stacks: status.stacks,
    })),
    attackerExplicitStatuses: getExplicitOnHitStatuses(pair.attacker.runtime),
    plushieOnHitStatuses: pair.attacker.runtime.final.plushieStatusOnHit ?? {},
    defenderStartingStatuses,
    startingAbilityAppliedCount,
    expected: {
      damageDelta: pair.attacker.state.damageDealt - damageBeforeSpite,
      defenderHp: pair.defender.state.hp,
      defenderStatuses: pair.defender.state.statuses,
      spiteArmed: pair.attacker.state.spiteArmed,
      spiteChargeReadyAt: pair.attacker.state.spiteChargeReadyAt,
      abilityAppliedCount: pair.attacker.state.abilityAppliedCounts["Spite"] ?? 0,
    },
  };
});

const waitPolicyPayload = waitPolicyFixtures.map((fixture) => {
  const pair = buildRuntimePair(fixture.attacker, fixture.defender);
  __test_handleMeleeHit(
    fixture.firstHitAt,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );

  const secondHitTime = fixture.firstHitAt + fixture.attacker.biteCooldown;
  pair.attacker.state.nextHitAt = secondHitTime;
  const damageBeforeRetry = pair.attacker.state.damageDealt;
  __test_handleMeleeHit(
    secondHitTime,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );

  return {
    name: fixture.name,
    time: secondHitTime,
    baseDamage:
      ((pair.attacker.runtime.final.damage * (1 + Math.min(8, pair.attacker.runtime.final.weight / Math.max(1, pair.defender.runtime.final.weight)))) / 2),
    spiteValue: pair.attacker.runtime.abilityValueByName["Spite"] ?? 0,
    spiteChargeReadyAt: fixture.firstHitAt + 5,
    attackerHp: pair.attacker.runtime.final.health,
    attackerCurrentHp: pair.attacker.runtime.final.health,
    attackerMaxHp: pair.attacker.runtime.final.health,
    attackerBiteCooldown: pair.attacker.runtime.final.biteCooldown,
    defenderDamage: pair.defender.runtime.final.damage,
    defenderBiteCooldown: pair.defender.runtime.final.biteCooldown,
    expected: {
      shouldDelay: pair.attacker.state.damageDealt === damageBeforeRetry,
      nextHitAt: pair.attacker.state.nextHitAt,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify({ activation: activationPayload, bites: bitePayload, waitPolicy: waitPolicyPayload }, null, 2)}\n`,
  "utf8",
);
console.log(
  `Wrote ${activationPayload.length + bitePayload.length + waitPolicyPayload.length} simple spite Rust fixtures to ${outputPath}`,
);
