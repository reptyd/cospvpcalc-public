import type { BadOmenOutcome } from "../engine";

export const badOmenOutcomes: BadOmenOutcome[] = [
  { statusId: "Frostbite_Status", stacks: 5, label: "Force: Frostbite +5" },
  { statusId: "Burn_Status", stacks: 8, label: "Force: Burn +8" },
  { statusId: "Bleed_Status", stacks: 10, label: "Force: Bleed +10" },
  { statusId: "Corrosion_Status", stacks: 5, label: "Force: Corrosion +5" },
  { statusId: "Confusion_Status", stacks: 3, label: "Force: Confusion +3" },
  { statusId: "Shredded_Wings", stacks: 3, label: "Force: Shredded Wings +3" },
  { statusId: "Disease_Status", stacks: 20, label: "Force: Disease +20" },
  { statusId: "Injury_Status", stacks: 10, label: "Force: Injury +10" },
  { statusId: "Necropoison_Status", stacks: 10, label: "Force: Necropoison +10" },
  { statusId: "Poison_Status", stacks: 10, label: "Force: Poison +10" },
];

export function resolveBadOmenChoice(choice: string): BadOmenOutcome | null {
  if (choice === "auto") return null;
  const match = badOmenOutcomes.find((option) => `${option.statusId}|${option.stacks}` === choice);
  return match ?? null;
}
