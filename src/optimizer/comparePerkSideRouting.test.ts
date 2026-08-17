/// <reference types="node" />
// Every per-side Compare knob has to move the fight for the side that set it,
// through the real engine.
//
// `rustCompareMatchupRuntime.test.ts` proves each knob reaches the config field
// it owns - the TS half, written after a review found four perks wired one-side
// only. The Rust half was unguarded: `setup.rs` copies each field onto its
// side, and swapping two of those lines (`a.compare_dark_star =
// config.defender_compare_dark_star` and its twin) leaves the whole Rust suite
// green at 1198 passed. `contract_readers` cannot see it either - it greps for
// the identifier and says so in its own header.
//
// A side-swap survives every symmetric check, so this one is directional: set
// the knob on A, and the metric it owns must move further in its own direction
// than the same knob set on B moves it. Routed to the wrong side the two runs
// trade places and the comparison inverts.
//
// The numbers are never pinned - only the direction of a difference - so a
// weekly rebalance moves both runs together and the assertion holds.
import { describe, expect, it } from "vitest";
import type { CompareSidePerks } from "./rustCompareMatchupRuntime";
import { loadRustForNode, runMatchupSummaryWithPerks } from "./rustNodeMatchup";
import { makeAbility, makeSyntheticCreature, withRegisteredFixture } from "./__fixtures__/syntheticCreature";

const NO_PERKS: CompareSidePerks = {
  traps: false, trails: false, powerCharge: false, goreCharge: false, startingSpiteCharged: false,
  muddyBuff: false, hungerRule: false, gourmandizer: false, startingHungerUnits: 100,
  appetiteBaseUnits: 100, defiledGroundLevel: 0, defiledGroundWeakness: false, hasDarkstar: false,
  appetiteDrainMultiplier: 1, healingPulseEnabled: false, healingPulseOnce: false,
  expungeEnabled: false, wardenRageStartHpPct: 0, headStartSec: 0,
};

/** The runner's fight cap, used as "still alive" for a missing death time. */
const HORIZON_SEC = 900;

const ATTACKER = "Kendyll";
const DEFENDER = "Korathos";

type Row = {
  name: string;
  perk: Partial<CompareSidePerks>;
  /** What the knob is meant to move for whoever sets it, and which way. */
  metric: "deathTimeA" | "deathTimeB" | "damageDealtA" | "damageDealtB";
  direction: "up" | "down";
  /** Why that metric moves that way - the mechanic, not the measurement. */
  because: string;
  /** Conditions the knob needs before it does anything at all. */
  scene?: Scene;
  /** An ability the fight has to contain for the knob to reach anything. The
   *  trails are the case: the `trails` perk only decides whether a carrier's
   *  trail runs, and no real pairing here carries one. A synthetic creature
   *  with exactly that ability, on both sides, isolates the field - with two
   *  trails in the fight, a swap on one is masked by the other still firing. */
  carrier?: string;
};

type Scene = NonNullable<Parameters<typeof runMatchupSummaryWithPerks>[5]>;

// Darkstar and Defiled Ground multiply how fast a side sheds its ailments, and
// only while it is settled off its feet (`side.rs::recoverable_recovery_mult`).
// A standing fight with nothing to shed leaves both at 1.0, which is why a
// side-swap on `compare_dark_star` was invisible to the whole Rust suite.
const RECOVERY_SCENE: Scene = {
  initialStatusesA: [{ statusId: "Poison_Status", stacks: 20 }],
  initialStatusesB: [{ statusId: "Poison_Status", stacks: 20 }],
  posturePolicy: "regenAware",
};

