import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  generateSpecConstantsRustSource,
  generateSpecConstantsTsSource,
  SPEC_CONSTANTS_RUST_OUT_PATH,
  SPEC_CONSTANTS_TS_OUT_PATH,
} from "../../scripts/gen_spec_constants";

/**
 * CI drift gate: the committed spec_constants.rs and
 * specConstants.generated.ts must stay in sync with the `specConstants`
 * blocks in src/pages/referenceContent.ts. If they diverge - someone
 * edited a magnitude (or a bullet that owns one) but forgot to run
 * `npm run gen:spec-constants` - this fails with a regenerate hint.
 *
 * The codegen functions are pure (no fs side-effects on import), so it
 * is safe to import and run them here.
 */
const norm = (source: string) => source.replace(/\r\n/g, "\n");

describe("spec constants codegen drift gate", () => {
  test("committed spec_constants.rs matches referenceContent.ts", () => {
    const expected = norm(generateSpecConstantsRustSource());
    const actual = norm(readFileSync(SPEC_CONSTANTS_RUST_OUT_PATH, "utf8"));
    if (expected !== actual) {
      console.error(
        `[spec-constants-drift] ${SPEC_CONSTANTS_RUST_OUT_PATH} is stale. Run \`npm run gen:spec-constants\` and commit.`,
      );
    }
    expect(actual).toBe(expected);
  });

  test("committed specConstants.generated.ts matches referenceContent.ts", () => {
    const expected = norm(generateSpecConstantsTsSource());
    const actual = norm(readFileSync(SPEC_CONSTANTS_TS_OUT_PATH, "utf8"));
    if (expected !== actual) {
      console.error(
        `[spec-constants-drift] ${SPEC_CONSTANTS_TS_OUT_PATH} is stale. Run \`npm run gen:spec-constants\` and commit.`,
      );
    }
    expect(actual).toBe(expected);
  });
});
