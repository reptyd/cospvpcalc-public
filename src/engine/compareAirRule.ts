export const DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC = 1.8;

/** Aerial Dodge roll style: the deterministic even spread (default) vs seeded
 *  independent rolls that vary per run (Compare / Sandbox only). */
export type AerialDodgeRollStyle = "even" | "random";

/** Default per-side chance (0..100) that an incoming bite / breath tick lands
 *  on an airborne creature under the Aerial Dodge rule; it dodges the rest. */
export const DEFAULT_AERIAL_DODGE_HIT_CHANCE_PCT = 25;
