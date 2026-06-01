import type { BuildOptions, FinalStats, SimulationSummary } from "../engine";
import { traits, veneration } from "../engine/buildData";
import { scoreResult } from "../optimizer/scoring";
import { resolveTraitPercent } from "../shared/buildDomain";
import { computeAscensionCounts } from "../shared/buildEncoding";
import type { DummyValues } from "./BuildDetails";

const traitOptions = traits;

export function getPerspectiveMetrics(summary: SimulationSummary, side: "A" | "B") {
  const scored = scoreResult(summary, side);
  const didKill = side === "A" ? summary.deathTimeB != null : summary.deathTimeA != null;
  const ttkToKill = side === "A" ? summary.ttkAtoB : summary.ttkBtoA;
  const targetMaxHp = side === "A" ? summary.maxHpB : summary.maxHpA;
  return {
    dps: side === "A" ? summary.dpsAtoB : summary.dpsBtoA,
    killDps: didKill && ttkToKill > 0 ? targetMaxHp / ttkToKill : 0,
    effective: scored.effectiveDamage,
    ttk: scored.ttk,
    didKill,
    incomingUntilDeath: side === "A" ? summary.damageDealtB_untilADeath : summary.damageDealtA_untilBDeath,
    regenHealed: side === "A" ? summary.regenHealedA : summary.regenHealedB,
  };
}

export function createDummyFinalStats(dummyValues: DummyValues): FinalStats {
  return {
    name: "Dummy",
    tier: 1,
    health: dummyValues.health,
    weight: dummyValues.weight,
    damage: dummyValues.damage,
    biteCooldown: dummyValues.biteCooldown,
    healthRegen: 0,
    stamina: 0,
    stamRegen: 0,
    breath: "N/A",
    type: "Dummy",
    hasBreath: false,
    breathType: null,
    approxNotes: [],
    appliedTraits: [],
    plushieStatusOnHit: {},
    plushieStatusOnHitTaken: {},
    plushieStatusBlockPct: {},
  };
}

export function resolveTraitPercentLocal(traitId: string, build: BuildOptions): number {
  return resolveTraitPercent(traitId, build);
}

export function buildWithTraitSubset(build: BuildOptions, keepTraits: string[]): BuildOptions {
  const keepSet = new Set(keepTraits);
  const traitIds = build.traits.filter((id) => keepSet.has(id));
  const counts = computeAscensionCounts(build.traits, build.ascensionAssignments, build.venerationStage);
  const countByTrait = new Map<string, number>();
  build.traits.forEach((id, idx) => countByTrait.set(id, counts[idx] ?? 0));
  const assignments = Array.from({ length: veneration.stages }, () => "");
  let cursor = 0;
  for (const traitId of traitIds) {
    const count = Math.max(0, Math.min(build.venerationStage, countByTrait.get(traitId) ?? 0));
    for (let i = 0; i < count && cursor < assignments.length; i += 1) {
      assignments[cursor] = traitId;
      cursor += 1;
    }
  }
  return {
    ...build,
    traits: traitIds,
    ascensionAssignments: assignments,
  };
}

function buildWithExactTraitCounts(build: BuildOptions, traitIds: string[], countByTrait: Record<string, number>): BuildOptions {
  const assignments = Array.from({ length: veneration.stages }, () => "");
  let cursor = 0;
  for (const traitId of traitIds) {
    const count = Math.max(0, Math.min(build.venerationStage, Math.round(countByTrait[traitId] ?? 0)));
    for (let i = 0; i < count && cursor < assignments.length; i += 1) {
      assignments[cursor] = traitId;
      cursor += 1;
    }
  }
  return {
    ...build,
    traits: traitIds,
    ascensionAssignments: assignments,
  };
}

function getNeutralAnchorTrait(excluded: Set<string>): string {
  const neutralOrder = ["Speed", "Max_Stamina", "Stamina_Regen", "Healing"];
  for (const id of neutralOrder) {
    if (!excluded.has(id) && traitOptions.some((trait) => trait.id === id)) return id;
  }
  return traitOptions.find((trait) => !excluded.has(trait.id))?.id ?? "Speed";
}

export function buildWithTraitLevels(build: BuildOptions, levels: Record<string, number>, ensureTrait?: string): BuildOptions {
  const levelEntries = Object.entries(levels).filter(([, value]) => Number.isFinite(value) && value >= 0);
  let traitIds = levelEntries.map(([id]) => id);
  if (ensureTrait && !traitIds.includes(ensureTrait)) traitIds.push(ensureTrait);
  if (traitIds.length === 1) {
    const anchor = getNeutralAnchorTrait(new Set(traitIds));
    traitIds.push(anchor);
  }
  traitIds = traitIds.slice(0, 2);
  const countByTrait: Record<string, number> = {};
  for (const id of traitIds) {
    countByTrait[id] = Math.max(0, Math.min(build.venerationStage, Math.round(levels[id] ?? 0)));
  }
  return buildWithExactTraitCounts(build, traitIds, countByTrait);
}
