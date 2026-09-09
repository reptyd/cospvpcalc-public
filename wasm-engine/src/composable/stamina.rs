//! Stamina: the pool, its regen, and the rule that an action costing more than
//! the pool holds does not happen.
//!
//! Off by default (`stamina_enabled`), and while it is off the pool
//! never reaches the scheduler: `next_stamina_regen` stays at `f64::INFINITY`
//! and every read sits behind the same gate, so a fight is what it was before
//! the pool existed.
//!
//! What is here and what is not yet. Stamina is spent by actions and restored
//! once a second. The game also spends it on movement - sprinting, flying,
//! ambushing, swimming as a creature that should not - and switches the regen
//! off entirely while any of those holds. Those drains belong in this module
//! too, gated on the mover's state; what is missing is a state to gate them on.
//! A fight is a facetank, so neither side ever leaves standing: walking costs
//! nothing in the game and a standing creature regenerates at its full rate.
//! The state arrives with the surface that carries a distance, which runs on
//! this same engine and reuses this same pool - the drains are written when
//! there is something to read them off, not moved somewhere else.

use crate::contracts::SimpleCombatantStats;

use super::posture::Posture;
use super::side::CombatSide;

/// The pool refills once a second.
pub(crate) const STAMINA_REGEN_CADENCE_SEC: f64 = 1.0;

/// What a settled posture multiplies the second's regen by: 2.25 sitting and 4
/// laying.
pub(crate) fn posture_stamina_regen_mult(posture: Posture) -> f64 {
    match posture {
        Posture::Standing => 1.0,
        Posture::Sitting => 2.25,
        Posture::Laying => 4.0,
    }
}

/// Every regen second due at or before `time`, applied in order.
pub(crate) fn process_regen(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    time: f64,
    weather_immune: bool,
) {
    if !side.next_stamina_regen.is_finite() {
        return;
    }
    if stats.stamina.max(0.0) <= 0.0 {
        side.next_stamina_regen = f64::INFINITY;
        return;
    }
    // Moving fast does not out-pace the regen, it switches it off; gliding
    // switches it back on at its own rate. Both are `Standing` in a fight.
    if !side.movement_now.regenerates() {
        while side.next_stamina_regen <= time + 1e-9 {
            side.next_stamina_regen += STAMINA_REGEN_CADENCE_SEC;
        }
        return;
    }
    let rate = if side.movement_now == super::route::MovementState::Gliding {
        stats.glide_stamina_regen
    } else {
        stats.stamina_regen
    };
    if rate <= 0.0 {
        side.next_stamina_regen = f64::INFINITY;
        return;
    }
    // Read each second rather than at application: a status can land or leave
    // between two ticks, and the second is priced at the state it fires in.
    let max = max_stamina(side, stats);
    let modifiers = regen_multiplier(side, stats, time, weather_immune);
    while side.next_stamina_regen <= time + 1e-9 {
        let posture = if side.posture_settled_non_standing() {
            posture_stamina_regen_mult(side.posture_current)
        } else {
            1.0
        };
        side.stamina = (side.stamina + rate * posture * modifiers).clamp(0.0, max);
        side.next_stamina_regen += STAMINA_REGEN_CADENCE_SEC;
    }
}

