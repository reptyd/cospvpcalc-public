//! Movement over a distance: what a creature is doing, how fast that carries
//! it, and what it costs.
//!
//! This is the half of the engine a fight never reaches. A fight is a facetank
//! in which neither side goes anywhere, so every side in one is `Standing` and
//! every timer here stays at `f64::INFINITY`. A surface that puts a distance
//! between two creatures sets a state instead, and from then on the same loop,
//! the same sides, the same statuses and the same stamina pool carry it.
//!
//! Speeds arrive in the game's own stat units, resolved by the build layer the
//! way the combat stats are. The game turns a stat into studs a second in two
//! steps - `stat / 10 * 60`, then `/ 60 * 4.42` - which compose into a single
//! factor. A creature printed at 27 walks 11.93 studs a second; at 134 it
//! sprints 59.23.

use crate::contracts::SimpleCombatantStats;

use super::side::CombatSide;

/// One stretch of a route and what it is made of. A route is a list of these
/// in order; empty is one stretch of land, and a distance past the last leg
/// keeps the last leg's medium.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RouteLeg {
    #[serde(rename = "studs")]
    pub studs: f64,
    /// True for water. The medium decides which drain applies, which speed a
    /// creature out of its element reads, and nothing else.
    #[serde(default)]
    pub water: bool,
}

/// Whether the point `distance` along the route is water.
pub(crate) fn is_water_at(legs: &[RouteLeg], distance: f64) -> bool {
    let mut travelled = 0.0;
    for leg in legs {
        travelled += leg.studs.max(0.0);
        if distance < travelled - 1e-9 {
            return leg.water;
        }
    }
    legs.last().is_some_and(|leg| leg.water)
}

/// Whether the creature belongs in water. An aquatic and a semi-aquatic spend
/// no stamina in water; everything else spends some on every drain interval.
pub(crate) fn swims_freely(stats: &SimpleCombatantStats) -> bool {
    stats
        .identity
        .as_ref()
        .map(|identity| identity.creature_type.to_ascii_lowercase())
        .is_some_and(|kind| kind.contains("aquatic"))
}

/// Seconds between the stamina a non-aquatic spends staying afloat. The game
/// maps the creature's tier from 1 to 5 onto 1 second down to 0.65.
pub(crate) fn swim_drain_interval(stats: &SimpleCombatantStats) -> f64 {
    let tier = stats.identity.as_ref().map(|identity| identity.tier).unwrap_or(0.0);
    let tier = tier.clamp(1.0, 5.0);
    1.0 - (tier - 1.0) * (1.0 - 0.65) / 4.0
}

/// Studs a second per point of a printed speed stat.
pub(crate) const STUDS_PER_SECOND_PER_STAT: f64 = 6.0 / 60.0 * 4.42;

/// Distance and drains advance on the same half-second the game spends stamina
/// on, so a state that costs 1 every half-second costs exactly that.
pub(crate) const MOVEMENT_TICK_SEC: f64 = 0.5;

/// What the angle of attack does to a flying speed, at the one angle this model
/// carries: level.
///
/// The game maps the angle linearly onto a factor - `map(angle, -1.5, 1.5,
/// 4.25, top)` - where `top` is 0.4 under power and 0.075 in a settled glide,
/// and a settled glide multiplies the whole term by a further 1.1. At an angle
/// of zero the map returns the midpoint of its range, so the two factors are
/// fixed numbers rather than a curve this model has to carry.
///
/// A level line is the owner's chosen default for the glide - "a constant angle
/// and it is straight" - and the same angle is the only honest reading for
/// powered flight in a model with no altitude. When the angle becomes an input,
/// these two constants become the two ends of the same map.
pub(crate) const LEVEL_FLIGHT_FACTOR: f64 = (4.25 + 0.4) / 2.0;
pub(crate) const LEVEL_GLIDE_FACTOR: f64 = (4.25 + 0.075) / 2.0 * 1.1;

/// What a creature is doing. `Standing` is the only state a fight has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MovementState {
    #[default]
    Standing,
    Walking,
    Sprinting,
    Flying,
    Gliding,
    Ambushing,
}

impl MovementState {
    /// Studs a second in this state.
    ///
    /// **The ground and the air do not share a conversion.** A ground speed
    /// goes through `Constants.GetAdjustedSpeed(GetSpeed(stat))`, which is the
    /// `x 0.442` above. A flying speed does not: the client reads `FlySpeed`
    /// and puts `angleFactor x FlySpeed` straight into the body velocity, in
    /// studs a second. Running flight through the ground conversion made it
    /// more than five times too slow, and made the fastest state in the game
    /// slower than a sprint.
    ///
    /// Ambush multiplies sprint rather than naming a speed of its own, and a
    /// creature with no ambush multiplier sprints instead.
    pub(crate) fn studs_per_second(self, stats: &SimpleCombatantStats) -> f64 {
        match self {
            MovementState::Standing => 0.0,
            MovementState::Walking => stats.walk_speed.max(0.0) * STUDS_PER_SECOND_PER_STAT,
            MovementState::Sprinting => stats.sprint_speed.max(0.0) * STUDS_PER_SECOND_PER_STAT,
            MovementState::Flying => stats.fly_speed.max(0.0) * LEVEL_FLIGHT_FACTOR,
            MovementState::Gliding => stats.fly_speed.max(0.0) * LEVEL_GLIDE_FACTOR,
            MovementState::Ambushing => {
                let stat =
                    if stats.ambush_speed > 0.0 { stats.ambush_speed } else { stats.sprint_speed };
                stat.max(0.0) * STUDS_PER_SECOND_PER_STAT
            }
        }
    }

