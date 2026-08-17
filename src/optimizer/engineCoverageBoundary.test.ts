import { describe, expect, it } from "vitest";
import { creatureByName, creaturesData } from "../engine/creatureData";
import { effectsCatalog } from "../engine/data";
import { isModeledForCoverage, isModeledOtherAbility } from "./abilityCoverageRegistry";
import { getRustUnsupportedPassiveAbilityNames } from "./rustEligibilityHelpers";
import {
  DEFAULT_PASSIVE_CONTOUR_ABILITY_FILTERS,
  isIgnoredUnimplementedAbilityName,
} from "./rustPassiveContourShared";
import {
  ABILITY_REGISTRY,
  COMPOSABLE_ROUTED_NAMES,
  deriveModeledOtherAbilityNames,
} from "./abilityRegistry";
import { normalizeAbilityName } from "../shared/abilityNameAliases";
import { GENERIC_TRAIL_STATUS } from "./runtimeAbilityValue";

// Every ability name the eligibility / coverage paths can see across the real
// roster: the passive/activated/breath lists on each creature plus the
// effects-catalog other-ability names. Used by the equivalence property test so
// the inversion is locked against the actual data surface, not a hand list.
function allRosterAbilityNames(): string[] {
  const names = new Set<string>();
  for (const creature of creaturesData) {
    for (const ability of creature.passiveAbilities ?? []) names.add(ability.name);
    for (const ability of creature.activatedAbilities ?? []) names.add(ability.name);
    for (const ability of creature.breathAbilities ?? []) names.add(ability.name);
    const effects = ((effectsCatalog as unknown) as Record<string, Record<string, Array<{ name?: string }>>>)[creature.name] ?? {};
    for (const section of ["otherAbilities", "specialAbilities", "specialAbilitiesDetailed"]) {
      for (const ability of effects[section] ?? []) {
        if (typeof ability.name === "string") names.add(ability.name);
      }
    }
  }
  return [...names];
}

// Guards the boundary that broke Zeoarex: COVERAGE-display breadth (generic
// trails, base-name value variants, compare-only toggles) must NEVER leak into
// the ENGINE-facing isModeledOtherAbility. The engine uses it to decide which
// abilities are "ignorable unimplemented" (skipped) vs routed to a passive
// contour; a false-positive routes an unhandled ability and BLOCKS the matchup.
describe("engine <-> coverage modeled-classification boundary", () => {
  it("keeps the engine 'modeled' check narrow while coverage stays broad", () => {
    for (const name of ["Radiation Trail", "Necropoison Trail", "Lance (Radiation)"]) {
      // Engine: must be ignorable (no real contour handler) -> not "modeled".
      expect(isModeledOtherAbility(name)).toBe(false);
      // Coverage display: correctly shows modeled (toggle / generic channel).
      expect(isModeledForCoverage(name)).toBe(true);
    }
  });

  it("every generic-channel trail stays engine-narrow / coverage-broad", () => {
    // Generalizes the Radiation/Necropoison cases to the whole generic-trail
    // registry (auto-covers any future row added to GENERIC_TRAIL_STATUS): the
    // engine routes these via the generic damage-trail channel, NOT a contour
    // handler, so isModeledOtherAbility MUST stay false (else the matchup
    // blocks), while coverage shows them modeled.
    for (const name of Object.keys(GENERIC_TRAIL_STATUS)) {
      expect(isModeledOtherAbility(name), `engine must treat ${name} as ignorable`).toBe(false);
      expect(isModeledForCoverage(name), `coverage must show ${name} modeled`).toBe(true);
    }
  });

  it("does not flag Zeoarex's Radiation Trail as a blocking unsupported passive", () => {
    // Real consumer: with coverage breadth leaked in, Radiation Trail showed as a
    // routed (unsupported-but-modeled) passive and the matchup could not run.
    const zeoarex = creatureByName["Zeoarex"];
    expect(zeoarex).toBeTruthy();
    const empty = new Set<string>();
    const unsupported = getRustUnsupportedPassiveAbilityNames(
      zeoarex,
      empty,
      empty,
      empty,
      DEFAULT_PASSIVE_CONTOUR_ABILITY_FILTERS,
    );
    expect(unsupported).not.toContain("Radiation Trail");
  });
});

// The fail-open inversion: isIgnoredUnimplementedAbilityName keys on the
// explicit COMPOSABLE_ROUTED_NAMES set rather than on any coverage-facing
// classification. These two tests pin that inversion: (1) the routed set is
// exactly what the registry says and the shipped predicate agrees with it, and
// (2) it actually decouples eligibility from coverage.
describe("fail-open inversion: routed-set keyed eligibility", () => {
  it("routes exactly what the registry marks routed, and the shipped predicate agrees", () => {
    // The routed set used to be reconstructed from the coverage classifiers,
    // which is what let a coverage-side edit move an engine boundary. It now
    // comes from the registry's own flags and from nowhere else, so this pins
    // it against those flags directly.
    const expected = new Set<string>([
      ...deriveModeledOtherAbilityNames(),
      ...ABILITY_REGISTRY.filter((entry) => entry.routedDespitePartialModel).map((entry) =>
        normalizeAbilityName(entry.name),
      ),
    ]);
    expect([...COMPOSABLE_ROUTED_NAMES].sort()).toEqual([...expected].sort());

    const names = allRosterAbilityNames();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(isIgnoredUnimplementedAbilityName(name), `shipped fn diverges for "${name}"`).toBe(
        !COMPOSABLE_ROUTED_NAMES.has(normalizeAbilityName(name)),
      );
    }
  });

  it("coverage membership does not gate eligibility (the Zeoarex break)", () => {
    // Radiation Trail is the canonical case: coverage shows it modeled (generic
    // trail channel), but the engine has no contour handler for it, so it is NOT
    // routed. A coverage-side edit that broadened the old isModeledOtherAbility
    // flipped this to "routed-but-unhandled" and blocked the matchup. With the
    // inversion, coverage membership is irrelevant - the routed set is the only
    // gate - so the ability stays ignorable (fails open) and never blocks.
    const name = "Radiation Trail";
    expect(isModeledForCoverage(name)).toBe(true);
    expect(COMPOSABLE_ROUTED_NAMES.has(normalizeAbilityName(name))).toBe(false);
    expect(isIgnoredUnimplementedAbilityName(name)).toBe(true);

    // Generalise to every coverage-broad-but-unrouted name: each must fail open.
    for (const trail of Object.keys(GENERIC_TRAIL_STATUS)) {
      if (COMPOSABLE_ROUTED_NAMES.has(normalizeAbilityName(trail))) continue;
      expect(isModeledForCoverage(trail), `coverage must show ${trail} modeled`).toBe(true);
      expect(
        isIgnoredUnimplementedAbilityName(trail),
        `${trail} is coverage-modeled but unrouted -> must fail open, not gate eligibility`,
      ).toBe(true);
    }

    // The real consumer: Zeoarex carries Radiation Trail and stays eligible -
    // the routed-set inversion keeps it out of the unsupported-passive set.
    const zeoarex = creatureByName["Zeoarex"];
    expect(zeoarex).toBeTruthy();
    const empty = new Set<string>();
    expect(
      getRustUnsupportedPassiveAbilityNames(
        zeoarex,
        empty,
        empty,
        empty,
        DEFAULT_PASSIVE_CONTOUR_ABILITY_FILTERS,
      ),
    ).not.toContain("Radiation Trail");
  });
});