/// What the statuses and ability windows on a side multiply its regen second
/// by, composed the way the game composes them: every modifier that applies
/// multiplies the rate, so two of them compound.
///
/// The figures are each effect's own, read off the game's ailment table:
///
/// | effect | multiplier |
/// |---|---|
/// | Adrenaline, Unbridled Rage | 0 - the rate is switched off for the window |
/// | Hypothermia | 0.02 |
/// | Aggressive | 0.5, and 0.55 with the Bear plushie, which lifts the whole term by 1.1 |
/// | Aftershock | 0.5 |
/// | Frostbite | 0.75 |
/// | Sickly | 0.8 |
/// | Disease | 0.75, whatever the stack count - the stacks move its hunger and thirst drain, not the rate |
/// | Ashy Lungs | 0.8 |
/// | Ash Fall | 0.75, and its own tick takes 1.5% of the full pool |
/// | Stolen Speed | 0.8 - the game returns the speed multiplier for every target it names, stamina included |
/// | Torn Ligaments | 1 - stacks x 0.1, floored at 0 |
/// | Poison | 1 - stacks x 0.01 |
/// | Clean Water | 1.2 - the game reads Sickly's own constant for this one |
/// | Berserk, Warden's Rage | 2 |
/// | Agile Swimmer | 2, and only under water |
///
/// Weather immunity skips Hypothermia's term, the same exemption its damage has.
///
/// Heat Wave and Acid Rain carry no rate of their own; Hypothermia and Ash Fall
/// have their own rows above. Heat Wave applies 2 stacks of Burn a tick and Acid
/// Rain 2 stacks of Poison, and it is those stacks that cost the rate: Burn
/// applies Ashy Lungs, which is the row above, and Poison is its own row. A
/// weather status's own stack count is the duration of the weather, so reading
/// it as a stack of what it applies would charge the same cost twice.
fn regen_multiplier(
    side: &CombatSide,
    stats: &SimpleCombatantStats,
    time: f64,
    weather_immune: bool,
) -> f64 {
    let stacks = |id: &str| {
        side.statuses
            .get(id)
            .map(|instance| instance.stacks.max(0.0))
            .unwrap_or(0.0)
    };
    let present = |id: &str| stacks(id) > 0.0;

    let mut mult = 1.0;

    // Windows first: two of them zero the rate outright, so nothing after can
    // matter - but they compose the same way and the code reads plainer for it.
    // Read as "now is inside the window": these fields keep the moment the
    // window ends, so testing them for a positive number would hold the rate
    // down for the rest of the fight after one activation.
    if time < side.adrenaline_active_until {
        mult *= ADRENALINE_REGEN_MULT;
    }
    if time < side.unbridled_rage_active_until {
        mult *= UNBRIDLED_RAGE_REGEN_MULT;
    }
    if side.warden_rage_on {
        mult *= WARDEN_RAGE_REGEN_MULT;
    }
    if super::conditional_berserk_active(side, stats) {
        mult *= BERSERK_REGEN_MULT;
    }

    if present("Aggressive_Status") {
        mult *= AGGRESSIVE_REGEN_MULT;
    }
    if present("Aggressive_Bear_Status") {
        mult *= AGGRESSIVE_REGEN_MULT * AGGRESSIVE_BEAR_LIFT;
    }
    if present("Frostbite_Status") {
        mult *= FROSTBITE_REGEN_MULT;
    }
    if present("Hypothermia_Status") && !weather_immune {
        mult *= HYPOTHERMIA_REGEN_MULT;
    }
    if present("Sickly_Status") {
        mult *= SICKLY_REGEN_MULT;
    }
    if present("Disease_Status") {
        mult *= DISEASE_REGEN_MULT;
    }
    if present("Ashy_Lungs") {
        mult *= ASHY_LUNGS_REGEN_MULT;
    }
    if present("Ash_Fall_Status") {
        mult *= ASH_FALL_REGEN_MULT;
    }
    if present("Aftershock_Status") {
        mult *= AFTERSHOCK_REGEN_MULT;
    }
    if side.agile_swimmer_active {
        mult *= AGILE_SWIMMER_REGEN_MULT;
    }
    if present("Stolen_Speed_Status") {
        mult *= STOLEN_SPEED_REGEN_MULT;
    }
    if present("Clean_Water_Status") {
        mult *= CLEAN_WATER_REGEN_MULT;
    }
    let torn = stacks("Torn_Ligaments_Status");
    if torn > 0.0 {
        mult *= (1.0 - torn * TORN_LIGAMENTS_REGEN_LOSS_PER_STACK).clamp(0.0, 1.0);
    }
    let poison = stacks("Poison_Status");
    if poison > 0.0 {
        mult *= (1.0 - poison * POISON_REGEN_LOSS_PER_STACK).max(0.0);
    }
    mult.max(0.0)
}

