/// <reference types="node" />
// Committed-vs-fresh WASM freshness gate (the dump half). Skipped in normal
// runs; the CI `wasm-fresh` job runs it twice - once against the committed
// src/rust-pkg bundle, once after `npm run rust:build` - each time writing every
// creature's matchup summary to the path in WASM_FRESHNESS_DUMP. A separate
// compare step (scripts/compare_wasm_summaries.mjs) diffs the two dumps; any
// behavioural divergence means the committed bundle is stale (engine edited
// without a rebuild - the class that shipped the Aftershock/Aggressive inert
// bug). The two runs are separate processes because a 2nd WASM instance corrupts
// the bg.js memory view. Behaviour, not bytes - so it is OS-independent
// (committed bundle built on Windows, CI on Linux).
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { creaturesData } from "../engine/creatureData";
import { loadRustForNode, runMatchupSummary } from "./rustNodeMatchup";

const dumpPath = process.env.WASM_FRESHNESS_DUMP;

describe.skipIf(!dumpPath)("wasm freshness dump", () => {
  it("dumps every creature's summary vs a fixed opponent", async () => {
    const rustMod = await loadRustForNode();
    const opponent = creaturesData[0]!.name;
    const summaries: Record<string, unknown> = {};
    for (const c of creaturesData) {
      const s = runMatchupSummary(rustMod, c.name, opponent);
      summaries[c.name] = {
        winner: s.winner,
        deathTimeA: s.deathTimeA,
        deathTimeB: s.deathTimeB,
        finalHpA: s.finalHpA,
        finalHpB: s.finalHpB,
      };
    }
    writeFileSync(dumpPath!, `${JSON.stringify(summaries, null, 2)}\n`);
  }, 180_000);
});
