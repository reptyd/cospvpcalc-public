import { applyRulesAndBuild, simulateFight } from "../src/engine";
import {
  creaturesData,
  effectsCatalog,
  plushieByName,
} from "../src/engine/data";
import type { BuildOptions } from "../src/engine/types";
import { computeAbilityCoverageSummary, getAbilityCoverage } from "../src/optimizer/abilityCoverage";
import { normalizeAbilityName } from "../src/optimizer/abilityCoverageRegistry";
import { writeFileSync } from "node:fs";

type CoverageStatus = "modeled" | "partial" | "deferred" | "out-of-model" | "not-modeled";

type CoverageReport = {
  totalAbilities: number;
  modeledAbilities: number;
  partialAbilities: number;
  deferredAbilities: number;
  outOfModelAbilities: number;
  notModeledAbilities: number;
  topByStatus: Record<Exclude<CoverageStatus, "modeled">, Array<{ name: string; count: number }>>;
  abilitiesByStatus: Record<Exclude<CoverageStatus, "modeled">, string[]>;
};

const statusCounts: Record<Exclude<CoverageStatus, "modeled">, Record<string, number>> = {
  partial: {},
  deferred: {},
  "out-of-model": {},
  "not-modeled": {},
};

for (const creature of creaturesData) {
  for (const ability of getAbilityCoverage(creature.name)) {
    if (ability.status === "modeled") continue;
    statusCounts[ability.status][ability.name] = (statusCounts[ability.status][ability.name] ?? 0) + 1;
  }
}

const coverageSummary = computeAbilityCoverageSummary();
const summarizeStatus = (status: Exclude<CoverageStatus, "modeled">) =>
  Object.entries(statusCounts[status])
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

const coverageReport: CoverageReport = {
  totalAbilities: coverageSummary.total,
  modeledAbilities: coverageSummary.applied,
  partialAbilities: coverageSummary.partial,
  deferredAbilities: coverageSummary.deferred,
  outOfModelAbilities: coverageSummary.outOfModel,
  notModeledAbilities: coverageSummary.unresolved,
  topByStatus: {
    partial: summarizeStatus("partial").slice(0, 30),
    deferred: summarizeStatus("deferred").slice(0, 30),
    "out-of-model": summarizeStatus("out-of-model").slice(0, 30),
    "not-modeled": summarizeStatus("not-modeled").slice(0, 30),
  },
  abilitiesByStatus: {
    partial: Object.keys(statusCounts.partial).sort((a, b) => a.localeCompare(b)),
    deferred: Object.keys(statusCounts.deferred).sort((a, b) => a.localeCompare(b)),
    "out-of-model": Object.keys(statusCounts["out-of-model"]).sort((a, b) => a.localeCompare(b)),
    "not-modeled": Object.keys(statusCounts["not-modeled"]).sort((a, b) => a.localeCompare(b)),
  },
};

writeFileSync("ability_coverage_report.json", JSON.stringify(coverageReport, null, 2));

const golden: Array<Record<string, unknown>> = [];

const buildBase = (opts: Partial<BuildOptions> = {}): BuildOptions => ({
  venerationStage: 0,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  ...opts,
});

const korathos = creaturesData.find((c) => c.name === "Korathos");
if (korathos) {
  const dummy = {
    name: "Dummy",
    stats: { ...korathos.stats, health: 50000, damage: 1, weight: 10000, breath: "N/A" },
  };
  const atk = applyRulesAndBuild(korathos, buildBase());
  const def = applyRulesAndBuild(dummy, buildBase());
  const summary = simulateFight(atk, def, { activesOn: true, breathOn: false, maxTimeSec: 1.1 });
  golden.push({
    name: "Korathos Poison Attack + Life Leech",
    expected: {
      poisonApplied: true,
      lifeLeechRatio: 0.3,
    },
    computed: {
      poisonStacks: summary.debug?.B.statuses["Poison_Status"] ?? 0,
      lifeLeechRatio: summary.debug?.A.totalLifeLeechHealed
        ? summary.debug?.A.totalLifeLeechHealed / summary.debug?.A.totalDamageDealt
        : 0,
    },
  });
}

