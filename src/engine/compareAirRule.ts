export const DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC = 1.8;

/** Dodge roll style: the deterministic even spread (default) vs seeded
 *  independent rolls that vary per run (Compare / Sandbox only). */
export type AerialDodgeRollStyle = "even" | "random";

/** Default per-side chance (0..100) that an incoming bite / breath tick lands
 *  on a side under the Dodge Chance rule; it dodges the rest. */
export const DEFAULT_AERIAL_DODGE_HIT_CHANCE_PCT = 25;

/** The share of attacks that land, written as a plain fraction: 25 gives
 *  "1 in 4", 30 gives "3 in 10", 37 gives "37 in 100". Returns null where the
 *  fraction would have to be rounded to be written, so the percentage stands
 *  alone rather than beside a number it does not equal. */
export function hitChanceAsFraction(pct: number): string | null {
  if (!Number.isInteger(pct) || pct <= 0 || pct >= 100) return null;
  let a = pct;
  let b = 100;
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return `${pct / a} in ${100 / a}`;
}

/** Shredded Wings only reaches a creature that flies, so the rule needs saying
 *  wherever the dodge is configured. */
export const DODGE_SHREDDED_WINGS_NOTE =
  "Shredded Wings stops a flying creature from dodging. A creature that does not fly keeps its dodge.";

/** What a side's stat card shows for bite cooldown: the fixed number when that
 *  side is on a fixed cadence, and null when it keeps its own. Each side reads
 *  its own value - the card used to be handed side A's number for both. */
export function fixedCadenceFor(ruleEnabled: boolean, sec: number): number | null {
  return ruleEnabled && sec > 0 ? sec : null;
}
