/// <reference types="node" />
// The committed `src/rust-pkg/*.wasm` is what ships - CI does not rebuild it -
// so editing `contracts.rs` and skipping `npm run rust:build` leaves a binary
// whose wire contract is a version behind. Until now that showed up as a field
// arriving at the engine and being dropped in silence.
//
// The binary reports the digest of its own field set; `contractSchemaHash.
// generated.ts` carries the digest of the source it was generated from. Same
// function, both sides, so they part company exactly when the binary is stale.
// `rustMatchupLoader` makes the same comparison at load - hard in dev, a
// degraded bridge in prod - and this runs it in CI, where the mistake is
// cheapest to fix.
import { describe, expect, it } from "vitest";
import { CONTRACT_SCHEMA_HASH } from "./contractSchemaHash.generated";
import { loadRustForNode } from "./rustNodeMatchup";

describe("the shipped WASM was built from the current wire contract", () => {
  it("reports the digest this bundle expects", async () => {
    const rustMod = await loadRustForNode();
    expect(
      rustMod.rust_matchup_contract_version(),
      "the committed .wasm predates a contracts.rs change - run `npm run rust:build`",
    ).toBe(CONTRACT_SCHEMA_HASH);
  }, 30_000);
});
