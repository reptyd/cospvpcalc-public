import { applyRulesAndBuild, type BuildOptions } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { simulateBestBuildMatchupWithPath } from "../src/optimizer/bestBuildsRuntime";
import { buildBestBuildsOpponentFinal } from "../src/optimizer/bestBuildsRuntime";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";

function readCliArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === `--${name}`) return args[index + 1]?.trim();
    if (current?.startsWith(`--${name}=`)) return current.slice(name.length + 3).trim();
  }
  return undefined;
}

function parseListArg(rawValue: string | undefined, fallback: string): string[] {
  const normalized = rawValue?.trim() || fallback;
  if (normalized === "@empty") return [];
  return normalized
    .split(normalized.includes("+") ? "+" : ",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readBuildFromEnv(): BuildOptions {
  return {
    venerationStage: Math.max(0, Number(readCliArg("veneration-stage") || process.env.BENCH_VENERATION_STAGE?.trim() || "5")),
    traits: parseListArg(readCliArg("traits") || process.env.BENCH_TRAITS?.trim(), "Bite,Damage"),
    ascensionAssignments: parseListArg(
      readCliArg("ascensions") || process.env.BENCH_ASCENSIONS?.trim(),
      "Damage,Damage,Damage,Damage,Damage",
    ),
    plushies: parseListArg(readCliArg("plushies") || process.env.BENCH_PLUSHIES?.trim(), "Void,Void"),
    elder: readCliArg("elder") || process.env.BENCH_ELDER?.trim() || "None",
  };
}

async function simulate(mode: "ts" | "rust", sourceName: string, opponentName: string, build: BuildOptions) {
  const sourceCreature = creatureByName[sourceName];
  const opponentCreature = creatureByName[opponentName];
  if (!sourceCreature || !opponentCreature) {
    throw new Error(`Missing creature: ${!sourceCreature ? sourceName : opponentName}`);
  }

  setRustMatchupBridgeForceDisabled(mode === "ts");
  if (mode === "rust") {
    await loadRustMatchupBridge().catch(() => null);
  }

  const finalA = applyRulesAndBuild(sourceCreature, build);
  const finalB = buildBestBuildsOpponentFinal(opponentCreature);
  const { summary, path } = simulateBestBuildMatchupWithPath({
    sourceCreature,
    finalA,
    opponentCreature,
    activesOn: true,
    breathOn: true,
    maxTimeSec: Math.max(30, Number(readCliArg("max-time-sec") || process.env.BENCH_MAX_TIME_SEC?.trim() || "180")),
    abilityPolicy: ((readCliArg("ability-policy") || process.env.BENCH_ABILITY_POLICY?.trim()) as "fast" | "semiIdeal" | undefined) || "semiIdeal",
  });

  return {
    path,
    summary,
    finalA: {
      hasBreath: finalA.hasBreath,
      breathType: finalA.breathType,
    },
    finalB: {
      hasBreath: finalB.hasBreath,
      breathType: finalB.breathType,
    },
  };
}

async function main() {
  const sourceName = readCliArg("creature") || process.env.BENCH_CREATURE?.trim() || "Kendyll";
  const opponentName = readCliArg("opponent") || process.env.BENCH_OPPONENT?.trim();
  if (!opponentName) {
    throw new Error("Missing opponent name. Use --opponent <CreatureName>.");
  }

  const build = readBuildFromEnv();
  const tsResult = await simulate("ts", sourceName, opponentName, build);
  const rustResult = await simulate("rust", sourceName, opponentName, build);
  setRustMatchupBridgeForceDisabled(false);

  const tsEffective =
    tsResult.summary.winner === "A"
      ? tsResult.summary.damageDealtAAtBDeath + tsResult.summary.extendedDamagePotentialA
      : tsResult.summary.damageDealtA;
  const rustEffective =
    rustResult.summary.winner === "A"
      ? rustResult.summary.damageDealtAAtBDeath + rustResult.summary.extendedDamagePotentialA
      : rustResult.summary.damageDealtA;

  console.log(
    JSON.stringify(
      {
        sourceName,
        opponentName,
        build,
        tsPath: tsResult.path,
        rustPath: rustResult.path,
        localBuildFacts: {
          finalA: rustResult.finalA,
          finalB: rustResult.finalB,
          rawBreathFight: rustResult.finalA.hasBreath || rustResult.finalB.hasBreath,
        },
        tsSummary: tsResult.summary,
        rustSummary: rustResult.summary,
        deltas: {
          ttk: rustResult.summary.ttkAtoB - tsResult.summary.ttkAtoB,
          dps: rustResult.summary.dpsAtoB - tsResult.summary.dpsAtoB,
          effective: rustEffective - tsEffective,
          survival:
            (rustResult.summary.deathTimeA ?? rustResult.summary.maxTimeSec) -
            (tsResult.summary.deathTimeA ?? tsResult.summary.maxTimeSec),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  setRustMatchupBridgeForceDisabled(false);
  console.error(error);
  process.exitCode = 1;
});
