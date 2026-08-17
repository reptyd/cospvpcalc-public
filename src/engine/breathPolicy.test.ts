import { describe, expect, it } from "vitest";
import {
  getBreathPolicyKind,
  getDefaultBreathPolicy,
  resolveBreathPolicy,
} from "./breathPolicy";

// A chain breath ramps a multiplier, so tapping it the moment the bar allows
// keeps resetting the ramp and throws most of its damage away. That is the
// whole reason "auto" resolves differently for chain breaths - and the branch
// deciding it had no test, so it could return one answer for everything with
// the suite green.

describe("what kind of breath a creature has", () => {
  it("calls the ramping breaths chain", () => {
    for (const name of ["Energy Breath", "Lightning Breath", "Glacier Breath"]) {
      expect(getBreathPolicyKind({ breathType: name }), name).toBe("chain");
    }
  });

  it("calls an ordinary capacity breath normal", () => {
    for (const name of ["Fire Breath", "Acid Breath", "Water Breath"]) {
      expect(getBreathPolicyKind({ breathType: name }), name).toBe("normal");
    }
  });

  it("calls the self-timed breaths auto-fire", () => {
    // These run their own charge and cooldown model, so no firing discipline
    // applies to them at all.
    for (const name of ["Plasma Beam", "Solar Beam", "Spirit Glare", "Lance (Frostbite)"]) {
      expect(getBreathPolicyKind({ breathType: name }), name).toBe("autoFire");
    }
  });

  it("calls a creature with no breath none", () => {
    for (const value of [null, undefined, "", "N/A"]) {
      expect(getBreathPolicyKind({ breathType: value })).toBe("none");
    }
  });
});

describe("what auto means", () => {
  it("bursts a chain breath off a full bar [REF:ability_energy_breath]", () => {
    expect(getDefaultBreathPolicy("chain")).toBe("onFullBar");
    expect(resolveBreathPolicy("auto", "chain")).toBe("onFullBar");
  });

  it("fires everything else the moment it can", () => {
    for (const kind of ["normal", "autoFire", "none"] as const) {
      expect(getDefaultBreathPolicy(kind), kind).toBe("onAvailability");
      expect(resolveBreathPolicy("auto", kind), kind).toBe("onAvailability");
    }
  });

  it("gets out of the way once the user picks a mode", () => {
    // Auto is a default, not an override: a chosen mode has to survive the
    // chain-breath branch.
    for (const kind of ["chain", "normal", "autoFire", "none"] as const) {
      expect(resolveBreathPolicy("onAvailability", kind), kind).toBe("onAvailability");
      expect(resolveBreathPolicy("onFullBar", kind), kind).toBe("onFullBar");
      expect(resolveBreathPolicy("ideal", kind), kind).toBe("ideal");
    }
  });
});
