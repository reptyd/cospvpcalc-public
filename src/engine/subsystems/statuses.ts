import type { BadOmenOutcome } from "../types";

// Mirrors the Rust engine's `is_persistent_pvp_status` (statuses.rs) - the
// ailments flagged `DoesNotHealWhileMoving` in the game, held while moving and
// decayed while stationary under No Move Facetank.
export const PERSISTENT_STATUS_IDS = new Set<string>([
  "Poison_Status",
  "Burn_Status",
  "Bleed_Status",
  "Corrosion_Status",
  "Necropoison_Status",
  "Frostbite_Status",
  "Radiation_Status",
  "Hypothermia_Status",
  "Sickly_Status",
  "Injury_Status",
]);

export const BAD_OMEN_STATUS_ID = "Bad_Omen";
export const BAD_OMEN_OUTCOMES: BadOmenOutcome[] = [
  { statusId: "Frostbite_Status", stacks: 5, label: "Frostbite +5" },
  { statusId: "Burn_Status", stacks: 8, label: "Burn +8" },
  { statusId: "Bleed_Status", stacks: 10, label: "Bleed +10" },
  { statusId: "Corrosion_Status", stacks: 5, label: "Corrosion +5" },
  { statusId: "Confusion_Status", stacks: 3, label: "Confusion +3" },
  { statusId: "Shredded_Wings", stacks: 3, label: "Shredded Wings +3" },
  { statusId: "Disease_Status", stacks: 20, label: "Disease +20" },
  { statusId: "Injury_Status", stacks: 10, label: "Injury +10" },
  { statusId: "Necropoison_Status", stacks: 10, label: "Necropoison +10" },
  { statusId: "Poison_Status", stacks: 10, label: "Poison +10" },
];

// The deterministic Best Builds / Optimizer outcome: those paths need a fixed,
// reproducible follow-up, and Burn +8 has been the on-paper value.
export const BAD_OMEN_DEFAULT_OUTCOME: BadOmenOutcome =
  BAD_OMEN_OUTCOMES.find((o) => o.statusId === "Burn_Status") ?? BAD_OMEN_OUTCOMES[0];

// Bad Omen is a random ability: in Compare/Sandbox each expiry should get a
// fresh roll. The engine consumes one outcome per expiry (cycling), so we hand
// it a freshly-rolled batch - a new draw every time the sim is built, so
// re-running re-rolls. `count` covers far more expiries than any fight produces.
export function rollBadOmenBatch(count = 16): BadOmenOutcome[] {
  return Array.from(
    { length: Math.max(1, count) },
    () => BAD_OMEN_OUTCOMES[Math.floor(Math.random() * BAD_OMEN_OUTCOMES.length)],
  );
}
