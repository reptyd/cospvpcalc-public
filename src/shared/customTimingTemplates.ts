import type { UserTimingSpec, Expr } from "./customAbilityTypes";

/**
 * Ready-made UserTimingSpec presets exposed to the timing editor's
 * "+ Template" dropdown. Each template returns a complete spec
 * with id/display_name swapped in by the editor.
 *
 * The templates intentionally cover the common authoring patterns
 * users hit:
 *   - "Use on cooldown"     → fire as soon as the ability is
 *                              available, no future-look.
 *   - "Conditional"         → only fire when a specific condition
 *                              is met (HP threshold, opp state, …).
 *   - "Future-look"         → score future delays via the utility
 *                              integral (the engine's full mode).
 *   - "Emergency override"  → mostly skip, but force-fire on a hot
 *                              trigger (low HP, etc.).
 *
 * The list is open - anyone can add more by following the pattern.
 */
export type TimingTemplate = {
  id: string;
  name: string;
  description: string;
  category: "ready" | "conditional" | "future-look" | "hybrid";
  build: (input: { id: string; display_name: string }) => UserTimingSpec;
};

const ALWAYS: Expr = { kind: "const", value: 1 };

/** self.hp_ratio < threshold */
const lowSelfHp = (threshold: number): Expr => ({
  kind: "bin",
  op: "lt",
  left: { kind: "var", path: "self.hp_ratio" },
  right: { kind: "const", value: threshold },
});

/** opp.hp_ratio < threshold */
const lowOppHp = (threshold: number): Expr => ({
  kind: "bin",
  op: "lt",
  left: { kind: "var", path: "opp.hp_ratio" },
  right: { kind: "const", value: threshold },
});

/** self.hp_ratio > threshold */
const highSelfHp = (threshold: number): Expr => ({
  kind: "bin",
  op: "gt",
  left: { kind: "var", path: "self.hp_ratio" },
  right: { kind: "const", value: threshold },
});

export const TIMING_TEMPLATES: TimingTemplate[] = [
  {
    id: "always-ready",
    name: "Always when ready",
    description: "Fire as soon as the ability becomes available. No future-look.",
    category: "ready",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      candidates: [0],
      horizon_sec: 1,
      threshold: 0,
      force_fire: ALWAYS,
    }),
  },
  {
    id: "below-30-hp",
    name: "When self HP below 30%",
    description: "Fire only when caster's HP ratio drops below 30%.",
    category: "conditional",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      candidates: [0],
      horizon_sec: 2,
      threshold: 0,
      force_fire: lowSelfHp(0.3),
    }),
  },
  {
    id: "execute-window",
    name: "When opponent below 25% HP (execute)",
    description: "Wait until the opponent is in execute range, then fire immediately.",
    category: "conditional",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      candidates: [0],
      horizon_sec: 1,
      threshold: 0,
      force_fire: lowOppHp(0.25),
    }),
  },
  {
    id: "defensive",
    name: "Defensive (skip when full HP)",
    description: "Skip while caster is healthy; let utility decide once HP is below 70%.",
    category: "hybrid",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      candidates: [0, 0.5, 1, 2],
      horizon_sec: 8,
      threshold: 0.001,
      force_skip: highSelfHp(0.7),
    }),
  },
  {
    id: "emergency-override",
    name: "Emergency override (force on low HP)",
    description: "Normally use future-look, but force-fire if HP drops below 15%.",
    category: "hybrid",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      candidates: [0, 0.5, 1, 2, 5],
      horizon_sec: 12,
      threshold: 0.001,
      force_fire: lowSelfHp(0.15),
    }),
  },
  {
    id: "future-look-light",
    name: "Future-look · light (Fast-style)",
    description: "Score 3 candidate delays - small horizon. Cheaper than Ideal.",
    category: "future-look",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      candidates: [0, 0.1, 0.5],
      horizon_sec: 5,
      threshold: 0.001,
    }),
  },
  {
    id: "future-look-deep",
    name: "Future-look · deep (Ideal-style)",
    description: "Score many candidates over a long horizon. Most accurate, highest cost.",
    category: "future-look",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      candidates: [0, 0.5, 1, 2, 5, 10, 15, 30],
      horizon_sec: 30,
      threshold: 0.001,
    }),
  },
  {
    id: "burst-window",
    name: "Burst window (very short)",
    description: "Score only the next 0-1s, useful for reactive bursts.",
    category: "future-look",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      candidates: [0, 0.1, 0.25, 0.5, 1],
      horizon_sec: 2,
      threshold: 0.001,
    }),
  },
];

/** Identify which "strategy" most closely matches a given spec. Used
 * by the visual editor to preselect the right form. The mapping is
 * heuristic - when the spec doesn't fit any preset cleanly, fall back
 * to "custom". */
export type TimingStrategy = "always-ready" | "conditional" | "future-look" | "hybrid" | "custom";

export function inferTimingStrategy(spec: UserTimingSpec): TimingStrategy {
  const isOnlyZeroCandidate =
    spec.candidates.length === 1 && spec.candidates[0] === 0;
  const hasForceFire = !!spec.force_fire;
  const hasForceSkip = !!spec.force_skip;
  const isAlwaysFire =
    hasForceFire &&
    spec.force_fire?.kind === "const" &&
    spec.force_fire.value !== 0;

  if (isOnlyZeroCandidate && isAlwaysFire) return "always-ready";
  if (isOnlyZeroCandidate && hasForceFire && !isAlwaysFire) return "conditional";
  if (!hasForceFire && !hasForceSkip && spec.candidates.length > 1) return "future-look";
  if ((hasForceFire || hasForceSkip) && spec.candidates.length > 1) return "hybrid";
  return "custom";
}
