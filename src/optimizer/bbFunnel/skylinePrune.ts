import type { CreatureRuntime, FinalStats } from "../../engine";
import { creatureByName } from "../../engine/creatureData";
import { normalizeAbilityName } from "../../engine/runtimeHelpers";
import { deriveFlatSelfHealNames } from "../abilityRegistry";
import {
  canonicalNumber,
  canonicalStatusMap,
  sourceAbilitySignature,
  type CombatSignatureGroup,
} from "./combatSignature";

// ---------------------------------------------------------------------------
// Skyline prune (funnel layer 2).
//
// Within one discrete status class the fight is monotone in a handful of
// beneficial stat axes: a build that is at-least-as-good on every such axis (and
// strictly better on one) beats-or-ties the other against EVERY opponent, so the
// weaker build can never outrank it and is dropped. The result is the input-space
// Pareto frontier per class.
//
// Which axes are safe to ORDER on is settled empirically by the monotonicity
// probe (monotonicityProbe.ts), not assumed:
//   - damage, biteCooldown, health, healthRegen, weight, breathDamagePct, reflect
//     all read cleanly monotone against a Fortify opponent -> order axes.
//   - on-hit DoT stacks are NOT clean (crossing a stack count can lengthen the
//     kill vs Fortify's cleanse), and block was inert / unverified, so both stay
//     as EXACT-MATCH partition dimensions - they define the class, never the order.
//
// Two guards keep the prune exact:
//   - HP-axis exemption: a FLAT-heal source (Life Leech) into a pool with breath
//     opponents has a non-monotone HP hole (more max-HP means %-max-HP breath
//     scales up while the flat heal does not, so more HP can die sooner). When
//     that pattern is present health is demoted from an order axis to an
//     exact-match dimension so it is never pruned on.
//   - Partition by the full discrete class first; monotonicity only holds inside
//     a class.
//
// A near-frontier challenger band per class is retained so Phase 2c's order
// certificate can promote a near-miss into an exact fight.
// ---------------------------------------------------------------------------

export type SkylineAxisName =
  | "damage"
  | "biteCooldown"
  | "health"
  | "healthRegen"
  | "weight"
  | "breathDamagePct"
  | "reflect";

type AxisSpec = { name: SkylineAxisName; higherIsBetter: boolean; read: (f: FinalStats) => number };

// Order-candidate axes with their beneficial direction. Every one here was
// confirmed clean-monotone by the probe; the exact-match suspects (on-hit DoT
// stacks, block) are intentionally absent - they live in the class key.
const ORDER_AXES: readonly AxisSpec[] = [
  { name: "damage", higherIsBetter: true, read: (f) => f.damage },
  { name: "biteCooldown", higherIsBetter: false, read: (f) => f.biteCooldown },
  { name: "health", higherIsBetter: true, read: (f) => f.health },
  { name: "healthRegen", higherIsBetter: true, read: (f) => f.healthRegen ?? 0 },
  { name: "weight", higherIsBetter: true, read: (f) => f.weight },
  { name: "breathDamagePct", higherIsBetter: true, read: (f) => f.breathDamagePct ?? 0 },
  { name: "reflect", higherIsBetter: true, read: (f) => f.plushieReflectAvgPct ?? 0 },
];

const ORDER_AXIS_BY_NAME: ReadonlyMap<SkylineAxisName, AxisSpec> = new Map(
  ORDER_AXES.map((axis) => [axis.name, axis]),
);

/** The order-candidate axis names, in declaration order. Exported so the
 * monotonicity probe's coverage can be asserted against the real set instead of
 * a copy of it. */
export const ORDER_AXIS_NAMES: readonly SkylineAxisName[] = ORDER_AXES.map((axis) => axis.name);

/** The probe found no order-candidate axis non-monotone, so the default demote
 * set is empty; `weight` / `reflect` are kept as order axes on the strength of
 * the sweep + the engine weight formula (offense caps, defense never reverses). */
export const PROBED_NON_MONOTONE_ORDER_AXES: ReadonlySet<SkylineAxisName> = new Set<SkylineAxisName>();

export type SkylineOptions = {
  source: CreatureRuntime;
  pool: readonly string[];
  /** Order-candidate axes to demote to exact-match dims. Defaults to the probe
   * finding (empty). Health is demoted separately by the HP-axis exemption. */
  nonMonotoneAxes?: ReadonlySet<SkylineAxisName>;
  /** Near-frontier builds kept per class for Phase 2c to promote. */
  challengerQuotaPerRegion?: number;
};

