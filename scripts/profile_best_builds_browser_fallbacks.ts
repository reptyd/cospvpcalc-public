import { chromium } from "playwright";
import {
  bootstrapBestBuildsDevApi,
  configureBestBuilds,
  fallbackCountFromProfile,
  fallbackCountFromTelemetry,
  isKnownCreatureName,
  readCache,
  runFullFallbackProfile,
  runQuickFallbackScan,
  writeCache,
  type BestBuildsBenchmarkConfig,
  type RuntimePathProfile,
  type RuntimePathTelemetry,
} from "./best_builds_browser_shared";

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
const cliCreatureName = readCliArg("creature");
const cliTargetUrl = readCliArg("url");
const cliSearchDepth = readCliArg("search-depth");
const cliPoolMode = readCliArg("pool-mode");
const cliPoolScope = readCliArg("pool-scope");
const cliObjective = readCliArg("objective");
const profileMode =
  (process.env.BENCH_PROFILE_MODE?.trim() as "quick" | "full" | undefined) ||
  (process.argv.includes("--quick") ? "quick" : "full");
const selectedPoolTiers = (readCliArg("selected-pool-tiers") || process.env.BENCH_SELECTED_POOL_TIERS?.trim() || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);

const config: BestBuildsBenchmarkConfig = {
  creatureName: cliCreatureName || process.env.BENCH_CREATURE?.trim() || "Sigmatox",
  nextSearchDepth: ((cliSearchDepth || process.env.BENCH_SEARCH_DEPTH?.trim()) as "soft" | "detailed" | undefined) || "detailed",
  nextPoolMode:
    ((cliPoolMode || process.env.BENCH_POOL_MODE?.trim()) as
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
    ((cliPoolScope || process.env.BENCH_POOL_SCOPE?.trim()) as "sameOrHigher" | "sameOrLower" | "withinOneTier" | "exactTiers" | undefined) ||
    "withinOneTier",
  nextSelectedPoolTiers: selectedPoolTiers,
  nextObjective:
    ((cliObjective || process.env.BENCH_OBJECTIVE?.trim()) as
      | "winRate"
      | "survival"
      | "avgDps"
      | "avgTtk"
      | "immortalDamage"
      | undefined) || "avgTtk",
  nextUseRustMatchupRuntime: true,
};

async function main() {
  if (!isKnownCreatureName(config.creatureName)) {
    console.log(JSON.stringify({ url: cliTargetUrl || targetUrl, config, mode: profileMode, invalidCreature: true }, null, 2));
    return;
  }
  const effectiveUrl = cliTargetUrl || targetUrl;
  const quickCache = readCache<RuntimePathTelemetry>(config, "quick", effectiveUrl);
  const fullCache = profileMode === "full" ? readCache<RuntimePathProfile>(config, "full", effectiveUrl) : null;
  if (profileMode === "quick" && quickCache) {
    console.log(JSON.stringify({ url: effectiveUrl, config, mode: profileMode, cached: true, result: quickCache, totalTsFallback: fallbackCountFromTelemetry(quickCache) }, null, 2));
    return;
  }
  if (profileMode === "full" && fullCache) {
    console.log(JSON.stringify({ url: effectiveUrl, config, mode: profileMode, cached: true, result: fullCache, totalTsFallback: fallbackCountFromProfile(fullCache) }, null, 2));
    return;
  }

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  try {
    await bootstrapBestBuildsDevApi(page, effectiveUrl);
    await configureBestBuilds(page, config);
    if (profileMode === "quick") {
      const result = await runQuickFallbackScan(page);
      writeCache(config, "quick", effectiveUrl, result);
      console.log(JSON.stringify({ url: effectiveUrl, config, mode: profileMode, cached: false, result, totalTsFallback: fallbackCountFromTelemetry(result) }, null, 2));
      return;
    }

    const quickResult = quickCache ?? (await runQuickFallbackScan(page));
    if (!quickCache) writeCache(config, "quick", effectiveUrl, quickResult);
    if (fallbackCountFromTelemetry(quickResult) === 0) {
      const emptyProfile: RuntimePathProfile = {
        stage1: { totalPathCounts: quickResult.stage1, fallbackByOpponent: [] },
        stage2: { totalPathCounts: quickResult.stage2, fallbackByOpponent: [] },
      };
      writeCache(config, "full", effectiveUrl, emptyProfile);
      console.log(JSON.stringify({ url: effectiveUrl, config, mode: profileMode, cached: false, quickScan: quickResult, result: emptyProfile, totalTsFallback: 0 }, null, 2));
      return;
    }

    const result = await runFullFallbackProfile(page);
    writeCache(config, "full", effectiveUrl, result);
    console.log(JSON.stringify({ url: effectiveUrl, config, mode: profileMode, cached: false, quickScan: quickResult, result, totalTsFallback: fallbackCountFromProfile(result) }, null, 2));
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
