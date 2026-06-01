import { chromium } from "playwright";
import {
  bootstrapBestBuildsDevApi,
  configureBestBuilds,
  isKnownCreatureName,
  readCache,
  runMatchupParityScan,
  writeCache,
  type BestBuildsBenchmarkConfig,
  type MatchupParityScanProfile,
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

const mode = (process.env.BENCH_MATCHUP_MODE?.trim() as "minimal" | "hybrid" | undefined) || "minimal";
const abilityPolicy = (process.env.BENCH_ABILITY_POLICY?.trim() as "fast" | "semiIdeal" | undefined) || "fast";
const maxTimeSec = Math.max(30, Number(process.env.BENCH_MAX_TIME_SEC?.trim() || "90"));
const opponentLimit = Math.max(4, Number(process.env.BENCH_MATCHUP_OPPONENTS?.trim() || "16"));
const mismatchLimit = Math.max(1, Number(process.env.BENCH_MISMATCH_LIMIT?.trim() || "40"));

async function main() {
  if (!isKnownCreatureName(config.creatureName)) {
    console.log(JSON.stringify({ url: cliTargetUrl || targetUrl, config, invalidCreature: true }, null, 2));
    return;
  }
  const cacheMode = `matchup-parity-${mode}-${abilityPolicy}-${maxTimeSec}-${opponentLimit}`;
  const effectiveUrl = cliTargetUrl || targetUrl;
  const cached = readCache<MatchupParityScanProfile>(config, cacheMode, effectiveUrl);
  if (cached) {
    console.log(JSON.stringify({ url: effectiveUrl, config, mode, abilityPolicy, maxTimeSec, opponentLimit, cached: true, result: cached }, null, 2));
    return;
  }

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  try {
    await bootstrapBestBuildsDevApi(page, effectiveUrl);
    await configureBestBuilds(page, config);
    const result = await runMatchupParityScan(page, { mode, abilityPolicy, maxTimeSec, opponentLimit, mismatchLimit });
    writeCache(config, cacheMode, effectiveUrl, result);
    console.log(JSON.stringify({ url: effectiveUrl, config, mode, abilityPolicy, maxTimeSec, opponentLimit, cached: false, result }, null, 2));
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
