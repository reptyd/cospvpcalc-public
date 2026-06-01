import type { ElderVariant } from "./types";

export type ElderProfile = {
  id: Exclude<ElderVariant, "None">;
  name: Exclude<ElderVariant, "None">;
  summary: string;
  modifiers: {
    weightPct?: number;
    damagePct?: number;
    biteCooldownPct?: number;
    activeCooldownPct?: number;
    healthRegenPct?: number;
    staminaPct?: number;
    stamRegenPct?: number;
    speedPct?: number;
    ailmentBlockPct?: number;
  };
};

export const elderProfiles: ElderProfile[] = [
  {
    id: "Devious",
    name: "Devious",
    summary: "+7.5% Speed / -7.5% Bite CD / +25% Stam Regen / -20% Weight / -15% Damage",
    modifiers: {
      speedPct: 7.5,
      biteCooldownPct: -7.5,
      stamRegenPct: 25,
      weightPct: -20,
      damagePct: -15,
    },
  },
  {
    id: "Gentle",
    name: "Gentle",
    summary: "+15% HP Regen / +10% Stamina / -10% Ability CD / +10% Ailment Block",
    modifiers: {
      activeCooldownPct: -10,
      healthRegenPct: 15,
      staminaPct: 10,
      ailmentBlockPct: 10,
    },
  },
  {
    id: "Powerful",
    name: "Powerful",
    summary: "+20% Weight / +15% Damage / -20% HP Regen / -20% Stamina / +5% Bite CD / -5% Speed",
    modifiers: {
      weightPct: 20,
      damagePct: 15,
      healthRegenPct: -20,
      staminaPct: -20,
      biteCooldownPct: 5,
      speedPct: -5,
    },
  },
];

export const elderOptions: ElderVariant[] = ["None", "Devious", "Gentle", "Powerful"];

export const elderById: Record<Exclude<ElderVariant, "None">, ElderProfile> = Object.fromEntries(
  elderProfiles.map((profile) => [profile.id, profile]),
) as Record<Exclude<ElderVariant, "None">, ElderProfile>;
