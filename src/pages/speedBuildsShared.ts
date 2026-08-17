// Shared view-helpers and persistence for Speed Builds. Extracted so the
// classic SpeedBuildsPage and the beta SpeedBuildsPageBeta read identical
// numbers from a single source of truth - only the presentation differs.

import type { BuildOptions, ElderVariant } from "../engine/types";
import { plushieByName, veneration } from "../engine/buildData";
import { getCreatureSpecificPlushieModifiers } from "../engine/plushieBuildMappings";
import { formatPlushieEffectSummary } from "../engine/plushieEffectSummary";
import { formatRoundedNumber, formatRoundedPercent } from "../shared/displayFormat";
import { safeReadLocalStorage, safeWriteLocalStorage } from "../shared/safeStorage";
import {
  CHANNEL_LABELS,
  LOWER_IS_BETTER,
  READOUT_CHANNELS,
  readChannel,
  SPEED_CHANNELS,
  type SpeedChannel,
  type SpeedReadout,
  type SpeedTarget,
} from "../speed/speedChannels";
import { SPEED_EFFECTS, type SpeedEffect, type SpeedEffectContext, type SpeedEffectSource } from "../speed/speedEffects";
import type { SpeedContribution } from "../speed/speedMath";
import { optimizableChannels } from "../speed/speedSearch";

export { readChannel };

export type SpeedMode = "optimize" | "manual";

/** Which of the two figures the ranking is ordered by. The sweep orders on
 * whatever effects it is handed, so ranking on sustained is the same search run
 * with nothing held - there is no second sort. */
export type SpeedRankBy = "peak" | "sustained";

export const RANK_BY_LABELS: Record<SpeedRankBy, string> = { peak: "Peak", sustained: "Sustained" };

/** Manual mode opens on a fully venerated but otherwise bare build, the same
 * assumption the sweep makes - so a build carried over from the ranking lands
 * on identical numbers. */