const wingShredder = creaturesData.find((c) =>
  (c.passiveAbilities ?? []).some((a) => a.name === "Wing Shredder"),
);
if (wingShredder) {
  const dummy = { name: "Dummy", stats: { ...wingShredder.stats, health: 50000, damage: 1, breath: "N/A" } };
  const atk = applyRulesAndBuild(wingShredder, buildBase());
  const def = applyRulesAndBuild(dummy, buildBase());
  const summary = simulateFight(atk, def, { activesOn: true, breathOn: false, maxTimeSec: 1.1 });
  golden.push({
    name: "Wing Shredder -> Shredded Wings",
    expected: { status: "Shredded_Wings" },
    computed: { stacks: summary.debug?.B.statuses["Shredded_Wings"] ?? 0 },
  });
}

const serrated = creaturesData.find((c) =>
  (c.passiveAbilities ?? []).some((a) => a.name === "Serrated Teeth"),
);
if (serrated) {
  const dummy = { name: "Dummy", stats: { ...serrated.stats, health: 50000, damage: 1, breath: "N/A" } };
  const atk = applyRulesAndBuild(serrated, buildBase());
  const def = applyRulesAndBuild(dummy, buildBase());
  const summary = simulateFight(atk, def, { activesOn: true, breathOn: false, maxTimeSec: 1.1 });
  golden.push({
    name: "Serrated Teeth -> Deep Wounds",
    expected: { status: "Deep_Wounds_Status" },
    computed: { stacks: summary.debug?.B.statuses["Deep_Wounds_Status"] ?? 0 },
  });
}

const voidPlushie = plushieByName["Void"];
if (voidPlushie) {
  const baseCreature = creaturesData[0];
  const base = applyRulesAndBuild(baseCreature, buildBase());
  const voidBuild = applyRulesAndBuild(baseCreature, buildBase({ plushies: ["Void"] }));
  const dummy = applyRulesAndBuild({ name: "Dummy", stats: { ...baseCreature.stats, health: 50000, damage: 1, breath: "N/A" } }, buildBase());
  const sBase = simulateFight(base, dummy, { activesOn: false, breathOn: false, maxTimeSec: 2 });
  const sVoid = simulateFight(voidBuild, dummy, { activesOn: false, breathOn: false, maxTimeSec: 2 });
  golden.push({
    name: "Void plushie damage",
    expected: { damageIncrease: 0.075 },
    computed: {
      dpsBase: sBase.dpsAtoB,
      dpsVoid: sVoid.dpsAtoB,
    },
  });
}

if (korathos) {
  const atk = applyRulesAndBuild(korathos, buildBase());
  const def = applyRulesAndBuild(korathos, buildBase());
  const summary = simulateFight(atk, def, { activesOn: true, breathOn: false, maxTimeSec: 1.1 });
  golden.push({
    name: "Block Poison reduces stacks",
    expected: { baseStacks: 2.5, blockFraction: 0.75 },
    computed: {
      poisonStacks: summary.debug?.B.statuses["Poison_Status"] ?? 0,
    },
  });
}

const angelic = creaturesData.find((c) => c.name === "Angelic Warden");
if (angelic) {
  const dummy = {
    name: "Dummy",
    stats: { ...angelic.stats, health: 50000, damage: 8000, biteCooldown: 1, weight: 50000, breath: "N/A" },
  };
  const atk = applyRulesAndBuild(angelic, buildBase());
  const def = applyRulesAndBuild(dummy, buildBase());
  const summary = simulateFight(atk, def, { activesOn: true, breathOn: false, maxTimeSec: 4 });
  golden.push({
    name: "Warden's Rage + Resistance flags",
    expected: { wardenRage: true, wardenResistanceActive: true },
    computed: {
      wardenRage: summary.debug?.A.wardenRageOn ?? false,
      wardenRageStacks: summary.debug?.A.wardenRageStacks ?? 0,
      wardenResistanceActive: summary.debug?.A.wardenResistanceActive ?? false,
    },
  });

  const effects = effectsCatalog[angelic.name] ?? {};
  const modeled = new Set<string>();
  for (const entry of effects.specialAbilitiesDetailed ?? []) modeled.add(normalizeAbilityName(entry.name));
  for (const entry of effects.specialAbilities ?? []) modeled.add(normalizeAbilityName(entry.name));
  for (const entry of effects.otherAbilities ?? []) modeled.add(normalizeAbilityName(entry.name));
  const hasRage = modeled.has(normalizeAbilityName("Warden's Rage"));
  const hasRes = modeled.has(normalizeAbilityName("Warden's Resistance"));
  golden.push({
    name: "Ability coverage (Angelic Warden) includes Warden abilities",
    expected: { wardenRageModeled: true, wardenResistanceModeled: true },
    computed: { wardenRageModeled: hasRage, wardenResistanceModeled: hasRes },
  });
}

