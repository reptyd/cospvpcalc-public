import { chromium } from "playwright";
import { creatureByName } from "../src/engine/creatureData";
import { memoizedApplyRulesAndBuild } from "../src/optimizer/bestBuildsOptimizations";
import { buildBestBuildsOpponentFinal } from "../src/optimizer/bestBuildsRuntime";
import {
  bootstrapBestBuildsDevApi,
  configureBestBuilds,
  isKnownCreatureName,
  type BestBuildsBenchmarkConfig,
} from "./best_builds_browser_shared";

type BuildOptions = {
  venerationStage: number;
  traits: string[];
  ascensionAssignments: string[];
  plushies: string[];
  elder?: string;
};

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
  const normalized = rawValue ?? fallback;
  if (normalized === "@empty") return [];
  return normalized
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const targetUrl = process.env.BENCH_URL?.trim() || "http://127.0.0.1:5173";
const headed = process.env.BENCH_HEADED === "1";
const selectedPoolTiers = (readCliArg("selected-pool-tiers") || process.env.BENCH_SELECTED_POOL_TIERS?.trim() || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);

const sourceCreatureName = readCliArg("creature") || process.env.BENCH_CREATURE?.trim() || "Imini";
const opponentName = readCliArg("opponent") || process.env.BENCH_OPPONENT?.trim() || "Kretapex";
const useTopResult = (readCliArg("use-top-result") || process.env.BENCH_USE_TOP_RESULT?.trim()) === "1";
const resultIndex = Math.max(0, Number(readCliArg("result-index") || process.env.BENCH_RESULT_INDEX?.trim() || "0"));
const activesOn = (readCliArg("actives-on") || process.env.BENCH_ACTIVES_ON?.trim()) === "0" ? false : true;
const breathOn = (readCliArg("breath-on") || process.env.BENCH_BREATH_ON?.trim()) === "0" ? false : true;
const abilityPolicy = ((readCliArg("ability-policy") || process.env.BENCH_ABILITY_POLICY?.trim()) as "fast" | "semiIdeal" | undefined) || "fast";
const maxTimeSec = Math.max(30, Number(readCliArg("max-time-sec") || process.env.BENCH_MAX_TIME_SEC?.trim() || "90"));

const build: BuildOptions = {
  venerationStage: Math.max(0, Number(readCliArg("veneration-stage") || process.env.BENCH_VENERATION_STAGE?.trim() || "5")),
  traits: parseListArg(readCliArg("traits") || process.env.BENCH_TRAITS?.trim(), "Bite,Damage"),
  ascensionAssignments: parseListArg(readCliArg("ascensions") || process.env.BENCH_ASCENSIONS?.trim(), "Damage,Damage,Damage,Damage,Damage"),
  plushies: parseListArg(readCliArg("plushies") || process.env.BENCH_PLUSHIES?.trim(), "Void,Void"),
  elder: readCliArg("elder") || process.env.BENCH_ELDER?.trim() || "None",
};

const config: BestBuildsBenchmarkConfig = {
  creatureName: sourceCreatureName,
  nextSearchDepth: ((readCliArg("search-depth") || process.env.BENCH_SEARCH_DEPTH?.trim()) as "soft" | "detailed" | undefined) || "soft",
  nextPoolMode:
    ((readCliArg("pool-mode") || process.env.BENCH_POOL_MODE?.trim()) as
      | "meta40"
      | "meta60"
      | "meta80"
      | "meta120"
      | "meta160"
      | "meta200"
      | "meta240"
      | "meta280"
      | "meta320"
      | "custom"
      | undefined) || "meta40",
  nextPoolScope:
    ((readCliArg("pool-scope") || process.env.BENCH_POOL_SCOPE?.trim()) as "sameOrHigher" | "sameOrLower" | "withinOneTier" | "exactTiers" | undefined) ||
    "withinOneTier",
  nextSelectedPoolTiers: selectedPoolTiers,
  nextObjective:
    ((readCliArg("objective") || process.env.BENCH_OBJECTIVE?.trim()) as
      | "winRate"
      | "survival"
      | "avgDps"
      | "avgTtk"
      | "immortalDamage"
      | undefined) || "avgTtk",
  nextUseRustMatchupRuntime: true,
};

function classifySeverity(input: {
  tsWinner: "A" | "B" | "Draw";
  rustWinner: "A" | "B" | "Draw";
  tsTtk: number;
  rustTtk: number;
  tsDps: number;
  rustDps: number;
}): "P0" | "P1" | "P2" {
  if (input.tsWinner !== input.rustWinner) return "P0";
  if (Math.abs(input.tsTtk - input.rustTtk) > 0.01 || Math.abs(input.tsDps - input.rustDps) > 0.01) return "P1";
  return "P2";
}

