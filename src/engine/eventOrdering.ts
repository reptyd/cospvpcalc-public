export const COMBAT_EVENT_PHASES = [
  "passives",
  "statusTicks",
  "statusDecay",
  "regen",
  "bite",
  "breath",
  "activeAbilities",
] as const;

export type CombatEventPhase = (typeof COMBAT_EVENT_PHASES)[number];

export const FIXED_FIRST_COMBAT_EVENT_PHASE: CombatEventPhase = "passives";

export const REORDERABLE_COMBAT_EVENT_PHASES: CombatEventPhase[] = [
  "statusTicks",
  "statusDecay",
  "regen",
  "bite",
  "breath",
  "activeAbilities",
];

export const RECOMMENDED_COMBAT_EVENT_ORDER: CombatEventPhase[] = [
  "passives",
  "statusDecay",
  "activeAbilities",
  "regen",
  "bite",
  "statusTicks",
  "breath",
];

export const COMBAT_EVENT_PHASE_LABELS: Record<CombatEventPhase, string> = {
  passives: "Passives",
  statusTicks: "Status ticks",
  statusDecay: "Status decay",
  regen: "HP regen",
  bite: "Bite",
  breath: "Breath",
  activeAbilities: "Active abilities",
};

const PHASE_SET = new Set<CombatEventPhase>(COMBAT_EVENT_PHASES);

export function normalizeCombatEventOrder(value: unknown): CombatEventPhase[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<CombatEventPhase>();
  const next: CombatEventPhase[] = [FIXED_FIRST_COMBAT_EVENT_PHASE];

  for (const item of raw) {
    if (typeof item !== "string" || !PHASE_SET.has(item as CombatEventPhase)) continue;
    const phase = item as CombatEventPhase;
    if (phase === FIXED_FIRST_COMBAT_EVENT_PHASE || seen.has(phase)) continue;
    seen.add(phase);
    next.push(phase);
  }

  for (const phase of REORDERABLE_COMBAT_EVENT_PHASES) {
    if (!seen.has(phase)) next.push(phase);
  }

  return next;
}

export function parseStoredCombatEventOrder(value: string | null): CombatEventPhase[] {
  if (!value) return [...RECOMMENDED_COMBAT_EVENT_ORDER];
  try {
    return normalizeCombatEventOrder(JSON.parse(value));
  } catch {
    return [...RECOMMENDED_COMBAT_EVENT_ORDER];
  }
}