const reflectCreature = creaturesData.find((c) => c.name === "Arcabatur");
if (reflectCreature) {
  const dummy = { name: "Dummy", stats: { ...reflectCreature.stats, health: 50000, damage: 1, breath: "N/A" } };
  const atk = applyRulesAndBuild(reflectCreature, buildBase());
  const def = applyRulesAndBuild(dummy, buildBase());
  const summary = simulateFight(atk, def, { activesOn: true, breathOn: false, maxTimeSec: 1 });
  golden.push({
    name: "Reflect active window",
    expected: { reflectActive: true },
    computed: { reflectActiveUntil: summary.debug?.A.reflectActiveUntil ?? null },
  });
}

const totemCreature = creaturesData.find((c) => c.name === "Apofuex");
if (totemCreature) {
  const dummy = { name: "Dummy", stats: { ...totemCreature.stats, health: 50000, damage: 1, breath: "N/A" } };
  const atk = applyRulesAndBuild(totemCreature, buildBase());
  const def = applyRulesAndBuild(dummy, buildBase());
  const summary = simulateFight(atk, def, { activesOn: true, breathOn: false, maxTimeSec: 3.1 });
  golden.push({
    name: "Totem applies poison stacks",
    expected: { poisonStacks: ">0" },
    computed: { poisonStacks: summary.debug?.B.statuses["Poison_Status"] ?? 0 },
  });
}

const drowsyCreature = creaturesData.find((c) => c.name === "Amolis");
if (drowsyCreature) {
  const dummy = { name: "Dummy", stats: { ...drowsyCreature.stats, health: 50000, damage: 1, breath: "N/A" } };
  const atk = applyRulesAndBuild(drowsyCreature, buildBase());
  const def = applyRulesAndBuild(dummy, buildBase());
  const summary = simulateFight(atk, def, { activesOn: true, breathOn: false, maxTimeSec: 1.1 });
  golden.push({
    name: "Drowsy Area applies Drowsy",
    expected: { drowsy: true },
    computed: { drowsyStacks: summary.debug?.B.statuses["Drowsy_Status"] ?? 0 },
  });
}

const kaminaru = creaturesData.find((c) => c.name === "Kaminaru");
if (kaminaru) {
  const dummy = { name: "Dummy", stats: { ...kaminaru.stats, health: 50000, damage: 1, breath: "N/A" } };
  const atk = applyRulesAndBuild(kaminaru, buildBase());
  const def = applyRulesAndBuild(dummy, buildBase());
  const summary = simulateFight(atk, def, { activesOn: true, breathOn: false, maxTimeSec: 1.1 });
  golden.push({
    name: "Lich Mark (Kaminaru) applies Blessing's Boon",
    expected: { status: "Blessings_Boon" },
    computed: { stacks: summary.debug?.B.statuses["Blessings_Boon"] ?? 0 },
  });
}

writeFileSync("golden_examples_report.json", JSON.stringify(golden, null, 2));

// Generate plushies coverage report
const plushiesData = Object.values(plushieByName);
const parsedPlushies = plushiesData.filter(
  (p) => p.modifiersParsed && p.modifiersParsed.length > 0
);
const unparsedPlushies = plushiesData.filter(
  (p) => !p.modifiersParsed || p.modifiersParsed.length === 0
);

const plushiesCoverageReport = {
  total: plushiesData.length,
  parsedCount: parsedPlushies.length,
  unparsedCount: unparsedPlushies.length,
  parsedPlushies: parsedPlushies.map((p) => ({
    name: p.name,
    stackRule: p.stackRule,
    stats: [...new Set(p.modifiersParsed?.map((m) => m.stat) ?? [])],
  })),
  sampleUnparsed: unparsedPlushies.slice(0, 20).map((p) => ({
    name: p.name,
    rawDescription: p.rawDescription,
  })),
};

writeFileSync("plushies_coverage_report.json", JSON.stringify(plushiesCoverageReport, null, 2));

const consoleSummary = {
  coverage: coverageReport,
  goldenExamples: golden.map((g) => g.name),
};

console.log(JSON.stringify(consoleSummary, null, 2));