function computeLocalBuildRoutingFacts() {
  const sourceCreature = creatureByName[sourceCreatureName];
  const opponentCreature = creatureByName[opponentName];
  if (!sourceCreature || !opponentCreature) return null;
  const finalA = memoizedApplyRulesAndBuild(sourceCreature, build);
  const finalB = buildBestBuildsOpponentFinal(opponentCreature);
  const actualBreathFight = breathOn && (finalA.hasBreath || finalB.hasBreath);
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
  if (!isKnownCreatureName(sourceCreatureName) || !isKnownCreatureName(opponentName)) {
    console.log(
      JSON.stringify(
        {
          url: targetUrl,
          config,
          sourceCreatureName,
          opponentName,
          invalidCreature: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  const localBuildFacts = computeLocalBuildRoutingFacts();

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  try {
    await bootstrapBestBuildsDevApi(page, targetUrl);
    await configureBestBuilds(page, config);
    if (useTopResult) {
      await page.evaluate(async () => {
        const api = Reflect.get(window, "__bestBuildsDevApi") as {
          runBestBuilds: () => Promise<void>;
        };
        await api.runBestBuilds();
      });
      await page.waitForFunction(
        (expectedIndex) => {
          const api = Reflect.get(window, "__bestBuildsDevApi") as
            | {
                getResultsState: () => { count: number };
              }
            | undefined;
          return (api?.getResultsState?.().count ?? 0) > expectedIndex;
        },
        resultIndex,
        { timeout: 180000 },
      );
    }
    const result = await page.evaluate(
      async (payload) => {
        const api = Reflect.get(window, "__bestBuildsDevApi") as {
          inspectSingleMatchupParity: (input: typeof payload) => Promise<{
            opponentName: string;
            build: BuildOptions;
            activesOn: boolean;
            breathOn: boolean;
            abilityPolicy: "fast" | "semiIdeal";
            maxTimeSec: number;
            tsPath: string;
            rustPath: string;
            tsSummary: {
              winner: "A" | "B" | "Draw";
              ttkAtoB: number;
              dpsAtoB: number;
              damageDealtA: number;
              damageDealtAAtBDeath: number;
              extendedDamagePotentialA: number;
              deathTimeA: number | null;
              maxTimeSec: number;
            };
            rustSummary: {
              winner: "A" | "B" | "Draw";
              ttkAtoB: number;
              dpsAtoB: number;
              damageDealtA: number;
              damageDealtAAtBDeath: number;
              extendedDamagePotentialA: number;
              deathTimeA: number | null;
              maxTimeSec: number;
            };
          } | null>;
          inspectTopResultMatchupParity: (input: {
            sourceCreatureName?: string;
            opponentName: string;
            resultIndex?: number;
            abilityPolicy?: "fast" | "semiIdeal";
            maxTimeSec?: number;
          }) => Promise<{
            opponentName: string;
            build: BuildOptions;
            activesOn: boolean;
            breathOn: boolean;
            abilityPolicy: "fast" | "semiIdeal";
            maxTimeSec: number;
            tsPath: string;
            rustPath: string;
            tsSummary: {
              winner: "A" | "B" | "Draw";
              ttkAtoB: number;
              dpsAtoB: number;
              damageDealtA: number;
              damageDealtAAtBDeath: number;
              extendedDamagePotentialA: number;
              deathTimeA: number | null;
              maxTimeSec: number;
            };
            rustSummary: {
              winner: "A" | "B" | "Draw";
              ttkAtoB: number;
              dpsAtoB: number;
              damageDealtA: number;
              damageDealtAAtBDeath: number;
              extendedDamagePotentialA: number;
              deathTimeA: number | null;
              maxTimeSec: number;
            };
          } | null>;
        };
        if (payload.useTopResult) {
          return api.inspectTopResultMatchupParity({
            sourceCreatureName: payload.sourceCreatureName,
            opponentName: payload.opponentName,
            resultIndex: payload.resultIndex,
            abilityPolicy: payload.abilityPolicy,
            maxTimeSec: payload.maxTimeSec,
          });
        }
        return api.inspectSingleMatchupParity(payload);
      },
      {
        sourceCreatureName,
        opponentName,
        build,
        useTopResult,
        resultIndex,
        activesOn,
        breathOn,
        abilityPolicy,
        maxTimeSec,
      },
    );

    if (!result) {
      console.log(JSON.stringify({ url: targetUrl, config, sourceCreatureName, opponentName, result: null }, null, 2));
      return;
    }

    const severity = classifySeverity({
      tsWinner: result.tsSummary.winner,
      rustWinner: result.rustSummary.winner,
      tsTtk: result.tsSummary.ttkAtoB,
      rustTtk: result.rustSummary.ttkAtoB,
      tsDps: result.tsSummary.dpsAtoB,
      rustDps: result.rustSummary.dpsAtoB,
    });

    const tsEffective =
      result.tsSummary.winner === "A"
        ? result.tsSummary.damageDealtAAtBDeath + result.tsSummary.extendedDamagePotentialA
        : result.tsSummary.damageDealtA;
    const rustEffective =
      result.rustSummary.winner === "A"
        ? result.rustSummary.damageDealtAAtBDeath + result.rustSummary.extendedDamagePotentialA
        : result.rustSummary.damageDealtA;

    console.log(
      JSON.stringify(
        {
          url: targetUrl,
          config,
          sourceCreatureName,
          opponentName,
          useTopResult,
          resultIndex,
          build: result.build,
          activesOn: result.activesOn,
          breathOn: result.breathOn,
          localBuildFacts,
          abilityPolicy,
          maxTimeSec,
          severity,
          suggestedAction: severity === "P2" ? "keep_rust" : "fallback",
          result: {
            tsPath: result.tsPath,
            rustPath: result.rustPath,
            tsSummary: result.tsSummary,
            rustSummary: result.rustSummary,
            deltas: {
              ttk: result.rustSummary.ttkAtoB - result.tsSummary.ttkAtoB,
              dps: result.rustSummary.dpsAtoB - result.tsSummary.dpsAtoB,
              effective: rustEffective - tsEffective,
              survival:
                (result.rustSummary.deathTimeA ?? result.rustSummary.maxTimeSec) -
                (result.tsSummary.deathTimeA ?? result.tsSummary.maxTimeSec),
            },
          },
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