export type SkylineRegion = {
  classKey: string;
  frontier: CombatSignatureGroup[];
  challengers: CombatSignatureGroup[];
  /** Members pruned out (not on the frontier and outside the challenger band).
   * Every one is dominated by a frontier member of the same class. */
  dropped: CombatSignatureGroup[];
};

export type SkylineResult = {
  /** Frontier plus challengers across all classes - the survivors handed to 2c. */
  kept: CombatSignatureGroup[];
  /** Strict Pareto frontier only (no challengers). */
  frontier: CombatSignatureGroup[];
  regions: SkylineRegion[];
  orderAxes: SkylineAxisName[];
  exactMatchAxes: SkylineAxisName[];
  hpAxisExempt: boolean;
  inputCount: number;
  keptCount: number;
};

const DEFAULT_CHALLENGER_QUOTA = 3;

/** Does the source carry a heal whose size is independent of its own max HP?
 * That is the shape that opens the HP non-monotonicity hole against %-max-HP
 * breath. The set comes off `ABILITY_REGISTRY`'s `flatSelfHeal` flag, so a new
 * ability of that shape is covered by its own record. */
export function sourceHasFlatHeal(source: CreatureRuntime): boolean {
  const flatHeals = deriveFlatSelfHealNames();
  return [
    ...(source.activatedAbilities ?? []),
    ...(source.passiveAbilities ?? []),
  ].some((ability) => flatHeals.has(normalizeAbilityName(ability.name)));
}

/** A pool has breath opponents when any named opponent carries a breath. */
export function poolHasBreathOpponent(pool: readonly string[]): boolean {
  return pool.some((name) => {
    const opponent = creatureByName[name];
    if (!opponent) return false;
    const breath = opponent.stats?.breath;
    return (!!breath && breath !== "N/A") || (opponent.breathAbilities?.length ?? 0) > 0;
  });
}

/** Everything in the combat signature that is NOT an effective order axis. Two
 * groups sharing this key differ only on the order axes, so monotonicity holds
 * between them. Demoted order candidates (health under exemption, plus any
 * `nonMonotoneAxes`) are appended so they, too, partition rather than prune. */
function partitionKey(
  source: CreatureRuntime,
  finalStats: FinalStats,
  activesOn: boolean,
  breathOn: boolean,
  demotedAxes: ReadonlySet<SkylineAxisName>,
): string {
  const parts: string[] = [
    `A${activesOn ? 1 : 0}`,
    `B${breathOn ? 1 : 0}`,
    // combat-relevant fields that are never order axes
    `dmg2${canonicalNumber(finalStats.damage2)}`,
    `acm${canonicalNumber(finalStats.activeCooldownMultiplier)}`,
    `bres${canonicalNumber(finalStats.breathResistance)}`,
    `breg${canonicalNumber(finalStats.breathRegenPct)}`,
    `ebl${canonicalNumber(finalStats.elderStatusBlockPct)}`,
    `ox${canonicalNumber(finalStats.oxygenTime)}`,
    `mo${canonicalNumber(finalStats.moistureTime)}`,
    `eld${finalStats.elder ?? "None"}`,
    `typ${finalStats.type ?? ""}`,
    `dt${finalStats.diet ?? ""}`,
    `tr${canonicalNumber(finalStats.tier)}`,
    `hb${finalStats.hasBreath ? 1 : 0}`,
    `bt${finalStats.breathType ?? ""}`,
    `cb${finalStats.customBreathProfile ? JSON.stringify(finalStats.customBreathProfile) : ""}`,
    // discrete status classes + block (exact-match suspects)
    `oh${canonicalStatusMap(finalStats.plushieStatusOnHit)}`,
    `oht${canonicalStatusMap(finalStats.plushieStatusOnHitTaken)}`,
    `blk${canonicalStatusMap(finalStats.plushieStatusBlockPct)}`,
    `ga${(finalStats.plushieGrantedOtherAbilities ?? []).map((a) => a.name).sort().join(",")}`,
    `ab${sourceAbilitySignature(source)}`,
  ];
  // Demoted order candidates partition too, so a prune never crosses them.
  for (const axis of ORDER_AXES) {
    if (demotedAxes.has(axis.name)) {
      parts.push(`${axis.name}=${canonicalNumber(axis.read(finalStats))}`);
    }
  }
  return parts.join("␟");
}

