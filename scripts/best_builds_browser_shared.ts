import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import type { Page } from "playwright";
import type { BuildOptions } from "../src/engine";

export type BestBuildsBenchmarkConfig = {
  creatureName: string;
  nextSearchDepth: "soft" | "detailed";
  nextPoolMode: "meta40" | "meta60" | "meta80" | "meta120" | "meta160" | "meta200" | "meta240" | "meta280" | "meta320" | "custom";
  nextPoolScope: "sameOrHigher" | "sameOrLower" | "withinOneTier" | "exactTiers";
  nextSelectedPoolTiers?: number[];
  nextObjective: "winRate" | "survival" | "avgDps" | "avgTtk" | "immortalDamage";
  nextUseRustMatchupRuntime?: boolean;
};

export type RuntimePathTelemetry = {
  stage1: Record<string, number>;
  stage2: Record<string, number>;
};

export type RuntimePathProfile = {
  stage1: {
    totalPathCounts: Record<string, number>;
    fallbackByOpponent?: Array<{ opponentName: string; count: number }> | string[];
  };
  stage2: {
    totalPathCounts: Record<string, number>;
    fallbackByOpponent?: Array<{ opponentName: string; count: number }> | string[];
  };
};

export type MatchupRoutingScanProfile = {
  mode: "minimal" | "hybrid";
  skeletonCount: number;
  fullPoolCount: number;
  opponentCount: number;
  abilityPolicy: "fast" | "semiIdeal";
  maxTimeSec: number;
  totalPathCounts: Record<string, number>;
  fallbackByOpponent: Array<{ opponentName: string; count: number }>;
};

export type MatchupParityScanProfile = {
  mode: "minimal" | "hybrid";
  skeletonCount: number;
  fullPoolCount: number;
  opponentCount: number;
  totalMatchups: number;
  mismatchCount: number;
  severitySummary: {
    p0: number;
    p1: number;
    p2: number;
    suggestedAction: "fallback" | "keep_rust" | "inspect";
    dominantContour: string | null;
  };
  mismatches: Array<{
    skeletonLabel: string;
    build: BuildOptions;
    activesOn: boolean;
    breathOn: boolean;
    opponentName: string;
    rustPath: string;
    severity: "P0" | "P1" | "P2";
    suggestedAction: "fallback" | "keep_rust" | "inspect";
    tsWinner: "A" | "B" | "Draw";
    rustWinner: "A" | "B" | "Draw";
    tsTtk: number;
    rustTtk: number;
    tsDps: number;
    rustDps: number;
    tsEffective: number;
    rustEffective: number;
    tsSurvival: number;
    rustSurvival: number;
  }>;
};

type CachedEntry<T> = {
  version: 1;
  gitHead: string;
  worktreeSignature: string;
  url: string;
  config: BestBuildsBenchmarkConfig;
  mode: string;
  value: T;
  createdAt: string;
};

const cacheRoot = path.resolve(".cache", "best-builds-browser");
const defaultWaitTimeoutMs = Math.max(30_000, Number(process.env.BENCH_WAIT_TIMEOUT_MS?.trim() || "180000"));
const creatureRuntimeDataPath = path.resolve("data", "creatures.runtime.json");

let knownCreatureNameSet: Set<string> | null = null;
let knownCreatureNamesSorted: string[] | null = null;

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "_");
}

export function getGitHead(): string {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").trim();
  } catch {
    return "unknown";
  }
}

export function getWorktreeSignature(): string {
  try {
    const status = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    const diff = execSync("git diff --no-ext-diff --binary", { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 20 * 1024 * 1024 }).toString("utf8");
    return crypto.createHash("sha1").update(status).update("\n---\n").update(diff).digest("hex");
  } catch {
    return "unknown";
  }
}

export function isKnownCreatureName(name: string): boolean {
  if (!knownCreatureNameSet) {
    try {
      const parsed = JSON.parse(fs.readFileSync(creatureRuntimeDataPath, "utf8")) as {
        creatures?: Array<{ name?: string }>;
      };
      knownCreatureNamesSorted = (parsed.creatures ?? [])
        .map((creature) => creature.name?.trim())
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => a.localeCompare(b));
      knownCreatureNameSet = new Set(knownCreatureNamesSorted);
    } catch {
      knownCreatureNamesSorted = [];
      knownCreatureNameSet = new Set();
    }
  }
  return knownCreatureNameSet.has(name);
}

