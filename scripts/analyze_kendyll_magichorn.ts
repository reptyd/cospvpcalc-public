import { applyRulesAndBuild, type BuildOptions } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { simulateBestBuildMatchup } from "../src/optimizer/bestBuildsRuntime";
import { aggregateBestBuildsMatchupSummary, compareAggregate, type BestBuildAggregate } from "../src/optimizer/ranking";
import { buildDefaultMetaPool } from "../src/optimizer/poolUtils";
import { setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";

type Row = {
  opponent: string;
  winner: "A" | "B" | "Draw";
  ttkWin: number;
  effective: number;
  survival: number;
};

type BuildSpec = {
  label: string;
  build: BuildOptions;
};

function requireCreature(name: string) {
  const creature = creatureByName[name];
  if (!creature) throw new Error(`Missing creature: ${name}`);
  return creature;
}

function formatBuild(build: BuildOptions): string {
  return `traits=${build.traits.join("+")} asc=${build.ascensionAssignments.join(",")} plushies=${build.plushies.join("+")}`;
}

function summarize(rows: Row[]): BestBuildAggregate {
  const count = Math.max(1, rows.length);
  const wins = rows.filter((row) => row.winner === "A");
  const draws = rows.filter((row) => row.winner === "Draw");
  return {
    winRate: wins.length / count,
    drawRate: draws.length / count,
    avgSurvival: rows.reduce((sum, row) => sum + row.survival, 0) / count,
    avgDps: 0,
    avgTtkWin: wins.length > 0 ? wins.reduce((sum, row) => sum + row.ttkWin, 0) / wins.length : 180,
    avgImmortalDamage: rows.reduce((sum, row) => sum + row.effective, 0) / count,
  };
}

function compareBuilds(label: string, left: BuildSpec, right: BuildSpec, leftRows: Row[], rightRows: Row[]): void {
  const rightByOpponent = new Map(rightRows.map((row) => [row.opponent, row]));
  const leftWins = leftRows.filter((row) => row.winner === "A");
  const rightWins = rightRows.filter((row) => row.winner === "A");

  const onlyLeftWins = leftWins.filter((row) => rightByOpponent.get(row.opponent)?.winner !== "A");
  const onlyRightWins = rightWins.filter((row) => !leftWins.some((leftRow) => leftRow.opponent === row.opponent));

  const commonWins = leftWins
    .map((row) => {
      const other = rightByOpponent.get(row.opponent);
      if (!other || other.winner !== "A") return null;
      return {
        opponent: row.opponent,
        ttkDelta: row.ttkWin - other.ttkWin,
        effectiveDelta: row.effective - other.effective,
      };
    })
    .filter((row): row is { opponent: string; ttkDelta: number; effectiveDelta: number } => row !== null);

  const topTtk = [...commonWins].sort((a, b) => a.ttkDelta - b.ttkDelta).slice(0, 8);
  const worstTtk = [...commonWins].sort((a, b) => b.ttkDelta - a.ttkDelta).slice(0, 8);

  console.log(`\n=== ${label} ===`);
  console.log(`left:  ${left.label} | ${formatBuild(left.build)}`);
  console.log(`right: ${right.label} | ${formatBuild(right.build)}`);
  console.log(`left-only wins (${onlyLeftWins.length}): ${onlyLeftWins.map((row) => row.opponent).join(", ") || "-"}`);
  console.log(`right-only wins (${onlyRightWins.length}): ${onlyRightWins.map((row) => row.opponent).join(", ") || "-"}`);
  console.log("common wins with best left-side TTK deltas:");
  for (const row of topTtk) {
    console.log(`  ${row.opponent}: ttk ${row.ttkDelta.toFixed(2)}, eff ${row.effectiveDelta.toFixed(2)}`);
  }
  console.log("common wins with worst left-side TTK deltas:");
  for (const row of worstTtk) {
    console.log(`  ${row.opponent}: ttk ${row.ttkDelta.toFixed(2)}, eff ${row.effectiveDelta.toFixed(2)}`);
  }
}

function printStats(label: string, build: BuildOptions): void {
  const source = requireCreature(process.env.PROFILE_CREATURE?.trim() || "Kendyll");
  const final = applyRulesAndBuild(source, build);
  console.log(
    `${label}: damage=${final.damage.toFixed(3)} biteCooldown=${final.biteCooldown.toFixed(3)} regen=${final.healthRegen.toFixed(3)} health=${final.health.toFixed(2)}`,
  );
}

async function simulateBuild(spec: BuildSpec, pool: string[]): Promise<Row[]> {
  const source = requireCreature(process.env.PROFILE_CREATURE?.trim() || "Kendyll");
  const finalA = applyRulesAndBuild(source, spec.build);
  return pool.map((opponentName) => {
    const opponent = requireCreature(opponentName);
    const summary = simulateBestBuildMatchup({
      sourceCreature: source,
      finalA,
      opponentCreature: opponent,
      activesOn: true,
      breathOn: true,
      maxTimeSec: 180,
      abilityPolicy: "semiIdeal",
    });
    const agg = aggregateBestBuildsMatchupSummary(summary);
    return {
      opponent: opponentName,
      winner: summary.winner,
      ttkWin: agg.ttkWin,
      effective: agg.immortalDamage,
      survival: agg.survival,
    };
  });
}

async function main(): Promise<void> {
  setRustMatchupBridgeForceDisabled(true);

  const sourceName = process.env.PROFILE_CREATURE?.trim() || "Kendyll";
  const pool = buildDefaultMetaPool(sourceName, Number(process.env.PROFILE_POOL_SIZE ?? 80), process.env.PROFILE_POOL_SCOPE?.trim() || "withinOneTier");

  const builds: BuildSpec[] = [
    {
      label: "Void+Void 0/5",
      build: {
        venerationStage: 5,
        traits: ["Bite", "Damage"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
        plushies: ["Void", "Void"],
      },
    },
    {
      label: "Magi+Ice 1/4",
      build: {
        venerationStage: 5,
        traits: ["Bite", "Damage"],
        ascensionAssignments: ["Bite", "Damage", "Damage", "Damage", "Damage"],
        plushies: ["Magichorn Prongbug", "Ice Wolf"],
      },
    },
    {
      label: "Magi+Void 5/0",
      build: {
        venerationStage: 5,
        traits: ["Bite", "Damage"],
        ascensionAssignments: ["Bite", "Bite", "Bite", "Bite", "Bite"],
        plushies: ["Magichorn Prongbug", "Void"],
      },
    },
    {
      label: "Heartsnake+Void 0/5",
      build: {
        venerationStage: 5,
        traits: ["Bite", "Damage"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
        plushies: ["Heartsnake", "Void"],
      },
    },
    {
      label: "Ice+Void 0/5",
      build: {
        venerationStage: 5,
        traits: ["Bite", "Damage"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
        plushies: ["Ice Wolf", "Void"],
      },
    },
    {
      label: "Void+Void 1/4",
      build: {
        venerationStage: 5,
        traits: ["Bite", "Damage"],
        ascensionAssignments: ["Bite", "Damage", "Damage", "Damage", "Damage"],
        plushies: ["Void", "Void"],
      },
    },
    {
      label: "Void+Void 5/0",
      build: {
        venerationStage: 5,
        traits: ["Bite", "Damage"],
        ascensionAssignments: ["Bite", "Bite", "Bite", "Bite", "Bite"],
        plushies: ["Void", "Void"],
      },
    },
  ];

  const simulated = new Map<string, Row[]>();
  for (const build of builds) {
    printStats(build.label, build.build);
    const rows = await simulateBuild(build, pool);
    simulated.set(build.label, rows);
    const aggregate = summarize(rows);
    console.log(
      `${build.label}: winRate=${(aggregate.winRate * 100).toFixed(2)} drawRate=${(aggregate.drawRate * 100).toFixed(2)} avgTtk=${aggregate.avgTtkWin.toFixed(5)} avgEff=${aggregate.avgImmortalDamage.toFixed(2)}`,
    );
  }

  const ranked = builds
    .map((build) => ({
      build,
      aggregate: summarize(simulated.get(build.label)!),
    }))
    .sort((a, b) => compareAggregate(a.aggregate, b.aggregate, "avgTtk"));

  console.log("\n=== ranked by current TS objective (avgTtk) ===");
  for (const entry of ranked) {
    console.log(
      `${entry.build.label}: winRate=${(entry.aggregate.winRate * 100).toFixed(2)} avgTtk=${entry.aggregate.avgTtkWin.toFixed(5)} avgEff=${entry.aggregate.avgImmortalDamage.toFixed(2)}`,
    );
  }

  compareBuilds(
    "Void+Void 0/5 vs Magi+Ice 1/4",
    builds[0],
    builds[1],
    simulated.get(builds[0].label)!,
    simulated.get(builds[1].label)!,
  );
  compareBuilds(
    "Void+Void 0/5 vs Magi+Void 5/0",
    builds[0],
    builds[2],
    simulated.get(builds[0].label)!,
    simulated.get(builds[2].label)!,
  );
  compareBuilds(
    "Magi+Ice 1/4 vs Heartsnake+Void 0/5",
    builds[1],
    builds[3],
    simulated.get(builds[1].label)!,
    simulated.get(builds[3].label)!,
  );
  compareBuilds(
    "Magi+Ice 1/4 vs Ice+Void 0/5",
    builds[1],
    builds[4],
    simulated.get(builds[1].label)!,
    simulated.get(builds[4].label)!,
  );
  compareBuilds(
    "Magi+Ice 1/4 vs Void+Void 1/4",
    builds[1],
    builds[5],
    simulated.get(builds[1].label)!,
    simulated.get(builds[5].label)!,
  );
  compareBuilds(
    "Magi+Void 5/0 vs Void+Void 5/0",
    builds[2],
    builds[6],
    simulated.get(builds[2].label)!,
    simulated.get(builds[6].label)!,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
