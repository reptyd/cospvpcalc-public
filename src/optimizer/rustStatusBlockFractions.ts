import { getRawPlushieBlockFraction } from "../engine/statusBlockMath";
import type { FinalStats } from "../engine/types";

/**
 * Per-ailment plushie block fractions for the Rust engine. The umbrella /
 * all-ailment (elder) block is passed separately as a scalar
 * (`elderBlockFraction`) rather than folded in here, so Radiation - which only
 * weakens the per-ailment stat blocks - leaves it intact.
 *
 * A negative fraction is a weakness, not a broken block: Sparkler trades 15%
 * off Poison, Frostbite and Burn for taking a fifth more Bleed, and Ginger
 * Snapper and Ember Spirit are built the same way. Clamping those to zero
 * handed the wearer the upside and dropped the price, so the whole fraction is
 * passed through and the engine decides what a negative one means. Only an
 * exact zero is dropped, because it says nothing.
 */
export function buildPlushieRustStatusBlockFractions(
  finalStats: Pick<FinalStats, "plushieStatusBlockPct">,
): Record<string, number> {
  const entries = Object.keys(finalStats.plushieStatusBlockPct ?? {})
    .map((statusId): [string, number] => [
      statusId,
      getRawPlushieBlockFraction(finalStats, statusId),
    ])
    .filter(([, fraction]) => fraction !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}
