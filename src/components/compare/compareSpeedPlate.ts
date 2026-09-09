// The one place on the Compare side that reads the movement registry. Compare
// shows the figures; it never feeds them to a fight, and the isolation gate in
// `referenceContent.speed.test.ts` names this file as the single exception.
//
// The figures are the ones Speed Builds computes with the build applied and
// nothing held: veneration, traits, plushies and the elder move them; Speed
// Blitz, Ambush's own activation, weather and every other held effect do not.
// A creature's own speeds do not reach `FinalStats` at all - the build path
// drops movement percentages on purpose - so reading the stats instead would
// print a number that ignores the build sitting next to it on the same page.

import type { BuildOptions, CreatureRuntime } from "../../engine/types";
import { evaluateSpeed } from "../../speed/speedMath";
import { CHANNEL_LABELS, READOUT_CHANNELS, type SpeedTarget } from "../../speed/speedChannels";

export type SpeedPlateChannel = {
  target: SpeedTarget;
  label: string;
  value: number;
};

/** Turn is not a speed - it is how a creature comes about - so it stays out. */
const NOT_A_SPEED: ReadonlySet<SpeedTarget> = new Set<SpeedTarget>(["turn"]);

/**
 * Every speed the creature has, in reading order, with the build applied and
 * no held effect. Absent channels are dropped rather than shown as zero: a
 * grounded creature has no fly speed to compare.
 */
export function speedPlateChannels(
  creature: CreatureRuntime | null | undefined,
  build: BuildOptions | null | undefined,
): SpeedPlateChannel[] {
  if (!creature || !build) return [];
  const readout = evaluateSpeed({ creature, build, active: [] }).final;
  const out: SpeedPlateChannel[] = [];
  for (const target of READOUT_CHANNELS) {
    if (NOT_A_SPEED.has(target)) continue;
    const value = readout[target];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    out.push({ target, label: CHANNEL_LABELS[target], value });
  }
  return out;
}

/** The figure the collapsed plate carries: walking, or swimming for an aquatic. */
export function walkSpeedFor(
  creature: CreatureRuntime | null | undefined,
  build: BuildOptions | null | undefined,
): number | null {
  if (!creature || !build) return null;
  const value = evaluateSpeed({ creature, build, active: [] }).final.speed;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function formatSpeed(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The two sides' channels merged into comparison rows, in reading order: one
 * row per channel either side has, with `null` where a side has none. Shaped
 * like the block's own numeric rows so the breakdown renders them with the
 * same bar, the same winner and the same colours.
 */
export function speedComparisonRows(
  creatureA: CreatureRuntime | null | undefined,
  buildA: BuildOptions | null | undefined,
  creatureB: CreatureRuntime | null | undefined,
  buildB: BuildOptions | null | undefined,
): { target: SpeedTarget; label: string; a: number | null; b: number | null }[] {
  const byTarget = (channels: SpeedPlateChannel[]) => new Map(channels.map((ch) => [ch.target, ch.value]));
  const a = byTarget(speedPlateChannels(creatureA, buildA));
  const b = byTarget(speedPlateChannels(creatureB, buildB));
  const rows: { target: SpeedTarget; label: string; a: number | null; b: number | null }[] = [];
  for (const target of READOUT_CHANNELS) {
    if (NOT_A_SPEED.has(target)) continue;
    if (!a.has(target) && !b.has(target)) continue;
    rows.push({ target, label: CHANNEL_LABELS[target], a: a.get(target) ?? null, b: b.get(target) ?? null });
  }
  return rows;
}