const ROWS: Row[] = [
  {
    name: "Head Start",
    perk: { headStartSec: 6 },
    metric: "deathTimeA",
    direction: "up",
    because: "the setter's opponent is inert for the window, so the setter survives longer",
  },
  {
    name: "Power Charge",
    perk: { powerCharge: true },
    metric: "damageDealtA",
    direction: "up",
    because: "the setter's first melee hit lands at +50%",
  },
  {
    name: "Gore Charge",
    perk: { goreCharge: true },
    metric: "deathTimeB",
    direction: "down",
    because: "the setter's first hit adds Bleed, so the opponent dies sooner",
  },
  {
    name: "Darkstar",
    perk: { hasDarkstar: true },
    metric: "damageDealtB",
    direction: "down",
    because: "the setter sheds its ailments faster, so its opponent gets less out of them",
    scene: RECOVERY_SCENE,
  },
  {
    name: "Defiled Ground",
    perk: { defiledGroundLevel: 3 },
    metric: "damageDealtB",
    direction: "down",
    because: "same recovery multiplier as Darkstar, on its own ladder",
    scene: RECOVERY_SCENE,
  },
  // The seven trail fields nothing else names. `defender_flame_trail_value`
  // and its five siblings appear in no test at all, and `trail_status_id`
  // carries which ailment the generic trails leave behind - a field that could
  // be read off either side with nothing to say so.
  ...(["Flame Trail", "Frost Trail", "Plague Trail", "Toxic Trail", "Necropoison Trail"] as const).map(
    (ability): Row => ({
      name: ability,
      perk: { trails: true },
      metric: "deathTimeB",
      direction: "down",
      because: "the carrier's trail damages whoever it is fighting, so that side dies sooner",
      carrier: ability,
    }),
  ),
  {
    name: "Healing Step",
    perk: { trails: true },
    metric: "deathTimeA",
    direction: "up",
    because: "it heals its own carrier, who then outlives the horizon",
    carrier: "Healing Step",
  },
];

describe("a Compare knob moves the fight for the side that set it", () => {
  it.each(ROWS)("$name", async (row) => {
    const rustMod = await loadRustForNode();
    const carrier = row.carrier
      ? makeSyntheticCreature({
          name: `TrailCarrier_${row.carrier.replace(/\s/g, "")}`,
          stats: { health: 6_000, damage: 300, biteCooldown: 1, weight: 1_000, healthRegen: 0 },
          // The value is the HP threshold the trail runs below, read as a
          // percent above 1, so 100 keeps it on for the whole fight.
          passiveAbilities: [makeAbility(row.carrier, 100)],
        })
      : null;
    const [attacker, defender] = carrier ? [carrier.name, carrier.name] : [ATTACKER, DEFENDER];

    const read = (perksA: CompareSidePerks, perksB: CompareSidePerks): number => {
      const summary = runMatchupSummaryWithPerks(
        rustMod, attacker, defender, perksA, perksB, row.scene ?? {},
      ) as unknown as Record<string, number | null>;
      // A side that never dies has no death time; for these rows that IS the
      // result, so it reads as the horizon rather than as a missing number.
      return summary[row.metric] ?? HORIZON_SEC;
    };

    const run = () => {
      const base = read(NO_PERKS, NO_PERKS);
      return {
        base,
        setOnA: read({ ...NO_PERKS, ...row.perk }, NO_PERKS) - base,
        setOnB: read(NO_PERKS, { ...NO_PERKS, ...row.perk }) - base,
      };
    };
    const { setOnA, setOnB } = carrier
      ? withRegisteredFixture(carrier, {} as never, run)
      : run();

    expect(
      setOnA,
      `${row.name} on A moved ${row.metric} not at all - ${ATTACKER} vs ${DEFENDER} no longer exercises it, pick another pair`,
    ).not.toBe(0);

    const wrongWay =
      `${row.name} set on A did not move ${row.metric} ${row.direction} relative to the same knob on B. ` +
      `Expected because ${row.because}. Check which side setup.rs copies the field to.`;
    if (row.direction === "up") expect(setOnA, wrongWay).toBeGreaterThan(setOnB);
    else expect(setOnA, wrongWay).toBeLessThan(setOnB);
  }, 30_000);
});
