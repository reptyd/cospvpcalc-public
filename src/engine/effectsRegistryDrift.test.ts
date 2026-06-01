import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  generateRegistryRustSource,
  REGISTRY_OUT_PATH,
} from "../../scripts/gen_effects_registry";

/**
 * CI drift gate: every commit must keep the committed
 * `wasm-engine/src/effects_registry.rs` in sync with the current
 * NAME_TO_EFFECT_META + STATUS_REFERENCE_DRAFTS in
 * `src/engine/statusCatalog.ts`. If they diverge — someone edited the
 * TS catalog but forgot to run `npm run gen:registry` — this test
 * fails with a diff hint so the developer regenerates before merging.
 *
 * The codegen function is pure (no fs side-effects), so importing it
 * from the test here is safe — it only writes the file when
 * `gen_effects_registry.ts` is invoked as a CLI script.
 */
describe("effects registry codegen drift gate", () => {
  test("committed effects_registry.rs matches the current TS catalog", () => {
    const expected = generateRegistryRustSource();
    const actual = readFileSync(REGISTRY_OUT_PATH, "utf8");

    // Normalize line endings — git may check out CRLF on Windows while
    // the generator emits LF. Compare logical content, not byte-for-byte.
    const norm = (source: string) => source.replace(/\r\n/g, "\n");
    const expectedNorm = norm(expected);
    const actualNorm = norm(actual);

    if (expectedNorm !== actualNorm) {
      // Surface the path the developer needs to regenerate. The actual
      // diff is rendered by vitest below.
      console.error(
        `[effects-registry-drift] ${REGISTRY_OUT_PATH} is stale. Run \`npm run gen:registry\` and commit the result.`,
      );
    }

    expect(actualNorm).toBe(expectedNorm);
  });
});
