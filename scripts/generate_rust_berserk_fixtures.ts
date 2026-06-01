import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  __test_buildCombatantRuntime,
  __test_createCombatantState,
  __test_currentBiteCooldown,
} from "../src/engine/engineTestApi";
import { buildFinalFromCreatureName } from "../src/engine/engineTestFixtures";
import { creatureByName } from "../src/engine/data";

const outputPath = resolve("wasm-engine", "fixtures", "simple_berserk_cooldown_fixtures.json");

type FixtureSeed = {
  name: string;
  hpRatio: number;
  statuses?: Record<string, { stacks: number; nextTickAt?: number; remainingSec?: number }>;
};

function getBerserkCreatureName(): string {
  const creature = Object.values(creatureByName).find((entry) =>
    (entry.passiveAbilities ?? []).some((ability) => ability.name === "Berserk"),
  );
  if (!creature) {
    throw new Error("No Berserk creature found in runtime data");
  }
  return creature.name;
}

function getBerserkData(runtime: ReturnType<typeof __test_buildCombatantRuntime>) {
  const def = runtime.specialDefs.find((entry) => entry.type === "conditionalMultiStat");
  return {
    biteCooldownMultiplier:
      def && "mods" in def && typeof def.mods.biteCooldownMultiplier === "number"
        ? def.mods.biteCooldownMultiplier
        : 1,
    hpRatioThreshold:
      def && "trigger" in def
        ? ((def.trigger.hpRatioLt ?? def.trigger.hpRatioLte ?? 0) as number)
        : 0,
  };
}

const berserkCreatureName = getBerserkCreatureName();

const FIXTURES: FixtureSeed[] = [
  {
    name: "berserk-inactive-high-hp",
    hpRatio: 0.8,
  },
  {
    name: "berserk-active-low-hp",
    hpRatio: 0.1,
  },
  {
    name: "berserk-active-with-status-modifiers",
    hpRatio: 0.1,
    statuses: {
      Drowsy_Status: { stacks: 1, remainingSec: 8 },
      Frostbite_Status: { stacks: 4, remainingSec: 8 },
    },
  },
];

const payload = FIXTURES.map((fixture) => {
  const final = buildFinalFromCreatureName(berserkCreatureName);
  const runtime = __test_buildCombatantRuntime(final);
  const state = __test_createCombatantState(final);
  const berserk = getBerserkData(runtime);

  state.hp = final.health * fixture.hpRatio;
  for (const [statusId, value] of Object.entries(fixture.statuses ?? {})) {
    state.statuses[statusId] = {
      stacks: value.stacks,
      nextTickAt: value.nextTickAt ?? 3,
      remainingSec: value.remainingSec ?? 12,
    };
  }

  return {
    name: fixture.name,
    attacker: {
      health: final.health,
      weight: final.weight,
      damage: final.damage,
      biteCooldown: final.biteCooldown,
      healthRegen: final.healthRegen ?? 0,
      berserkBiteCooldownMultiplier: berserk.biteCooldownMultiplier,
      berserkHpRatioThreshold: berserk.hpRatioThreshold,
      firstStrikePct: 0,
      firstStrikeHpRatioThreshold: 1,
      hasWardenResistance: false,
      hunkerReductionPct: 0,
      onHitStatuses: [],
      onHitTakenStatuses: [],
      startingStatuses: [],
      statusResistFractions: {},
      plushieStatusBlockFractions: {},
    },
    attackerCurrentHp: state.hp,
    startingStatuses: state.statuses,
    expected: {
      biteCooldown: __test_currentBiteCooldown(runtime, state, true),
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.length} simple berserk cooldown Rust fixtures to ${outputPath}`);
