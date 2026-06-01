import { chromium, type Browser, type Page } from "playwright";
import {
  bootstrapBestBuildsDevApi,
  configureBestBuilds,
  getKnownCreatureNames,
  isKnownCreatureName,
  readCache,
  runMatchupRoutingScan,
  writeCache,
  type BestBuildsBenchmarkConfig,
  type MatchupRoutingScanProfile,
} from "./best_builds_browser_shared";

const targetUrl = process.env.BENCH_URL?.trim() || "http://127.0.0.1:5173";
const headed = process.env.BENCH_HEADED === "1";
const parallelism = Math.max(1, Number(process.env.BENCH_PARALLEL?.trim() || "8"));
const selectedPoolTiers = (process.env.BENCH_SELECTED_POOL_TIERS?.trim() || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);
const explicitCreatureNames = (process.env.BENCH_CREATURES?.trim() || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const prefixFilter = process.env.BENCH_CREATURE_PREFIX?.trim()?.toLowerCase() || "";

const baseConfig: Omit<BestBuildsBenchmarkConfig, "creatureName"> = {
  nextSearchDepth: (process.env.BENCH_SEARCH_DEPTH?.trim() as "soft" | "detailed" | undefined) || "detailed",
  nextPoolMode:
    (process.env.BENCH_POOL_MODE?.trim() as
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
      | undefined) || "meta80",
  nextPoolScope:
    (process.env.BENCH_POOL_SCOPE?.trim() as "sameOrHigher" | "sameOrLower" | "withinOneTier" | "exactTiers" | undefined) ||
    "withinOneTier",
  nextSelectedPoolTiers: selectedPoolTiers,
  nextObjective:
    (process.env.BENCH_OBJECTIVE?.trim() as
      | "winRate"
      | "survival"
      | "avgDps"
      | "avgTtk"
      | "immortalDamage"
      | undefined) || "avgTtk",
  nextUseRustMatchupRuntime: true,
};

const mode = (process.env.BENCH_MATCHUP_MODE?.trim() as "minimal" | "hybrid" | undefined) || "minimal";
const abilityPolicy = (process.env.BENCH_ABILITY_POLICY?.trim() as "fast" | "semiIdeal" | undefined) || "fast";
const maxTimeSec = Math.max(30, Number(process.env.BENCH_MAX_TIME_SEC?.trim() || "90"));
const opponentLimit = Math.max(4, Number(process.env.BENCH_MATCHUP_OPPONENTS?.trim() || "16"));
const explainLimit = Math.max(1, Number(process.env.BENCH_EXPLAIN_LIMIT?.trim() || "20"));

type RankedResult = {
  creatureName: string;
  invalidCreature?: boolean;
  cached: boolean;
  totalTsFallback: number;
  result: MatchupRoutingScanProfile | null;
};

function selectCreatureNames(): string[] {
  const names = explicitCreatureNames.length > 0 ? explicitCreatureNames : getKnownCreatureNames();
  return names.filter((name) => !prefixFilter || name.toLowerCase().startsWith(prefixFilter));
}

async function openWorkerPage(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  await bootstrapBestBuildsDevApi(page, targetUrl);
  return { browser, page };
}

async function collectOne(page: Page, creatureName: string): Promise<RankedResult> {
  if (!isKnownCreatureName(creatureName)) {
    return { creatureName, invalidCreature: true, cached: false, totalTsFallback: 0, result: null };
  }
  const config: BestBuildsBenchmarkConfig = { creatureName, ...baseConfig };
  const cacheMode = `matchup-routing-${mode}-${abilityPolicy}-${maxTimeSec}-${opponentLimit}`;
  const cached = readCache<MatchupRoutingScanProfile>(config, cacheMode, targetUrl);
  if (cached) {
    return {
      creatureName,
      cached: true,
      totalTsFallback: cached.totalPathCounts.ts_fallback ?? 0,
      result: cached,
    };
  }
  await configureBestBuilds(page, config);
  const result = await runMatchupRoutingScan(page, { mode, abilityPolicy, maxTimeSec, opponentLimit, explainLimit });
  writeCache(config, cacheMode, targetUrl, result);
  return {
    creatureName,
    cached: false,
    totalTsFallback: result.totalPathCounts.ts_fallback ?? 0,
    result,
  };
}

async function main() {
  const creatureNames = selectCreatureNames();
  const ranked = new Array<RankedResult>(creatureNames.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(parallelism, creatureNames.length || 1)) }, async () => {
      const { browser, page } = await openWorkerPage();
      try {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= creatureNames.length) return;
          const creatureName = creatureNames[index]!;
          const result = await collectOne(page, creatureName);
          ranked[index] = result;
          console.error(`[matchup-scan] ${index + 1}/${creatureNames.length} ${creatureName} ts_fallback=${result.totalTsFallback}`);
        }
      } finally {
        await page.close();
        await browser.close();
      }
    }),
  );
  ranked.sort((a, b) => b.totalTsFallback - a.totalTsFallback || a.creatureName.localeCompare(b.creatureName));
  console.log(
    JSON.stringify(
      {
        url: targetUrl,
        baseConfig,
        mode,
        abilityPolicy,
        maxTimeSec,
        opponentLimit,
        explainLimit,
        parallelism,
        ranked,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
