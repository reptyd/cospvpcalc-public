export type ApproximationCategory =
  | "ability"
  | "timing"
  | "data"
  | "status"
  | "breath"
  | "resource"
  | "plushie"
  | "trait"
  | "model";

export type ApproximationDefinition = {
  category: ApproximationCategory;
  message: string;
};

export const APPROXIMATION_NOTES = {
  ADRENALINE_COOLDOWN_APPROX: {
    category: "timing",
    message: "Adrenaline cooldown is approx=90s.",
  },
  REFLUX_HUNGER_UNMODELED: {
    category: "resource",
    message: "Reflux hunger gating is not modeled; using one-cast-at-a-time stand-and-fight approximation.",
  },
  SHADOW_BARRAGE_CADENCE_ASSUMED: {
    category: "timing",
    message: "Shadow Barrage cadence modeled as 1 hit per second (approx).",
  },
  HP_REGEN_ORDERING_TODO: {
    category: "model",
    message: "HP regen plushie applied; heal-rate ordering with other systems is TODO.",
  },
  BREATH_TYPE_MISSING: {
    category: "breath",
    message: "Breath type missing; using approx 5% base damage DPS.",
  },
  HEAL_BEAM_SELF_NO_EFFECT: {
    category: "breath",
    message: "Heal Beam heals targets (not self); in 1v1 self-model it has no direct effect.",
  },
  BREATH_RESISTANCE_APPLIED: {
    category: "breath",
    message: "Breath resistance applied.",
  },
  BREATH_TICK_RESOLUTION: {
    category: "timing",
    message: "Breath tick resolution is 1s (approx).",
  },
  FIRST_STRIKE_VALUE_MISSING: {
    category: "data",
    message: "First Strike value missing; ignored (approx).",
  },
  UNBRIDLED_RAGE_STAMINA_UNMODELED: {
    category: "resource",
    message: "Unbridled Rage stamina cost is not modeled (stamina pool unavailable).",
  },
  FROST_NOVA_VALUE_MISSING: {
    category: "data",
    message: "Frost Nova value missing; using 75% base damage (approx).",
  },
  REFLECT_STATUS_UNQUANTIFIED: {
    category: "status",
    message: "Reflect status detected: reflect damage amount not quantified (ignored).",
  },
  KNIGHT_REFLECT_APPROX: {
    category: "status",
    message: "Knight reflect modeled as deterministic average (5% per hit = 25% chance × 20% damage).",
  },
  SELF_DESTRUCT_DELAY_DEFAULTED: {
    category: "timing",
    message: "Self-Destruct delay not specified; using 1s delay (approx).",
  },
} as const satisfies Record<string, ApproximationDefinition>;

export type ApproximationNoteCode = keyof typeof APPROXIMATION_NOTES;

const MESSAGE_TO_META = new Map<string, { code: ApproximationNoteCode; category: ApproximationCategory }>(
  Object.entries(APPROXIMATION_NOTES).map(([code, definition]) => [
    definition.message,
    { code: code as ApproximationNoteCode, category: definition.category },
  ]),
);

export function resolveApproximationNote(note: ApproximationNoteCode | string): string {
  if (note in APPROXIMATION_NOTES) {
    return APPROXIMATION_NOTES[note as ApproximationNoteCode].message;
  }
  return note;
}

export function addApproximationNote(notes: string[], note: ApproximationNoteCode | string): void {
  notes.push(resolveApproximationNote(note));
}

export function addApproximationNoteOnce(notes: string[], note: ApproximationNoteCode | string): void {
  const resolved = resolveApproximationNote(note);
  if (!notes.includes(resolved)) notes.push(resolved);
}

export function getApproximationMeta(note: string): {
  code: ApproximationNoteCode | null;
  category: ApproximationCategory | "custom";
} {
  const meta = MESSAGE_TO_META.get(note);
  if (!meta) {
    return {
      code: null,
      category: "custom",
    };
  }
  return meta;
}
