import { applyRulesAndBuild, type BuildOptions } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { buildDefaultMetaPool } from "../src/optimizer/poolUtils";
import { simulateBestBuildMatchupWithPath } from "../src/optimizer/bestBuildsRuntime";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";

type Mode = "ts" | "rust";

type OpponentRow = {
  name: string;
  path: string;
  winner: "A" | "B" | "Draw";
  ttk: number;
  dps: number;
  effective: number;
  survival: number;
};

function parseBuildList(raw: string, separatorFallback: "," | "+"): string[] {
  const separator = raw.includes(separatorFallback) ? separatorFallback : raw.includes(",") ? "," : "+";
  return raw
    .split(separator)
    .map((value) => value.trim())
    .filter(Boolean);
}

function readEnvInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readProfileTargetCreature(fallback: string): string {
  return process.env.PROFILE_TARGET_CREATURE?.trim() || process.env.PROFILE_CREATURE?.trim() || fallback;
}

function readProfileTargetPoolSize(fallback: number): number {
  const targetPool = process.env.PROFILE_TARGET_POOL?.trim();
  if (targetPool) {
    const match = /^meta(\d+)$/i.exec(targetPool);
    if (match) return Number(match[1]);
  }
  const value = process.env.PROFILE_POOL_SIZE;
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readProfileTargetFilter(fallback: string): string {
  return process.env.PROFILE_TARGET_FILTER?.trim() || process.env.PROFILE_POOL_SCOPE?.trim() || fallback;
}

function readBuildFromEnv(prefix: "BUILD_A" | "BUILD_B"): BuildOptions {
  const traits = parseBuildList(process.env[`${prefix}_TRAITS`] ?? "Bite,Damage", "+");
  const ascensionAssignments = (process.env[`${prefix}_ASC`] ?? "Damage,Damage,Damage,Damage,Damage")
    .split(",")
    .map((value) => value.trim());
  const plushies = parseBuildList(process.env[`${prefix}_PLUSHIES`] ?? "Void,Void", "+");
  const venerationStage = Number(process.env[`${prefix}_VEN`] ?? 5);
  const elder = process.env[`${prefix}_ELDER`]?.trim() || "None";
  return {
    venerationStage,
    traits,
    ascensionAssignments,
    plushies,
    elder,
  };
}

async function simulateRows(mode: Mode, sourceName: string, opponentNames: string[], build: BuildOptions): Promise<Map<string, OpponentRow>> {
  const sourceCreature = creatureByName[sourceName];
  if (!sourceCreature) {
    throw new Error(`Missing source creature: ${sourceName}`);
  }
  setRustMatchupBridgeForceDisabled(mode === "ts");
  if (mode === "rust") {
    await loadRustMatchupBridge().catch(() => null);
  }

  const finalA = applyRulesAndBuild(sourceCreature, build);
  const rows = new Map<string, OpponentRow>();
  for (const opponentName of opponentNames) {
    const opponentCreature = creatureByName[opponentName];
    if (!opponentCreature) continue;
    const { summary, path } = simulateBestBuildMatchupWithPath({
      sourceCreature,
      finalA,
      opponentCreature,
      activesOn: true,
      breathOn: true,
      maxTimeSec: 180,
      abilityPolicy: "semiIdeal",
    });
    rows.set(opponentName, {
      name: opponentName,
      path,
      winner: summary.winner,
      ttk: summary.ttkAtoB,
      dps: summary.dpsAtoB,
      effective: summary.winner === "A" ? summary.damageDealtAAtBDeath + summary.extendedDamagePotentialA : summary.damageDealtA,
      survival: summary.deathTimeA ?? summary.maxTimeSec,
    });
  }
  return rows;
}

function compareBuild(label: string, tsRows: Map<string, OpponentRow>, rustRows: Map<string, OpponentRow>): void {
  const diffs = [...tsRows.keys()].map((name) => {
    const ts = tsRows.get(name)!;
    const rust = rustRows.get(name)!;
    return {
      name,
      winnerChanged: ts.winner !== rust.winner,
      ttkDelta: rust.ttk - ts.ttk,
      dpsDelta: rust.dps - ts.dps,
      effectiveDelta: rust.effective - ts.effective,
      survivalDelta: rust.survival - ts.survival,
      ts,
      rust,
    };
  });

  const transitionSummary = new Map<
    string,
    { count: number; winnerChanges: number; maxTtkDelta: number; maxEffectiveDelta: number }
  >();
  for (const entry of diffs) {
    const key = `${entry.ts.path} -> ${entry.rust.path}`;
    const current = transitionSummary.get(key) ?? {
      count: 0,
      winnerChanges: 0,
      maxTtkDelta: 0,
      maxEffectiveDelta: 0,
    };
    current.count += 1;
    if (entry.winnerChanged) current.winnerChanges += 1;
    current.maxTtkDelta = Math.max(current.maxTtkDelta, Math.abs(entry.ttkDelta));
    current.maxEffectiveDelta = Math.max(current.maxEffectiveDelta, Math.abs(entry.effectiveDelta));
    transitionSummary.set(key, current);
  }

  const winnerChanges = diffs.filter((entry) => entry.winnerChanged);
  const topEffective = [...diffs]
    .sort((a, b) => Math.abs(b.effectiveDelta) - Math.abs(a.effectiveDelta))
    .slice(0, 12);
  const topTtk = [...diffs]
    .sort((a, b) => Math.abs(b.ttkDelta) - Math.abs(a.ttkDelta))
    .slice(0, 12);

  console.log(`\n=== ${label} ===`);
  console.log("path transitions:");
  for (const [transition, summary] of [...transitionSummary.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(
      `${transition}: count=${summary.count}, winnerChanges=${summary.winnerChanges}, max|ttk|=${summary.maxTtkDelta.toFixed(2)}, max|eff|=${summary.maxEffectiveDelta.toFixed(2)}`,
    );
  }
  console.log(`winner changes: ${winnerChanges.length}`);
  if (winnerChanges.length > 0) {
    for (const entry of winnerChanges.slice(0, 10)) {
      console.log(
        `winner ${entry.name}: ts=${entry.ts.winner}, rust=${entry.rust.winner}, tsTTK=${entry.ts.ttk.toFixed(2)}, rustTTK=${entry.rust.ttk.toFixed(2)}, tsEff=${entry.ts.effective.toFixed(2)}, rustEff=${entry.rust.effective.toFixed(2)}`,
      );
    }
  }

  console.log("top effective deltas:");
  for (const entry of topEffective) {
    console.log(
      `${entry.name}: eff ${entry.effectiveDelta.toFixed(2)}, ttk ${entry.ttkDelta.toFixed(2)}, dps ${entry.dpsDelta.toFixed(2)}, surv ${entry.survivalDelta.toFixed(2)}, winner ${entry.ts.winner}->${entry.rust.winner}`,
    );
  }

  console.log("top ttk deltas:");
  for (const entry of topTtk) {
    console.log(
      `${entry.name}: ttk ${entry.ttkDelta.toFixed(2)}, dps ${entry.dpsDelta.toFixed(2)}, eff ${entry.effectiveDelta.toFixed(2)}, surv ${entry.survivalDelta.toFixed(2)}, winner ${entry.ts.winner}->${entry.rust.winner}`,
    );
  }
}

async function main(): Promise<void> {
  const sourceName = readProfileTargetCreature("Kendyll");
  const poolSize = readProfileTargetPoolSize(80);
  const poolScope = readProfileTargetFilter("withinOneTier");
  const opponentLimit = readEnvInt("PROFILE_OPPONENT_LIMIT", 0);
  const activePool = buildDefaultMetaPool(sourceName, poolSize, poolScope);
  const slicedPool = opponentLimit > 0 ? activePool.slice(0, opponentLimit) : activePool;

  const buildA = readBuildFromEnv("BUILD_A");
  const buildB = readBuildFromEnv("BUILD_B");

  console.log(`Creature: ${sourceName}`);
  console.log(`Pool: meta${poolSize} / ${poolScope} (${slicedPool.length})`);
  console.log(`Build A: traits=${buildA.traits.join("+")} asc=${buildA.ascensionAssignments.join(",")} plushies=${buildA.plushies.join("+")} elder=${buildA.elder ?? "None"}`);
  console.log(`Build B: traits=${buildB.traits.join("+")} asc=${buildB.ascensionAssignments.join(",")} plushies=${buildB.plushies.join("+")} elder=${buildB.elder ?? "None"}`);

  const tsA = await simulateRows("ts", sourceName, slicedPool, buildA);
  const rustA = await simulateRows("rust", sourceName, slicedPool, buildA);
  const tsB = await simulateRows("ts", sourceName, slicedPool, buildB);
  const rustB = await simulateRows("rust", sourceName, slicedPool, buildB);
  setRustMatchupBridgeForceDisabled(false);

  compareBuild("Build A", tsA, rustA);
  compareBuild("Build B", tsB, rustB);
}

main().catch((error: unknown) => {
  setRustMatchupBridgeForceDisabled(false);
  console.error(error);
  process.exitCode = 1;
});