export const DEFAULT_MANUAL_BUILD: BuildOptions = {
  venerationStage: 5,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

/** What the reader has already settled before the sweep runs, so the ranking
 * answers his question instead of the ideal one. Null on elder or traits leaves
 * that choice to the sweep, which measures it - the default, and the only shape
 * the page had before. */
export type SpeedConstraints = {
  elder: ElderVariant | null;
  traits: string[] | null;
  venerationStage: number;
  /** How the veneration stages are split between locked traits. A single trait
   * takes the whole budget whatever this says, so it only bites once the reader
   * has locked two. */
  ascensionAssignments: string[];
  /** Plushies every ranked build must carry, up to the two slots a build has.
   * Empty leaves both open; one leaves the other free. */
  requiredPlushies: string[];
  /** Plushies the reader does not own. */
  excludedPlushies: string[];
};

export const DEFAULT_SPEED_CONSTRAINTS: SpeedConstraints = {
  elder: null,
  traits: null,
  venerationStage: 5,
  ascensionAssignments: ["", "", "", "", ""],
  requiredPlushies: [],
  excludedPlushies: [],
};

/** Read a constraint group off a stored blob or a shared snapshot, field by
 * field, so one unrecognised entry costs that entry rather than the group. */
export function readSpeedConstraints(value: unknown): SpeedConstraints {
  const raw = (value ?? {}) as Partial<SpeedConstraints>;
  const strings = (list: unknown): string[] | null =>
    Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : null;
  const stage = raw.venerationStage;
  return {
    elder: typeof raw.elder === "string" ? raw.elder : null,
    traits: strings(raw.traits),
    venerationStage:
      typeof stage === "number" && Number.isFinite(stage)
        ? Math.max(0, Math.min(veneration.stages, Math.round(stage)))
        : DEFAULT_SPEED_CONSTRAINTS.venerationStage,
    ascensionAssignments: strings(raw.ascensionAssignments) ?? [...DEFAULT_SPEED_CONSTRAINTS.ascensionAssignments],
    // Links shared before the constraint took two slots carry a single name.
    requiredPlushies:
      strings(raw.requiredPlushies)?.slice(0, 2)
      ?? (typeof (raw as { requiredPlushie?: unknown }).requiredPlushie === "string"
        && (raw as { requiredPlushie: string }).requiredPlushie
        ? [(raw as { requiredPlushie: string }).requiredPlushie]
        : []),
    excludedPlushies: strings(raw.excludedPlushies) ?? [],
  };
}

/** How many of the five are set, for the count on the button that opens them. */
export function countSpeedConstraints(constraints: SpeedConstraints): number {
  return (
    (constraints.elder !== null ? 1 : 0) +
    (constraints.traits !== null ? 1 : 0) +
    (constraints.venerationStage !== DEFAULT_SPEED_CONSTRAINTS.venerationStage ? 1 : 0) +
    (constraints.requiredPlushies.length > 0 ? 1 : 0) +
    (constraints.excludedPlushies.length > 0 ? 1 : 0)
  );
}

/** Toggles come in one list, not one list per source: the reader is picking what
 * is true of him right now, and whether that came from his own ability or from
 * the weather is a detail the breakdown already carries. Within the list the
 * order still reads outward - what the creature can do, what it can do with its
 * body, then what the world is doing to it. */
const SOURCE_ORDER: SpeedEffectSource[] = ["ability", "state", "world", "plushie", "trait", "elder"];

export function offerableEffects(effects: readonly SpeedEffect[]): SpeedEffect[] {
  return [...effects].sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
}

export function effectCaption(effect: SpeedEffect, ctx: SpeedEffectContext | null): string {
  if (typeof effect.caption !== "function") return effect.caption ?? "";
  return ctx ? effect.caption(ctx) : "";
}

/** Most of the plushies that move a channel carry no movement modifier in the
 * plushie data: Sea, Sky, Mylo, Succulant, Reindeer, Horned Beetlefly,
 * Partridge and Momo have no parsed modifiers at all and print "not modeled",
 * and Void has only its damage line, so its speed penalty went unmentioned on
 * the one page it matters to. The speed registry knows what each of them does,
 * so it leads whenever the data does not carry the movement side. */
export function plushieCaption(name: string): string {
  const summary = formatPlushieEffectSummary(name);
  const speed = SPEED_EFFECTS.filter(
    (effect) => effect.plushie === name && typeof effect.caption === "string",
  ).map((effect) => effect.caption as string);
  if (speed.length === 0) return summary;
  // Resolved the way the summary itself resolves them, or a plushie whose
  // movement line comes from the override table rather than its own record -
  // Astral Quetzal - would have that line printed twice.
  const modifiers = getCreatureSpecificPlushieModifiers(false, name) ?? plushieByName[name]?.modifiersParsed ?? [];
  if (modifiers.some((modifier) => modifier.stat === "movementSpeedPct" || modifier.stat === "walkSpeedPct")) return summary;
  return summary && summary !== "not modeled" ? `${speed.join(", ")}, ${summary}` : speed.join(", ");
}

/** The only elder modifier that reaches this page. `elderOps` reads `speedPct`
 * and nothing else, so the picker chips that one line - the damage and the
 * regeneration an elder also carries land in the combat model, which no channel
 * here touches. */
export const SPEED_ELDER_MODIFIERS = ["speedPct"];

/** Channels this creature actually has, in reading order. A grounded creature
 * yields no fly entry at all, and must never be offered a fly ranking that can
 * only come back empty; the same holds for ambush on the creatures without the
 * multiplier, which is most of the roster. */
export function availableTargets(base: SpeedReadout): SpeedTarget[] {
  return READOUT_CHANNELS.filter((channel) => readChannel(base, channel) !== null);
}

/** The channels worth putting in the picker: this creature's, minus the ones no
 * effect in the registry can move. Turn is the whole of that difference - every
 * creature has one and nothing touches it, so ranking on it would sort a column
 * of identical numbers. It still shows in the readout; it is just not a choice. */
export function pickableTargets(base: SpeedReadout): SpeedTarget[] {
  const movable = optimizableChannels();
  return availableTargets(base).filter((channel) => movable.has(channel));
}

export function isLowerBetter(channel: SpeedTarget): boolean {
  return LOWER_IS_BETTER.has(channel);
}

export function channelLabel(channel: SpeedTarget): string {
  return CHANNEL_LABELS[channel];
}

export type SpeedChannelRow = {
  channel: SpeedTarget;
  label: string;
  /** The creature's printed stat, before the build. Nobody plays on this
   * number, so it is never what a percentage is measured against. */
  raw: number;
  /** What the build alone produces - plushies, trait, elder, veneration. True of
   * the creature whatever it is doing, which is what makes it the baseline. */
  sustained: number;
  /** Sustained plus everything held right now. Equal to sustained when nothing
   * is held. */
  peak: number;
  /** Peak against sustained. Null when sustained is zero. */
  deltaPct: number | null;
  tone: "good" | "bad" | "flat";
};

export function channelRows(base: SpeedReadout, sustained: SpeedReadout, peak: SpeedReadout): SpeedChannelRow[] {
  return availableTargets(base).map((channel) => {
    const raw = readChannel(base, channel) ?? 0;
    const from = readChannel(sustained, channel) ?? raw;
    const to = readChannel(peak, channel) ?? from;
    const deltaPct = from === 0 ? null : ((to - from) / from) * 100;
    const improved = isLowerBetter(channel) ? to < from : to > from;
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      raw,
      sustained: from,
      peak: to,
      deltaPct,
      tone: to === from ? "flat" : improved ? "good" : "bad",
    };
  });
}

