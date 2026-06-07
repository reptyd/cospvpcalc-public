import { plushieByName } from "./buildData";
import { getCreatureSpecificPlushieModifiers, getPlushieGrantedOtherAbilities } from "./plushieBuildMappings";

const STAT_LABELS: Record<string, string> = {
  damagePct: "dmg",
  hpPct: "HP",
  healthPct: "HP",
  movementSpeedPct: "speed",
  weightPct: "weight",
  breathResistancePct: "breath resist",
  stamRegenPct: "stam regen",
  hpRegenPct: "HP regen",
  biteCooldownPct: "bite CD",
  breathRegenPct: "breath regen",
  breathDamagePct: "breath dmg",
  muddyDurationBoost: "Muddy duration",
  plushieReflectAvgPct: "avg reflect",
  appetiteDrainPct: "appetite drain",
  appetiteCapacityPct: "appetite capacity",
  takeoffStaminaCostPct: "takeoff stam",
  bleedStacks: "Bleed",
  burnStacks: "Burn",
  poisonStacks: "Poison",
  necropoisonStacks: "Necropoison",
  frostbiteStacks: "Frostbite",
  blockBleedPct: "block Bleed",
  blockBurnPct: "block Burn",
  blockPoisonPct: "block Poison",
  blockFrostbitePct: "block Frostbite",
  blockNecropoisonPct: "block Necropoison",
  blockInjuryPct: "block Injury",
};

const STACK_STATS = new Set([
  "bleedStacks",
  "burnStacks",
  "poisonStacks",
  "necropoisonStacks",
  "frostbiteStacks",
]);

function isDefensiveNote(note: string | null | undefined): boolean {
  if (!note) return false;
  const n = note.toLowerCase();
  if (n.includes("defensive")) return true;
  if (n.includes("offensive")) return false;
  return false;
}

function formatValue(value: number, op: string, isStack: boolean): string {
  const sign = value > 0 ? "+" : "";
  if (isStack) return `${sign}${value}`;
  if (op === "addFlat") return `${sign}${value}`;
  return `${sign}${value}%`;
}

export function formatPlushieEffectSummary(name: string): string {
  if (!name) return "";
  const plushie = plushieByName[name];
  if (!plushie) return "";

  const parts: string[] = [];
  const mods = getCreatureSpecificPlushieModifiers(false, name) ?? plushie.modifiersParsed ?? [];
  for (const mod of mods) {
    const label = STAT_LABELS[mod.stat] ?? mod.stat;
    const isStack = STACK_STATS.has(mod.stat);
    const val = formatValue(mod.value, mod.op, isStack);
    if (isStack) {
      const suffix = isDefensiveNote(mod.note) ? "on self hit" : "on hit";
      parts.push(`${val} ${label} ${suffix}`);
    } else {
      parts.push(`${label} ${val}`);
    }
  }

  const granted = getPlushieGrantedOtherAbilities(name) ?? [];
  for (const ability of granted) {
    parts.push(ability.name);
  }

  if (name === "Bear") parts.push("Aggressive/Scared +10pp");
  if (name === "Eclipse") parts.push("+5% dmg / +25% stam regen / +15% HP regen (night-only)");

  if (parts.length === 0) return "not modeled";
  return parts.join(", ");
}
