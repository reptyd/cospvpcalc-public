import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  bootstrapBestBuildsDevApi,
  buildCacheKey,
  configureBestBuilds,
  fallbackCountFromProfile,
  fallbackCountFromTelemetry,
  getGitHead,
  getKnownCreatureNames,
  getWorktreeSignature,
  isKnownCreatureName,
  mapWithConcurrency,
  readCache,
  runFullFallbackProfile,
  runQuickFallbackScan,
  writeCache,
  type BestBuildsBenchmarkConfig,
  type RuntimePathProfile,
  type RuntimePathTelemetry,
} from "./best_builds_browser_shared";

type RankedResult = {
  creatureName: string;
  invalidCreature?: boolean;
  timedOut?: boolean;
  quickTelemetry: RuntimePathTelemetry;
  totalTsFallback: number;
  totalFallbackOpponents: number;
  profile: RuntimePathProfile | null;
  cache: {
    quick: boolean;
    full: boolean;
  };
};

const targetUrl = process.env.BENCH_URL?.trim() || "http://127.0.0.1:5173";
const headed = process.env.BENCH_HEADED === "1";
const explainAll = process.env.BENCH_EXPLAIN_ALL === "1";
const quickOnly = process.env.BENCH_QUICK_ONLY === "1";
const parallelism = Math.max(1, Number(process.env.BENCH_PARALLEL?.trim() || "4"));
const perCreatureTimeoutMs = Math.max(60_000, Number(process.env.BENCH_PER_CREATURE_TIMEOUT_MS?.trim() || "300000"));
const shardTotal = Math.max(1, Number(process.env.BENCH_SHARD_TOTAL?.trim() || "1"));
const shardIndexRaw = Number(process.env.BENCH_SHARD_INDEX?.trim() || "0");
const shardIndex = Math.max(0, Math.min(shardTotal - 1, Number.isFinite(shardIndexRaw) ? shardIndexRaw : 0));
const creatureNameFilter = process.env.BENCH_CREATURE_FILTER?.trim() || "";
const creaturePrefixFilter = process.env.BENCH_CREATURE_PREFIX?.trim() || "";
const explicitCreatureNames = (process.env.BENCH_CREATURES?.trim() || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const selectedPoolTiers = (process.env.BENCH_SELECTED_POOL_TIERS?.trim() || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);
const selectionSignature = crypto
  .createHash("sha1")
  .update(JSON.stringify({ explicitCreatureNames, creatureNameFilter, creaturePrefixFilter, shardIndex, shardTotal }))
  .digest("hex")
  .slice(0, 10);

const baseConfig: Omit<BestBuildsBenchmarkConfig, "creatureName"> = {
  nextSearchDepth: (process.env.BENCH_SEARCH_DEPTH?.trim() as BestBuildsBenchmarkConfig["nextSearchDepth"] | undefined) || "detailed",
  nextPoolMode:
    (process.env.BENCH_POOL_MODE?.trim() as BestBuildsBenchmarkConfig["nextPoolMode"] | undefined) || "meta80",
  nextPoolScope:
    (process.env.BENCH_POOL_SCOPE?.trim() as BestBuildsBenchmarkConfig["nextPoolScope"] | undefined) || "withinOneTier",
  nextSelectedPoolTiers: selectedPoolTiers,
  nextObjective: (process.env.BENCH_OBJECTIVE?.trim() as BestBuildsBenchmarkConfig["nextObjective"] | undefined) || "avgTtk",
  nextUseRustMatchupRuntime: true,
};

const progressRoot = path.resolve(".cache", "best-builds-browser", "runs");
const runKey = [
  baseConfig.nextSearchDepth,
  baseConfig.nextPoolMode,
  baseConfig.nextPoolScope,
  baseConfig.nextObjective,
  baseConfig.nextUseRustMatchupRuntime === false ? "ts" : "rust",
  quickOnly ? "quick-only" : explainAll ? "full-all" : "auto",
  `sel-${selectionSignature}`,
  `shard-${shardIndex + 1}-of-${shardTotal}`,
].join("__");
const progressPath = path.join(progressRoot, `${runKey}.json`);

type ProgressFile = {
  version: 1;
  runKey: string;
  selectionSignature: string;
  gitHead: string;
  worktreeSignature: string;
  targetUrl: string;
  baseConfig: Omit<BestBuildsBenchmarkConfig, "creatureName">;
  shardIndex: number;
  shardTotal: number;
  createdAt: string;
  updatedAt: string;
  ranked: RankedResult[];
};

function selectCreatureNames(): string[] {
  const sourceNames = explicitCreatureNames.length > 0 ? explicitCreatureNames : getKnownCreatureNames();
  const filtered = sourceNames.filter((name) => {
    if (creaturePrefixFilter && !name.toLowerCase().startsWith(creaturePrefixFilter.toLowerCase())) return false;
    if (creatureNameFilter && !name.toLowerCase().includes(creatureNameFilter.toLowerCase())) return false;
    return true;
  });
  return filtered.filter((_, index) => index % shardTotal === shardIndex);
}

function loadProgress(): RankedResult[] {
  try {
    if (!fs.existsSync(progressPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(progressPath, "utf8")) as ProgressFile;
    if (parsed.version !== 1 || parsed.runKey !== runKey) return [];
    if (parsed.selectionSignature !== selectionSignature) return [];
    if (parsed.gitHead !== getGitHead()) return [];
    if (parsed.worktreeSignature !== getWorktreeSignature()) return [];
    return parsed.ranked ?? [];
  } catch {
    return [];
  }
}

function writeProgress(ranked: RankedResult[]): void {
  fs.mkdirSync(progressRoot, { recursive: true });
  const progress: ProgressFile = {
    version: 1,
    runKey,
    selectionSignature,
    gitHead: getGitHead(),
    worktreeSignature: getWorktreeSignature(),
    targetUrl,
    baseConfig,
    shardIndex,
    shardTotal,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ranked: [...ranked].sort((a, b) => b.totalTsFallback - a.totalTsFallback || a.creatureName.localeCompare(b.creatureName)),
  };
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

async function openWorkerPage(): Promise<{ browser: import("playwright").Browser; page: Page }> {
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  await bootstrapBestBuildsDevApi(page, targetUrl);
  return { browser, page };
}

async function collectQuickResult(page: Page, creatureName: string): Promise<RankedResult> {
  if (!isKnownCreatureName(creatureName)) {
    return {
      creatureName,
      invalidCreature: true,
      quickTelemetry: { stage1: {}, stage2: {} },
      totalTsFallback: 0,
      totalFallbackOpponents: 0,
      profile: null,
      cache: { quick: false, full: false },
    };
  }
  const config: BestBuildsBenchmarkConfig = { creatureName, ...baseConfig };
  const cachedQuick = readCache<RuntimePathTelemetry>(config, "quick", targetUrl);
  const quickTelemetry =
    cachedQuick ??
    (await (async () => {
      await configureBestBuilds(page, config);
      const telemetry = await runQuickFallbackScan(page);
      writeCache(config, "quick", targetUrl, telemetry);
      return telemetry;
    })());

  const totalTsFallback = fallbackCountFromTelemetry(quickTelemetry);
  if ((totalTsFallback === 0 && !explainAll) || quickOnly) {
    const profile: RuntimePathProfile = {
      stage1: { totalPathCounts: quickTelemetry.stage1, fallbackByOpponent: [] },
      stage2: { totalPathCounts: quickTelemetry.stage2, fallbackByOpponent: [] },
    };
    if (totalTsFallback === 0) {
      writeCache(config, "full", targetUrl, profile);
    }
    return {
      creatureName,
      quickTelemetry,
      totalTsFallback,
      totalFallbackOpponents: 0,
      profile,
      cache: {
        quick: Boolean(cachedQuick),
        full: false,
      },
    };
  }

  const cachedFull = readCache<RuntimePathProfile>(config, "full", targetUrl);
  const profile =
    cachedFull ??
    (await (async () => {
      await configureBestBuilds(page, config);
      const fullProfile = await runFullFallbackProfile(page);
      writeCache(config, "full", targetUrl, fullProfile);
      return fullProfile;
    })());

  return {
    creatureName,
    quickTelemetry,
    totalTsFallback: cachedFull ? fallbackCountFromProfile(profile) : totalTsFallback,
    totalFallbackOpponents:
      (profile.stage1.fallbackByOpponent?.length ?? 0) + (profile.stage2.fallbackByOpponent?.length ?? 0),
    profile,
    cache: {
      quick: Boolean(cachedQuick),
      full: Boolean(cachedFull),
    },
  };
}

async function collectWithTimeout(page: Page, creatureName: string): Promise<RankedResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      collectQuickResult(page, creatureName),
      new Promise<RankedResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            creatureName,
            timedOut: true,
            quickTelemetry: { stage1: {}, stage2: {} },
            totalTsFallback: Number.MAX_SAFE_INTEGER,
            totalFallbackOpponents: 0,
            profile: null,
            cache: { quick: false, full: false },
          });
        }, perCreatureTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const creatureNames = selectCreatureNames();
  const selectedCreatureNameSet = new Set(creatureNames);
  const priorRanked = loadProgress();
  const usablePriorRanked = priorRanked.filter((entry) => selectedCreatureNameSet.has(entry.creatureName));
  const priorByName = new Map(usablePriorRanked.map((entry) => [entry.creatureName, entry]));
  const pendingCreatureNames = creatureNames.filter((name) => !priorByName.has(name));
  const ranked = [...usablePriorRanked];
  let completed = usablePriorRanked.length;

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(parallelism, pendingCreatureNames.length || 1)) }, async (_, workerIndex) => {
      const { browser, page } = await openWorkerPage();
      try {
        for (let index = workerIndex; index < pendingCreatureNames.length; index += parallelism) {
          const creatureName = pendingCreatureNames[index]!;
          const result = await collectWithTimeout(page, creatureName);
          ranked.push(result);
          completed += 1;
          writeProgress(ranked);
          console.error(
            `[browser-fallback-batch] ${completed}/${creatureNames.length} ${creatureName} ts_fallback=${result.totalTsFallback}`,
          );
        }
      } finally {
        await page.close();
        await browser.close();
      }
    }),
  );

  ranked.sort((a, b) => b.totalTsFallback - a.totalTsFallback || a.creatureName.localeCompare(b.creatureName));
  writeProgress(ranked);
  console.log(
    JSON.stringify(
      {
        url: targetUrl,
        baseConfig,
        creatureNames,
        pendingCreatureNames,
        parallelism,
        explainAll,
        quickOnly,
        perCreatureTimeoutMs,
        shardIndex,
        shardTotal,
        progressPath,
        cacheHint: {
          quickModeKeyExample: buildCacheKey({ creatureName: creatureNames[0] || "Sigmatox", ...baseConfig }, "quick"),
        },
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
