import breathSpecsRuntime from "../../data/breath_specs.runtime.json";
import type {
  BreathPolicyMode,
  BreathPolicySetting,
  CreatureRuntime,
  CustomBreathProfile,
} from "./types";

/**
 * Breath firing-policy helpers. Deliberately a leaf: it reads the 18 KB breath
 * spec table directly instead of `./data`, so the settings UIs can classify a
 * creature's breath without dragging the 2 MB creature + effects catalogs into
 * their chunk.
 */

/** Which firing disciplines are meaningful for a creature's breath.
 *
 *  - `chain`    - the breath ramps a chain multiplier (Energy / Lightning /
 *                 Glacier). Tapping on availability keeps resetting the ramp,
 *                 so these default to bursting off a full bar.
 *  - `normal`   - a standard continuous-capacity breath with no chain.
 *  - `autoFire` - Lance / Plasma Beam / Solar Beam / Spirit Glare /
 *                 Heliolyth's Judgement. They run their own charge + cooldown
 *                 model, so no firing policy applies.
 *  - `none`     - the creature has no breath at all. */
export type BreathPolicyKind = "chain" | "normal" | "autoFire" | "none";

/** The two fields a breath policy is derived from, satisfied by both
 *  `FinalStats` and an adapter over `CreatureRuntime`. */
export type BreathPolicySource = {
  breathType?: string | null;
  customBreathProfile?: CustomBreathProfile | null;
};

type BreathSpecRow = { name: string; stats?: { chain?: number; chainMaxStacks?: number } };

function normalizeBreathName(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

// Mirrors `is_standard_breath` in `wasm-engine/src/composable/breath.rs` - the
// special kinds listed there are exactly the ones that bypass the fuel-meter
// stepper the policy governs.
const AUTO_FIRE_SPECIAL_KINDS = new Set([
  "lance",
  "plasma_beam",
  "solar_beam",
  "spirit_glare",
  "heliolyth_judgement",
]);

// Name-side counterpart for built-in creatures, where the special kind is
// resolved from the breath name in `toRustBreathProfile`. `Lance ...` variants
// are matched by prefix since each carries its own ailment suffix.
const AUTO_FIRE_BREATH_NAMES = new Set(
  ["Plasma Beam", "Solar Beam", "Spirit Glare", "Heliolyth's Judgement"].map(normalizeBreathName),
);

const chainStacksByBreathName = new Map<string, { chain: number; chainMaxStacks: number }>(
  (breathSpecsRuntime as { breathTypes: BreathSpecRow[] }).breathTypes.map((spec) => [
    normalizeBreathName(spec.name),
    { chain: spec.stats?.chain ?? 0, chainMaxStacks: spec.stats?.chainMaxStacks ?? 0 },
  ]),
);

export function getBreathPolicyKind(source: BreathPolicySource | null | undefined): BreathPolicyKind {
  if (!source) return "none";
  const custom = source.customBreathProfile;
  if (custom) {
    if (custom.specialKind && AUTO_FIRE_SPECIAL_KINDS.has(custom.specialKind)) return "autoFire";
    return custom.chain > 0 && custom.chainMaxStacks > 0 ? "chain" : "normal";
  }
  const name = source.breathType;
  if (!name || name === "N/A") return "none";
  const key = normalizeBreathName(name);
  if (AUTO_FIRE_BREATH_NAMES.has(key) || key.startsWith("lance")) return "autoFire";
  const stacks = chainStacksByBreathName.get(key);
  if (!stacks) return "none";
  return stacks.chain > 0 && stacks.chainMaxStacks > 0 ? "chain" : "normal";
}

export function getCreatureBreathPolicyKind(
  creature: CreatureRuntime | null | undefined,
): BreathPolicyKind {
  if (!creature) return "none";
  return getBreathPolicyKind({
    breathType: creature.stats?.breath ?? null,
    customBreathProfile: creature.customBreathProfile,
  });
}

/** The mode a breath fires with when the user leaves the control on `auto`.
 *  Auto-fire and breathless creatures ignore the field entirely; they report
 *  the engine default so the config stays at its serde value. */
export function getDefaultBreathPolicy(kind: BreathPolicyKind): BreathPolicyMode {
  return kind === "chain" ? "onFullBar" : "onAvailability";
}

export function resolveBreathPolicy(
  setting: BreathPolicySetting,
  kind: BreathPolicyKind,
): BreathPolicyMode {
  return setting === "auto" ? getDefaultBreathPolicy(kind) : setting;
}

/** Selectable options, in display order. `ideal` runs an engine-replay search
 *  for the best burst timing (`breath_ideal_bridge` in Rust); it is affordable
 *  for the single fights Compare and Sandbox run, but not for the ~95 k
 *  matchups Best Builds sweeps, so that surface filters it out (see
 *  `BREATH_POLICY_OPTIONS_BB`). */
export const BREATH_POLICY_OPTIONS: ReadonlyArray<{
  id: BreathPolicySetting;
  /** Compact label for the three-button segmented control. */
  label: string;
  /** Spelled-out label for dropdowns, which have the room. */
  longLabel: string;
}> = [
  { id: "onAvailability", label: "Availability", longLabel: "On availability" },
  { id: "onFullBar", label: "Full bar", longLabel: "On full bar" },
  { id: "ideal", label: "Ideal", longLabel: "Ideal" },
];

/** Best Builds variant of {@link BREATH_POLICY_OPTIONS}. The `ideal` policy's
 *  per-burst engine replay is far too costly to run across a full best-builds
 *  sweep (~95 k matchups x 2 sides), so it is excluded there - exactly as
 *  posture policy is left off in Best Builds. Compare / Sandbox keep the full
 *  list. */
export const BREATH_POLICY_OPTIONS_BB = BREATH_POLICY_OPTIONS.filter(
  (option) => option.id !== "ideal",
);

export const BREATH_POLICY_MODE_LABELS: Record<BreathPolicyMode, string> = {
  onAvailability: "On availability",
  onFullBar: "On full bar",
  ideal: "Ideal",
};

/** Tooltip / caption copy for a selectable option, given the creature's kind
 *  so `Auto` can name the mode it resolves to. */
export function describeBreathPolicyOption(
  id: BreathPolicySetting,
  kind: BreathPolicyKind,
): string {
  if (id === "auto") {
    return `Use this creature's default (${BREATH_POLICY_MODE_LABELS[getDefaultBreathPolicy(kind)]}). Chain breaths burst off a full bar; every other breath fires on availability.`;
  }
  if (id === "onFullBar") {
    return "Hold fire while the meter charges, then burst continuously until it drains. Lets a chain breath ramp to its full multiplier.";
  }
  if (id === "onAvailability") {
    return "Fire whenever there is any fuel left. A chain breath resets its ramp between taps.";
  }
  if (id === "ideal") {
    return "Search each burst's start timing by replaying the fight, picking whatever maximises this creature's own end HP. Costlier than the other modes; Compare and Sandbox only.";
  }
  return BREATH_POLICY_MODE_LABELS[id];
}

/** Why the control is hidden for a side, or `null` when a policy applies.
 *  `none` covers both breathless creatures and the handful whose breath name
 *  has no spec entry (Moon Beam, Silly Beam) - the engine models no breath for
 *  either, so the wording stays about the model rather than the creature. */
export function breathPolicyUnavailableReason(kind: BreathPolicyKind): string | null {
  if (kind === "autoFire") {
    return "This breath fires on its own charge-up and cooldown, so there is no firing policy to pick.";
  }
  if (kind === "none") return "No breath is modelled for this creature.";
  return null;
}
