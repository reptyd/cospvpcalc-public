import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEATHER,
  isAquaticType,
  isTerrestrialType,
  isWeatherImmune,
  normalizeWeather,
  type WeatherCondition,
} from "./weather";

// The Rust engine has no ability-by-name path, so whether a side shrugs off the
// weather is decided here and passed through as a bool. Nothing tested it, and
// the whole body could return false with the Rust weather tests still green -
// they seed the status directly and never ask who was supposed to be spared.

describe("weather immunity", () => {
  it("Volcanic ignores Heat Wave and nothing else [REF:status_heat_wave]", () => {
    expect(isWeatherImmune("heatWave", true, false)).toBe(true);
    expect(isWeatherImmune("heatWave", false, false)).toBe(false);
    // The ability is specific: it does not cover the other two.
    expect(isWeatherImmune("blizzard", true, false)).toBe(false);
    expect(isWeatherImmune("acidRain", true, false)).toBe(false);
  });

  it("Frosty ignores Blizzard and nothing else [REF:status_hypothermia]", () => {
    expect(isWeatherImmune("blizzard", false, true)).toBe(true);
    expect(isWeatherImmune("blizzard", false, false)).toBe(false);
    expect(isWeatherImmune("heatWave", false, true)).toBe(false);
    expect(isWeatherImmune("acidRain", false, true)).toBe(false);
  });

  it("Acid Rain spares nobody [REF:status_acid_rain]", () => {
    expect(isWeatherImmune("acidRain", true, true)).toBe(false);
  });

  it("no weather is nothing to be immune to", () => {
    expect(isWeatherImmune("none", true, true)).toBe(false);
  });
});

describe("weather setting", () => {
  it("defaults to none", () => {
    expect(DEFAULT_WEATHER).toBe("none");
  });

  it("keeps the three real conditions and rejects everything else", () => {
    for (const value of ["heatWave", "blizzard", "acidRain"] satisfies WeatherCondition[]) {
      expect(normalizeWeather(value)).toBe(value);
    }
    // A stored value from an older build, or a typo, must not leave the setting
    // in a state the engine cannot read.
    for (const junk of [undefined, null, "", "none", "Thunderstorm", "HEATWAVE", 3, {}]) {
      expect(normalizeWeather(junk)).toBe("none");
    }
  });
});

describe("the Storming type gate", () => {
  it("reads the two types case-insensitively", () => {
    for (const value of ["Terrestrial", "terrestrial", "TERRESTRIAL", " Terrestrial "]) {
      expect(isTerrestrialType(value)).toBe(true);
      expect(isAquaticType(value)).toBe(false);
    }
    for (const value of ["Aquatic", "aquatic", " AQUATIC "]) {
      expect(isAquaticType(value)).toBe(true);
      expect(isTerrestrialType(value)).toBe(false);
    }
  });

  it("leaves Semi-Aquatic out of both", () => {
    // Storming is strictly terrestrial-versus-aquatic; a Semi-Aquatic falling
    // into either bucket would arm the debuff on a matchup that never has it.
    expect(isAquaticType("Semi-Aquatic")).toBe(false);
    expect(isTerrestrialType("Semi-Aquatic")).toBe(false);
  });

  it("treats a missing type as neither", () => {
    for (const value of [undefined, null, ""]) {
      expect(isTerrestrialType(value)).toBe(false);
      expect(isAquaticType(value)).toBe(false);
    }
  });
});