pub(crate) const ADRENALINE_REGEN_MULT: f64 = 0.0;
pub(crate) const UNBRIDLED_RAGE_REGEN_MULT: f64 = 0.0;
pub(crate) const WARDEN_RAGE_REGEN_MULT: f64 = 2.0;
pub(crate) const BERSERK_REGEN_MULT: f64 = 2.0;
pub(crate) const AGGRESSIVE_REGEN_MULT: f64 = 0.5;
pub(crate) const AGGRESSIVE_BEAR_LIFT: f64 = 1.1;
pub(crate) const FROSTBITE_REGEN_MULT: f64 = 0.75;
pub(crate) const HYPOTHERMIA_REGEN_MULT: f64 = 0.02;
pub(crate) const SICKLY_REGEN_MULT: f64 = 0.8;
/// Disease takes the same quarter off the stamina rate that it takes off health
/// regeneration, and takes it whatever the stack count is.
pub(crate) const DISEASE_REGEN_MULT: f64 = 0.75;
pub(crate) const STOLEN_SPEED_REGEN_MULT: f64 = 0.8;
pub(crate) const CLEAN_WATER_REGEN_MULT: f64 = 1.2;
pub(crate) const ASHY_LUNGS_REGEN_MULT: f64 = 0.8;
pub(crate) const AFTERSHOCK_REGEN_MULT: f64 = 0.5;
/// Agile Swimmer's figures arrive when the creature enters water and leave when
/// it leaves, so a fight reads them only in the underwater mode.
pub(crate) const AGILE_SWIMMER_REGEN_MULT: f64 = 2.0;
pub(crate) const AGILE_SWIMMER_MAX_MULT: f64 = 1.5;
pub(crate) const TORN_LIGAMENTS_REGEN_LOSS_PER_STACK: f64 = 0.1;

/// Spring Water raises the pool itself rather than the rate.
pub(crate) const SPRING_WATER_MAX_MULT: f64 = 1.25;

/// The side's ceiling: its stat, lifted by whatever raises the pool.
pub(crate) fn max_stamina(side: &CombatSide, stats: &SimpleCombatantStats) -> f64 {
    let mut max = stats.stamina.max(0.0);
    if side.statuses.get("Spring_Water_Status").is_some_and(|i| i.stacks > 0.0) {
        max *= SPRING_WATER_MAX_MULT;
    }
    if side.agile_swimmer_active {
        max *= AGILE_SWIMMER_MAX_MULT;
    }
    max
}

/// Poison's two stamina effects, per stack: it takes this share of a full pool
/// on each of its damage ticks, and it lowers the second's regen by this
/// fraction. Ten stacks therefore eat 3.5% of the pool a tick and hold the
/// regen at 90%; a hundred stacks would hold it at nothing.
pub(crate) const POISON_STAMINA_LOSS_PER_STACK: f64 = 0.0035;
pub(crate) const POISON_REGEN_LOSS_PER_STACK: f64 = 0.01;

/// What Poison takes from a full pool for `stacks` stacks on one tick. Acid Rain
/// reaches this figure through the 2 stacks of Poison each of its ticks applies,
/// not through its own stacks, which count the weather's duration.
pub(crate) fn poison_tick_cost(side: &CombatSide, stats: &SimpleCombatantStats, stacks: f64) -> f64 {
    if stacks <= 0.0 {
        return 0.0;
    }
    max_stamina(side, stats) * stacks * POISON_STAMINA_LOSS_PER_STACK
}

/// The share of a full pool Blessing's Boon adds and Malice's Mark takes, each
/// once at the moment it lands.
pub(crate) const BLESSINGS_BOON_STAMINA_FRACTION: f64 = 0.25;
pub(crate) const MALICES_MARK_STAMINA_FRACTION: f64 = -0.25;

