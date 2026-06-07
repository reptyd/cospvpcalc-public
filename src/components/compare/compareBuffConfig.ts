import type { CompareBuffId, CompareBuffSelection, CompareDayNightMode, CompareMoonMode } from "../../engine/compareBuffRuntime";
import { DEFAULT_COMPARE_BUFF_SELECTION } from "../../engine/compareBuffRuntime";

export type CompareBuffOption = {
  id: CompareBuffId;
  label: string;
  description: string;
};

export const compareBuffOptions: CompareBuffOption[] = [
  { id: "damageBoost", label: "Damage Boost", description: "+5% damage, +5% weight, -5% bite cooldown" },
  { id: "regenBoost", label: "Regen Boost", description: "+20% health regen, +20% stamina regen, -10% ability cooldown" },
  { id: "packHealerNearby", label: "Pack Healer nearby", description: "+25% health regen to both creatures if enabled on either side" },
  { id: "cleanWater", label: "Clean water", description: "+20% health regen" },
  { id: "refreshed", label: "Refreshed", description: "+5% health regen" },
  { id: "newborn", label: "Newborn", description: "+50% health regen" },
  { id: "muddy", label: "Muddy Status", description: "+25% health regen, doubled poison/bleed healing rate, 90s manual duration (180s with Land plushie)" },
  { id: "aggressive", label: "Aggressive", description: "+25% damage for 10s; Bear makes it +35%" },
  { id: "scared", label: "Scared Status", description: "-50% damage for 10s; Bear makes it -40%" },
  { id: "storming", label: "Storming", description: "Terrestrial vs Aquatic only: this side takes +10% damage (bite + breath) for the whole fight" },
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