    /// Stamina spent per movement tick. Walking is free, which is why a
    /// facetank with the mode off costs nothing: the game charges for speed,
    /// not for being somewhere else.
    pub(crate) fn stamina_per_tick(self) -> f64 {
        match self {
            MovementState::Standing | MovementState::Walking | MovementState::Gliding => 0.0,
            MovementState::Sprinting | MovementState::Flying => 1.0,
            MovementState::Ambushing => AMBUSH_STAMINA_PER_TICK,
        }
    }

    /// What the creature manages when the pool will not cover this state:
    /// walking, the one state that costs nothing and every creature has.
    ///
    /// The game does something else for flight: a flier whose pool reaches zero
    /// starts gliding and keeps its height rather than coming down. That
    /// transition is not modelled here **on purpose**: gliding in this file
    /// covers ground at the full flying speed, for no stamina and with no end,
    /// so routing a spent flier into it would turn an empty pool into an
    /// upgrade, and an unbounded one. Walking understates the creature; gliding
    /// would overstate it without limit, and only one of those is safe to be
    /// wrong in.
    pub(crate) fn when_spent(self) -> MovementState {
        MovementState::Walking
    }

    /// Whether the pool refills at all. The game does not let a sprinting or
    /// flying creature regenerate - the rate is switched off rather than
    /// out-paced - and gliding switches it back on at its own rate.
    pub(crate) fn regenerates(self) -> bool {
        !matches!(self, MovementState::Sprinting | MovementState::Flying | MovementState::Ambushing)
    }

    /// Whether the creature is off the ground. Takeoff is charged for entering
    /// this state, and an aquatic reads its beached figure only outside it.
    pub(crate) fn airborne(self) -> bool {
        matches!(self, MovementState::Flying | MovementState::Gliding)
    }
}

/// Ambush burns four a tick against sprinting's one, which is what keeps it to
/// the seven seconds the game gives it.
pub(crate) const AMBUSH_STAMINA_PER_TICK: f64 = 4.0;

/// How far apart the two sides are right now, in studs. Zero on a fight -
/// neither side is travelling, so there is no gap to measure - and zero on a
/// race, where the sides set off level and the pursuer has nothing to close.
/// On a chase it is the head start plus however much further the pursued has
/// gone, floored at zero once the pursuer has caught up.
pub(crate) fn gap_studs(a: &CombatSide, b: &CombatSide, initial_gap: f64) -> f64 {
    let travelling =
        a.movement != MovementState::Standing || b.movement != MovementState::Standing;
    if !travelling || initial_gap <= 0.0 {
        return 0.0;
    }
    (initial_gap + b.distance_studs - a.distance_studs).max(0.0)
}

/// Whether the two are together, which decides whether either can reach the
/// other. Three cases, and the third is the one that is easy to get wrong:
///
/// - **Neither is travelling.** A fight, where the distance is nothing by
///   convention and everyone is in reach. True, so every gate on this is inert
///   and a fight is what it always was.
/// - **Travelling, with a gap between them.** A chase: out of reach until the
///   pursuer has closed it, together from then on.
/// - **Travelling, level.** A race - two creatures each running their own line,
///   who are level because they started together and not because they are
///   standing on each other. Never in reach. Reading this case as contact put
///   two racers in a fight and killed one of them two seconds in.
pub(crate) fn in_contact(a: &CombatSide, b: &CombatSide, initial_gap: f64) -> bool {
    let travelling =
        a.movement != MovementState::Standing || b.movement != MovementState::Standing;
    if !travelling {
        return true;
    }
    if initial_gap <= 0.0 {
        return false;
    }
    initial_gap + b.distance_studs - a.distance_studs <= 1e-9
}

/// What the side moves at where it currently stands. An aquatic out of the
/// water reads its beached figure - what it manages hauling itself over land -
/// and everything else reads the state's own speed.
fn speed_here(side: &CombatSide, stats: &SimpleCombatantStats, water: bool) -> f64 {
    let state = side.movement_now;
    if !water
        && swims_freely(stats)
        && stats.beached_speed > 0.0
        && !state.airborne()
        && state != MovementState::Standing
    {
        return stats.beached_speed * STUDS_PER_SECOND_PER_STAT;
    }
    state.studs_per_second(stats)
}