/** Speed keeps two decimals where the site rounds to one. The sweep packs ten
 * builds into half a unit of each other, and at one decimal half the ranking
 * prints the same number; trailing zeros are still dropped, so a whole value
 * stays whole. Best Builds carries its own 2 dp seconds formatter for the same
 * reason. */
export function formatSpeedValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

export function formatChannelValue(value: number | null): string {
  return value === null ? "None" : formatSpeedValue(value);
}

export function formatDelta(deltaPct: number | null): string {
  if (deltaPct === null || Math.abs(deltaPct) < 0.05) return "unchanged";
  return `${deltaPct > 0 ? "+" : ""}${formatRoundedPercent(deltaPct)}`;
}

/** One contribution, as the channels it actually moves on this creature.
 * Multipliers are shown as percentages rather than raw factors: the site's
 * display rounding is one decimal, which would flatten a x1.025 plushie to
 * x1 but reads exactly as +2.5%. */
export function formatContributionOps(contribution: SpeedContribution, readout: SpeedReadout): string {
  const parts: string[] = [];
  for (const channel of SPEED_CHANNELS) {
    const op = contribution.ops[channel];
    if (!op || readout[channel] === null) continue;
    const label = CHANNEL_LABELS[channel as SpeedChannel];
    if (op.kind === "multiply") {
      const factor = op.value ** contribution.stacks;
      parts.push(`${label} ${factor >= 1 ? "+" : "-"}${formatRoundedPercent(Math.abs(factor - 1) * 100)}`);
    } else {
      const amount = op.value * contribution.stacks;
      parts.push(`${label} ${amount >= 0 ? "+" : "-"}${formatRoundedNumber(Math.abs(amount))}`);
    }
  }
  return parts.join(", ");
}

export const SOURCE_LABELS: Record<SpeedEffectSource, string> = {
  plushie: "Plushie",
  trait: "Trait",
  elder: "Elder",
  ability: "Ability",
  state: "Posture",
  world: "World",
};

export type SpeedContributionRow = {
  contribution: SpeedContribution;
  source: string;
  change: string;
  /** Whether this row is one of the held effects - the difference between the
   * sustained and the peak figure. */
  held: boolean;
  /** What outside the row set its number, when something did. Empty for every
   * row that speaks for itself. */
  note: string;
};

