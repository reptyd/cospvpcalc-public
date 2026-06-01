import rulesRuntime from "../../data/rules.recode.json";
import traitsRuntime from "../../data/traits.runtime.json";
import venerationRuntime from "../../data/veneration.runtime.json";
import plushiesRuntime from "../../data/plushies.runtime.json";
import plushiesIconsRuntime from "../../data/plushies.icons.json";
import traitIconsRuntime from "../../data/trait_icons.json";
import type { PlushieRuntime, RulesRuntime, TraitsRuntime, VenerationRuntime } from "./types";
export { elderById, elderOptions, elderProfiles, type ElderProfile } from "./elderData";

type TraitsRoot = { traits: TraitsRuntime[] };
type PlushiesRoot = { plushies: PlushieRuntime[] };
type IconsRoot = { icons: Record<string, string> };

function normalizePlushie(plushie: PlushieRuntime): PlushieRuntime {
  const modifiersParsed = plushie.modifiersParsed;
  if (!modifiersParsed?.length) return plushie;

  const seen = new Map<string, NonNullable<PlushieRuntime["modifiersParsed"]>[number]>();
  for (const mod of modifiersParsed) {
    const key = `${mod.stat}::${mod.op}::${mod.value}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, mod);
      continue;
    }
    if ((existing.note == null || existing.note === "") && mod.note) {
      seen.set(key, mod);
    }
  }

  return {
    ...plushie,
    modifiersParsed: [...seen.values()],
  };
}

export const rules = rulesRuntime as RulesRuntime;
export const traits = (traitsRuntime as TraitsRoot).traits;
export const veneration = venerationRuntime as unknown as VenerationRuntime;
export const plushies = ((plushiesRuntime as PlushiesRoot).plushies ?? []).map(normalizePlushie);

export const plushieByName: Record<string, PlushieRuntime> = Object.fromEntries(
  plushies.map((plushie) => [plushie.name, plushie]),
);

const plushiesIcons = ((plushiesIconsRuntime as IconsRoot).icons ?? {}) as Record<string, string>;
const traitIcons = ((traitIconsRuntime as IconsRoot).icons ?? {}) as Record<string, string>;

export const getPlushieIcon = (name: string): string | null => plushiesIcons[name] ?? null;
export const getTraitIcon = (name: string): string | null => traitIcons[name] ?? null;