/// One movement tick for one side: resolve the intent against the pool, charge
/// it, and return the studs it covered. The caller owns the clock.
fn step_side(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    charge_stamina: bool,
    water: bool,
) -> f64 {
    // A creature holds still to sit or lie down and cannot move once it is
    // down, so a posture beats the intent outright: from the moment it starts
    // going down until it is back on its feet, it covers no ground and spends
    // no stamina. Lying down to refill therefore costs the two seconds it takes
    // to settle, which are two seconds of standing still.
    if side.posture_pending != super::posture::Posture::Standing
        || side.posture_current != super::posture::Posture::Standing
    {
        side.movement_now = MovementState::Standing;
        return 0.0;
    }
    // The intent holds; what it manages this tick is the intent when the pool
    // covers it and the fallback when it does not. It is not a decision the
    // side sticks to: the tick after the pool has something in it, the intent
    // is back.
    side.movement_now = if charge_stamina
        && !super::stamina::can_pay(side, side.movement.stamina_per_tick())
    {
        side.movement.when_spent()
    } else {
        side.movement
    };
    if charge_stamina {
        super::stamina::spend(side, side.movement_now.stamina_per_tick());
    }
    let covered = speed_here(side, stats, water) * MOVEMENT_TICK_SEC;
    side.distance_studs += covered;
    covered
}

/// The stamina a non-aquatic spends staying afloat, and the drowning that
/// follows once there is none left. Charged whether or not the creature is
/// going anywhere: it is charged for not sinking rather than for travelling.
///
/// Both happen on one tick, on the creature's own tier-derived interval,
/// because that is how the game does it - it drowns the creature on the same
/// tick that takes the stamina. Tier reaches nothing else: sprinting,
/// flight and ambush are all charged on a flat half-second.
pub(crate) fn process_afloat(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    time: f64,
    water: bool,
    charge_stamina: bool,
) {
    if !water || !charge_stamina || swims_freely(stats) || stats.stamina.max(0.0) <= 0.0 {
        side.next_swim_drain = f64::INFINITY;
        return;
    }
    let interval = swim_drain_interval(stats);
    if !side.next_swim_drain.is_finite() {
        side.next_swim_drain = time + interval;
    }
    while side.next_swim_drain <= time + 1e-9 {
        super::stamina::spend(side, SWIM_STAMINA_PER_DRAIN);
        if side.stamina <= 1e-9 && side.death_time.is_none() {
            side.hp -= drown_damage(side.hp, stats.health.max(1.0));
        }
        side.next_swim_drain += interval;
    }
}

/// What one afloat tick costs a creature that does not belong in the water.
pub(crate) const SWIM_STAMINA_PER_DRAIN: f64 = 1.0;

/// Drowning from an empty pool, measured by the owner in game: a creature with
/// 1200 max HP went 1200, 1179, 1158, 1137, 1116 - four steps of exactly 21,
/// which is 1.75% of its maximum, with no fall-off.
///
/// It lands on the same tick the afloat cost is charged on, because that is
/// where the game dispatches it: `DrownRemote` fires inside the branch that
/// takes the stamina. So its cadence is the swim interval, and a bigger
/// creature drowns faster for the same reason it tires faster.
///
/// The recorded gaps were 0.707, 0.504 and 0.640 seconds. They average close to
/// a tier-5 interval and cannot prove one: 0.504 is shorter than any tier's
/// interval, so either the observation jittered or the server keeps its own
/// clock. The coupling above is the code's; the amount is the measurement.
pub(crate) const DROWN_PCT_MAX_HP_PER_TICK: f64 = 1.75;

/// The wiki's floor: a creature at or under 5% of its max HP takes no drowning
/// damage. The oxygen mode has no floor and the moisture mode floors at half,
/// so all three differ.
pub(crate) const DROWN_HP_FLOOR_FRAC: f64 = 0.05;

/// One tick of drowning. Nothing once the side is at or under the floor.
pub(crate) fn drown_damage(hp: f64, max_hp: f64) -> f64 {
    let floor = max_hp * DROWN_HP_FLOOR_FRAC;
    if hp <= floor + 1e-9 {
        return 0.0;
    }
    let raw = max_hp * DROWN_PCT_MAX_HP_PER_TICK / 100.0;
    raw.min(hp - floor)
}

/// Where inside a tick a quantity that fell from `before` to zero crossed it,
/// as a fraction of the tick. Both the finish line and the closing gap are
/// straight lines inside one tick - the state, and so the speed, is fixed for
/// its whole length - so the crossing is exact rather than rounded to the grid.
fn crossing_within_tick(before: f64, closed: f64) -> f64 {
    if closed <= 0.0 {
        return MOVEMENT_TICK_SEC;
    }
    (before / closed).clamp(0.0, 1.0) * MOVEMENT_TICK_SEC
}