/** Bear is the one plushie that pays nothing of its own - it strengthens the
 * Cower buff, so it can win a slot in the ranking without ever earning a row.
 * Name it on the row it is actually paying into. */
function contributionNote(contribution: SpeedContribution, build: BuildOptions | null): string {
  if (contribution.effect.id !== "posture_cower") return "";
  return build?.plushies.some((name) => name.trim().toLowerCase() === "bear") ? "with Bear" : "";
}

/** The qualifiers carried up to a ranking row, which has no breakdown to hang
 * them on. Named, since off the breakdown the effect they belong to is gone. */
export function contributionNotes(rows: readonly SpeedContributionRow[]): string[] {
  return rows.filter((row) => row.note).map((row) => `${row.contribution.effect.label} ${row.note}`);
}

/** The breakdown rows for one build. A contribution that only touches channels
 * this creature lacks - a flier's fly speed on a grounded creature - prints
 * nothing, so the row goes with it. */
export function contributionRows(
  contributions: readonly SpeedContribution[],
  base: SpeedReadout | null,
  build: BuildOptions | null = null,
  heldIds: readonly string[] = [],
): SpeedContributionRow[] {
  if (!base) return [];
  return contributions
    .map((contribution) => ({
      contribution,
      source: SOURCE_LABELS[contribution.effect.source],
      change: formatContributionOps(contribution, base),
      held: heldIds.includes(contribution.effect.id),
      note: contributionNote(contribution, build),
    }))
    .filter((row) => row.change.length > 0);
}

// The setup the user assembles - mode, ranking channel, what they are holding
// and the manual loadout - survives leaving the page and coming back. The page
// unmounts on navigation, so it would otherwise reset to a bare Adharcaiin
// every time. The sweep itself is a few milliseconds and re-runs on every
// change, so there is no result worth caching, only the question.
export const SPEED_BUILDS_STORAGE_KEY = "cos.speedBuildsState";

export type PersistedSpeedBuildsState = {
  mode?: SpeedMode;
  target?: SpeedTarget;
  rankBy?: SpeedRankBy;
  active?: string[];
  fillPct?: number;
  packmates?: number;
  manualBuild?: BuildOptions;
  constraints?: SpeedConstraints;
};

function isBuildOptions(value: unknown): value is BuildOptions {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<BuildOptions>;
  return (
    typeof build.venerationStage === "number" &&
    Array.isArray(build.traits) &&
    Array.isArray(build.ascensionAssignments) &&
    Array.isArray(build.plushies) &&
    typeof build.elder === "string"
  );
}

export function loadSpeedBuildsState(): PersistedSpeedBuildsState {
  const raw = safeReadLocalStorage(SPEED_BUILDS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PersistedSpeedBuildsState;
    const out: PersistedSpeedBuildsState = {};
    if (parsed.mode === "optimize" || parsed.mode === "manual") out.mode = parsed.mode;
    if (typeof parsed.target === "string") out.target = parsed.target;
    if (parsed.rankBy === "peak" || parsed.rankBy === "sustained") out.rankBy = parsed.rankBy;
    if (Array.isArray(parsed.active)) out.active = parsed.active.filter((id) => typeof id === "string");
    if (typeof parsed.fillPct === "number" && Number.isFinite(parsed.fillPct)) out.fillPct = parsed.fillPct;
    if (typeof parsed.packmates === "number" && Number.isFinite(parsed.packmates)) out.packmates = parsed.packmates;
    // A blob written by an older build shape degrades to the default loadout
    // rather than crashing the page on the first render that reads it.
    if (isBuildOptions(parsed.manualBuild)) out.manualBuild = parsed.manualBuild;
    if (parsed.constraints) out.constraints = readSpeedConstraints(parsed.constraints);
    return out;
  } catch {
    return {};
  }
}

export function saveSpeedBuildsState(state: Required<PersistedSpeedBuildsState>): void {
  safeWriteLocalStorage(SPEED_BUILDS_STORAGE_KEY, JSON.stringify(state));
}
