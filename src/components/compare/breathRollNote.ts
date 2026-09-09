import breathSpecsRuntime from "../../../data/breath_specs.runtime.json";
import { breathAilmentsOnTarget, type BreathAilment } from "../../engine/breathAilmentText";
import type { CreatureRuntime } from "../../engine";
import type { BreathSpec } from "../../engine/types";
import type { BreathRollMode } from "./compareSpecialAbilities";

/** The multiplier a breath crit lands, mirroring `BREATH_CRIT_MULTIPLIER` in
 *  `wasm-engine/src/composable/breath_rolls.rs`. */
const CRIT_MULTIPLIER = 1.5;

const specsByName = new Map<string, BreathSpec>(
  (breathSpecsRuntime as { breathTypes: BreathSpec[] }).breathTypes.map((spec) => [
    spec.name.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " "),
    spec,
  ]),
);

function specFor(breathName: string | undefined): BreathSpec | null {
  if (!breathName) return null;
  return specsByName.get(breathName.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ")) ?? null;
}

/** The breath this creature fires, by the name the spec table uses. */
export function creatureBreathName(creature: CreatureRuntime | undefined): string | undefined {
  const breath = creature?.breathAbilities?.[0];
  return breath?.subtype ?? breath?.name ?? undefined;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** A percentage as the share of ticks it takes: 25 -> "one tick in four",
 *  30 -> "three ticks in ten". */
function tickShare(pct: number): string {
  if (pct >= 100) return "every tick";
  const hundredths = Math.round(pct * 100);
  const divisor = greatestCommonDivisor(hundredths, 10_000) || 1;
  const numerator = hundredths / divisor;
  const denominator = 10_000 / divisor;
  const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const denominatorWord = words[denominator] ?? String(denominator);
  if (numerator === 1) return `one tick in ${denominatorWord}`;
  return `${words[numerator] ?? numerator} ticks in ${denominatorWord}`;
}

/** "Slowed Status" is the prose spelling; the plate says "Slowed". */
function plainName(name: string): string {
  return name.replace(/\s+Status$/i, "");
}

function stackPhrase(ailment: BreathAilment): string {
  const stacks = ailment.stacks ?? 1;
  return stacks === 1
    ? `one stack of ${plainName(ailment.name)}`
    : `${stacks} stacks of ${plainName(ailment.name)}`;
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function trimTrailingZeroes(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * What the chosen mode does to a breath carrying `critPct` and `ailments`.
 * With neither, the rule is stated without numbers - that covers a custom
 * profile, a lance and a beam, none of which the spec table describes.
 */
export function describeBreathRolls(
  mode: BreathRollMode,
  critPct: number,
  ailments: BreathAilment[],
): string {
  if (critPct <= 0 && ailments.length === 0) {
    return mode === "even"
      ? "Every chance lands as a whole event, spaced as evenly as the chance allows."
      : mode === "pseudo"
        ? "No chance is drawn: a crit chance becomes a flat damage multiplier, and an ailment chance becomes a fraction of a stack on every tick."
        : "Every chance is drawn on each tick, so one run differs from the next.";
  }

  if (mode === "even") {
    const parts = [
      ...(critPct > 0 ? [`a crit on ${tickShare(critPct)}`] : []),
      ...ailments.map((a) => `${stackPhrase(a)} on ${tickShare(a.probability)}`),
    ];
    return `Every chance lands as a whole event, spaced as evenly as the chance allows: ${joinClauses(parts)}.`;
  }

  if (mode === "pseudo") {
    const parts = [
      ...(critPct > 0
        ? [`the ${trimTrailingZeroes(critPct)}% crit chance becomes a flat ${trimTrailingZeroes(1 + (critPct / 100) * (CRIT_MULTIPLIER - 1))}x`]
        : []),
      ...ailments.map(
        (a) => `${plainName(a.name)} lands ${trimTrailingZeroes(((a.stacks ?? 1) * a.probability) / 100)} of a stack`,
      ),
    ];
    return `No chance is drawn - on every tick ${joinClauses(parts)}.`;
  }

  const parts = [
    ...(critPct > 0 ? [`the ${trimTrailingZeroes(critPct)}% crit chance`] : []),
    ...ailments.map((a) => `the ${trimTrailingZeroes(a.probability)}% chance of ${stackPhrase(a)}`),
  ];
  const drawn = parts.length > 1 ? "are drawn" : "is drawn";
  const sentence = joinClauses(parts);
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} ${drawn} on every tick, so one run differs from the next.`;
}

/** The same, for the breath this creature fires. */
export function describeBreathRollMode(
  mode: BreathRollMode,
  creature: CreatureRuntime | undefined,
): string {
  const spec = specFor(creatureBreathName(creature));
  return describeBreathRolls(
    mode,
    spec?.stats?.critChancePct ?? 0,
    breathAilmentsOnTarget(spec?.raw, spec?.name),
  );
}
