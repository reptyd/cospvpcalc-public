import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseStats } from "../src/engine/engine.test.helpers";
import { buildFinalFromCreatureName, buildRuntimePair } from "../src/engine/engineTestFixtures";
import {
  __test_updateSpite,
  __test_updateRadiation,
  __test_updateReflux,
  __test_updateRewind,
  __test_updateHuntersCurse,
  __test_handleFrostNova,
  __test_handleCursedSigil,
  __test_handleFrostSnare,
  __test_handleThornTrap,
  __test_updateShadowBarrage,
} from "../src/engine/engineTestApi";

const outputPath = resolve("wasm-engine", "fixtures", "simple_active_timing_fixtures.json");

type StatusShape = {
  stacks: number;
  nextTickAt: number | null;
  remainingSec: number;
};

const FIXTURES = [
  {
    name: "active-update-rewind-then-frost-snare",
    attacker: buildFinalFromCreatureName("Hellion Warden"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 9,
    snapshotHp: 6000,
    snapshotStatuses: {
      Burn_Status: { stacks: 3, nextTickAt: 3, remainingSec: 9 },
    } satisfies Record<string, StatusShape>,
    currentHp: 4000,
    currentStatuses: {
      Burn_Status: { stacks: 9, nextTickAt: 3, remainingSec: 9 },
      Poison_Status: { stacks: 4, nextTickAt: 3, remainingSec: 9 },
    } satisfies Record<string, StatusShape>,
    forceFrostSnare: true,
  },
  {
    name: "active-update-shadow-barrage-arms-after-last-hit",
    attacker: buildFinalFromCreatureName("Pentagloss"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 5,
    lastMeleeHitAt: 1,
    lastMeleeHitDamage: 100,
  },
  {
    name: "active-update-spite-only-maintains-armed-state",
    attacker: buildFinalFromCreatureName("Dunklaestus"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1200, damage: 50, biteCooldown: 1 }),
    time: 3,
    spiteArmed: true,
    spiteChargeReadyAt: 6,
  },
  {
    name: "active-update-radiation-applies-close-range-corrosion",
    attacker: buildFinalFromCreatureName("Oxytalis"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1200, damage: 50, biteCooldown: 1 }),
    time: 1,
    radiationNextTickAt: 1,
  },
  {
    name: "active-update-reflux-arms-charge",
    attacker: buildFinalFromCreatureName("Gholbini"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1600, damage: 50, biteCooldown: 1 }),
    time: 0,
  },
  {
    name: "active-update-reflux-impacts-after-charge",
    attacker: buildFinalFromCreatureName("Gholbini"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1600, damage: 50, biteCooldown: 1 }),
    time: 5,
    refluxArmed: true,
    refluxChargeReadyAt: 5,
  },
  {
    name: "active-update-reflux-puddle-ticks-corrosion",
    attacker: buildFinalFromCreatureName("Gholbini"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1600, damage: 50, biteCooldown: 1 }),
    time: 6,
    refluxPuddleUntil: 15,
    refluxNextTickAt: 6,
    defenderStatuses: {
      Slow_Status: { stacks: 2, nextTickAt: null, remainingSec: 6 },
    } satisfies Record<string, StatusShape>,
    defenderHp: 11400,
  },
  {
    name: "active-update-cursed-sigil-applies-bad-omen",
    attacker: buildFinalFromCreatureName("Lithumbra"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1200, damage: 50, biteCooldown: 1 }),
    time: 0,
    forceCursedSigil: true,
  },
  {
    name: "active-update-thorn-trap-applies-bleed-and-freeze",
    attacker: buildFinalFromCreatureName("Skulderouge"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1200, damage: 50, biteCooldown: 1 }),
    time: 0,
    forceThornTrap: true,
  },
  {
    name: "active-update-frost-nova-deals-burst-and-applies-frostbite",
    attacker: buildFinalFromCreatureName("Avothius"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 0,
    forceFrostNova: true,
  },
  {
    name: "active-update-hunters-curse-spends-hp-and-arms-buff",
    attacker: buildFinalFromCreatureName("Novus Warden"),
    defender: baseStats({ name: "Dummy", health: 12000, weight: 1400, damage: 50, biteCooldown: 1 }),
    time: 0,
    forceHuntersCurse: true,
  },
];