/// Settle the two statuses that move the pool once rather than while they last.
///
/// Called where the clock reads the moment the status landed. A status that
/// lands, expires and lands again moves the pool a second time; one that merely
/// persists across a tick does not.
pub(crate) fn settle_one_shot_pool_changes(side: &mut CombatSide, stats: &SimpleCombatantStats) {
    let max = max_stamina(side, stats);
    if max <= 0.0 {
        return;
    }
    for (id, fraction, paid) in [
        ("Blessings_Boon", BLESSINGS_BOON_STAMINA_FRACTION, 0),
        ("Malices_Mark", MALICES_MARK_STAMINA_FRACTION, 1),
    ] {
        let present = side.statuses.get(id).is_some_and(|i| i.stacks > 0.0);
        let already = if paid == 0 {
            side.blessings_boon_stamina_paid
        } else {
            side.malices_mark_stamina_paid
        };
        if present && !already {
            side.stamina = (side.stamina + max * fraction).clamp(0.0, max);
        }
        if paid == 0 {
            side.blessings_boon_stamina_paid = present;
        } else {
            side.malices_mark_stamina_paid = present;
        }
    }
}

/// Unbridled Rage's activation cost, as a share of a full pool. The game
/// refuses the activation while the pool holds less than this and takes exactly
/// this much when it fires. Earthquake (a quarter) and Speed Blitz (a half)
/// carry the same shape and neither reaches a fight here: no fight models
/// either ability.
pub(crate) const UNBRIDLED_RAGE_STAMINA_FRACTION: f64 = 0.5;
/// What Guardians Passage takes from the user's pool when the channel completes.
/// The game takes 75% of it from a user who sealed a packmate and the whole pool
/// from one who sealed anyone else; the creature sealed here counts as a
/// packmate.
pub(crate) const GUARDIANS_PASSAGE_STAMINA_FRACTION: f64 =
    crate::spec_constants::GUARDIANS_PASSAGE_STAMINA_COST_PCT / 100.0;

/// The share of a full pool an action costs, as the game states those costs:
/// a fraction of the maximum rather than of what is left.
pub(crate) fn cost_from_max(side: &CombatSide, stats: &SimpleCombatantStats, fraction: f64) -> f64 {
    max_stamina(side, stats) * fraction
}

/// Whether the pool holds at least `cost` right now. A cost of zero always
/// passes, which is what a side with no pool - or a fight not modelling
/// stamina - reports for every action.
pub(crate) fn can_pay(side: &CombatSide, cost: f64) -> bool {
    cost <= 0.0 || side.stamina + 1e-9 >= cost
}

/// Take `cost` from the pool. Callers ask `can_pay` first; this clamps at zero
/// so a rounding remainder cannot drive the pool negative.
pub(crate) fn spend(side: &mut CombatSide, cost: f64) {
    if cost <= 0.0 {
        return;
    }
    side.stamina = (side.stamina - cost).max(0.0);
}

/// Ash Fall takes this share of a full pool on each of its ticks, and lowers the
/// rate by the fraction below while it holds. Neither figure reads the stack
/// count.
pub(crate) const ASH_FALL_STAMINA_LOSS_PER_TICK: f64 =
    crate::spec_constants::ASH_FALL_STAMINA_LOSS_PER_TICK_PCT / 100.0;
pub(crate) const ASH_FALL_REGEN_MULT: f64 = crate::spec_constants::ASH_FALL_REGEN_MULT;

/// What Ash Fall takes from a full pool for `ticks` of it.
pub(crate) fn ash_fall_tick_cost(
    side: &CombatSide,
    stats: &SimpleCombatantStats,
    ticks: f64,
) -> f64 {
    if ticks <= 0.0 {
        return 0.0;
    }
    max_stamina(side, stats) * ticks * ASH_FALL_STAMINA_LOSS_PER_TICK
}

