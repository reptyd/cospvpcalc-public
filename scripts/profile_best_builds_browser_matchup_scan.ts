import { chromium } from "playwright";
import {
  bootstrapBestBuildsDevApi,
  configureBestBuilds,
  isKnownCreatureName,
  readCache,
  runMatchupRoutingScan,
  writeCache,
  type BestBuildsBenchmarkConfig,
  type MatchupRoutingScanProfile,
} from "./best_builds_browser_shared";

const targetUrl = process.env.BENCH_URL?.trim() || "http://127.0.0.1:5173";
const headed = process.env.BENCH_HEADED === "1";
const selectedPoolTiers = (process.env.BENCH_SELECTED_POOL_TIERS?.trim() || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);

const config: BestBuildsBenchmarkConfig = {
  creatureName: process.env.BENCH_CREATURE?.trim() || "Sigmatox",
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

async function main() {
  if (!isKnownCreatureName(config.creatureName)) {
    console.log(JSON.stringify({ url: targetUrl, config, invalidCreature: true }, null, 2));
    return;
  }
  const cacheMode = `matchup-routing-${mode}-${abilityPolicy}-${maxTimeSec}-${opponentLimit}`;
  const cached = readCache<MatchupRoutingScanProfile>(config, cacheMode, targetUrl);
  if (cached) {
    console.log(
      JSON.stringify(
        {
          url: targetUrl,
          config,
          mode,
          abilityPolicy,
          maxTimeSec,
          opponentLimit,
          cached: true,
          result: cached,
          totalTsFallback: cached.totalPathCounts.ts_fallback ?? 0,
        },
        null,
        2,
      ),
    );
    return;
  }

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  try {
    await bootstrapBestBuildsDevApi(page, targetUrl);
    await configureBestBuilds(page, config);
    const result = await runMatchupRoutingScan(page, { mode, abilityPolicy, maxTimeSec, opponentLimit, explainLimit });
    writeCache(config, cacheMode, targetUrl, result);
    console.log(
      JSON.stringify(
        {
          url: targetUrl,
          config,
          mode,
          abilityPolicy,
          maxTimeSec,
          opponentLimit,
          cached: false,
          result,
          totalTsFallback: result.totalPathCounts.ts_fallback ?? 0,
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