const payload = FIXTURES.map((fixture) => {
  const pair = buildRuntimePair(fixture.attacker, fixture.defender);

  if ("snapshotHp" in fixture) {
    pair.attacker.state.hp = fixture.currentHp;
    pair.attacker.state.statuses = structuredClone(fixture.currentStatuses);
    pair.attacker.state.rewindHistory = [
      {
        time: 0,
        hp: fixture.snapshotHp,
        statuses: structuredClone(fixture.snapshotStatuses),
      },
    ];
  }

  if ("lastMeleeHitAt" in fixture) {
    pair.attacker.state.lastMeleeHitAt = fixture.lastMeleeHitAt;
    pair.attacker.state.lastMeleeHitDamage = fixture.lastMeleeHitDamage;
  }

  if ("spiteArmed" in fixture) {
    pair.attacker.state.spiteArmed = fixture.spiteArmed;
    pair.attacker.state.spiteChargeReadyAt = fixture.spiteChargeReadyAt;
  }
  if ("radiationNextTickAt" in fixture) {
    pair.attacker.state.radiationNextTickAt = fixture.radiationNextTickAt;
  }
  if ("refluxArmed" in fixture) {
    pair.attacker.state.refluxArmed = fixture.refluxArmed;
  }
  if ("refluxChargeReadyAt" in fixture) {
    pair.attacker.state.refluxChargeReadyAt = fixture.refluxChargeReadyAt;
  }
  if ("refluxPuddleUntil" in fixture) {
    pair.attacker.state.refluxPuddleUntil = fixture.refluxPuddleUntil;
  }
  if ("refluxNextTickAt" in fixture) {
    pair.attacker.state.refluxNextTickAt = fixture.refluxNextTickAt;
  }
  if ("defenderStatuses" in fixture) {
    pair.defender.state.statuses = structuredClone(fixture.defenderStatuses);
  }
  if ("defenderHp" in fixture) {
    pair.defender.state.hp = fixture.defenderHp;
  }

  __test_updateSpite(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );
  __test_updateRadiation(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );
  __test_updateReflux(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );
  __test_updateRewind(
    fixture.time,
    pair.attacker.runtime,
    pair.defender.runtime,
    pair.attacker.state,
    pair.defender.state,
  );
  if ("forceFrostSnare" in fixture && fixture.forceFrostSnare) {
    pair.attacker.runtime.hasFrostSnare = true;
    __test_handleFrostSnare(
      fixture.time,
      pair.attacker.runtime,
      pair.defender.runtime,
      pair.attacker.state,
      pair.defender.state,
    );
  }
  if ("forceFrostNova" in fixture && fixture.forceFrostNova) {
    __test_handleFrostNova(
      fixture.time,
      pair.attacker.runtime,
      pair.defender.runtime,
      pair.attacker.state,
      pair.defender.state,
    );
  }
  if ("forceHuntersCurse" in fixture && fixture.forceHuntersCurse) {
    __test_updateHuntersCurse(
      fixture.time,
      pair.attacker.runtime,
      pair.defender.runtime,
      pair.attacker.state,
      pair.defender.state,
    );
  }
  if ("forceCursedSigil" in fixture && fixture.forceCursedSigil) {
    __test_handleCursedSigil(
      fixture.time,
      pair.attacker.runtime,
      pair.defender.runtime,
      pair.attacker.state,
      pair.defender.state,
    );
  }
  if ("forceThornTrap" in fixture && fixture.forceThornTrap) {
    __test_handleThornTrap(
      fixture.time,
      pair.attacker.runtime,
      pair.defender.runtime,
      pair.attacker.state,
      pair.defender.state,
    );
  }
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
    starting: {
      maxHp: fixture.attacker.health,
      attackerDamage: pair.attacker.runtime.final.damage,
      attackerBiteCooldown: pair.attacker.runtime.final.biteCooldown,
      hp: "currentHp" in fixture ? fixture.currentHp : pair.attacker.runtime.final.health,
      statuses: "currentStatuses" in fixture ? fixture.currentStatuses : {},
      defenderHp: "defenderHp" in fixture ? fixture.defenderHp : fixture.defender.health,
      defenderMaxHp: fixture.defender.health,
      defenderDamage: pair.defender.runtime.final.damage,
      defenderBiteCooldown: pair.defender.runtime.final.biteCooldown,
      defenderStatuses: "defenderStatuses" in fixture ? fixture.defenderStatuses : {},
      rewindSnapshotHp: "snapshotHp" in fixture ? fixture.snapshotHp : null,
      rewindSnapshotStatuses: "snapshotStatuses" in fixture ? fixture.snapshotStatuses : {},
      lastMeleeHitAt: "lastMeleeHitAt" in fixture ? fixture.lastMeleeHitAt : -1,
      lastMeleeHitDamage: "lastMeleeHitDamage" in fixture ? fixture.lastMeleeHitDamage : 0,
      spiteArmed: "spiteArmed" in fixture ? fixture.spiteArmed : false,
      spiteChargeReadyAt: "spiteChargeReadyAt" in fixture ? fixture.spiteChargeReadyAt : 0,
      radiationNextTickAt: "radiationNextTickAt" in fixture ? fixture.radiationNextTickAt : pair.attacker.state.radiationNextTickAt,
      spiteValue: pair.attacker.runtime.abilityValueByName["Spite"] ?? null,
      radiationAvailable: pair.attacker.state.radiationNextTickAt !== null || "radiationNextTickAt" in fixture,
      refluxAvailable: pair.attacker.runtime.hasReflux,
      refluxArmed: "refluxArmed" in fixture ? fixture.refluxArmed : false,
      refluxChargeReadyAt: "refluxChargeReadyAt" in fixture ? fixture.refluxChargeReadyAt : 0,
      refluxPuddleUntil: "refluxPuddleUntil" in fixture ? fixture.refluxPuddleUntil : 0,
      refluxNextTickAt: "refluxNextTickAt" in fixture ? fixture.refluxNextTickAt : null,
      rewindAvailable: pair.attacker.runtime.hasRewind,
      startingAdrenalineActiveUntil: pair.attacker.state.adrenalineActiveUntil,
      startingAdrenalineCooldownUntil: pair.attacker.state.adrenalineCooldownUntil,
      frostNovaAvailable: Boolean("forceFrostNova" in fixture && fixture.forceFrostNova),
      frostNovaValue: pair.attacker.runtime.abilityValueByName["Frost Nova"] ?? null,
      startingFrostNovaCooldownUntil:
        "startingFrostNovaCooldownUntil" in fixture ? fixture.startingFrostNovaCooldownUntil : 0,
      fortifyAvailable: pair.attacker.runtime.effects.otherAbilities?.some((ability) => ability.name === "Fortify") ?? false,
      huntersCurseAvailable: Boolean("forceHuntersCurse" in fixture && fixture.forceHuntersCurse),
      unbridledRageAvailable: false,
      frostSnareAvailable: Boolean("forceFrostSnare" in fixture && fixture.forceFrostSnare),
      cursedSigilAvailable: Boolean("forceCursedSigil" in fixture && fixture.forceCursedSigil),
      cursedSigilStacks: pair.attacker.runtime.abilityValueByName["Cursed Sigil"] ?? 0,
      thornTrapAvailable: Boolean("forceThornTrap" in fixture && fixture.forceThornTrap),
      shadowBarrageAvailable: pair.attacker.runtime.hasShadowBarrage,
      shadowBarrageValue: pair.attacker.runtime.abilityValueByName["Shadow Barrage"] ?? 0,
    },
    expected: {
      attackerHp: pair.attacker.state.hp,
      attackerStatuses: pair.attacker.state.statuses,
      defenderHp: pair.defender.state.hp,
      defenderStatuses: pair.defender.state.statuses,
      spiteArmed: pair.attacker.state.spiteArmed,
      spiteChargeReadyAt: pair.attacker.state.spiteChargeReadyAt,
      radiationNextTickAt: pair.attacker.state.radiationNextTickAt,
      refluxArmed: pair.attacker.state.refluxArmed,
      refluxChargeReadyAt: pair.attacker.state.refluxChargeReadyAt,
      refluxPuddleUntil: pair.attacker.state.refluxPuddleUntil,
      refluxNextTickAt: pair.attacker.state.refluxNextTickAt,
      rewindCooldownUntil: pair.attacker.state.rewindCooldownUntil,
      adrenalineActiveUntil: pair.attacker.state.adrenalineActiveUntil,
      adrenalineCooldownUntil: pair.attacker.state.adrenalineCooldownUntil,
      huntersCurseActiveUntil: pair.attacker.state.huntersCurseActiveUntil,
      huntersCurseCooldownUntil: pair.attacker.state.huntersCurseCooldownUntil,
      unbridledRageActiveUntil: 0,
      unbridledRageCooldownUntil: 0,
      frostNovaCooldownUntil: pair.attacker.state.frostNovaCooldownUntil,
      frostSnareCooldownUntil: pair.attacker.state.frostSnareCooldownUntil,
      cursedSigilCooldownUntil: pair.attacker.state.cursedSigilCooldownUntil,
      thornTrapCooldownUntil: pair.attacker.state.thornTrapCooldownUntil,
      shadowBarrageCooldownUntil: pair.attacker.state.shadowBarrageCooldownUntil,
      shadowBarrageBaseDamage: pair.attacker.state.shadowBarrageBaseDamage,
      shadowBarrageRemainingHits: pair.attacker.state.shadowBarrageRemainingHits,
      shadowBarrageNextHitAt: pair.attacker.state.shadowBarrageNextHitAt,
      abilityAppliedCounts: pair.attacker.state.abilityAppliedCounts,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.length} simple active timing Rust fixtures to ${outputPath}`);