/// What one second of recovery adds at the state the side is in: the rate the
/// stats carry, the posture it has settled into, and every status modifier that
/// applies. Zero where the side is moving too fast to recover at all.
pub(crate) fn regen_per_second(
    side: &CombatSide,
    stats: &SimpleCombatantStats,
    time: f64,
    weather_immune: bool,
) -> f64 {
    if !side.movement_now.regenerates() {
        return 0.0;
    }
    let rate = if side.movement_now == super::route::MovementState::Gliding {
        stats.glide_stamina_regen
    } else {
        stats.stamina_regen
    };
    if rate <= 0.0 {
        return 0.0;
    }
    let posture = if side.posture_settled_non_standing() {
        posture_stamina_regen_mult(side.posture_current)
    } else {
        1.0
    };
    rate * posture * regen_multiplier(side, stats, time, weather_immune)
}

/// Put `amount` back into the pool, stopping at the side's own ceiling.
pub(crate) fn gain(side: &mut CombatSide, stats: &SimpleCombatantStats, amount: f64) {
    if amount <= 0.0 {
        return;
    }
    side.stamina = (side.stamina + amount).min(max_stamina(side, stats));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composable::config::ComposableAbilityConfig;
    use crate::composable::reference_tests::default_combatant;
    use crate::composable::simulate_composable_matchup_with_trace;
    use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus};

    fn stats(stamina: f64, regen: f64) -> SimpleCombatantStats {
        let mut s = default_combatant();
        s.stamina = stamina;
        s.stamina_regen = regen;
        s
    }

    fn side(stamina: f64, regen: f64) -> (CombatSide, SimpleCombatantStats) {
        let st = stats(stamina, regen);
        let mut side = CombatSide::new(&st, None);
        side.next_stamina_regen = STAMINA_REGEN_CADENCE_SEC;
        (side, st)
    }

    #[test]
    fn a_side_starts_on_a_full_pool() {
        let (s, _) = side(135.0, 3.0);
        assert_eq!(s.stamina, 135.0);
    }

    #[test]
    fn regen_adds_the_rate_once_a_second_and_stops_at_the_cap() {
        let (mut s, st) = side(135.0, 3.0);
        s.stamina = 100.0;
        process_regen(&mut s, &st, 1.0, false);
        assert_eq!(s.stamina, 103.0);
        process_regen(&mut s, &st, 3.0, false);
        assert_eq!(s.stamina, 109.0, "two more seconds, two more ticks");
        process_regen(&mut s, &st, 100.0, false);
        assert_eq!(s.stamina, 135.0, "the cap holds");
    }

    #[test]
    fn a_settled_posture_multiplies_the_second_and_a_transition_does_not() {
        for (posture, mult) in [(Posture::Sitting, 2.25), (Posture::Laying, 4.0)] {
            let (mut s, st) = side(1000.0, 3.0);
            s.stamina = 0.0;
            s.posture_current = posture;
            s.posture_pending = posture;
            process_regen(&mut s, &st, 1.0, false);
            assert_eq!(s.stamina, 3.0 * mult, "{posture:?} multiplies the second");
        }

        // Going down is not down yet, which is how the rest of the posture
        // math reads a transition.
        let (mut s, st) = side(1000.0, 3.0);
        s.stamina = 0.0;
        s.posture_current = Posture::Standing;
        s.posture_pending = Posture::Laying;
        process_regen(&mut s, &st, 1.0, false);
        assert_eq!(s.stamina, 3.0);
    }

    #[test]
    fn a_creature_with_no_pool_or_no_rate_never_joins_the_schedule() {
        let (mut s, st) = side(0.0, 3.0);
        process_regen(&mut s, &st, 1.0, false);
        assert!(!s.next_stamina_regen.is_finite());

        let (mut s, st) = side(135.0, 0.0);
        process_regen(&mut s, &st, 1.0, false);
        assert!(!s.next_stamina_regen.is_finite());
    }

    #[test]
    fn an_action_costs_a_share_of_the_full_pool_and_is_refused_above_it() {
        let (mut s, st) = side(200.0, 3.0);
        let half = cost_from_max(&s, &st, UNBRIDLED_RAGE_STAMINA_FRACTION);
        assert_eq!(half, 100.0);
        assert!(can_pay(&s, half));
        spend(&mut s, half);
        assert_eq!(s.stamina, 100.0);
        assert!(can_pay(&s, half), "exactly enough is enough");
        spend(&mut s, half);
        assert_eq!(s.stamina, 0.0);
        assert!(!can_pay(&s, half), "an empty pool is short of the half");
    }

    fn with_status(stamina: f64, regen: f64, id: &str, stacks: f64) -> (CombatSide, SimpleCombatantStats) {
        let (mut side, st) = side(stamina, regen);
        side.stamina = 0.0;
        crate::statuses::apply_simple_status_list(
            0.0,
            &mut side.statuses,
            &[SimpleAppliedStatus { status_id: id.to_string(), stacks, ..Default::default() }],
        );
        (side, st)
    }

    #[test]
    fn every_status_that_moves_the_rate_moves_it_by_its_own_figure() {
        // One second each, from empty, at a rate of 10: the pool after the tick
        // is the multiplier in figures.
        for (id, stacks, expected) in [
            ("Frostbite_Status", 1.0, 7.5),
            ("Hypothermia_Status", 1.0, 0.2),
            ("Sickly_Status", 1.0, 8.0),
            ("Stolen_Speed_Status", 1.0, 8.0),
            ("Clean_Water_Status", 1.0, 12.0),
            ("Aggressive_Status", 1.0, 5.0),
            ("Aggressive_Bear_Status", 1.0, 5.5),
            ("Torn_Ligaments_Status", 3.0, 7.0),
            ("Poison_Status", 10.0, 9.0),
            ("Ashy_Lungs", 1.0, 8.0),
            ("Disease_Status", 4.0, 7.5),
            ("Aftershock_Status", 1.0, 5.0),
        ] {
            let (mut side, st) = with_status(1000.0, 10.0, id, stacks);
            process_regen(&mut side, &st, 1.0, false);
            assert!(
                (side.stamina - expected).abs() < 1e-9,
                "{id} at {stacks} stacks: expected {expected}, got {}",
                side.stamina
            );
        }
    }

    /// Agile Swimmer is the one modifier that reads the fight's own state rather
    /// than a status: the game grants it on entering water, and the underwater
    /// drain mode is what a fight has that means that.
    #[test]
    fn agile_swimmer_reads_the_pool_and_the_rate_only_under_water() {
        let (mut dry, st) = with_status(1000.0, 10.0, "Frostbite_Status", 0.0);
        dry.stamina = 0.0;
        process_regen(&mut dry, &st, 1.0, false);
        assert!((dry.stamina - 10.0).abs() < 1e-9, "on ground the rate is its own: {}", dry.stamina);
        assert!((max_stamina(&dry, &st) - 1000.0).abs() < 1e-9);

        let (mut wet, st) = with_status(1000.0, 10.0, "Frostbite_Status", 0.0);
        wet.agile_swimmer_active = true;
        wet.stamina = 0.0;
        process_regen(&mut wet, &st, 1.0, false);
        assert!((wet.stamina - 20.0).abs() < 1e-9, "under water the rate doubles: {}", wet.stamina);
        assert!(
            (max_stamina(&wet, &st) - 1500.0).abs() < 1e-9,
            "and the pool is half again as big: {}",
            max_stamina(&wet, &st),
        );
    }

    /// The two statuses that move the pool once rather than while they last.
    #[test]
    fn blessings_boon_and_malices_mark_each_pay_once() {
        let (mut side, st) = with_status(200.0, 1.0, "Frostbite_Status", 0.0);
        side.stamina = 100.0;

        // Nothing on the side yet, so nothing moves.
        settle_one_shot_pool_changes(&mut side, &st);
        assert_eq!(side.stamina, 100.0);

        crate::statuses::apply_simple_status_list(
            0.0,
            &mut side.statuses,
            &[SimpleAppliedStatus { status_id: "Blessings_Boon".to_string(), stacks: 1.0, ..Default::default() }],
        );
        settle_one_shot_pool_changes(&mut side, &st);
        assert_eq!(side.stamina, 150.0, "a quarter of a 200 pool");

        // Still there on the next pass, and the pool does not move again.
        settle_one_shot_pool_changes(&mut side, &st);
        assert_eq!(side.stamina, 150.0);

        crate::statuses::apply_simple_status_list(
            0.0,
            &mut side.statuses,
            &[SimpleAppliedStatus { status_id: "Malices_Mark".to_string(), stacks: 1.0, ..Default::default() }],
        );
        settle_one_shot_pool_changes(&mut side, &st);
        assert_eq!(side.stamina, 100.0, "and the mark takes the same quarter");
    }

    /// A status that lands, expires and lands again moves the pool a second
    /// time, because the flag follows the status's presence rather than holding
    /// for the rest of the fight.
    #[test]
    fn a_second_landing_pays_again() {
        let (mut side, st) = with_status(200.0, 1.0, "Frostbite_Status", 0.0);
        side.stamina = 0.0;
        for _ in 0..2 {
            crate::statuses::apply_simple_status_list(
                0.0,
                &mut side.statuses,
                &[SimpleAppliedStatus { status_id: "Blessings_Boon".to_string(), stacks: 1.0, ..Default::default() }],
            );
            settle_one_shot_pool_changes(&mut side, &st);
            side.statuses.remove("Blessings_Boon");
            settle_one_shot_pool_changes(&mut side, &st);
        }
        assert_eq!(side.stamina, 100.0, "two landings, two quarters");
    }

    #[test]
    fn two_of_them_compound() {
        let (mut side, st) = with_status(1000.0, 10.0, "Frostbite_Status", 1.0);
        crate::statuses::apply_simple_status_list(
            0.0,
            &mut side.statuses,
            &[SimpleAppliedStatus { status_id: "Sickly_Status".to_string(), stacks: 1.0, ..Default::default() }],
        );
        process_regen(&mut side, &st, 1.0, false);
        // 0.75 x 0.8 = 0.6
        assert!((side.stamina - 6.0).abs() < 1e-9, "got {}", side.stamina);
    }

    #[test]
    fn weather_immunity_skips_hypothermia_the_way_it_skips_its_damage() {
        let (mut side, st) = with_status(1000.0, 10.0, "Hypothermia_Status", 1.0);
        process_regen(&mut side, &st, 1.0, true);
        assert!((side.stamina - 10.0).abs() < 1e-9, "got {}", side.stamina);
    }

    #[test]
    fn an_ability_window_can_switch_the_rate_off_entirely() {
        let (mut raging, st) = side(1000.0, 10.0);
        raging.stamina = 0.0;
        raging.adrenaline_active_until = 30.0;
        process_regen(&mut raging, &st, 1.0, false);
        assert_eq!(raging.stamina, 0.0, "Adrenaline holds the rate at zero");

        // And the window is a window: past its end the rate is back. These
        // fields keep the moment it closes rather than a flag, so reading them
        // as "ever fired" would hold the rate down for the rest of the fight -
        // which is what the first cut of this did.
        raging.next_stamina_regen = 31.0;
        process_regen(&mut raging, &st, 31.0, false);
        assert_eq!(raging.stamina, 10.0, "past the window the rate is back");

        let (mut warden, st) = side(1000.0, 10.0);
        warden.stamina = 0.0;
        warden.warden_rage_on = true;
        process_regen(&mut warden, &st, 1.0, false);
        assert_eq!(warden.stamina, 20.0, "Warden's Rage doubles it");
    }

    #[test]
    fn spring_water_raises_the_ceiling_and_what_a_share_of_it_costs() {
        let (side, st) = with_status(200.0, 10.0, "Spring_Water_Status", 1.0);
        assert_eq!(max_stamina(&side, &st), 250.0);
        assert_eq!(cost_from_max(&side, &st, UNBRIDLED_RAGE_STAMINA_FRACTION), 125.0);
    }

    #[test]
    fn poison_takes_a_share_per_stack_and_holds_the_rate_down() {
        let (bare, bare_stats) = side(1000.0, 10.0);
        assert_eq!(poison_tick_cost(&bare, &bare_stats, 10.0), 35.0, "ten stacks eat 3.5% a tick");
        assert_eq!(poison_tick_cost(&bare, &bare_stats, 0.0), 0.0);

        let (mut s, st) = side(1000.0, 10.0);
        s.stamina = 0.0;
        crate::statuses::apply_simple_status_list(
            0.0,
            &mut s.statuses,
            &[SimpleAppliedStatus {
                status_id: "Poison_Status".to_string(),
                stacks: 10.0,
                ..Default::default()
            }],
        );
        process_regen(&mut s, &st, 1.0, false);
        assert!(
            (s.stamina - 9.0).abs() < 1e-9,
            "ten stacks hold the second at 90%: got {}",
            s.stamina
        );
    }

    fn unbridled_rage_fires(attacker: &SimpleCombatantStats, stamina_on: bool) -> usize {
        let mut defender = default_combatant();
        defender.damage = 0.0;
        defender.health = 1e9;
        let mut config = ComposableAbilityConfig::default();
        config.attacker_unbridled_rage = true;
        config.stamina_enabled = stamina_on;
        let result = simulate_composable_matchup_with_trace(
            attacker, &defender, None, None,
            SimpleAbilityTimingMode::ReallyFast,
            &config,
            300.0, true,
        );
        result
            .combat_log
            .expect("trace")
            .iter()
            .filter(|e| e.description.as_deref().is_some_and(|d| d.contains("Unbridled Rage")))
            .count()
    }

    #[test]
    fn an_activation_the_pool_cannot_pay_for_does_not_happen() {
        // The game refuses Unbridled Rage below half a pool and takes that half
        // when it fires. The half is half of the maximum, so a full pool always
        // covers one activation; a pool that never refills covers a second and
        // then nothing, while one that refills is above the cost at every
        // cooldown. Neither side can win, so the fight runs the whole
        // 300-second window, into which the 120-second cooldown fits three
        // activations.
        let mut rich = default_combatant();
        rich.damage = 0.0;
        rich.health = 1e9;
        rich.stamina = 200.0;
        rich.stamina_regen = 20.0;

        let mut broke = rich.clone();
        broke.stamina_regen = 0.0;

        assert!(
            unbridled_rage_fires(&rich, false) > 0,
            "without stamina modelling the ability fires as it always did",
        );
        assert_eq!(
            unbridled_rage_fires(&rich, false),
            unbridled_rage_fires(&broke, false),
            "and the pool is not read at all",
        );

        let rich_on = unbridled_rage_fires(&rich, true);
        let broke_on = unbridled_rage_fires(&broke, true);
        assert!(
            rich_on > 0,
            "a pool that refills fires at least once: got {rich_on}",
        );
        assert!(
            broke_on < rich_on,
            "a pool that never refills runs out first: {broke_on} against {rich_on}",
        );
    }

    #[test]
    fn a_fight_that_does_not_model_stamina_leaves_the_pool_off_the_schedule() {
        let attacker = stats(135.0, 3.0);
        let defender = stats(135.0, 3.0);
        let result = simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::Ideal,
            &ComposableAbilityConfig::default(),
            30.0, false,
        );
        // Nothing to assert on the pool from outside - the point is that the
        // fight runs at all with the stats present and the switch off, which is
        // what the byte-identity fixtures elsewhere pin.
        assert!(result.max_time_sec > 0.0);
    }
}
