import type { CompareBuffId, CompareBuffSelection, CompareDayNightMode, CompareMoonMode } from "../../engine/compareBuffRuntime";
import type { CompareSeason } from "../../engine/compareSeason";
import { DEFAULT_COMPARE_BUFF_SELECTION } from "../../engine/compareBuffRuntime";

export type CompareBuffOption = {
  id: CompareBuffId;
  label: string;
  description: string;
};

export const compareBuffOptions: CompareBuffOption[] = [
  { id: "damageBoost", label: "Damage Boost", description: "+5% damage, +5% weight, -5% bite cooldown" },
  { id: "regenBoost", label: "Regen Boost", description: "+20% health regen, -10% ability cooldown" },
  { id: "packHealerNearby", label: "Pack Healer nearby", description: "+25% health regen to both creatures if enabled on either side" },
  { id: "cleanWater", label: "Clean water", description: "+20% health regen" },
  { id: "refreshed", label: "Refreshed", description: "+5% health regen" },
  { id: "newborn", label: "Newborn", description: "+50% health regen, hunger and thirst drain about 20% slower" },
  { id: "springWater", label: "Spring water", description: "Photovore drink: thirst drains about 23% slower for 300s" },
  { id: "satiated", label: "Satiated", description: "Hunger drains about 23% slower for 300s" },
  { id: "territory", label: "Territory", description: "Standing in your own territory: hunger drains about 17% slower" },
  { id: "muddy", label: "Muddy Status", description: "+25% health regen, doubled poison/bleed healing rate, 90s manual duration (180s with Land plushie)" },
  { id: "aggressive", label: "Aggressive", description: "+25% damage for 10s; Bear makes it +37.5%" },
  { id: "scared", label: "Scared Status", description: "-50% damage for 10s; Bear makes it -45%" },
  { id: "storming", label: "Storming", description: "Terrestrial vs Aquatic only: this side takes +10% damage (bite + breath) for the whole fight" },
  { id: "guardiansSeal", label: "Guardian's Seal", description: "Starts sealed by a packmate's Guardians Passage: -85% damage taken for the first 9s" },
];

export const defaultCompareBuffSelection = (): CompareBuffSelection => ({ ...DEFAULT_COMPARE_BUFF_SELECTION });

export const compareDayNightOptions: Array<{ value: CompareDayNightMode; label: string }> = [
  { value: "none", label: "None" },
  { value: "day", label: "Day" },
  { value: "night", label: "Night" },
];

export const compareMoonOptions: Array<{ value: CompareMoonMode; label: string }> = [
  { value: "none", label: "None" },
  { value: "blueMoon", label: "Blue Moon" },
  { value: "bloodMoon", label: "Blood Moon" },
];

export const compareSeasonOptions: Array<{ value: CompareSeason; label: string }> = [
  { value: "none", label: "None" },
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer" },
  { value: "fall", label: "Fall" },
  { value: "winter", label: "Winter" },
  { value: "sakura", label: "Sakura" },
  { value: "famine", label: "Famine" },
  { value: "drought", label: "Drought" },
];
