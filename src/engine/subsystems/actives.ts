export const DISABLE_BREATH = "Breath";
export const DISABLE_WARDEN_RAGE = "Warden's Rage";
export const DISABLE_WARDEN_RESISTANCE = "Warden's Resistance";
export const DISABLE_REFLECT = "Reflect";
export const DISABLE_TOTEM = "Totem";
export const DISABLE_DROWSY = "Drowsy Area";
export const DISABLE_LICH_MARK = "Lich Mark";
export const DISABLE_PLUSHIE_OFF = "Plushie Offensive Procs";
export const DISABLE_PLUSHIE_DEF = "Plushie Defensive Procs";
export const DISABLE_STATUS_ATTACKS = "Status Attacks";
export const DISABLE_STATUS_BLOCKS = "Status Blocks";

export const HUNKER_OUTGOING_DAMAGE_MULTIPLIER = 0.5;

export function isAbilityDisabled(disabled: Set<string>, ability: string): boolean {
  return disabled.has(ability);
}
