/**
 * "Nearby radiated creatures" - shared across every battle surface that
 * exposes the control (Compare per-creature card, Best Builds / Optimizer
 * Battle Settings, Sandbox). Radiation's 0.5% max HP per tick is additive
 * across nearby radiated creatures, so the engine multiplies each radiated
 * fighter's Radiation DOT by (1 self + this count + the other fighter when it
 * too is radiated). The control is available in any battle (it is NOT gated on
 * an ability) and is a single matchup-level value shared by both sides.
 */
export const RADIATION_NEARBY_MAX = 20;

/** Clamp a raw input to the valid integer range [0, RADIATION_NEARBY_MAX]. */
export function clampRadiationNearby(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(RADIATION_NEARBY_MAX, Math.floor(value)));
}
