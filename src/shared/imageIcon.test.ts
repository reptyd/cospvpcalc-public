import { describe, expect, it } from "vitest";
import { dataUrlByteLength, isCustomIconDataUrl } from "./imageIcon";

describe("isCustomIconDataUrl", () => {
  it("accepts image data URLs only", () => {
    expect(isCustomIconDataUrl("data:image/webp;base64,AAAA")).toBe(true);
    expect(isCustomIconDataUrl("data:image/png;base64,AAAA")).toBe(true);
  });

  it("rejects non-image and non-data values", () => {
    expect(isCustomIconDataUrl("data:text/plain;base64,AAAA")).toBe(false);
    expect(isCustomIconDataUrl("https://example.com/icon.png")).toBe(false);
    expect(isCustomIconDataUrl("Adharcaiin")).toBe(false);
    expect(isCustomIconDataUrl(null)).toBe(false);
    expect(isCustomIconDataUrl(undefined)).toBe(false);
  });
});

describe("dataUrlByteLength", () => {
  it("returns the stored character length", () => {
    expect(dataUrlByteLength("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA".length);
  });
});