function dominates(a: FinalStats, b: FinalStats, axes: readonly AxisSpec[]): boolean {
  let strictlyBetterSomewhere = false;
  for (const axis of axes) {
    const av = axis.read(a);
    const bv = axis.read(b);
    const aBetterOrEqual = axis.higherIsBetter ? av >= bv : av <= bv;
    if (!aBetterOrEqual) return false;
    const aStrictlyBetter = axis.higherIsBetter ? av > bv : av < bv;
    if (aStrictlyBetter) strictlyBetterSomewhere = true;
  }
  return strictlyBetterSomewhere;
}

/** Pareto frontier of one partition over the effective order axes. */
function frontierOf(groups: CombatSignatureGroup[], axes: readonly AxisSpec[]): CombatSignatureGroup[] {
  return groups.filter(
    (candidate) => !groups.some((other) => other !== candidate && dominates(other.finalStats, candidate.finalStats, axes)),
  );
}

/**
 * Prune signature groups to the per-class input-space Pareto frontier plus a
 * near-frontier challenger band, honouring the HP-axis exemption and the probe's
 * order-vs-exact-match axis split.
 */
export function skylinePrune(groups: readonly CombatSignatureGroup[], options: SkylineOptions): SkylineResult {
  const demotedAxes = new Set<SkylineAxisName>(options.nonMonotoneAxes ?? PROBED_NON_MONOTONE_ORDER_AXES);
  const hpAxisExempt = sourceHasFlatHeal(options.source) && poolHasBreathOpponent(options.pool);
  if (hpAxisExempt) demotedAxes.add("health");

  const effectiveAxes = ORDER_AXES.filter((axis) => !demotedAxes.has(axis.name));
  const challengerQuota = options.challengerQuotaPerRegion ?? DEFAULT_CHALLENGER_QUOTA;

  const byClass = new Map<string, CombatSignatureGroup[]>();
  for (const group of groups) {
    const key = partitionKey(
      options.source,
      group.finalStats,
      group.representative.activesOn,
      group.representative.breathOn,
      demotedAxes,
    );
    const bucket = byClass.get(key);
    if (bucket) bucket.push(group);
    else byClass.set(key, [group]);
  }

  const regions: SkylineRegion[] = [];
  const frontier: CombatSignatureGroup[] = [];
  const kept: CombatSignatureGroup[] = [];
  for (const [classKey, classGroups] of byClass) {
    const classFrontier = frontierOf(classGroups, effectiveAxes);
    const frontierSet = new Set(classFrontier);
    const nonFrontier = classGroups
      .filter((group) => !frontierSet.has(group))
      .sort((a, b) => b.representative.preScore - a.representative.preScore);
    const challengers = nonFrontier.slice(0, challengerQuota);
    const dropped = nonFrontier.slice(challengerQuota);
    regions.push({ classKey, frontier: classFrontier, challengers, dropped });
    frontier.push(...classFrontier);
    kept.push(...classFrontier, ...challengers);
  }

  return {
    kept,
    frontier,
    regions,
    orderAxes: effectiveAxes.map((axis) => axis.name),
    exactMatchAxes: ORDER_AXES.filter((axis) => demotedAxes.has(axis.name)).map((axis) => axis.name),
    hpAxisExempt,
    inputCount: groups.length,
    keptCount: kept.length,
  };
}

export type ParetoViolation = { classKey: string; kind: "kept-is-dominated" | "dropped-is-non-dominated"; signature: string };

/**
 * Assert the result is a valid per-class Pareto frontier: no frontier member is
 * dominated by another classmate, and every dropped member is dominated by some
 * frontier member of its class. Returns the (hopefully empty) violation list.
 */
export function verifySkylinePareto(result: SkylineResult): { valid: boolean; violations: ParetoViolation[] } {
  const effectiveAxes = result.orderAxes
    .map((name) => ORDER_AXIS_BY_NAME.get(name))
    .filter((axis): axis is AxisSpec => axis !== undefined);
  const violations: ParetoViolation[] = [];
  for (const region of result.regions) {
    const classmates = [...region.frontier, ...region.challengers, ...region.dropped];
    for (const member of region.frontier) {
      if (classmates.some((other) => other !== member && dominates(other.finalStats, member.finalStats, effectiveAxes))) {
        violations.push({ classKey: region.classKey, kind: "kept-is-dominated", signature: member.signature });
      }
    }
    for (const member of region.dropped) {
      if (!region.frontier.some((f) => dominates(f.finalStats, member.finalStats, effectiveAxes))) {
        violations.push({ classKey: region.classKey, kind: "dropped-is-non-dominated", signature: member.signature });
      }
    }
  }
  return { valid: violations.length === 0, violations };
}
