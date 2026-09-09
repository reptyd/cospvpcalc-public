import { describe, expect, it } from "vitest";
import {
  ATTACK_STATUS_MAP,
  BLOCK_STATUS_MAP,
  DEFENSIVE_STATUS_MAP,
} from "../../tools/effects_catalog_rules";
import { SUPPORTED_GENERIC_STATUS_IDS } from "./rustEligibilityHelpers";

/**
 * Parity guard for the fail-closed eligibility class. SUPPORTED_GENERIC_STATUS_IDS
 * lists the ailments the engine carries via its generic channel; the
 * Attack/Block/Defensive maps in tools/effects_catalog_rules.ts assign a status to
 * each "<X> Attack/Block/Defensive" ability. If a new ailment is added to a map but
 * not routed for eligibility, every creature carrying it silently becomes ineligible
 * and its matchups stop running (the Zeoarex-adjacent class).
 *
 * Some map statuses are intentionally NOT generic-supported because the engine
 * handles them another way. They are whitelisted here with the reason, so a NEW
 * map status still fails the test until it is consciously routed.
 */
const NON_GENERIC_MAP_STATUSES = new Set<string>([
  // Ligament Tear applies Torn_Ligaments via a dedicated engine handler, not the
  // generic ailment channel.
  "Torn_Ligaments_Status",
  // Defensive Paralyze is out of model.
  "Paralyze_Status",
]);

function allMapStatuses(): Set<string> {
  return new Set<string>([
    ...Object.values(ATTACK_STATUS_MAP),
    ...Object.values(BLOCK_STATUS_MAP),
    ...Object.values(DEFENSIVE_STATUS_MAP),
  ]);
}

describe("generic-status eligibility parity", () => {
  it("every Attack/Block/Defensive map status is generic-supported or an explicit exception", () => {
    const unaccounted = [...allMapStatuses()].filter(
      (statusId) => !SUPPORTED_GENERIC_STATUS_IDS.has(statusId) && !NON_GENERIC_MAP_STATUSES.has(statusId),
    );
    // A new "<X> Attack/Block/Defensive" status must be consciously routed: added to
    // SUPPORTED_GENERIC_STATUS_IDS (the engine carries it generically) or to the
    // exception set above (handled another way / out of model).
    expect(unaccounted).toEqual([]);
  });

  it("keeps the exception set free of stale entries", () => {
    const mapStatuses = allMapStatuses();
    for (const statusId of NON_GENERIC_MAP_STATUSES) {
      // The exception only makes sense for a status the maps actually reference and
      // that is deliberately absent from the generic-supported set.
      expect(mapStatuses.has(statusId)).toBe(true);
      expect(SUPPORTED_GENERIC_STATUS_IDS.has(statusId)).toBe(false);
    }
  });
});
