/**
 * Regenerates wasm-engine/fixtures/simple_life_leech_breath_matchups.json from TS oracle.
 *
 * Derives `specialKind`, `selfHealPct`, and `specialStatuses` from breath name + raw text
 * so that Rust composable (which reads structured fields) matches TS runtime (which uses
 * hardcoded name matches + raw-text parsing).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { applyRulesAndBuild, simulateFight, type AbilityTimingMode } from "../src/engine";
import { breathSpecByName } from "../src/engine/data";
import { buildRuntimePair, getEngineCreatureStrict } from "../src/engine/engineTestFixtures";
import { projectBestBuildsMatchupSummary } from "../src/optimizer/bestBuildsMatchupContract";
import {
  getRustBlockingActivatedAbilityNamesForPassiveContours,
  getRustUnsupportedPassiveAbilityNamesForBreath,
} from "../src/optimizer/rustBestBuildsRuntime";
import { parseBreathAilments, resolveStatusId } from "../src/engine/runtimeHelpers";

const outputPath = resolve("wasm-engine", "fixtures", "simple_life_leech_breath_matchups.json");

type FixtureSeed = {
  name: string;
  attackerName: string;
  defenderName: string;
  disabledAbilitiesA?: string[];
  disabledAbilitiesB?: string[];
  maxTimeSec: number;
  abilityPolicy: AbilityTimingMode;
};

const FIXTURES: FixtureSeed[] = [
  {
    name: "life-leech-breath-korathos-vs-morthorax",
    attackerName: "Korathos",
    defenderName: "Morthorax",
    disabledAbilitiesA: ["Charge", "Iron Stomach", "Lich Mark", "Thorn Trap"],
    disabledAbilitiesB: ["Iron Stomach", "Necropoison Attack", "Disease Attack"],
    maxTimeSec: 24,
    abilityPolicy: "fast",
  },
  {
    name: "life-leech-breath-korathos-vs-morthorax-semi-ideal",
    attackerName: "Korathos",
    defenderName: "Morthorax",
    disabledAbilitiesA: ["Charge", "Iron Stomach", "Lich Mark", "Thorn Trap"],
    disabledAbilitiesB: ["Iron Stomach", "Necropoison Attack", "Disease Attack"],
    maxTimeSec: 24,
    abilityPolicy: "semiIdeal",
  },
];

function buildFinal(name: string) {
  return applyRulesAndBuild(getEngineCreatureStrict(name), {
    venerationStage: 0,
    traits: [],
    ascensionAssignments: ["", "", "", "", ""],
    plushies: [],
  });
}

function projectSelfDestructProfile(
  runtime: ReturnType<typeof buildRuntimePair>["attacker"]["runtime"],
  disabledAbilities: string[],
) {
  if (disabledAbilities.includes("Self-Destruct")) return null;
  const selfDestruct = runtime.specialDefs.find((def) => def.type === "conditionalDelayedExplosion");
  if (!selfDestruct) return null;
  const triggerHpRatioLte =
    "hpRatioLte" in selfDestruct.trigger && selfDestruct.trigger.hpRatioLte != null
      ? selfDestruct.trigger.hpRatioLte
      : "hpRatioLt" in selfDestruct.trigger && selfDestruct.trigger.hpRatioLt != null
        ? selfDestruct.trigger.hpRatioLt
        : 0;
  return {
    triggerHpRatioLte,
    damagePct: selfDestruct.onExplode.dealDamage.pct,
    selfHpFloorPct: selfDestruct.selfAfterExplode.hpFloorPct,
    applyStatuses: (selfDestruct.onExplode.applyStatus ?? []).map((status) => ({
      statusId: status.statusId,
      stacks: status.stacks,
    })),
  };
}

// Mirror of getExplicitOnHitStatuses in src/engine/hitStatusRuntime.ts.
// TS runtime applies these at simulation time from ability name -> status;
// they are NOT present in runtime.effects.applyStatusOnHit. For Rust fixtures
// we must merge them into onHitStatuses so Rust composable sees the same
// payload TS's simulation applies on each hit.
const EXPLICIT_ON_HIT_MAPPING: Record<string, string> = {
  "Wing Shredder": "Shredded_Wings",
  "Serrated Teeth": "Deep_Wounds_Status",
  "Ligament Tear": "Torn_Ligaments_Status",
};

function getExplicitOnHitStatusesForFixture(
  runtime: ReturnType<typeof buildRuntimePair>["attacker"]["runtime"],
  disabledAbilities: string[],
): Array<{ statusId: string; stacks: number }> {
  const out: Array<{ statusId: string; stacks: number }> = [];
  const seen = new Set<string>();
  const abilities: Array<{ name: string; value: number | null }> = [
    ...((runtime.effects.otherAbilities ?? []).map((a: any) => ({
      name: a.name as string,
      value: typeof a.value === "number" ? (a.value as number) : null,
    }))),
    ...((runtime.creature?.passiveAbilities ?? []).map((a: any) => ({
      name: a.name as string,
      value: typeof a.value === "number" ? (a.value as number) : null,
    }))),
  ];
  for (const a of abilities) {
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    if (disabledAbilities.includes(a.name)) continue;
    const statusId = EXPLICIT_ON_HIT_MAPPING[a.name];
    if (!statusId) continue;
    const stacks = typeof a.value === "number" ? a.value : 1;
    out.push({ statusId, stacks });
  }
  return out;
}

function mapCombatant(
  runtime: ReturnType<typeof buildRuntimePair>["attacker"]["runtime"],
  final: ReturnType<typeof buildFinal>,
  disabledAbilities: string[],
) {
  const berserkDef = runtime.specialDefs.find((entry) => entry.type === "conditionalMultiStat");
  const firstStrikeDef = runtime.specialDefs.find((entry) => entry.type === "conditionalDamageBoost");
  const hunkerValue = runtime.abilityValueByName["Hunker"];
  return {
    health: final.health,
    weight: final.weight,
    damage: final.damage,
    biteCooldown: final.biteCooldown,
    healthRegen: final.healthRegen ?? 0,
    berserkBiteCooldownMultiplier:
      berserkDef && "mods" in berserkDef && typeof berserkDef.mods.biteCooldownMultiplier === "number"
        ? berserkDef.mods.biteCooldownMultiplier
        : 1,
    berserkHpRatioThreshold:
      berserkDef && "trigger" in berserkDef
        ? ((berserkDef.trigger.hpRatioLt ?? berserkDef.trigger.hpRatioLte ?? 0) as number)
        : 0,
    firstStrikePct:
      typeof runtime.abilityValueByName["First Strike"] === "number"
        ? (runtime.abilityValueByName["First Strike"] ?? 0)
        : 0,
    firstStrikeHpRatioThreshold:
      firstStrikeDef && "trigger" in firstStrikeDef ? (firstStrikeDef.trigger.hpRatioGte ?? 1) : 1,
    hasWardenResistance: runtime.hasWardenResistance,
    breathResistance:
      typeof runtime.abilityValueByName["Breath Resistance"] === "number"
        ? (runtime.abilityValueByName["Breath Resistance"] ?? 0)
        : 0,
    selfDestructProfile: projectSelfDestructProfile(runtime, disabledAbilities),
    hunkerReductionPct:
      typeof hunkerValue === "number" && Number.isFinite(hunkerValue)
        ? (hunkerValue <= 1 ? hunkerValue * 100 : hunkerValue)
        : 0,
    onHitStatuses: [
      ...(runtime.effects.applyStatusOnHit ?? [])
        .filter((status) => !disabledAbilities.includes(status.sourceAbility))
        .map((status) => ({
          statusId: status.statusId,
          stacks: status.stacks,
        })),
      ...getExplicitOnHitStatusesForFixture(runtime, disabledAbilities),
    ],
    onHitTakenStatuses: (runtime.effects.applyStatusOnHitTaken ?? [])
      .filter((status) => !disabledAbilities.includes(status.sourceAbility))
      .map((status) => ({
        statusId: status.statusId,
        stacks: status.stacks,
      })),
    statusResistFractions: Object.fromEntries(
      (runtime.effects.resistStatus ?? []).map((entry) => [entry.statusId, entry.fraction]),
    ),
    plushieStatusBlockFractions: Object.fromEntries(
      Object.entries(final.plushieStatusBlockPct ?? {}).map(([statusId, pct]) => [statusId, pct / 100]),
    ),
  };
}

// ─── Breath profile translation: TS runtime behavior → Rust structured fields ──
//
// TS runtime has two parallel sources of breath-special behavior that are NOT encoded
// in `breathSpecByName[*].specialKind` / `.selfHealPct` / `.specialStatuses`:
//   (1) Hardcoded name matches in breathSpecialRuntime.ts for Miasma/Cloud/Heal/Spirit Glare
//   (2) `parseBreathAilments(spec.raw)` in breathHelpersRuntime.ts applyBreathAilments
// Rust composable reads ONLY the structured fields. Translate here so Rust fixture input
// mirrors what TS runtime actually does on these breaths.

const BREATH_NAME_TO_SPECIAL_KIND: Record<string, string> = {
  "Miasma Breath": "miasma",
  "Cloud Breath": "cloud",
  "Heal Breath": "heal",
  "Spirit Glare": "spirit_glare",
  "Solar Beam": "solar_beam",
};

const BREATH_NAME_TO_SELF_HEAL_PCT: Record<string, number> = {
  "Miasma Breath": 0.5,
  "Cloud Breath": 1,
  "Heal Breath": 3,
};

// Mirror of ignoredBreathAilmentPatterns in breathHelpersRuntime.ts
const IGNORED_BREATH_AILMENT_PATTERNS: RegExp[] = [
  /injury/i,
  /freeze/i,
  /blurred\s*vision/i,
  /muddy/i,
  /shredded\s*wings/i,
  /tunnel\s*vision/i,
  /shock/i,
  /\bslow(?:ed)?\b/i,
  /fear/i,
];
function isIgnoredBreathAilment(name: string): boolean {
  return IGNORED_BREATH_AILMENT_PATTERNS.some((p) => p.test(name));
}

function deriveSpecialStatusesFromRaw(raw: string): Array<{ statusId: string; stacks: number }> {
  const out: Array<{ statusId: string; stacks: number }> = [];
  for (const ailment of parseBreathAilments(raw)) {
    if (isIgnoredBreathAilment(ailment.name)) continue;
    const statusId = resolveStatusId(ailment.name);
    if (!statusId) continue;
    const expectedStacks = (ailment.probability / 100) * (ailment.stacks ?? 1);
    out.push({ statusId, stacks: expectedStacks });
  }
  return out;
}

function mapBreathProfile(final: ReturnType<typeof buildFinal>) {
  const breathType = final.breathType;
  if (!breathType) return null;
  const spec = breathSpecByName[breathType];
  if (!spec) return null;

  // Prefer explicit structured spec fields; fall back to name/raw-derived values
  // to mirror TS runtime (which uses hardcoded name matches + raw parsing).
  const specialKind = spec.specialKind ?? BREATH_NAME_TO_SPECIAL_KIND[breathType] ?? null;
  const selfHealPct = spec.selfHealPct ?? BREATH_NAME_TO_SELF_HEAL_PCT[breathType] ?? 0;
  const structuredSpecialStatuses = (spec.specialStatuses ?? []).map((s) => ({
    statusId: s.statusId,
    stacks: s.stacks,
  }));
  const rawDerivedSpecialStatuses =
    structuredSpecialStatuses.length > 0 ? [] : deriveSpecialStatusesFromRaw(spec.raw ?? "");
  const specialStatuses = [...structuredSpecialStatuses, ...rawDerivedSpecialStatuses];

  return {
    dpsPct: spec.effect?.dps ?? 0,
    capacity: spec.stats?.capacity ?? 0,
    regenRate: spec.stats?.regenRate ?? 0,
    critChancePct: spec.stats?.critChancePct ?? 0,
    chain: spec.chain ?? 0,
    chainMaxStacks: spec.chainMaxStacks ?? 0,
    specialKind,
    selfHealPct,
    cleanseStacks: spec.cleanseStacks ?? 0,
    lanceDamagePct: spec.lanceDamagePct ?? 0,
    lanceChargeSec: spec.lanceChargeSec ?? 0,
    lanceCooldownSec: spec.lanceCooldownSec ?? 0,
    lanceStatusId: spec.lanceStatusId ?? null,
    autoFireDelaySec: spec.autoFireDelaySec ?? (breathType === "Solar Beam" ? 3 : 0),
    autoFireCooldownSec: spec.autoFireCooldownSec ?? (specialKind === "solar_beam" || specialKind === "spirit_glare" ? 120 : 0),
    specialStatuses,
  };
}

const payload = FIXTURES.map((fixture) => {
  const attackerCreature = getEngineCreatureStrict(fixture.attackerName);
  const defenderCreature = getEngineCreatureStrict(fixture.defenderName);
  const attacker = buildFinal(fixture.attackerName);
  const defender = buildFinal(fixture.defenderName);
  const runtimePair = buildRuntimePair(attacker, defender);

  const autoDisabledAbilitiesA = [
    ...new Set([
      ...(fixture.disabledAbilitiesA ?? []),
      ...getRustUnsupportedPassiveAbilityNamesForBreath(attackerCreature),
      ...getRustBlockingActivatedAbilityNamesForPassiveContours(attackerCreature).filter((name) => name !== "Life Leech"),
    ]),
  ];
  const autoDisabledAbilitiesB = [
    ...new Set([
      ...(fixture.disabledAbilitiesB ?? []),
      ...getRustUnsupportedPassiveAbilityNamesForBreath(defenderCreature),
      ...getRustBlockingActivatedAbilityNamesForPassiveContours(defenderCreature).filter((name) => name !== "Life Leech"),
    ]),
  ];

  const summary = simulateFight(attacker, defender, {
    activesOn: true,
    breathOn: true,
    maxTimeSec: fixture.maxTimeSec,
    abilityPolicy: fixture.abilityPolicy,
    disabledAbilitiesA: autoDisabledAbilitiesA,
    disabledAbilitiesB: autoDisabledAbilitiesB,
    compareNoMoveFacetank: true,
  });

  return {
    name: fixture.name,
    attacker: mapCombatant(runtimePair.attacker.runtime, attacker, autoDisabledAbilitiesA),
    defender: mapCombatant(runtimePair.defender.runtime, defender, autoDisabledAbilitiesB),
    attackerBreath: mapBreathProfile(attacker),
    defenderBreath: mapBreathProfile(defender),
    lifeLeechProfile: {
      attacker: {
        available:
          typeof runtimePair.attacker.runtime.abilityValueByName["Life Leech"] === "number" &&
          !autoDisabledAbilitiesA.includes("Life Leech"),
        lifeLeechValue: runtimePair.attacker.runtime.abilityValueByName["Life Leech"] ?? 0,
      },
      defender: {
        available:
          typeof runtimePair.defender.runtime.abilityValueByName["Life Leech"] === "number" &&
          !autoDisabledAbilitiesB.includes("Life Leech"),
        lifeLeechValue: runtimePair.defender.runtime.abilityValueByName["Life Leech"] ?? 0,
      },
    },
    abilityPolicy: fixture.abilityPolicy,
    maxTimeSec: fixture.maxTimeSec,
    expectedSummary: {
      ...projectBestBuildsMatchupSummary(summary),
      extendedDamagePotentialA: 0,
    },
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.length} simple life leech breath Rust fixtures to ${outputPath}`);
