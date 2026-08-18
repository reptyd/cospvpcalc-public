import { describe, expect, it } from "vitest";

import { applyBbDefiledGroundToAbilityConfig } from "./bestBuildsBattleSettingsBridge";
import type { RustComposableAbilityConfig } from "./rustMatchupBridge";
import type { CreatureRuntime } from "../engine/types";

const creature = (abilities: string[]): CreatureRuntime =>
  ({
    name: "Test",
    activatedAbilities: abilities.map((name) => ({ name })),
  }) as unknown as CreatureRuntime;

const owner = () => creature(["Defiled Ground"]);
const bystander = () => creature(["Volcanic"]);

const setting = (
  side: "attacker" | "defender",
  level: number,
): Partial<RustComposableAbilityConfig> => ({
  [`${side}CompareDefiledGroundLevel`]: level,
});

describe("applyBbDefiledGroundToAbilityConfig", () => {
  it("gives an owner the level and its opponent the weakness", () => {
    const config = applyBbDefiledGroundToAbilityConfig(
      setting("attacker", 3),
      owner(),
      bystander(),
    );

    expect(config?.attackerCompareDefiledGroundLevel).toBe(3);
    expect(config?.defenderCompareDefiledGroundWeakness).toBe(true);
    // The owner does not stand on anyone else's ground.
    expect(config?.attackerCompareDefiledGroundWeakness).toBe(false);
    expect(config?.defenderCompareDefiledGroundLevel).toBe(0);
  });

  it("drops the level for a creature that does not own the ability", () => {
    // The setting is pool-wide, so it reaches builds that never defiled
    // anything; without the gate every one of them recovered ailments faster.
    const config = applyBbDefiledGroundToAbilityConfig(
      setting("attacker", 2),
      bystander(),
      bystander(),
    );

    expect(config?.attackerCompareDefiledGroundLevel).toBe(0);
    expect(config?.defenderCompareDefiledGroundWeakness).toBe(false);
  });

  it("afflicts the source when the opponent is the one who owns it", () => {
    const config = applyBbDefiledGroundToAbilityConfig(
      setting("defender", 1),
      bystander(),
      owner(),
    );

    expect(config?.defenderCompareDefiledGroundLevel).toBe(1);
    expect(config?.attackerCompareDefiledGroundWeakness).toBe(true);
    expect(config?.defenderCompareDefiledGroundWeakness).toBe(false);
  });

  it("gives both sides the weakness when both own it", () => {
    const config = applyBbDefiledGroundToAbilityConfig(
      { ...setting("attacker", 1), ...setting("defender", 2) },
      owner(),
      owner(),
    );

    expect(config?.attackerCompareDefiledGroundLevel).toBe(1);
    expect(config?.defenderCompareDefiledGroundLevel).toBe(2);
    expect(config?.attackerCompareDefiledGroundWeakness).toBe(true);
    expect(config?.defenderCompareDefiledGroundWeakness).toBe(true);
  });

  it("leaves the overlay alone when the setting is off", () => {
    const base: Partial<RustComposableAbilityConfig> = { attackerFortify: true };
    expect(applyBbDefiledGroundToAbilityConfig(base, owner(), owner())).toBe(base);
    expect(applyBbDefiledGroundToAbilityConfig(undefined, owner(), owner())).toBeUndefined();
  });

  it("keeps the rest of the overlay untouched", () => {
    const config = applyBbDefiledGroundToAbilityConfig(
      { ...setting("attacker", 3), attackerFortify: true, defenderRewind: true },
      owner(),
      bystander(),
    );

    expect(config?.attackerFortify).toBe(true);
    expect(config?.defenderRewind).toBe(true);
  });
});
