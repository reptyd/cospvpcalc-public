import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  bootstrapBestBuildsDevApi,
  buildCacheKey,
  configureBestBuilds,
  getGitHead,
  getKnownCreatureNames,
  getWorktreeSignature,
  isKnownCreatureName,
  readCache,
  runMatchupParityScan,
  writeCache,
  type BestBuildsBenchmarkConfig,
  type MatchupParityScanProfile,
} from "./best_builds_browser_shared";

type RankedParityResult = {
  creatureName: string;
  invalidCreature?: boolean;
  timedOut?: boolean;
  mismatchCount: number;
  totalMatchups: number;
  profile: MatchupParityScanProfile | null;
  cache: {
    parity: boolean;
  };
};

function parityPriority(entry: RankedParityResult): number {
  const summary = entry.profile?.severitySummary;
  if (!summary) return entry.mismatchCount;
  return summary.p0 * 1_000_000 + summary.p1 * 100_000 + summary.p2;
}

function compareRankedParity(left: RankedParityResult, right: RankedParityResult): number {
  return parityPriority(right) - parityPriority(left) || right.mismatchCount - left.mismatchCount || left.creatureName.localeCompare(right.creatureName);
}

const targetUrl = process.env.BENCH_URL?.trim() || "http://127.0.0.1:5173";
const headed = process.env.BENCH_HEADED === "1";
const parallelism = Math.max(1, Number(process.env.BENCH_PARALLEL?.trim() || "4"));
const perCreatureTimeoutMs = Math.max(60_000, Number(process.env.BENCH_PER_CREATURE_TIMEOUT_MS?.trim() || "240000"));
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

const mode = (process.env.BENCH_MATCHUP_MODE?.trim() as "minimal" | "hybrid" | undefined) || "minimal";
const abilityPolicy = (process.env.BENCH_ABILITY_POLICY?.trim() as "fast" | "semiIdeal" | undefined) || "fast";
const maxTimeSec = Math.max(30, Number(process.env.BENCH_MAX_TIME_SEC?.trim() || "90"));
const opponentLimit = Math.max(4, Number(process.env.BENCH_MATCHUP_OPPONENTS?.trim() || "16"));
const mismatchLimit = Math.max(1, Number(process.env.BENCH_MISMATCH_LIMIT?.trim() || "40"));
const cacheMode = `matchup-parity-${mode}-${abilityPolicy}-${maxTimeSec}-${opponentLimit}`;

const progressRoot = path.resolve(".cache", "best-builds-browser", "runs");
const runKey = [
  baseConfig.nextSearchDepth,
  baseConfig.nextPoolMode,
  baseConfig.nextPoolScope,
  baseConfig.nextObjective,
  baseConfig.nextUseRustMatchupRuntime === false ? "ts" : "rust",
  "matchup-parity",
  mode,
  abilityPolicy,
  `t${maxTimeSec}`,
  `o${opponentLimit}`,
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
  mode: "minimal" | "hybrid";
  abilityPolicy: "fast" | "semiIdeal";
  maxTimeSec: number;
  opponentLimit: number;
  mismatchLimit: number;
  shardIndex: number;
  shardTotal: number;
  createdAt: string;
  updatedAt: string;
  ranked: RankedParityResult[];
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

function loadProgress(): RankedParityResult[] {
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

function writeProgress(ranked: RankedParityResult[]): void {
  fs.mkdirSync(progressRoot, { recursive: true });
  const progress: ProgressFile = {
    version: 1,
    runKey,
    selectionSignature,
    gitHead: getGitHead(),
    worktreeSignature: getWorktreeSignature(),
    targetUrl,
    baseConfig,
    mode,
    abilityPolicy,
    maxTimeSec,
    opponentLimit,
    mismatchLimit,
    shardIndex,
    shardTotal,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ranked: [...ranked].sort(compareRankedParity),
  };
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

async function openWorkerPage(): Promise<{ browser: import("playwright").Browser; page: Page }> {
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  await bootstrapBestBuildsDevApi(page, targetUrl);
  return { browser, page };
}

async function collectParityResult(page: Page, creatureName: string): Promise<RankedParityResult> {
  if (!isKnownCreatureName(creatureName)) {
    return {
      creatureName,
      invalidCreature: true,
      mismatchCount: 0,
      totalMatchups: 0,
      profile: null,
      cache: { parity: false },
    };
  }
  const config: BestBuildsBenchmarkConfig = { creatureName, ...baseConfig };
  const cachedParity = readCache<MatchupParityScanProfile>(config, cacheMode, targetUrl);
  const profile =
    cachedParity ??
    (await (async () => {
      await configureBestBuilds(page, config);
      const result = await runMatchupParityScan(page, { mode, abilityPolicy, maxTimeSec, opponentLimit, mismatchLimit });
      writeCache(config, cacheMode, targetUrl, result);
      return result;
    })());

  return {
    creatureName,
    mismatchCount: profile.mismatchCount,
    totalMatchups: profile.totalMatchups,
    profile,
    cache: {
      parity: Boolean(cachedParity),
    },
  };
}

async function collectWithTimeout(page: Page, creatureName: string): Promise<RankedParityResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      collectParityResult(page, creatureName),
      new Promise<RankedParityResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            creatureName,
            timedOut: true,
            mismatchCount: Number.MAX_SAFE_INTEGER,
            totalMatchups: 0,
            profile: null,
            cache: { parity: false },
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
            `[browser-parity-batch] ${completed}/${creatureNames.length} ${creatureName} mismatches=${result.mismatchCount} action=${result.profile?.severitySummary.suggestedAction ?? "inspect"} p0=${result.profile?.severitySummary.p0 ?? 0} p1=${result.profile?.severitySummary.p1 ?? 0} p2=${result.profile?.severitySummary.p2 ?? 0}`,
          );
        }
      } finally {
        await page.close();
        await browser.close();
      }
    }),
  );

  ranked.sort(compareRankedParity);
  writeProgress(ranked);
  console.log(
    JSON.stringify(
      {
        url: targetUrl,
        baseConfig,
        mode,
        abilityPolicy,
        maxTimeSec,
        opponentLimit,
        mismatchLimit,
        creatureNames,
        pendingCreatureNames,
        parallelism,
        perCreatureTimeoutMs,
        shardIndex,
        shardTotal,
        progressPath,
        cacheHint: {
          parityModeKeyExample: buildCacheKey({ creatureName: creatureNames[0] || "Sigmatox", ...baseConfig }, cacheMode),
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
