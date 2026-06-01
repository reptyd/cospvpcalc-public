// Weather cataclysms — a single global battle setting applied to BOTH
// sides at setup. Single source of truth shared by Compare, Best Builds,
// Optimizer, and Sandbox. The Rust engine seeds a single permanent
// (no-decay) status per non-immune side (see wasm-engine setup.rs +
// statuses::weather_status_id):
//
//   Heat Wave → Heat_Wave_Status   (1% maxHP/3s + 2 Burn; Volcanic immune)
//   Blizzard  → Hypothermia_Status (0.75% maxHP/3s; Frosty immune; laying
//               nullifies the damage)
//   Acid Rain → Acid_Rain_Status   (3% maxHP/3s + 2 Poison; no immunity)
//
// Thunderstorm is intentionally NOT a weather here — it surfaces as the
// separate "Storming" buff-menu debuff (see compareBuffConfig).

export type WeatherCondition = "none" | "heatWave" | "blizzard" | "acidRain";

export const DEFAULT_WEATHER: WeatherCondition = "none";

export const WEATHER_OPTIONS: Array<{ value: WeatherCondition; label: string }> = [
  { value: "none", label: "None" },
  { value: "heatWave", label: "Heat Wave" },
  { value: "blizzard", label: "Blizzard" },
  { value: "acidRain", label: "Acid Rain" },
];

/**
 * Whether a side is immune to the active weather, given whether it has the
 * Volcanic / Frosty abilities active in the current model. Volcanic ignores
 * Heat Wave; Frosty ignores Blizzard; Acid Rain (and "none") has no
 * immunity. The Rust engine has no ability-by-name path, so this is
 * resolved on the TS side and passed through the config as a bool.
 */
export function isWeatherImmune(
  weather: WeatherCondition,
  hasVolcanic: boolean,
  hasFrosty: boolean,
): boolean {
  if (weather === "heatWave") return hasVolcanic;
  if (weather === "blizzard") return hasFrosty;
  return false;
}

/** Normalize an unknown/legacy stored value to a valid WeatherCondition. */
export function normalizeWeather(value: unknown): WeatherCondition {
  return value === "heatWave" || value === "blizzard" || value === "acidRain"
    ? value
    : "none";
}

// Creature-type checks for the Storming gate. Case-insensitive so a custom
// creature tagged "Aquatic" / "aquatic" / "AQUATIC" all qualify (built-in
// creatures use the canonical "Terrestrial" / "Aquatic"). Semi-Aquatic is
// intentionally NOT aquatic here — Storming is strictly terrestrial-vs-aquatic.
export function isTerrestrialType(type: string | undefined | null): boolean {
  return (type ?? "").trim().toLowerCase() === "terrestrial";
}

export function isAquaticType(type: string | undefined | null): boolean {
  return (type ?? "").trim().toLowerCase() === "aquatic";
}
