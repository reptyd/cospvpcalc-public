import type { BadOmenOutcome } from "../types";

export const PERSISTENT_STATUS_IDS = new Set<string>([
  "Poison_Status",
  "Burn_Status",
  "Bleed_Status",
  "Corrosion_Status",
  "Necropoison_Status",
  "Frostbite_Status",
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
