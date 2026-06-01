import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

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

type BatchResult = {
  results: Suggestion[];
};

type CliConfig = {
  runDir: string;
};

function parseArgs(): CliConfig {
  const runDir = process.argv[2];
  if (!runDir) {
    throw new Error("Usage: npx tsx scripts/summarize_rust_rollout_data_pass.ts <runDir>");
  }
  return { runDir: path.resolve(runDir) };
}

function isConfident(entry: Suggestion): boolean {
  return (
    entry.manualPassiveBreathBlockers.length === 0 &&
    entry.sourceSafeNoOps.length > 0 &&
    entry.defenderSafeBreathNoOps.length > 0
  );
}

function isUncertain(entry: Suggestion): boolean {
  return !isConfident(entry) || entry.manualPassiveBreathBlockers.length > 0;
}

async function main(): Promise<void> {
  const config = parseArgs();
  const names = await readdir(config.runDir);
  const batchFiles = names
    .filter((name) => /^batch-\d+\.json$/.test(name))
    .sort();

  const results: Suggestion[] = [];
  for (const fileName of batchFiles) {
    const fullPath = path.join(config.runDir, fileName);
    const raw = await readFile(fullPath, "utf8");
    if (!raw.trim().startsWith("{")) continue;
    const parsed = JSON.parse(raw) as BatchResult;
    if (!Array.isArray(parsed.results)) continue;
    results.push(...parsed.results);
  }

  const confident = results.filter(isConfident).sort((a, b) => b.stage2Pct - a.stage2Pct || a.creature.localeCompare(b.creature));
  const uncertain = results.filter(isUncertain).sort((a, b) => a.stage2Pct - b.stage2Pct || a.creature.localeCompare(b.creature));
  const manualPassive = results
    .filter((entry) => entry.manualPassiveBreathBlockers.length > 0)
    .sort((a, b) => a.creature.localeCompare(b.creature));

  const outDir = path.join(config.runDir, "derived");
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, "confident-candidates.json"), JSON.stringify(confident, null, 2));
  await writeFile(path.join(outDir, "uncertain-candidates.json"), JSON.stringify(uncertain, null, 2));
  await writeFile(path.join(outDir, "manual-passive-cases.json"), JSON.stringify(manualPassive, null, 2));
  await writeFile(path.join(outDir, "uncertain-names.txt"), `${uncertain.map((entry) => entry.creature).join("\n")}\n`);

  console.log(
    JSON.stringify(
      {
        runDir: config.runDir,
        totalResults: results.length,
        confidentCount: confident.length,
        uncertainCount: uncertain.length,
        manualPassiveCount: manualPassive.length,
        outDir,
      },
      null,
      2,
    ),
  );
}

void main();
