import type { BuildOptions, SimulationSummary } from "../engine";
import { plushieByName, traits, veneration } from "../engine/data";
import { buildResultKey } from "../shared/buildEncoding";
import { computeAscensionLevels, parsePercentValue, traitNameFromId } from "../shared/buildDomain";
import { compareResult, scoreResult } from "./scoring";

type CompareEntry = {
  buildA: BuildOptions;
  buildB: BuildOptions;
  summary: SimulationSummary;
  finalDamageA: number;
  finalDamageB: number;
  activesOnA?: boolean;
  breathOnA?: boolean;
  activesOnB?: boolean;
  breathOnB?: boolean;
};

function resolveTraitPercentLocal(traitId: string, build: BuildOptions): number {
  const ascensionLevels = computeAscensionLevels(build.traits, build.ascensionAssignments, build.venerationStage);
  const level = ascensionLevels[traitId] ?? 0;
  const traitName = traitNameFromId(traitId);
  const ascension = veneration.traitAscension[traitName];
  if (ascension?.sequence?.length) {
    const idx = Math.min(level, ascension.sequence.length - 1);
    return parsePercentValue(ascension.sequence[idx]);
  }
  const trait = traits.find((item) => item.id === traitId);
  if (trait?.effectText) return parsePercentValue(trait.effectText);
  return 0;
}

function computeDamagePctTotal(build: BuildOptions): number {
  let total = 0;
  if (build.traits.includes("Damage")) total += resolveTraitPercentLocal("Damage", build);
  for (const plushieName of build.plushies) {
    const plushie = plushieByName[plushieName];
    if (!plushie?.modifiersParsed) continue;
    for (const mod of plushie.modifiersParsed) {
      if (mod.stat === "damagePct") total += mod.value;
    }
  }
  return total;
}

export function compareOptimizerResults(
  a: CompareEntry,
  b: CompareEntry,
  goal: "lexicographic" | "effectiveDamage" | "dps",
  perspective: "A" | "B",
): number {
  const aScore = scoreResult(a.summary, perspective);
  const bScore = scoreResult(b.summary, perspective);
  if (goal === "dps") {
    const aDps = perspective === "A" ? a.summary.dpsAtoB : a.summary.dpsBtoA;
    const bDps = perspective === "A" ? b.summary.dpsAtoB : b.summary.dpsBtoA;
    if (aDps !== bDps) return bDps - aDps;
  }
  const base = compareResult(aScore, bScore);
  if (base !== 0) return base;

  const aBuild = perspective === "A" ? a.buildA : a.buildB;
  const bBuild = perspective === "A" ? b.buildA : b.buildB;
  const aDamagePct = computeDamagePctTotal(aBuild);
  const bDamagePct = computeDamagePctTotal(bBuild);
  if (aDamagePct !== bDamagePct) return bDamagePct - aDamagePct;

  const aFinalDamage = perspective === "A" ? a.finalDamageA : a.finalDamageB;
  const bFinalDamage = perspective === "A" ? b.finalDamageA : b.finalDamageB;
  if (aFinalDamage !== bFinalDamage) return bFinalDamage - aFinalDamage;

  const aKey = buildResultKey(
    aBuild,
    perspective === "A" ? a.activesOnA ?? true : a.activesOnB ?? true,
    perspective === "A" ? a.breathOnA ?? true : a.breathOnB ?? true,
  );
  const bKey = buildResultKey(
    bBuild,
    perspective === "A" ? b.activesOnA ?? true : b.activesOnB ?? true,
    perspective === "A" ? b.breathOnA ?? true : b.breathOnB ?? true,
  );
  return aKey === bKey ? 0 : aKey.localeCompare(bKey);
}
