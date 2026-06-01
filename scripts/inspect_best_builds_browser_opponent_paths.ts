import { chromium } from "playwright";
import { creatureByName } from "../src/engine/creatureData";
import { memoizedApplyRulesAndBuild } from "../src/optimizer/bestBuildsOptimizations";
import { buildBestBuildsOpponentFinal } from "../src/optimizer/bestBuildsRuntime";
import { bootstrapBestBuildsDevApi, configureBestBuilds, isKnownCreatureName, type BestBuildsBenchmarkConfig } from "./best_builds_browser_shared";

function readCliArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === `--${name}`) return args[index + 1]?.trim();
    if (current?.startsWith(`--${name}=`)) return current.slice(name.length + 3).trim();
  }
  return undefined;
}

const targetUrl = process.env.BENCH_URL?.trim() || "http://127.0.0.1:5173";
const headed = process.env.BENCH_HEADED === "1";
const selectedPoolTiers = (readCliArg("selected-pool-tiers") || process.env.BENCH_SELECTED_POOL_TIERS?.trim() || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);

const config: BestBuildsBenchmarkConfig = {
  creatureName: readCliArg("creature") || process.env.BENCH_CREATURE?.trim() || "Sigmatox",
  nextSearchDepth: ((readCliArg("search-depth") || process.env.BENCH_SEARCH_DEPTH?.trim()) as "soft" | "detailed" | undefined) || "detailed",
  nextPoolMode:
    ((readCliArg("pool-mode") || process.env.BENCH_POOL_MODE?.trim()) as BestBuildsBenchmarkConfig["nextPoolMode"] | undefined) || "meta80",
  nextPoolScope:
    ((readCliArg("pool-scope") || process.env.BENCH_POOL_SCOPE?.trim()) as BestBuildsBenchmarkConfig["nextPoolScope"] | undefined) ||
    "withinOneTier",
  nextSelectedPoolTiers: selectedPoolTiers,
  nextObjective:
    ((readCliArg("objective") || process.env.BENCH_OBJECTIVE?.trim()) as BestBuildsBenchmarkConfig["nextObjective"] | undefined) || "avgTtk",
  nextUseRustMatchupRuntime: true,
};

const opponentName = readCliArg("opponent") || process.env.BENCH_OPPONENT?.trim() || "";
const abilityPolicy = (readCliArg("ability-policy") || process.env.BENCH_ABILITY_POLICY?.trim()) as "fast" | "semiIdeal" | undefined;
const maxTimeSec = Math.max(30, Number(readCliArg("max-time-sec") || process.env.BENCH_MAX_TIME_SEC?.trim() || "180"));

function computeLocalBuildRoutingFacts() {
  const sourceCreature = creatureByName[config.creatureName];
  const targetCreature = creatureByName[opponentName];
  if (!sourceCreature || !targetCreature) return null;
  const sourceBuild = {
    venerationStage: 5,
    traits: ["Bite", "Damage"],
    ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
    plushies: ["Void", "Void"],
    elder: "None",
  } as const;
  const finalA = memoizedApplyRulesAndBuild(sourceCreature, sourceBuild);
  const finalB = buildBestBuildsOpponentFinal(targetCreature);
  const actualBreathFight = (finalA.hasBreath || finalB.hasBreath);
  return {
    finalA: {
      hasBreath: finalA.hasBreath,
      breathType: finalA.breathType,
    },
    finalB: {
      hasBreath: finalB.hasBreath,
      breathType: finalB.breathType,
    },
    actualBreathFight,
  };
}

async function main() {
  if (!isKnownCreatureName(config.creatureName)) {
    console.log(JSON.stringify({ url: targetUrl, config, invalidCreature: true }, null, 2));
    return;
  }
  if (!opponentName) {
    throw new Error("Missing opponent name. Use --opponent <CreatureName> or BENCH_OPPONENT.");
  }

  const localBuildFacts = computeLocalBuildRoutingFacts();

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  try {
    await bootstrapBestBuildsDevApi(page, targetUrl);
    await configureBestBuilds(page, config);
    const result = await page.evaluate(
      async (payload) => {
        const api = Reflect.get(window, "__bestBuildsDevApi") as {
          inspectOpponentRuntimePaths: (input: {
            sourceCreatureName?: string;
            opponentName: string;
            abilityPolicy?: "fast" | "semiIdeal";
            maxTimeSec?: number;
          }) => Promise<unknown>;
        };
        return api.inspectOpponentRuntimePaths(payload);
      },
      {
        sourceCreatureName: config.creatureName,
        opponentName,
        abilityPolicy,
        maxTimeSec,
      },
    );

    console.log(
      JSON.stringify(
        {
          url: targetUrl,
          config,
          opponentName,
          localBuildFacts,
          abilityPolicy: abilityPolicy ?? "fast",
          maxTimeSec,
          result,
        },
        null,
        2,
      ),
    );
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