export function getKnownCreatureNames(): string[] {
  if (!knownCreatureNameSet) {
    isKnownCreatureName("__bootstrap__");
  }
  return [...(knownCreatureNamesSorted ?? [])];
}

export function buildCacheKey(config: BestBuildsBenchmarkConfig, mode: string): string {
  const tierKey = config.nextPoolScope === "exactTiers" ? (config.nextSelectedPoolTiers ?? []).join("-") || "none" : "na";
  return [
    sanitizePathPart(config.creatureName),
    config.nextSearchDepth,
    config.nextPoolMode,
    config.nextPoolScope,
    tierKey,
    config.nextObjective,
    config.nextUseRustMatchupRuntime === false ? "ts" : "rust",
    mode,
  ].join("__");
}

export function readCache<T>(config: BestBuildsBenchmarkConfig, mode: string, url: string): T | null {
  if (process.env.BENCH_DISABLE_CACHE === "1") return null;
  const filePath = path.join(cacheRoot, `${buildCacheKey(config, mode)}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as CachedEntry<T>;
    if (parsed.version !== 1) return null;
    if (parsed.gitHead !== getGitHead()) return null;
    if (parsed.worktreeSignature !== getWorktreeSignature()) return null;
    if (parsed.url !== url) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

export function writeCache<T>(config: BestBuildsBenchmarkConfig, mode: string, url: string, value: T): void {
  if (process.env.BENCH_DISABLE_CACHE === "1") return;
  fs.mkdirSync(cacheRoot, { recursive: true });
  const filePath = path.join(cacheRoot, `${buildCacheKey(config, mode)}.json`);
  const entry: CachedEntry<T> = {
    version: 1,
    gitHead: getGitHead(),
    worktreeSignature: getWorktreeSignature(),
    url,
    config,
    mode,
    value,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
}

export function fallbackCountFromTelemetry(telemetry: RuntimePathTelemetry): number {
  return (
    (telemetry.stage1.ts_fallback ?? 0) +
    (telemetry.stage1.ts_guarded_fallback ?? 0) +
    (telemetry.stage1.ts_emergency_fallback ?? 0) +
    (telemetry.stage2.ts_fallback ?? 0) +
    (telemetry.stage2.ts_guarded_fallback ?? 0) +
    (telemetry.stage2.ts_emergency_fallback ?? 0)
  );
}

export function fallbackCountFromProfile(profile: RuntimePathProfile): number {
  return (
    (profile.stage1.totalPathCounts.ts_fallback ?? 0) +
    (profile.stage1.totalPathCounts.ts_guarded_fallback ?? 0) +
    (profile.stage1.totalPathCounts.ts_emergency_fallback ?? 0) +
    (profile.stage2.totalPathCounts.ts_fallback ?? 0) +
    (profile.stage2.totalPathCounts.ts_guarded_fallback ?? 0) +
    (profile.stage2.totalPathCounts.ts_emergency_fallback ?? 0)
  );
}

export async function bootstrapBestBuildsDevApi(page: Page, targetUrl: string): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("cos.appShell", "advanced");
  });
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.keyboard.type("IDDQD");
  await page.getByRole("button", { name: "Best Builds" }).click();
  await page.waitForFunction(() => typeof Reflect.get(window, "__bestBuildsDevApi") === "object", undefined, {
    timeout: defaultWaitTimeoutMs,
  });
}

export async function configureBestBuilds(page: Page, config: BestBuildsBenchmarkConfig): Promise<void> {
  await page.evaluate((payload) => {
    const api = Reflect.get(window, "__bestBuildsDevApi") as {
      configure: (input: BestBuildsBenchmarkConfig) => void;
    };
    api.configure(payload);
  }, config);
  await page.waitForFunction(
    ({ expectedCreatureName, expectedPoolScope, expectedSelectedPoolTiers }) => {
      const api = Reflect.get(window, "__bestBuildsDevApi") as
        | {
            getConfigState: () => {
              creatureName: string;
              activePoolLength: number;
              poolScope?: BestBuildsBenchmarkConfig["nextPoolScope"];
              selectedPoolTiers?: number[];
            };
          }
        | undefined;
      const state = api?.getConfigState?.();
      if (!state || state.creatureName !== expectedCreatureName || state.activePoolLength <= 0) return false;
      if (state.poolScope !== expectedPoolScope) return false;
      const actualTiers = [...(state.selectedPoolTiers ?? [])].sort((a, b) => a - b);
      const expectedTiers = [...(expectedSelectedPoolTiers ?? [])].sort((a, b) => a - b);
      return actualTiers.length === expectedTiers.length && actualTiers.every((value, index) => value === expectedTiers[index]);
    },
    {
      expectedCreatureName: config.creatureName,
      expectedPoolScope: config.nextPoolScope,
      expectedSelectedPoolTiers: config.nextPoolScope === "exactTiers" ? (config.nextSelectedPoolTiers ?? []) : [],
    },
    {
      timeout: defaultWaitTimeoutMs,
    },
  );
}

export async function runQuickFallbackScan(page: Page): Promise<RuntimePathTelemetry> {
  await page.evaluate(async () => {
    const api = Reflect.get(window, "__bestBuildsDevApi") as {
      runBestBuilds: () => Promise<void>;
    };
    await api.runBestBuilds();
  });
  await page.waitForFunction(() => {
    const api = Reflect.get(window, "__bestBuildsDevApi") as
      | {
          getRunState: () => { isRunning: boolean; runtimePathTelemetry: RuntimePathTelemetry | null };
        }
      | undefined;
    const state = api?.getRunState?.();
    return Boolean(state && !state.isRunning && state.runtimePathTelemetry);
  }, undefined, {
    timeout: defaultWaitTimeoutMs,
  });
  return page.evaluate(() => {
    const api = Reflect.get(window, "__bestBuildsDevApi") as {
      getRunState: () => { runtimePathTelemetry: RuntimePathTelemetry | null };
    };
    return api.getRunState().runtimePathTelemetry as RuntimePathTelemetry;
  });
}

export async function runFullFallbackProfile(page: Page): Promise<RuntimePathProfile> {
  await page.evaluate(async () => {
    const api = Reflect.get(window, "__bestBuildsDevApi") as {
      profileRuntimePathsByOpponent: () => Promise<void>;
    };
    await api.profileRuntimePathsByOpponent();
  });
  await page.waitForFunction(() => {
    const api = Reflect.get(window, "__bestBuildsDevApi") as
      | {
          getRuntimePathProfileState: () => { isRunning: boolean; profile: RuntimePathProfile | null };
        }
      | undefined;
    const state = api?.getRuntimePathProfileState?.();
    return Boolean(state && !state.isRunning && state.profile);
  }, undefined, {
    timeout: defaultWaitTimeoutMs,
  });
  return page.evaluate(() => {
    const api = Reflect.get(window, "__bestBuildsDevApi") as {
      getRuntimePathProfile: () => RuntimePathProfile;
    };
    return api.getRuntimePathProfile();
  });
}

export async function runMatchupRoutingScan(
  page: Page,
  input: {
    mode?: "minimal" | "hybrid";
    abilityPolicy?: "fast" | "semiIdeal";
    maxTimeSec?: number;
    opponentLimit?: number;
    explainLimit?: number;
  } = {},
): Promise<MatchupRoutingScanProfile> {
  return page.evaluate(async (payload) => {
    const api = Reflect.get(window, "__bestBuildsDevApi") as {
      runMatchupRoutingScan: (input?: typeof payload) => Promise<MatchupRoutingScanProfile>;
    };
    return api.runMatchupRoutingScan(payload);
  }, input);
}

export async function runMatchupParityScan(
  page: Page,
  input: {
    mode?: "minimal" | "hybrid";
    abilityPolicy?: "fast" | "semiIdeal";
    maxTimeSec?: number;
    opponentLimit?: number;
    mismatchLimit?: number;
  } = {},
): Promise<MatchupParityScanProfile> {
  return page.evaluate(async (payload) => {
    const api = Reflect.get(window, "__bestBuildsDevApi") as {
      runMatchupParityScan: (input?: typeof payload) => Promise<MatchupParityScanProfile>;
    };
    return api.runMatchupParityScan(payload);
  }, input);
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const safeConcurrency = Math.max(1, Math.min(concurrency, values.length || 1));
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: safeConcurrency }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= values.length) return;
        results[index] = await worker(values[index]!, index);
      }
    }),
  );
  return results;
}