/// Advance both sides over every movement tick due at or before `time`, and
/// read the two things a route is asked for: when each side crossed the finish
/// line, and when the pursuer closed the gap.
///
/// The pair moves together because both readings are about the pair. Stepping
/// the sides separately and comparing afterwards would only know where they
/// stood at the end of however many ticks had passed, which is what the first
/// cut did - it read both answers off the half-second grid and reported a
/// crossing up to half a second late. Inside one tick nothing changes, so the
/// crossing is solved rather than rounded.
///
/// `initial_gap_studs` above zero makes it a chase, with A the pursuer by the
/// engine's own roles. Zero puts the two level, which is a race: there is no
/// gap to close and no catch to record.
#[allow(clippy::too_many_arguments)]
pub(crate) fn process_movement_pair(
    a: &mut CombatSide,
    a_stats: &SimpleCombatantStats,
    b: &mut CombatSide,
    b_stats: &SimpleCombatantStats,
    time: f64,
    charge_stamina: bool,
    goal_studs: f64,
    initial_gap_studs: f64,
    legs: &[RouteLeg],
) {
    loop {
        let next = a.next_movement_tick.min(b.next_movement_tick);
        if !(next.is_finite() && next <= time + 1e-9) {
            return;
        }
        let tick_start = next - MOVEMENT_TICK_SEC;
        let a_due = (a.next_movement_tick - next).abs() < 1e-9;
        let b_due = (b.next_movement_tick - next).abs() < 1e-9;

        let a_before = a.distance_studs;
        let b_before = b.distance_studs;
        let gap_before = initial_gap_studs + b_before - a_before;

        let a_water = is_water_at(legs, a.distance_studs);
        let b_water = is_water_at(legs, b.distance_studs);
        let a_step = if a_due { step_side(a, a_stats, charge_stamina, a_water) } else { 0.0 };
        let b_step = if b_due { step_side(b, b_stats, charge_stamina, b_water) } else { 0.0 };

        if goal_studs > 0.0 {
            for (side, before, step) in [(&mut *a, a_before, a_step), (&mut *b, b_before, b_step)] {
                if side.reached_distance_at.is_none() && side.distance_studs + 1e-9 >= goal_studs {
                    side.reached_distance_at =
                        Some(tick_start + crossing_within_tick(goal_studs - before, step));
                }
            }
        }

        if initial_gap_studs > 0.0 && a.caught_opponent_at.is_none() {
            let gap_after = initial_gap_studs + b.distance_studs - a.distance_studs;
            if gap_after <= 1e-9 {
                a.caught_opponent_at =
                    Some(tick_start + crossing_within_tick(gap_before, gap_before - gap_after));
            }
        }

        if a_due {
            a.next_movement_tick += MOVEMENT_TICK_SEC;
        }
        if b_due {
            b.next_movement_tick += MOVEMENT_TICK_SEC;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composable::config::ComposableAbilityConfig;
    use crate::composable::reference_tests::default_combatant;
    use crate::composable::simulate_composable_matchup_with_trace;
    use crate::composable::side::CombatSide;
    use crate::contracts::SimpleAbilityTimingMode;

    /// Nobody can win, so the loop runs the whole window and the distance is
    /// the distance rather than however far the side got before it died.
    fn harmless() -> SimpleCombatantStats {
        let mut s = default_combatant();
        s.damage = 0.0;
        s.health = 1e9;
        s
    }

    fn runner() -> SimpleCombatantStats {
        let mut s = harmless();
        s.stamina = 135.0;
        s.stamina_regen = 3.0;
        s.walk_speed = 27.0;
        s.sprint_speed = 134.0;
        s.fly_speed = 60.0;
        s.ambush_speed = 134.0 * 1.2;
        s.takeoff_stamina = 20.0;
        s.glide_stamina_regen = 2.0;
        s
    }

    #[test]
    fn a_printed_stat_becomes_studs_a_second_the_way_the_game_converts_it() {
        let s = runner();
        // 27 / 10 * 60, then / 60 * 4.42.
        assert!((MovementState::Walking.studs_per_second(&s) - 11.934).abs() < 1e-9);
        assert!((MovementState::Sprinting.studs_per_second(&s) - 59.228).abs() < 1e-9);
        assert_eq!(MovementState::Standing.studs_per_second(&s), 0.0);
        assert!((MovementState::Ambushing.studs_per_second(&s) - 59.228 * 1.2).abs() < 1e-6);
    }

    fn side_after(state: MovementState, seconds: f64, stamina_on: bool) -> (f64, f64, MovementState) {
        let stats = runner();
        let mut config = ComposableAbilityConfig::default();
        config.stamina_enabled = stamina_on;
        config.attacker_movement = state;
        let result = simulate_composable_matchup_with_trace(
            &stats, &harmless(), None, None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            seconds, true,
        );
        let side = result.debug.expect("side snapshot").a;
        (side.distance_studs, side.stamina, side.movement)
    }

    #[test]
    fn every_state_falls_back_to_walking_while_the_glide_has_no_bound() {
        // The game turns a spent flight into a glide. This model does not,
        // because its glide is free, full-speed and endless - see `when_spent`.
        for state in [
            MovementState::Flying,
            MovementState::Sprinting,
            MovementState::Ambushing,
            MovementState::Walking,
            MovementState::Gliding,
            MovementState::Standing,
        ] {
            assert_eq!(state.when_spent(), MovementState::Walking, "{state:?}");
        }
    }

    #[test]
    fn walking_costs_nothing_and_still_covers_ground() {
        let (distance, stamina, state) = side_after(MovementState::Walking, 10.0, true);
        assert!((distance - 119.34).abs() < 0.01, "ten seconds at 11.934: got {distance}");
        assert_eq!(stamina, 135.0, "walking is free and the pool stays full");
        assert_eq!(state, MovementState::Walking);
    }

    #[test]
    fn sprinting_burns_two_a_second_and_drops_to_walking_when_it_runs_out() {
        // 135 stamina at 2 a second is 67.5 seconds of sprint, and the regen is
        // switched off while sprinting rather than slowing the burn.
        let (_, stamina, state) = side_after(MovementState::Sprinting, 60.0, true);
        assert!((stamina - 15.0).abs() < 1e-6, "60 s of sprint leaves 15: got {stamina}");
        assert_eq!(state, MovementState::Sprinting);

        // Past that it alternates rather than settling into a walk: walking
        // regenerates, and the tick after the pool has something in it the
        // intent is back. So the run covers less ground than an endless sprint
        // and more than a walk, and the pool stays near empty.
        let (distance, stamina, _) = side_after(MovementState::Sprinting, 120.0, true);
        let all_sprint = 59.228 * 120.0;
        let all_walk = 11.934 * 120.0;
        assert!(distance < all_sprint, "cannot outrun the pool: got {distance}");
        assert!(distance > all_walk, "and does not give up sprinting: got {distance}");
        assert!(stamina < 10.0, "the pool stays near empty: got {stamina}");
    }

    #[test]
    fn with_stamina_off_it_sprints_for_ever() {
        let (distance, _, state) = side_after(MovementState::Sprinting, 120.0, false);
        assert_eq!(state, MovementState::Sprinting);
        assert!((distance - 59.228 * 120.0).abs() < 1.0, "got {distance}");
    }

    #[test]
    fn the_intent_holds_and_comes_back_the_tick_the_pool_can_pay_again() {
        let stats = runner();
        let mut side = CombatSide::new(&stats, None);
        side.movement = MovementState::Sprinting;
        side.next_movement_tick = MOVEMENT_TICK_SEC;
        side.stamina = 1.0;

        let mut idle = CombatSide::new(&stats, None);

        process_movement_pair(&mut side, &stats, &mut idle, &stats, 0.5, true, 0.0, 0.0, &[]);
        assert_eq!(side.movement_now, MovementState::Sprinting, "one tick is affordable");
        assert_eq!(side.stamina, 0.0);

        process_movement_pair(&mut side, &stats, &mut idle, &stats, 1.0, true, 0.0, 0.0, &[]);
        assert_eq!(side.movement_now, MovementState::Walking, "the next one is not");
        assert_eq!(side.movement, MovementState::Sprinting, "but the intent is unchanged");

        side.stamina = 5.0;
        process_movement_pair(&mut side, &stats, &mut idle, &stats, 1.5, true, 0.0, 0.0, &[]);
        assert_eq!(side.movement_now, MovementState::Sprinting, "and it is acted on again");
    }

    #[test]
    fn gliding_costs_nothing_and_refills_at_its_own_rate() {
        let (distance, stamina, _) = side_after(MovementState::Gliding, 10.0, true);
        assert!((distance - 60.0 * LEVEL_GLIDE_FACTOR * 10.0).abs() < 0.01, "got {distance}");
        assert_eq!(stamina, 135.0, "a full pool stays full");
    }

    #[test]
    fn the_air_does_not_use_the_ground_conversion() {
        // A ground speed goes through x0.442; a flying speed goes through the
        // angle factor instead. On this creature - walk 27, sprint 134, fly 60 -
        // that is the difference between flight being the slowest state and the
        // fastest.
        let s = runner();
        let walk = MovementState::Walking.studs_per_second(&s);
        let sprint = MovementState::Sprinting.studs_per_second(&s);
        let fly = MovementState::Flying.studs_per_second(&s);
        let glide = MovementState::Gliding.studs_per_second(&s);

        assert!((walk - 11.934).abs() < 1e-9);
        assert!((sprint - 59.228).abs() < 1e-9);
        assert!((fly - 60.0 * 2.325).abs() < 1e-9, "level flight is 2.325 x the stat: got {fly}");
        assert!((glide - 60.0 * 2.37875).abs() < 1e-9, "a level glide is a shade faster: got {glide}");
        assert!(fly > sprint * 2.0, "flight is the fastest state, not the slowest");
        assert!(glide > fly, "and a settled glide trades power for a little more speed");
    }

    /// Both sides given a state, a line to cross and a head start for B.
    fn race(
        a_state: MovementState,
        b_state: MovementState,
        goal: f64,
        gap: f64,
        seconds: f64,
    ) -> (crate::contracts::SimulationDebug, crate::contracts::SimulationDebug) {
        let stats = runner();
        let mut config = ComposableAbilityConfig::default();
        config.stamina_enabled = true;
        config.attacker_movement = a_state;
        config.defender_movement = b_state;
        config.route_distance_studs = goal;
        config.route_initial_gap_studs = gap;
        let result = simulate_composable_matchup_with_trace(
            &stats, &stats, None, None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            seconds, true,
        );
        let debug = result.debug.expect("side snapshots");
        (debug.a, debug.b)
    }

    #[test]
    fn the_faster_state_crosses_the_line_first() {
        // 600 studs: sprinting covers it in 10.1 s, walking in 50.3.
        let (a, b) = race(MovementState::Sprinting, MovementState::Walking, 600.0, 0.0, 120.0);
        let sprint_at = a.reached_distance_at.expect("the sprinter finished");
        let walk_at = b.reached_distance_at.expect("the walker finished too");
        assert!(sprint_at < walk_at, "{sprint_at} against {walk_at}");
        // Solved inside the tick rather than rounded to the grid: 600 studs at
        // 59.228 a second is 10.1305, and at 11.934 it is 50.2765.
        assert!((sprint_at - 600.0 / 59.228).abs() < 1e-6, "got {sprint_at}");
        assert!((walk_at - 600.0 / 11.934).abs() < 1e-6, "got {walk_at}");
    }

    #[test]
    fn a_line_nobody_reaches_is_left_uncrossed() {
        let (a, _) = race(MovementState::Walking, MovementState::Walking, 10_000.0, 0.0, 30.0);
        assert!(a.reached_distance_at.is_none());
        assert!(a.distance_studs > 0.0, "it was still running");
    }

    #[test]
    fn a_pursuer_closes_a_gap_only_if_it_is_the_faster_one() {
        // 200 studs of head start, closing at 59.23 - 11.93 = 47.29 a second:
        // caught inside five seconds.
        let (a, _) = race(MovementState::Sprinting, MovementState::Walking, 0.0, 200.0, 60.0);
        let caught = a.caught_opponent_at.expect("the sprinter caught the walker");
        // 200 studs at 59.228 - 11.934 = 47.294 a second, solved inside the tick.
        assert!((caught - 200.0 / (59.228 - 11.934)).abs() < 1e-6, "got {caught}");

        // The same gap against an equal runner never closes.
        let (a, _) = race(MovementState::Walking, MovementState::Walking, 0.0, 200.0, 60.0);
        assert!(a.caught_opponent_at.is_none(), "level speeds hold the gap");

        // And a slower pursuer falls further behind.
        let (a, b) = race(MovementState::Walking, MovementState::Sprinting, 0.0, 200.0, 60.0);
        assert!(a.caught_opponent_at.is_none());
        assert!(b.distance_studs > a.distance_studs, "the pursued pulled away");
    }

    #[test]
    fn a_race_records_no_catch_because_there_is_no_gap_to_close() {
        let (a, _) = race(MovementState::Sprinting, MovementState::Walking, 600.0, 0.0, 60.0);
        assert!(a.caught_opponent_at.is_none());
    }

    #[test]
    fn a_creature_going_down_or_down_covers_no_ground() {
        // Sitting and lying exclude moving, both ways: a creature holds still
        // to get down and cannot move once it is there. The transition counts,
        // which is what makes lying down to refill a trade rather than free.
        let stats = runner();
        for posture in [super::super::posture::Posture::Sitting, super::super::posture::Posture::Laying] {
            // Settled.
            let mut side = CombatSide::new(&stats, None);
            side.movement = MovementState::Sprinting;
            side.next_movement_tick = MOVEMENT_TICK_SEC;
            side.posture_current = posture;
            side.posture_pending = posture;
            let mut idle = CombatSide::new(&stats, None);
            process_movement_pair(&mut side, &stats, &mut idle, &stats, 0.5, true, 0.0, 0.0, &[]);
            assert_eq!(side.distance_studs, 0.0, "{posture:?} covers no ground");
            assert_eq!(side.stamina, stats.stamina, "and spends no stamina");
            assert_eq!(side.movement_now, MovementState::Standing);
            assert_eq!(side.movement, MovementState::Sprinting, "the intent survives it");

            // On the way down.
            let mut going = CombatSide::new(&stats, None);
            going.movement = MovementState::Sprinting;
            going.next_movement_tick = MOVEMENT_TICK_SEC;
            going.posture_pending = posture;
            let mut idle = CombatSide::new(&stats, None);
            process_movement_pair(&mut going, &stats, &mut idle, &stats, 0.5, true, 0.0, 0.0, &[]);
            assert_eq!(going.distance_studs, 0.0, "going down holds still too");
        }
    }

    fn identify(kind: &str, tier: f64) -> crate::contracts::CreatureIdentity {
        crate::contracts::CreatureIdentity {
            creature_type: kind.to_string(),
            diet: String::new(),
            elder: String::new(),
            tier,
            is_aerial: kind.eq_ignore_ascii_case("Flier"),
        }
    }

    #[test]
    fn a_leg_list_says_what_the_ground_under_a_point_is() {
        let legs = vec![RouteLeg { studs: 30.0, water: false }, RouteLeg { studs: 70.0, water: true }];
        assert!(!is_water_at(&legs, 0.0));
        assert!(!is_water_at(&legs, 29.9));
        assert!(is_water_at(&legs, 30.0), "the second leg starts here");
        assert!(is_water_at(&legs, 99.9));
        assert!(is_water_at(&legs, 500.0), "past the end the last leg keeps going");
        assert!(!is_water_at(&[], 500.0), "no legs is one stretch of land");
    }

    #[test]
    fn the_interval_for_staying_afloat_comes_off_the_tier() {
        // map(tier, 1, 5, 1, 0.65), which the game's own helper computes
        // linearly.
        for (tier, expected) in [(1.0, 1.0), (2.0, 0.9125), (3.0, 0.825), (4.0, 0.7375), (5.0, 0.65)] {
            let mut stats = runner();
            stats.identity = Some(identify("Terrestrial", tier));
            assert!(
                (swim_drain_interval(&stats) - expected).abs() < 1e-9,
                "tier {tier}: expected {expected}, got {}",
                swim_drain_interval(&stats),
            );
        }
    }

    #[test]
    fn water_costs_a_land_creature_and_costs_a_swimmer_nothing() {
        for (kind, expect_drain) in [("Terrestrial", true), ("Aquatic", false), ("Semi-Aquatic", false)] {
            let mut stats = runner();
            stats.identity = Some(identify(kind, 1.0));
            let mut side = CombatSide::new(&stats, None);
            // Ten seconds of water at a tier-1 interval of one second.
            for step in 1..=10 {
                process_afloat(&mut side, &stats, step as f64, true, true);
            }
            if expect_drain {
                assert!(side.stamina < stats.stamina, "{kind} spends stamina to stay afloat");
            } else {
                assert_eq!(side.stamina, stats.stamina, "{kind} spends no stamina");
            }
        }
    }

    #[test]
    fn an_empty_pool_in_water_drowns_at_the_measured_figure() {
        // Measured by the owner: a creature of 1200 maximum lost 21 a hit, four
        // running - 1.75% - and the hits come on the drain's own tick.
        let mut stats = runner();
        stats.health = 1200.0;
        stats.stamina = 2.0;
        stats.identity = Some(identify("Terrestrial", 1.0));
        let mut side = CombatSide::new(&stats, None);
        side.hp = 1200.0;

        let mut seen = Vec::new();
        for step in 1..=6 {
            let before = side.hp;
            process_afloat(&mut side, &stats, step as f64, true, true);
            if side.hp < before {
                seen.push(before - side.hp);
            }
        }
        assert!(seen.len() >= 4, "four hits at least: {seen:?}");
        for hit in &seen {
            assert!((hit - 21.0).abs() < 1e-9, "each hit is 21: {seen:?}");
        }

        // And nothing once the side is at or under a twentieth of its maximum.
        assert_eq!(drown_damage(60.0, 1200.0), 0.0);
        assert_eq!(drown_damage(59.0, 1200.0), 0.0);
        assert!((drown_damage(70.0, 1200.0) - 10.0).abs() < 1e-9, "and never through the floor");
    }

    #[test]
    fn an_aquatic_hauls_itself_over_land_at_its_beached_figure() {
        let mut stats = runner();
        stats.identity = Some(identify("Aquatic", 3.0));
        stats.beached_speed = 5.0;
        let mut side = CombatSide::new(&stats, None);
        side.movement = MovementState::Sprinting;
        side.next_movement_tick = MOVEMENT_TICK_SEC;
        let mut idle = CombatSide::new(&stats, None);
        process_movement_pair(&mut side, &stats, &mut idle, &stats, 0.5, true, 0.0, 0.0, &[]);
        assert!(
            (side.distance_studs - 5.0 * STUDS_PER_SECOND_PER_STAT * MOVEMENT_TICK_SEC).abs() < 1e-9,
            "beached, not sprinting: got {}",
            side.distance_studs,
        );
    }

    #[test]
    fn two_creatures_racing_never_reach_each_other() {
        // They are level because they set off together, not because they are
        // standing on each other. Each is running its own line.
        let mut stats = runner();
        stats.damage = 100.0;
        stats.bite_cooldown = 1.0;

        let mut config = ComposableAbilityConfig::default();
        config.stamina_enabled = true;
        config.attacker_movement = MovementState::Sprinting;
        config.defender_movement = MovementState::Sprinting;

        let result = simulate_composable_matchup_with_trace(
            &stats, &stats, None, None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            30.0, true,
        );
        let bites = result
            .combat_log
            .expect("trace")
            .iter()
            .filter(|e| e.entry_type == "bite")
            .count();
        assert_eq!(bites, 0, "a race is not a fight");
    }

    #[test]
    fn nobody_bites_across_a_gap_and_biting_starts_when_it_closes() {
        // A creature 200 studs behind cannot reach the one in front, however
        // fast its bite cooldown is. Bites start once it has closed the gap.
        let mut stats = runner();
        stats.damage = 100.0;
        stats.bite_cooldown = 1.0;
        stats.health = 1e9;

        let mut config = ComposableAbilityConfig::default();
        config.stamina_enabled = true;
        config.attacker_movement = MovementState::Sprinting;
        config.defender_movement = MovementState::Walking;
        config.route_initial_gap_studs = 200.0;

        let result = simulate_composable_matchup_with_trace(
            &stats, &stats, None, None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            30.0, true,
        );
        let caught = result
            .debug
            .as_ref()
            .expect("side snapshots")
            .a
            .caught_opponent_at
            .expect("the sprinter closed the gap");
        let bites: Vec<f64> = result
            .combat_log
            .expect("trace")
            .iter()
            .filter(|e| e.entry_type == "bite")
            .map(|e| e.time)
            .collect();
        assert!(!bites.is_empty(), "the fight resumed once they met");
        let earliest = bites.iter().copied().fold(f64::INFINITY, f64::min);
        assert!(
            earliest + 1e-9 >= caught,
            "no bite before the gap closed at {caught}: earliest was {earliest}",
        );
        // And the cadence is not saved up while chasing: a 1 s cooldown over the
        // 4.2 s of chase would otherwise land four bites the moment they meet.
        let at_the_moment = bites.iter().filter(|t| **t < caught + 1.5).count();
        assert!(at_the_moment <= 2, "bites were banked while apart: {bites:?}");
    }

    /// How many times `ability` landed over a run held `gap` studs apart. Both
    /// sides sprint, so the gap is the gap for the whole window and the only
    /// thing deciding whether the ability lands is its own reach.
    fn chase_ability_hits(gap: f64, frost_nova_value: f64, ability: &str) -> usize {
        let mut stats = runner();
        stats.damage = 0.0;
        stats.health = 1e9;
        stats.frost_nova_range_studs = frost_nova_value;

        let mut config = ComposableAbilityConfig::default();
        config.stamina_enabled = true;
        config.attacker_movement = MovementState::Sprinting;
        config.defender_movement = MovementState::Sprinting;
        config.route_initial_gap_studs = gap;
        match ability {
            "Frost Nova" => config.attacker_frost_nova = true,
            "Grim Lariat" => config.attacker_grim_lariat = true,
            "Cause Fear" => config.attacker_cause_fear = true,
            other => panic!("no gate wired for {other}"),
        }

        simulate_composable_matchup_with_trace(
            &stats, &stats, None, None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            8.0, true,
        )
        .combat_log
        .expect("trace")
        .iter()
        .filter(|e| {
            e.description.as_deref().is_some_and(|d| d.contains(ability))
                || e.detail.as_deref().is_some_and(|d| d.contains(ability))
        })
        .count()
    }

    #[test]
    fn an_ability_does_not_land_across_more_studs_than_it_reaches() {
        // Grim Lariat reaches 75. Across 600 studs of chase it never lands;
        // across 40 it lands from the first moment.
        assert_eq!(chase_ability_hits(600.0, 0.0, "Grim Lariat"), 0);
        assert!(chase_ability_hits(40.0, 0.0, "Grim Lariat") > 0);

        // Cause Fear reaches twice as far, so a gap Grim Lariat cannot cross is
        // inside its own figure.
        assert_eq!(chase_ability_hits(600.0, 0.0, "Cause Fear"), 0);
        assert!(chase_ability_hits(120.0, 0.0, "Cause Fear") > 0);
    }

    #[test]
    fn frost_nova_reaches_as_far_as_the_creature_says() {
        // 100 studs apart: a carrier printed at 75 cannot reach, one printed at
        // 300 can. Same ability, same gap, different creature.
        assert_eq!(chase_ability_hits(100.0, 75.0, "Frost Nova"), 0);
        assert!(chase_ability_hits(100.0, 300.0, "Frost Nova") > 0);
        // No value at all falls back to 75, so it behaves as the 75 carrier.
        assert_eq!(chase_ability_hits(100.0, 0.0, "Frost Nova"), 0);
    }

    #[test]
    fn a_fight_reads_no_range_at_all() {
        // Both sides standing, no gap: the gate cannot refuse, whatever the
        // reach. This is what keeps every existing fight unchanged.
        let mut stats = runner();
        stats.frost_nova_range_studs = 1.0;
        let a = CombatSide::new(&stats, None);
        let b = CombatSide::new(&stats, None);
        assert_eq!(gap_studs(&a, &b, 0.0), 0.0);
        for ability in ["Frost Nova", "Grim Lariat", "Ink Cloud", "Escape Area"] {
            assert!(
                super::super::ability_range::within_reach(ability, &stats, &a, &b, 0.0),
                "{ability} was refused in a facetank",
            );
        }
    }

    fn chase_bites(defender_damage2: f64) -> (usize, usize) {
        let mut stats = runner();
        stats.damage = 100.0;
        stats.bite_cooldown = 1.0;
        stats.health = 1e9;
        let mut pursued = stats.clone();
        pursued.damage2 = defender_damage2;

        let mut config = ComposableAbilityConfig::default();
        config.stamina_enabled = true;
        config.attacker_movement = MovementState::Sprinting;
        config.defender_movement = MovementState::Walking;
        config.route_initial_gap_studs = 50.0;

        let log = simulate_composable_matchup_with_trace(
            &stats, &pursued, None, None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            30.0, true,
        )
        .combat_log
        .expect("trace");
        let by = |who: &str| {
            log.iter()
                .filter(|e| e.entry_type == "bite" && e.attacker == who)
                .count()
        };
        (by("A"), by("B"))
    }

    #[test]
    fn the_one_being_chased_bites_over_its_shoulder_or_not_at_all() {
        // It is running away: what it can bring to bear on something behind it
        // is a secondary attack. Without one it never bites, however long the
        // pursuer stays on it.
        let (pursuer_with, pursued_with) = chase_bites(80.0);
        assert!(pursuer_with > 0, "the pursuer caught up and bit");
        assert!(pursued_with > 0, "and the pursued answered with its secondary");

        let (pursuer_without, pursued_without) = chase_bites(0.0);
        assert!(pursuer_without > 0, "the pursuer is unaffected by the rule");
        assert_eq!(pursued_without, 0, "no secondary attack, no answer");
    }

    #[test]
    fn a_fight_leaves_both_sides_standing_and_covers_no_ground() {
        let stats = runner();
        let mut config = ComposableAbilityConfig::default();
        config.stamina_enabled = true;
        let result = simulate_composable_matchup_with_trace(
            &stats, &stats, None, None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            30.0, true,
        );
        let side = result.debug.expect("side snapshot").a;
        assert_eq!(side.distance_studs, 0.0);
        assert_eq!(side.movement, MovementState::Standing);
    }
}
