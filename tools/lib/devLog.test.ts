import { describe, it, expect } from "vitest";
import { splitPost, lint } from "./devLog";

const CLEAN = [
  "<@&123>",
  "# Sonaria Stat Lab Update",
  "",
  "## Ability Policies",
  "**Fortify**",
  "- Timing is now decided by simulation, not a fixed stack count.",
  "",
  "## Bug Fixes",
  "**Rewind**",
  "- Now fires only when it would raise HP (was: fired below 75%).",
].join("\n");

const hasError = (text: string, re: RegExp): boolean => lint(text).errors.some((e) => re.test(e));
const hasWarning = (text: string, re: RegExp): boolean => lint(text).warnings.some((w) => re.test(w));

describe("lint", () => {
  it("passes a clean post with no errors or warnings", () => {
    expect(lint(CLEAN)).toEqual({ errors: [], warnings: [] });
  });

  it("errors on a missing, duplicated, or misplaced role ping", () => {
    expect(hasError(CLEAN.replace("<@&123>\n", ""), /no role ping/)).toBe(true);
    expect(hasError(`${CLEAN}\n<@&456>`, /appears 2 times/)).toBe(true);
    expect(hasError(`intro\n${CLEAN}`, /first line/)).toBe(true);
  });

  it("errors on an em dash and on a horizontal rule", () => {
    expect(hasError(CLEAN.replace("not a", "not — a"), /em dash/)).toBe(true);
    expect(hasError(CLEAN.replace("## Bug Fixes", "---\n## Bug Fixes"), /Discord renders it/)).toBe(true);
  });

  it("warns on hype, a plural author, and emoji", () => {
    expect(hasWarning(`${CLEAN}\n- A huge improvement.`, /hype/)).toBe(true);
    expect(hasWarning(CLEAN.replace("Timing is", "We think timing is"), /plural author/)).toBe(true);
    expect(hasWarning(`${CLEAN}\n- fixed a 🐛`, /emoji/)).toBe(true);
  });

  it("allows a little first person and warns past the budget", () => {
    expect(hasWarning(`${CLEAN}\n- I can't simulate terrain.`, /first person/)).toBe(false);
    expect(hasWarning(`${CLEAN}\n- I can't simulate terrain, so I measured what I could.`, /first person/)).toBe(true);
  });

  it("does not treat formula arrows, times, or ceilings as emoji", () => {
    const withFormula = `${CLEAN}\n\`\`\`\nvalue = ⌈map(hp, [0.5,1] → [100,1])⌉ × 8.5\n\`\`\``;
    expect(hasWarning(withFormula, /emoji/)).toBe(false);
  });
});

describe("splitPost", () => {
  it("keeps a short post as one message", () => {
    expect(splitPost(CLEAN)).toHaveLength(1);
  });

  it("splits a long post on category boundaries", () => {
    const big = `<@&1>\n# T\n\n## A\n${"a".repeat(1000)}\n\n## B\n${"b".repeat(1000)}`;
    const messages = splitPost(big);
    expect(messages).toHaveLength(2);
    expect(messages[0].startsWith("<@&1>")).toBe(true);
    expect(messages[1].startsWith("## B")).toBe(true);
  });

  it("throws when a single section cannot be split", () => {
    expect(() => splitPost(`<@&1>\n# T\n\n## A\n${"a".repeat(2500)}`)).toThrow(/cannot be split/);
  });
});
