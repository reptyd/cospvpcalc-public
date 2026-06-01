/**
 * Full-matrix parity: every creature as source × every creature as opponent.
 * Aggregates divergences by opponent AND by source.
 * Usage: node --experimental-wasm-modules --import tsx scripts/parity_all.ts [--sample N]
 * Output: parity_all_report.json + console summary
 */
import { applyRulesAndBuild } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";
import { simulateBestBuildMatchupWithPath } from "../src/optimizer/bestBuildsRuntime";
import { writeFileSync } from "fs";

const BUILD = {
  venerationStage: 5,
  traits: ["Damage", "Bite"] as [string, string],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"] as [string, string, string, string, string],
  plushies: ["Void", "Void"] as [string, string],
};

type Divergence = {
  source: string;
  opponent: string;
  type: "WRONG_WINNER" | "TTK>1s" | "SURV>1s";
  ttkDiff: number;
  survDiff: number;
  rustWinner: string;
  tsWinner: string;
  rustTtk: number;
  tsTtk: number;
  rustSurv: number;
  tsSurv: number;
  path: string;
};

async function main() {
  const sampleArg = process.argv.indexOf("--sample");
  const sampleN = sampleArg >= 0 ? parseInt(process.argv[sampleArg + 1], 10) : 0;

  await loadRustMatchupBridge();
  const allNames = Object.keys(creatureByName);
  const sources = sampleN > 0 ? allNames.slice(0, sampleN) : allNames;

  console.log(`[parity_all] sources=${sources.length} opponents=${allNames.length} matchups=${sources.length * (allNames.length - 1)}`);

  const divergences: Divergence[] = [];
  const bySource = new Map<string, { total: number; wrongWinner: number; ttkGt1: number; survGt1: number; errors: number }>();
  const byOpponent = new Map<string, { total: number; wrongWinner: number; ttkGt1: number; survGt1: number; errors: number; sampleDetail: string[] }>();

  let processed = 0;
  const total = sources.length * (allNames.length - 1);
  const startTs = Date.now();

  for (const srcName of sources) {
    const source = creatureByName[srcName];
    if (!source) continue;
    let finalA;
    try { finalA = applyRulesAndBuild(source, BUILD); } catch { continue; }
    const srcStat = { total: 0, wrongWinner: 0, ttkGt1: 0, survGt1: 0, errors: 0 };
    bySource.set(srcName, srcStat);

    for (const oppName of allNames) {
      if (oppName === srcName) continue;
      const opp = creatureByName[oppName]!;
      processed++;
      if (processed % 500 === 0) {
        const elapsed = (Date.now() - startTs) / 1000;
        const rate = processed / elapsed;
        const eta = (total - processed) / rate;
        console.log(`[parity_all] ${processed}/${total} (${(processed/total*100).toFixed(1)}%) rate=${rate.toFixed(0)}/s eta=${(eta/60).toFixed(1)}min`);
      }

      let oppStat = byOpponent.get(oppName);
      if (!oppStat) {
        oppStat = { total: 0, wrongWinner: 0, ttkGt1: 0, survGt1: 0, errors: 0, sampleDetail: [] };
        byOpponent.set(oppName, oppStat);
      }
      srcStat.total++;
      oppStat.total++;

      let rust, tsSim, path = "";
      try {
        const r = simulateBestBuildMatchupWithPath({
          sourceCreature: source, finalA, opponentCreature: opp,
          activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
        });
        if (r.path.includes("fallback") || r.path.includes("skipped")) continue;
        rust = r.summary;
        path = r.path;

        setRustMatchupBridgeForceDisabled(true);
        const t = simulateBestBuildMatchupWithPath({
          sourceCreature: source, finalA, opponentCreature: opp,
          activesOn: true, breathOn: true, maxTimeSec: 180, abilityPolicy: "ideal",
        });
        setRustMatchupBridgeForceDisabled(false);
        tsSim = t.summary;
      } catch {
        setRustMatchupBridgeForceDisabled(false);
        srcStat.errors++;
        oppStat.errors++;
        continue;
      }

      const ttkDiff = Math.abs(rust.ttkAtoB - tsSim.ttkAtoB);
      const survDiff = Math.abs((rust.deathTimeA ?? 180) - (tsSim.deathTimeA ?? 180));
      const isWrong = rust.winner !== tsSim.winner;
      const isTtk = ttkDiff > 1.0;
      const isSurv = survDiff > 1.0;

      if (isWrong) { srcStat.wrongWinner++; oppStat.wrongWinner++; }
      if (isTtk) { srcStat.ttkGt1++; oppStat.ttkGt1++; }
      if (isSurv) { srcStat.survGt1++; oppStat.survGt1++; }

      if (isWrong || isTtk || isSurv) {
        const type = isWrong ? "WRONG_WINNER" : isTtk ? "TTK>1s" : "SURV>1s";
        divergences.push({
          source: srcName, opponent: oppName, type,
          ttkDiff, survDiff,
          rustWinner: rust.winner, tsWinner: tsSim.winner,
          rustTtk: rust.ttkAtoB, tsTtk: tsSim.ttkAtoB,
          rustSurv: rust.deathTimeA ?? 180, tsSurv: tsSim.deathTimeA ?? 180,
          path,
        });
        if (oppStat.sampleDetail.length < 3) {
          oppStat.sampleDetail.push(`${srcName}: ${type} ttkΔ=${ttkDiff.toFixed(2)} survΔ=${survDiff.toFixed(2)}`);
        }
      }
    }
  }

  const elapsed = (Date.now() - startTs) / 1000;
  console.log(`\n[parity_all] DONE in ${(elapsed/60).toFixed(1)}min  total divergences: ${divergences.length}`);

  // By-opponent ranked (worst first)
  const oppRanked = Array.from(byOpponent.entries())
    .map(([name, s]) => ({ name, ...s, score: s.wrongWinner * 1000 + s.ttkGt1 * 10 + s.survGt1 }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const srcRanked = Array.from(bySource.entries())
    .map(([name, s]) => ({ name, ...s, score: s.wrongWinner * 1000 + s.ttkGt1 * 10 + s.survGt1 }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  console.log(`\n=== TOP OPPONENTS (sources affected) ===`);
  console.log(`opponent | wrongWin | ttk>1s | surv>1s | total | sample`);
  for (const o of oppRanked.slice(0, 40)) {
    console.log(`  ${o.name.padEnd(20)} | ${String(o.wrongWinner).padStart(3)} | ${String(o.ttkGt1).padStart(4)} | ${String(o.survGt1).padStart(4)} | ${o.total} | ${o.sampleDetail[0] || ""}`);
  }

  console.log(`\n=== TOP SOURCES (opponents with divergence) ===`);
  console.log(`source | wrongWin | ttk>1s | surv>1s | errors`);
  for (const s of srcRanked.slice(0, 20)) {
    console.log(`  ${s.name.padEnd(20)} | ${String(s.wrongWinner).padStart(3)} | ${String(s.ttkGt1).padStart(4)} | ${String(s.survGt1).padStart(4)} | ${s.errors}`);
  }

  // Write full report
  const report = {
    meta: { sources: sources.length, opponents: allNames.length, totalMatchups: total, elapsedSec: elapsed, date: new Date().toISOString() },
    totals: {
      wrongWinner: divergences.filter(d => d.type === "WRONG_WINNER").length,
      ttkGt1: divergences.filter(d => d.type === "TTK>1s").length,
      survGt1: divergences.filter(d => d.type === "SURV>1s").length,
    },
    byOpponent: oppRanked,
    bySource: srcRanked,
    divergences: divergences.sort((a, b) => {
      const order = { WRONG_WINNER: 0, "TTK>1s": 1, "SURV>1s": 2 };
      return order[a.type] - order[b.type] || b.ttkDiff - a.ttkDiff;
    }),
  };
  writeFileSync("parity_all_report.json", JSON.stringify(report, null, 2));
  console.log(`\n[parity_all] report written to parity_all_report.json`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
