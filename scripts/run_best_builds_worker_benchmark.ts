import { chromium } from "playwright";

type BenchmarkConfig = {
  creatureName: string;
  searchDepth: "soft" | "detailed";
  poolMode: "meta40" | "meta60" | "meta80" | "custom";
  poolScope: "sameOrHigher" | "sameOrLower" | "withinOneTier" | "exactTiers";
  selectedPoolTiers: number[];
  objective: "winRate" | "survival" | "avgDps" | "avgTtk" | "immortalDamage";
  useRustMatchupRuntime: boolean;
  benchmarkMode: "both" | "ts" | "rust";
};

const DEFAULT_CONFIG: BenchmarkConfig = {
  creatureName: process.env.BENCH_CREATURE?.trim() || "Sigmatox",
  searchDepth: (process.env.BENCH_SEARCH_DEPTH?.trim() as BenchmarkConfig["searchDepth"] | undefined) || "soft",
  poolMode: (process.env.BENCH_POOL_MODE?.trim() as BenchmarkConfig["poolMode"] | undefined) || "meta60",
  poolScope: (process.env.BENCH_POOL_SCOPE?.trim() as BenchmarkConfig["poolScope"] | undefined) || "withinOneTier",
  selectedPoolTiers: (process.env.BENCH_SELECTED_POOL_TIERS?.trim() || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5),
  objective: (process.env.BENCH_OBJECTIVE?.trim() as BenchmarkConfig["objective"] | undefined) || "avgTtk",
  useRustMatchupRuntime: process.env.BENCH_USE_RUST !== "0",
  benchmarkMode: (process.env.BENCH_MODE?.trim() as BenchmarkConfig["benchmarkMode"] | undefined) || "both",
};

const targetUrl = process.env.BENCH_URL?.trim() || "http://127.0.0.1:5173";
const headed = process.env.BENCH_HEADED === "1";
const repeatCount = Math.max(1, Number(process.env.BENCH_REPEAT?.trim() || "1"));

type WorkerBenchmarkResult = {
  tsElapsedMs: number | null;
  rustElapsedMs: number | null;
  tsTimings: unknown;
  rustTimings: unknown;
  tsRuntimePathTelemetry: unknown;
  rustRuntimePathTelemetry: unknown;
};

function summarizeSeries(values: number[]): { minMs: number; maxMs: number; meanMs: number; medianMs: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const mid = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return {
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    meanMs: sum / sorted.length,
    medianMs,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      window.localStorage.setItem("cos.appShell", "advanced");
    });
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await page.keyboard.type("IDDQD");
    await page.getByRole("button", { name: "Best Builds" }).click();
    await page.waitForFunction(() => typeof Reflect.get(window, "__bestBuildsDevApi") === "object");

    await page.evaluate((config) => {
      const api = Reflect.get(window, "__bestBuildsDevApi") as {
        configure: (input: {
          creatureName?: string;
          nextSearchDepth?: "soft" | "detailed";
          nextPoolMode?: "meta40" | "meta60" | "meta80" | "custom";
          nextPoolScope?: "sameOrHigher" | "sameOrLower" | "withinOneTier" | "exactTiers";
          nextSelectedPoolTiers?: number[];
          nextObjective?: "winRate" | "survival" | "avgDps" | "avgTtk" | "immortalDamage";
          nextUseRustMatchupRuntime?: boolean;
        }) => void;
      };
      api.configure({
        creatureName: config.creatureName,
        nextSearchDepth: config.searchDepth,
        nextPoolMode: config.poolMode,
        nextPoolScope: config.poolScope,
        nextSelectedPoolTiers: config.selectedPoolTiers,
        nextObjective: config.objective,
        nextUseRustMatchupRuntime: config.useRustMatchupRuntime,
      });
    }, DEFAULT_CONFIG);

    await page.waitForTimeout(250);
    const runs: WorkerBenchmarkResult[] = [];
    for (let index = 0; index < repeatCount; index += 1) {
      const result = await page.evaluate(async (benchmarkMode) => {
        const api = Reflect.get(window, "__bestBuildsDevApi") as {
          runWorkerBenchmark: (mode?: "both" | "ts" | "rust") => Promise<WorkerBenchmarkResult>;
        };
        return api.runWorkerBenchmark(benchmarkMode);
      }, DEFAULT_CONFIG.benchmarkMode);
      runs.push(result);
    }

    const tsSeries = runs
      .map((run) => run.tsElapsedMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const rustSeries = runs
      .map((run) => run.rustElapsedMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    console.log(
      JSON.stringify(
        {
          url: targetUrl,
          config: DEFAULT_CONFIG,
          repeatCount,
          summary: {
            ts: summarizeSeries(tsSeries),
            rust: summarizeSeries(rustSeries),
          },
          runs,
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
