export const EXPLICIT_OUT_OF_MODEL_ABILITIES = [
  "Invisibility",
  "Keen Observer",
  "Agile Swimmer",
  "Area Food Restore",
  "Area Water Restore",
  "Broodwatcher",
  "Burrower",
  "Change Weather",
  "Grab",
  "Latch",
  "Charge",
  "Climber",
  "Diver",
  "Egg Stealer",
  "Escape Area",
  "Ink Cloud",
  "Iron Stomach",
  "Lure",
  "Mud Pile",
  "Pack Healer",
  "Raider",
  "Soft Landing",
  "Strength In Numbers",
  "Stamina Puddle",
  "Tail Drop",
  "Glittering Trail",
  "Vanish",
  "Will To Live",
  "Healing Pulse",
  "Dazzling Flash",
  "Speed Steal",
  "Healing Hunter",
  "Shock Area",
  "Damage Link",
  "Earthquake",
  "Frosty",
  "Gale",
  "Silent Hunter",
  "Sonic Wings",
  "Speed Blitz",
  "Sticky Trap",
  "Volcanic",
] as const;

export const DEFERRED_LOW_INFO_ABILITIES = [
] as const;

export const NOT_MODELED_ABILITIES = [
  "Plasma Beam",
  "Silly Beam",
  "Snow Shield",
  "Heal Aura",
] as const;

export const PARTIAL_MODELED_ABILITIES = [
  "Gourmandizer",
  "Reflux",
] as const;

export type AbilityScopeStatus =
  | "modeled"
  | "partial"
  | "deferred"
  | "out-of-model"
  | "not-modeled";
