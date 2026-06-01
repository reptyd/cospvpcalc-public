import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { creatureByName } from "../src/engine/data";

type CliConfig = {
  poolMode: "meta40" | "meta60" | "meta80";
  poolScope: "sameOrHigher" | "sameOrLower" | "withinOneTier";
  limit: number;
  concurrency: number;
  names: string[];
};

type CoverageSummary = {
  creature: string;
  stage2Eligible: number;
  stage2Total: number;
  stage2Pct: number;
  selectedPaths: Array<{ name: string; count: number }>;
};

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  let poolMode: CliConfig["poolMode"] = "meta80";
  let poolScope: CliConfig["poolScope"] = "withinOneTier";
  let limit = 25;
  let concurrency = 6;
  const names: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--pool-mode") {
      poolMode = (args[i + 1] ?? poolMode) as CliConfig["poolMode"];
      i += 1;
      continue;
    }
    if (arg === "--pool-scope") {
      poolScope = (args[i + 1] ?? poolScope) as CliConfig["poolScope"];
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      limit = Number(args[i + 1] ?? limit);
      i += 1;
      continue;
    }
    if (arg === "--concurrency") {
      concurrency = Number(args[i + 1] ?? concurrency);
      i += 1;
      continue;
    }
    names.push(arg);
  }

  if (!["meta40", "meta60", "meta80"].includes(poolMode)) {
    throw new Error(`Unsupported pool mode: ${poolMode}`);
  }
  if (!["sameOrHigher", "sameOrLower", "withinOneTier"].includes(poolScope)) {
    throw new Error(`Unsupported pool scope: ${poolScope}`);
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Unsupported limit: ${limit}`);
  }
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error(`Unsupported concurrency: ${concurrency}`);
  }

  return { poolMode, poolScope, limit, concurrency, names };
}

function parseCoverageOutput(creature: string, stdout: string): CoverageSummary {
  const lines = stdout.split(/\r?\n/);
  const stage2Line = lines.find((line) => line.startsWith("Runtime stage2 coverage: "));
  if (!stage2Line) {
    throw new Error(`Missing stage2 coverage line for ${creature}`);
  }
  const match = stage2Line.match(/Runtime stage2 coverage:\s+(\d+)\/(\d+)\s+eligible\s+\(([\d.]+)%\)/);
  if (!match) {
    throw new Error(`Could not parse stage2 coverage for ${creature}: ${stage2Line}`);
  }
  const [, eligibleRaw, totalRaw, pctRaw] = match;

  const selectedPaths: Array<{ name: string; count: number }> = [];
  const selectedIdx = lines.findIndex((line) => line.trim() === "Runtime stage2 selected paths");
  if (selectedIdx >= 0) {
    for (let idx = selectedIdx + 1; idx < lines.length; idx += 1) {
      const line = lines[idx];
      if (!line.startsWith("  - ")) break;
      const pathMatch = line.match(/^\s*-\s+(.+?):\s+(\d+)$/);
      if (!pathMatch) break;
      selectedPaths.push({ name: pathMatch[1], count: Number(pathMatch[2]) });
    }
  }

  return {
    creature,
    stage2Eligible: Number(eligibleRaw),
    stage2Total: Number(totalRaw),
    stage2Pct: Number(pctRaw),
    selectedPaths,
  };
}

const execFileAsync = promisify(execFile);

async function runProfile(creature: string, config: CliConfig): Promise<CoverageSummary> {
  const { stdout } = await execFileAsync(
    "cmd.exe",
    ["/d", "/s", "/c", "npx.cmd", "tsx", "scripts/profile_rust_best_builds_eligibility.ts", creature, config.poolMode, config.poolScope],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return parseCoverageOutput(creature, stdout);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function main() {
  const config = parseArgs();
  const sourceNames = config.names.length > 0
    ? config.names
    : Object.keys(creatureByName).sort((a, b) => a.localeCompare(b));

  const allResults = await mapWithConcurrency(
    sourceNames,
    config.concurrency,
    (creature) => runProfile(creature, config),
  );
  const results = allResults.filter((summary) => summary.stage2Pct < 100);

  const sorted = results
    .sort((a, b) => a.stage2Pct - b.stage2Pct || a.creature.localeCompare(b.creature))
    .slice(0, config.limit);

  console.log(
    JSON.stringify(
      {
        poolMode: config.poolMode,
        poolScope: config.poolScope,
        concurrency: config.concurrency,
        totalProfiled: sourceNames.length,
        incompleteCount: results.length,
        shown: sorted.length,
        results: sorted,
      },
      null,
      2,
    ),
  );
}

void main();
