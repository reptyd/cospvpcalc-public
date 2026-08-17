/// <reference types="node" />
// Schema-seam parity gate. The TS<->WASM wire contract is defined twice by hand:
// the Rust structs `SimpleCombatantStats` / `ComposableAbilityConfig`
// (wasm-engine/src/{contracts,composable/config}.rs) and their TS mirrors
// `RustSimpleCombatantStats` / `RustComposableAbilityConfig` in
// rustMatchupBridge.ts. Compare is Rust-only, so a Rust field that isn't mirrored
// here is silently dropped at serialization - the field becomes a no-op in
// Compare with NO failing test (CLAUDE.md section 1 calls this the most common source of
// "I added the field but Compare ignores it").
//
// This gate closes that hole: the Rust field names are emitted to
// `wasm-engine/contract_manifest.json` by the `contract_manifest` cargo test
// (the single oracle), and here we extract the field names the TS mirror declares
// and assert the two sets are identical. A field added/renamed on either side, or
// a typo in the mirror's camelCase key, fails here naming the exact field.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeSource = readFileSync(path.resolve(here, "rustMatchupBridge.ts"), "utf8");
const manifest = JSON.parse(
  readFileSync(path.resolve(here, "../../wasm-engine/contract_manifest.json"), "utf8"),
) as Record<string, string[]>;

// Extract the top-level field names of a flat `export type X = { ... }` literal.
// Brace-depth tracking skips nested object types (selfDestructProfile, identity,
// inline Array<{...}> rows) so only the contract's own fields are counted.
function topLevelFieldNames(source: string, typeName: string): string[] {
  const marker = `export type ${typeName} = {`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`type ${typeName} not found in rustMatchupBridge.ts`);
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(`unterminated type ${typeName}`);
  const body = source
    .slice(openBrace + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const fields: string[] = [];
  let d = 0;
  for (const line of body.split("\n")) {
    const depthAtStart = d;
    for (const ch of line) {
      if (ch === "{") d++;
      else if (ch === "}") d--;
    }
    if (depthAtStart !== 0) continue;
    const m = line.trim().match(/^([A-Za-z_]\w*)\??\s*:/);
    if (m) fields.push(m[1]);
  }
  return fields.sort();
}

describe("TS↔Rust schema-seam parity", () => {
  it.each([
    ["RustSimpleCombatantStats", "simpleCombatantStats"],
    ["RustComposableAbilityConfig", "composableAbilityConfig"],
  ])("%s mirrors the Rust contract field-for-field", (tsType, manifestKey) => {
    const rustFields = manifest[manifestKey];
    expect(rustFields, `contract_manifest.json missing "${manifestKey}"`).toBeDefined();
    const tsFields = topLevelFieldNames(bridgeSource, tsType);
    // Symmetric: a Rust field absent here = silent Compare drop; a TS field absent
    // from Rust = a dead mirror entry. Both fail, naming the field.
    expect(tsFields).toEqual([...rustFields].sort());
  });
});
