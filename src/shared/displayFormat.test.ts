import { describe, expect, it } from "vitest";
import { formatBreathCapacity, formatRoundedNumber } from "./displayFormat";

describe("breath capacity never reads as full while it is not", () => {
  it("keeps the tenth a small capacity turns on", () => {
    // The reported case: half a unit spent out of ten showed as "10 / 10".
    expect(formatBreathCapacity(9.5, 10)).toBe("9.5");
  });

  it("rounds down rather than up to the maximum", () => {
    expect(formatBreathCapacity(9.96, 10)).toBe("9.9");
    expect(formatBreathCapacity(9.999, 10)).toBe("9.9");
  });

  it("prints the maximum only when the value reaches it", () => {
    expect(formatBreathCapacity(10, 10)).toBe("10");
    expect(formatBreathCapacity(11, 10)).toBe("10");
  });

  it("rounds normally away from the maximum", () => {
    expect(formatBreathCapacity(4.04, 10)).toBe("4");
    expect(formatBreathCapacity(4.06, 10)).toBe("4.1");
    expect(formatBreathCapacity(0, 10)).toBe("0");
  });

  it("survives a creature with no breath", () => {
    expect(formatBreathCapacity(0, 0)).toBe("0");
    expect(formatBreathCapacity(Number.NaN, 10)).toBe("0");
  });

  // The plain formatter is what HP keeps using, and it is free to round up.
  it("leaves the plain formatter alone", () => {
    expect(formatRoundedNumber(9.96)).toBe("10");
  });
});
