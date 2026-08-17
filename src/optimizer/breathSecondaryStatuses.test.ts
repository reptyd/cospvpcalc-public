import { describe, expect, it } from "vitest";
import breathSpecsRuntime from "../../data/breath_specs.runtime.json";
import { resolveStatusId } from "../engine/runtimeHelpers";
import { buildBreathProfileByName, SPEC_CHANCE_CORRECTIONS } from "./rustBestBuildsRuntime";

// The breath profile the app hands the engine is assembled by parsing the wiki
// spec text. That parse is the only thing between the data and the fight, and
// when it silently drops a clause the fight just stops applying a status - the
// Rust reference tests never notice, because they build their own profiles.
//
// So this reads the ailment clauses straight out of the same spec text the
// parser consumes, and requires the assembled profile to carry exactly them.
// Reading the source rather than a second copy of it is the point: a second copy
// can drift on its own, and then the test starts reporting its own drift as a
// parser bug.
//
// A clause names a status and a bracket: "X (Probability = N%, STACKS = M)",
// with the stack count sometimes written "no stacking" for a single
// application. Whether it lands on the target or the caster is decided by the
// nearest verb before it. Only an inflict clause rides the profile
// to the other side; a self-apply clause turning up in `specialStatuses` would
// be applying the caster's own buff to its target.
//
// Where the wiki text is known to be wrong the parser overrides it from
// SPEC_CHANCE_CORRECTIONS, so the expectation applies the same table. Each
// correction is also required to still bite, which is what keeps a stale row
// from sitting there once the wiki is fixed.

type BreathSpec = { name: string; raw?: string };

/** One ailment clause: the status it names, its chance, and its stack count. */
type Clause = [name: string, chancePct: number, stacks: number];

const specs = (breathSpecsRuntime as { breathTypes: BreathSpec[] }).breathTypes;

/** Breaths with no spec row, assembled from literals or not at all. */
const NO_SPEC_ROW = new Set(["Plasma Beam"]);

/** Ailment clauses in one spec's text, split by who they land on. */
function clausesIn(raw: string): { target: Clause[]; self: Clause[] } {
  const target: Clause[] = [];
  const self: Clause[] = [];
  // Sentence boundaries are no help here - "STACKS = 0.5" carries a full stop of
  // its own. So each clause is matched wherever it sits, and belongs to whichever
  // "It can also ..." phrase most recently preceded it.
  // The wiki writes the same thing five ways - "can also inflict", "can
  // inflict", "has a chance to inflict", a bare "inflicts", "self-apply" - so
  // the verb is the marker and the wrapping is ignored.
  const markers = [...raw.matchAll(/self-appl(?:y|ies)|inflicts?/gi)].map((m) => ({
    at: m.index ?? 0,
    self: m[0].toLowerCase().startsWith("self"),
  }));
  // The name is the run of capitalised words directly before the bracket, which
  // is what stops the match reaching back over "It can also inflict" and landing
  // ahead of its own marker.
  for (const clause of raw.matchAll(
    /([A-Z][A-Za-z'’]*(?:\s+[A-Z][A-Za-z'’]*){0,3})\s*\(\s*Probability\s*=\s*([\d.]+)%\s*,\s*(?:STACKS\s*=\s*([\d.]+)|no stacking)\s*\)/g,
  )) {
    const owner = markers.filter((m) => m.at < (clause.index ?? 0)).pop();
    if (!owner) continue;
    // "no stacking" is a single application, which is how the profile carries it.
    const stacks = clause[3] === undefined ? 1 : Number(clause[3]);
    (owner.self ? self : target).push([clause[1].trim(), Number(clause[2]), stacks]);
  }
  return { target, self };
}

describe("breath secondary statuses", () => {
  const withText = specs.filter((s) => typeof s.raw === "string" && s.raw.length > 0);

  it("every breath spec carries text to read", () => {
    // The rows below say nothing about a spec whose text went missing, so the
    // count is pinned rather than left to shrink quietly.
    expect(withText.length).toBe(specs.length);
    expect(specs.length).toBeGreaterThanOrEqual(24);
  });

  it.each(withText.map((s) => s.name))("%s applies exactly the statuses its spec text names", (name) => {
    const spec = specs.find((s) => s.name === name);
    const { target, self } = clausesIn(spec?.raw ?? "");

    const corrections = SPEC_CHANCE_CORRECTIONS[name] ?? [];
    const expected = new Map<string, number>();
    for (const [ailment, chancePct, stackCount] of target) {
      const statusId = resolveStatusId(ailment);
      expect(statusId, `${name}: "${ailment}" has no engine status id`).not.toBeNull();
      const fix = corrections.find((c) => resolveStatusId(c.status) === statusId && c.wikiPct === chancePct);
      expected.set(statusId!, ((fix?.gamePct ?? chancePct) / 100) * stackCount);
    }

    const applied = new Map(
      (buildBreathProfileByName(name)?.specialStatuses ?? []).map((s) => [s.statusId, s.stacks]),
    );
    expect([...applied.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [statusId, stacks] of expected) {
      expect(applied.get(statusId), `${name} / ${statusId}`).toBeCloseTo(stacks, 10);
    }

    // A self-apply clause must not reach the target.
    for (const [ailment] of self) {
      const statusId = resolveStatusId(ailment);
      if (statusId === null || target.some(([n]) => n === ailment)) continue;
      expect(applied.has(statusId), `${name}: ${ailment} is self-applied and must not ride the profile`).toBe(false);
    }

    for (const fix of corrections) {
      expect(
        target.some(([n, pct]) => resolveStatusId(n) === resolveStatusId(fix.status) && pct === fix.wikiPct),
        `${name}: the correction for ${fix.status} at ${fix.wikiPct}% no longer matches the spec text`,
      ).toBe(true);
    }
  });

  it("keeps Cloud Breath's self rolls off the target", () => {
    // Both of Cloud Breath's clauses are self-apply, so the profile it hands the
    // other side is empty. The engine self-applies Muddy on the cloud path.
    expect(buildBreathProfileByName("Cloud Breath")?.specialStatuses).toEqual([]);
    const { target, self } = clausesIn(specs.find((s) => s.name === "Cloud Breath")?.raw ?? "");
    expect(target).toEqual([]);
    expect(self.map(([n]) => n).sort()).toEqual(["Muddy", "Water Regeneration"]);
  });

  it("carries Plasma Beam's own constants, which no spec row holds", () => {
    // The one breath assembled from literals rather than the spec table. It was
    // written out twice and the copies drifted - Sandbox fired it at 50% crit
    // with no recast where the game gives 35% and 2.5 seconds.
    expect(specs.some((s) => NO_SPEC_ROW.has(s.name))).toBe(false);
    const profile = buildBreathProfileByName("Plasma Beam");
    expect(profile?.critChancePct).toBe(35);
    expect(profile?.autoFireDelaySec).toBeCloseTo(0.8, 10);
    expect(profile?.autoFireCooldownSec).toBeCloseTo(2.5, 10);
    expect(profile?.chargesMax).toBe(3);
    expect(profile?.chargeRegenSec).toBe(40);
  });
});
