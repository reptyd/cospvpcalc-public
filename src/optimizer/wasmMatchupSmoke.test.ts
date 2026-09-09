/// <reference types="node" />
// Real-WASM matchup smoke test. Runs representative matchups through the ACTUAL
// shipped engine (src/rust-pkg/*.wasm) via the shared Node loader. This closes
// the verification gap behind two prod misses this session: nothing exercised a
// real matchup through the rebuilt WASM, so a broadened classification (Zeoarex
// block) and a stale WASM (Aftershock/Aggressive never rebuilt) both slipped.
// Eligibility/classification drift is guarded purely (eligibilityUnsupported.test);
// THIS guards that the rebuilt engine actually crunches matchups without
// panicking / returning garbage - incl. the creatures this session touched.
import { describe, expect, it } from "vitest";
import { creaturesData } from "../engine/creatureData";
import { loadRustForNode, runMatchupSummary } from "./rustNodeMatchup";

describe("rebuilt-WASM matchup smoke", () => {
  // Pairs exercise the surfaces this session touched: Zeoarex (Radiation Trail +
  // Yolk Bomb -> Aftershock), Garluhmoat (Lich Mark -> Aftershock), Eldervaine
  // (Heal Beam carrier, just removed from the hand-list). The Aftershock -20% /
  // Aggressive persistence engine logic is unit-tested in cargo; here we only
  // assert the shipped WASM compiled from that source actually RUNS.
  it.each([
    ["Zeoarex", "Eldervaine"],
    ["Garluhmoat", "Eldervaine"],
    ["Eldervaine", "Kragnyx"],
    ["Zeoarex", "Kragnyx"],
  ])("runs %s vs %s through the shipped WASM with finite results", async (a, b) => {
    const rustMod = await loadRustForNode();
    const r = runMatchupSummary(rustMod, a, b);
    for (const v of [r.finalHpA, r.finalHpB]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // A determinate outcome: at least one side's HP is sane (>= 0) and the sim
    // produced numbers rather than throwing / NaN.
    expect(r.finalHpA).toBeGreaterThanOrEqual(0);
    expect(r.finalHpB).toBeGreaterThanOrEqual(0);
  }, 30_000);

  // Broad backstop: every creature (as source, so its full ability wiring is
  // exercised) vs a fixed opponent must simulate without panicking. Catches a
  // WASM-level break on ANY creature, not just the touched ones above.
  it("every creature simulates against a fixed opponent without panicking", async () => {
    const rustMod = await loadRustForNode();
    const opponent = creaturesData[0]!.name;
    const failures: string[] = [];
    for (const c of creaturesData) {
      try {
        const r = runMatchupSummary(rustMod, c.name, opponent);
        if (!Number.isFinite(r.finalHpA) || !Number.isFinite(r.finalHpB)) {
          failures.push(`${c.name}: non-finite ${JSON.stringify({ finalHpA: r.finalHpA, finalHpB: r.finalHpB })}`);
        }
      } catch (err) {
        failures.push(`${c.name}: threw ${(err as Error)?.message ?? String(err)}`);
      }
    }
    expect(failures, `matchups that failed to run:\n${failures.join("\n")}`).toEqual([]);
  }, 120_000);
});
