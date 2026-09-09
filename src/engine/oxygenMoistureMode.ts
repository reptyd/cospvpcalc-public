// Oxygen / Moisture drain - a single global Compare-only battle setting applied
// to BOTH sides. Mutually exclusive modes; the Rust engine drains a per-side
// pool (sourced from each creature's oxygenTime / moistureTime stat) and, once
// the pool is empty, deals 5% max HP/sec:
//
//   ground     -> moisture pool drains 1/sec; once empty, -5% maxHP/sec FLOORED
//                at 50% maxHP (drying out never kills).
//   underwater -> oxygen pool drains 1/sec; once empty, -5% maxHP/sec with NO
//                floor (drowning is lethal).
//
// A side whose relevant-mode stat is 0/absent is immune in that mode. The drain
// is engine-native (see wasm-engine: config.oxygen_moisture_mode +
// oxygen_moisture.rs); this module is the single source of truth for the enum
// shared by Compare and Best Builds.

export type OxygenMoistureMode = "off" | "ground" | "underwater";

export const DEFAULT_OXYGEN_MOISTURE_MODE: OxygenMoistureMode = "off";

export const OXYGEN_MOISTURE_OPTIONS: Array<{ value: OxygenMoistureMode; label: string }> = [
  { value: "ground", label: "Ground" },
  { value: "underwater", label: "Underwater" },
];

/** Normalize an unknown/legacy stored value to a valid OxygenMoistureMode. */
export function normalizeOxygenMoistureMode(value: unknown): OxygenMoistureMode {
  return value === "ground" || value === "underwater" ? value : "off";
}
