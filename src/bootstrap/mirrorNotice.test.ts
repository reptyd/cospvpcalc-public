import { describe, it, expect } from "vitest";
import { shouldOfferMirror, MIRROR_URL } from "./mirrorNotice";

describe("shouldOfferMirror", () => {
  it("offers the mirror on the fragile .ru custom domain (case-insensitive)", () => {
    expect(shouldOfferMirror("cospvpcalc.ru")).toBe(true);
    expect(shouldOfferMirror("www.cospvpcalc.ru")).toBe(true);
    expect(shouldOfferMirror("COSPVPCALC.RU")).toBe(true);
  });

  it("does not offer the mirror on the mirror host itself", () => {
    expect(shouldOfferMirror("cospvpcalc.pages.dev")).toBe(false);
  });

  it("does not offer the mirror on localhost / preview / unknown hosts", () => {
    expect(shouldOfferMirror("localhost")).toBe(false);
    expect(shouldOfferMirror("127.0.0.1")).toBe(false);
    expect(shouldOfferMirror("feature-branch.cospvpcalc-public.pages.dev")).toBe(false);
    expect(shouldOfferMirror("")).toBe(false);
    expect(shouldOfferMirror(undefined)).toBe(false);
  });

  it("points at the pages.dev mirror", () => {
    expect(MIRROR_URL).toContain("cospvpcalc.pages.dev");
  });
});
