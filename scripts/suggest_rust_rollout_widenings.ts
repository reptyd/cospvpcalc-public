import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { creatureByName } from "../src/engine/data";

type PoolMode = "meta40" | "meta60" | "meta80";
type PoolScope = "sameOrHigher" | "sameOrLower" | "withinOneTier";

type CliConfig = {
  poolMode: PoolMode;
  poolScope: PoolScope;
  concurrency: number;
  names: string[];
};

type DriftEntry = {
  label: string;
  drift: number;
  total: number;
};

type RolloutProbe = {
  sourceActivated: string[];
  sourceDrifts: DriftEntry[];
  defenderDrifts: DriftEntry[];
};

type AbilityProbeSummary = {
  abilityName: string;
  drifts: DriftEntry[];
};

type DefenderAbilityProbeSummary = {
  abilityName: string;
  opponents: number;
  drifts: DriftEntry[];
};

type ProfileSummary = {
  stage2Eligible: number;
  stage2Total: number;
  stage2Pct: number;
  breathDefenderActivatedBlockers: string[];
  breathDefenderPassiveBlockers: string[];
};

type Suggestion = {
  creature: string;
  sourceActivated: string[];
  stage2Pct: number;
  stage2Eligible: number;
  stage2Total: number;
  sourceSafeNoOps: string[];
  defenderSafeBreathNoOps: string[];
  manualPassiveBreathBlockers: string[];
};

const execFileAsync = promisify(execFile);

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  let poolMode: PoolMode = "meta80";
  let poolScope: PoolScope = "withinOneTier";
  let concurrency = 4;
  const names: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--pool-mode") {
      poolMode = (args[i + 1] ?? poolMode) as PoolMode;
      i += 1;
      continue;
    }
    if (arg === "--pool-scope") {
      poolScope = (args[i + 1] ?? poolScope) as PoolScope;
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
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error(`Unsupported concurrency: ${concurrency}`);
  }
  if (names.length === 0) {
    throw new Error("Usage: npx tsx scripts/suggest_rust_rollout_widenings.ts [--pool-mode meta80] [--pool-scope withinOneTier] [--concurrency 4] <Creature...>");
  }

  return { poolMode, poolScope, concurrency, names };
}

async function execScript(scriptPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "cmd.exe",
    ["/d", "/s", "/c", "npx.cmd", "tsx", scriptPath, ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return stdout;
}

function parseSourceActivated(stdout: string): string[] {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith("Source activated: "));
  if (!line) return [];
  const raw = line.slice("Source activated: ".length).trim();
  if (!raw || raw === "(none)") return [];
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseRolloutProbe(stdout: string): RolloutProbe {
  const lines = stdout.split(/\r?\n/);
  const driftRegex = /^(.+?): sourceDrift=(\d+)\/(\d+), defenderDrift=(\d+)\/(\d+)$/;
  const sourceActivated = parseSourceActivated(stdout);
  const sourceDrifts: DriftEntry[] = [];
  const defenderDrifts: DriftEntry[] = [];

  for (const line of lines) {
    const match = line.match(driftRegex);
    if (!match) continue;
    sourceDrifts.push({
      label: match[1],
      drift: Number(match[2]),
      total: Number(match[3]),
    });
    defenderDrifts.push({
      label: match[1],
      drift: Number(match[4]),
      total: Number(match[5]),
    });
  }

  return { sourceActivated, sourceDrifts, defenderDrifts };
}

function parseAbilityProbe(stdout: string): AbilityProbeSummary[] {
  const lines = stdout.split(/\r?\n/);
  const abilityRegex = /^(.+?): (.+)$/;
  const driftRegex = /([^=,]+)=(\d+)\/(\d+)/g;
  const results: AbilityProbeSummary[] = [];

  for (const line of lines) {
    if (line.startsWith("Source: ") || line.startsWith("Pool: ") || line.startsWith("Source activated: ")) continue;
    const match = line.match(abilityRegex);
    if (!match) continue;
    const drifts: DriftEntry[] = [];
    for (const entry of match[2].matchAll(driftRegex)) {
      drifts.push({
        label: entry[1].trim(),
        drift: Number(entry[2]),
        total: Number(entry[3]),
      });
    }
    if (drifts.length > 0) {
      results.push({ abilityName: match[1].trim(), drifts });
    }
  }

  return results;
}

function parseDefenderAbilityProbe(stdout: string): DefenderAbilityProbeSummary[] {
  const lines = stdout.split(/\r?\n/);
  const lineRegex = /^(.+?): opponents=(\d+), (.+)$/;
  const driftRegex = /([^=,]+)=(\d+)\/(\d+)/g;
  const results: DefenderAbilityProbeSummary[] = [];

  for (const line of lines) {
    const match = line.match(lineRegex);
    if (!match) continue;
    const drifts: DriftEntry[] = [];
    for (const entry of match[3].matchAll(driftRegex)) {
      drifts.push({
        label: entry[1].trim(),
        drift: Number(entry[2]),
        total: Number(entry[3]),
      });
    }
    results.push({
      abilityName: match[1].trim(),
      opponents: Number(match[2]),
      drifts,
    });
  }

  return results;
}

function parseNamedBlockers(stdout: string, header: string): string[] {
  const lines = stdout.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === header);
  if (headerIndex < 0) return [];
  const names: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith("  - ")) break;
    const match = line.match(/^\s*-\s+(.+?):\s+\d+$/);
    if (!match) break;
    names.push(match[1].trim());
  }
  return names;
}

