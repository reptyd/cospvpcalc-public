import type { CombatantRuntime, StatusDefGetter } from "./runtimeContext";
import type { StatusEffect } from "./types";

export type StatusRuntimeDeps = {
  badOmenStatusId: string;
  disableStatusBlocks: string;
  disableWardenResistance: string;
  statusStackDurationSec: number;
  persistentStatusIds: Set<string>;
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  normalizeAbilityName: (name: string) => string;
  getPlushieBlockFraction: (final: CombatantRuntime["final"], statusId: string) => number;
  getStatusDefinition: StatusDefGetter;
};

export type ParsedStatusWithPersistence = NonNullable<StatusEffect["parsed"]> & {
  persistent?: boolean;
  caps?: NonNullable<StatusEffect["parsed"]>["caps"] & {
    durationDecay?: "none" | string;
  };
};