function parseProfile(stdout: string): ProfileSummary {
  const stage2Line = stdout.split(/\r?\n/).find((line) => line.startsWith("Runtime stage2 coverage: "));
  if (!stage2Line) {
    throw new Error("Missing Runtime stage2 coverage line");
  }
  const stage2Match = stage2Line.match(/Runtime stage2 coverage:\s+(\d+)\/(\d+)\s+eligible\s+\(([\d.]+)%\)/);
  if (!stage2Match) {
    throw new Error(`Could not parse stage2 coverage: ${stage2Line}`);
  }

  return {
    stage2Eligible: Number(stage2Match[1]),
    stage2Total: Number(stage2Match[2]),
    stage2Pct: Number(stage2Match[3]),
    breathDefenderActivatedBlockers: [
      ...parseNamedBlockers(stdout, "Breath stage2 defender activated blockers (TS-modeled)"),
      ...parseNamedBlockers(stdout, "Breath stage2 defender activated blockers (TS-partial)"),
    ],
    breathDefenderPassiveBlockers: [
      ...parseNamedBlockers(stdout, "Breath stage2 defender passive blockers (TS-modeled)"),
      ...parseNamedBlockers(stdout, "Breath stage2 defender passive blockers (TS-partial)"),
    ],
  };
}

function isAllZero(drifts: DriftEntry[]): boolean {
  return drifts.length > 0 && drifts.every((entry) => entry.drift === 0);
}

async function analyzeCreature(creature: string, config: CliConfig): Promise<Suggestion> {
  const rolloutStdout = await execScript("scripts/probe_source_rollout_no_op.ts", [creature, config.poolMode, config.poolScope]);
  const rollout = parseRolloutProbe(rolloutStdout);
  const sourceSafeNoOps: string[] = [];

  if (rollout.sourceActivated.length > 0) {
    const sourceAbilityStdout = await execScript("scripts/probe_source_ability_no_op.ts", [creature]);
    const sourceAbilityResults = parseAbilityProbe(sourceAbilityStdout);
    for (const result of sourceAbilityResults) {
      if (isAllZero(result.drifts)) {
        sourceSafeNoOps.push(result.abilityName);
      }
    }
  }

  const profileStdout = await execScript("scripts/profile_rust_best_builds_eligibility.ts", [creature, config.poolMode, config.poolScope]);
  const profile = parseProfile(profileStdout);

  const defenderCandidates = [...new Set(profile.breathDefenderActivatedBlockers)].sort((a, b) => a.localeCompare(b));
  let defenderSafeBreathNoOps: string[] = [];
  if (defenderCandidates.length > 0) {
    const defenderProbeStdout = await execScript("scripts/probe_source_defender_ability_no_op.ts", [creature, ...defenderCandidates]);
    const defenderAbilityResults = parseDefenderAbilityProbe(defenderProbeStdout);
    defenderSafeBreathNoOps = defenderAbilityResults
      .filter((result) => result.opponents > 0 && isAllZero(result.drifts))
      .map((result) => result.abilityName);
  }

  return {
    creature,
    sourceActivated: rollout.sourceActivated,
    stage2Pct: profile.stage2Pct,
    stage2Eligible: profile.stage2Eligible,
    stage2Total: profile.stage2Total,
    sourceSafeNoOps,
    defenderSafeBreathNoOps,
    manualPassiveBreathBlockers: [...new Set(profile.breathDefenderPassiveBlockers)].sort((a, b) => a.localeCompare(b)),
  };
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

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main(): Promise<void> {
  const config = parseArgs();
  for (const name of config.names) {
    if (!creatureByName[name]) {
      throw new Error(`Unknown creature: ${name}`);
    }
  }

  const suggestions = await mapWithConcurrency(
    config.names,
    config.concurrency,
    (creature) => analyzeCreature(creature, config),
  );

  console.log(
    JSON.stringify(
      {
        poolMode: config.poolMode,
        poolScope: config.poolScope,
        concurrency: config.concurrency,
        results: suggestions,
      },
      null,
      2,
    ),
  );
}

void main();
