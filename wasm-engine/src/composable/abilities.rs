// Ability-specific helpers for the composable engine (Lich Mark + Yolk Bomb).
//
// Extracted from composable/mod.rs (light split, behavior-preserving).
//
// Lich Mark: 30 s cooldown armed window; first melee hit in window *places*
// the mark on the target, the next melee hit *converts* the mark into 5
// stacks of the owner-defined payload status. Tracking uses
// `lich_mark_*` fields on CombatSide.
//
// Yolk Bomb: single ability slot, behavior depends on the `value` string
// routed to self-status / enemy-status / self-fortify.

use std::collections::BTreeMap;

use crate::contracts::{SimpleAppliedStatus, SimpleCombatantStats, SimpleStatusInstance};
use crate::statuses::apply_incoming_statuses_to_target_with_fortify_immunity;

use super::status_helpers::apply_status_delta;
use super::CombatSide;

// ---------------------------------------------------------------------------
// Lich Mark
// ---------------------------------------------------------------------------

pub(super) const LICH_MARK_STATUS_ID: &str = "Lich_Mark_Status";
pub(super) const LICH_MARK_ARMED_WINDOW_SEC: f64 = 5.0;
pub(super) const LICH_MARK_COOLDOWN_SEC: f64 = 30.0;

fn clear_lich_mark_pending(side: &mut CombatSide, time: f64) {
    let pending_stacks = side
        .statuses
        .get(LICH_MARK_STATUS_ID)
        .map(|instance| instance.stacks)
        .unwrap_or(0.0);
    if pending_stacks > 0.0 {
        apply_status_delta(time, &mut side.statuses, LICH_MARK_STATUS_ID, -pending_stacks);
    }
    side.lich_mark_pending_payload_status_id = None;
}

fn clear_lich_mark_owned_payload(side: &mut CombatSide, time: f64) {
    let Some(payload_status_id) = side.lich_mark_owned_payload_status_id.clone() else {
        return;
    };
    let owned_stacks = side
        .statuses
        .get(&payload_status_id)
        .and_then(|instance| instance.lich_mark_owned_stacks)
        .unwrap_or(0.0);
    if owned_stacks > 0.0 {
        apply_status_delta(time, &mut side.statuses, &payload_status_id, -owned_stacks);
    }
    side.lich_mark_owned_payload_status_id = None;
}

fn place_lich_mark_pending(
    attacker: &mut CombatSide,
    defender: &mut CombatSide,
    payload_status_id: &str,
    time: f64,
) {
    clear_lich_mark_pending(defender, time);
    apply_status_delta(time, &mut defender.statuses, LICH_MARK_STATUS_ID, 1.0);
    defender.lich_mark_pending_payload_status_id = Some(payload_status_id.to_string());
    attacker.lich_mark_armed_until = 0.0;
}

fn convert_lich_mark_pending(
    defender: &mut CombatSide,
    payload_status_id: &str,
    time: f64,
) {
    clear_lich_mark_pending(defender, time);
    clear_lich_mark_owned_payload(defender, time);
    apply_status_delta(time, &mut defender.statuses, payload_status_id, 5.0);
    if let Some(instance) = defender.statuses.get_mut(payload_status_id) {
        instance.lich_mark_owned_stacks = Some(5.0_f64.min(instance.stacks));
    }
    defender.lich_mark_owned_payload_status_id = Some(payload_status_id.to_string());
}

pub(super) fn apply_lich_mark_on_melee_hit(
    attacker: &mut CombatSide,
    defender: &mut CombatSide,
    payload_status_id: Option<&str>,
    time: f64,
) {
    let Some(payload_status_id) = payload_status_id else {
        return;
    };
    let has_pending_mark = defender
        .statuses
        .get(LICH_MARK_STATUS_ID)
        .map(|instance| instance.stacks > 0.0)
        .unwrap_or(false)
        && defender.lich_mark_pending_payload_status_id.as_deref() == Some(payload_status_id);
    if has_pending_mark {
        convert_lich_mark_pending(defender, payload_status_id, time);
        return;
    }
    if attacker.lich_mark_armed_until > 0.0 && attacker.lich_mark_armed_until > time {
        place_lich_mark_pending(attacker, defender, payload_status_id, time);
    }
}

// ---------------------------------------------------------------------------
// Yolk Bomb
// ---------------------------------------------------------------------------

const YOLK_BOMB_VALUE_STACKS: f64 = 4.0;
const YOLK_BOMB_SLOW_STACKS: f64 = 2.0;
const YOLK_BOMB_FORTIFY_DURATION_SEC: f64 = 12.0; // 4 stacks * 3s stack duration

#[derive(Clone, Copy)]
enum YolkBombRouting<'a> {
    SelfStatus(&'a str),
    EnemyStatus(&'a str),
    SelfFortify,
    None,
}

fn resolve_yolk_bomb_routing(value: Option<&str>) -> YolkBombRouting<'_> {
    // P5 (2026-05-18): expanded from a 15-entry hardcoded match to the
    // full modeled/partial status catalog. Positive statuses (heals,
    // buffs, regeneration-likes) apply to SELF; negative statuses
    // apply to ENEMY. Both legacy CamelCase values ("BadOmen",
    // "BlurredVision", "Heatwave") and the new display-name format
    // ("Bad Omen", "Blurred Vision", "Heat Wave") resolve to the same
    // routing so existing `creatures.runtime.json` data keeps working
    // unchanged.
    //
    // Adding a new modeled/partial status requires:
    //   - One line in the TS `statusCatalog.ts::NAME_TO_ENGINE_ID`.
    //   - One arm here, choosing Self / Enemy routing.
    // The TS picker (`abilityValueOptions.ts::YOLK_BOMB_VALUE_OPTIONS`)
    // mirrors the routings below — the engine and the UI agree on
    // what's pickable.
    match value {
        // ---- SELF-target (buffs, heals, regen-likes) ----
        Some("Healing Pulse") => YolkBombRouting::SelfStatus("Healing_Pulse_Status"),
        Some("Stamina Boost") => YolkBombRouting::SelfStatus("Stamina_Boost_Status"),
        Some("Fortify") => YolkBombRouting::SelfFortify,
        Some("Healing Ailment") => YolkBombRouting::SelfStatus("Healing_Ailment"),
        Some("Blessing's Boon") => YolkBombRouting::SelfStatus("Blessings_Boon"),
        Some("Flowering") => YolkBombRouting::SelfStatus("Flowering_Status"),
        Some("Water Regeneration") => YolkBombRouting::SelfStatus("Water_Regeneration_Status"),

        // ---- ENEMY-target — display-name form (preferred going forward) ----
        Some("Bad Omen") => YolkBombRouting::EnemyStatus("Bad_Omen"),
        Some("Bleed") => YolkBombRouting::EnemyStatus("Bleed_Status"),
        Some("Blurred Vision") => YolkBombRouting::EnemyStatus("Blurred_Vision_Status"),
        Some("Broken Bones") => YolkBombRouting::EnemyStatus("Broken_Bones_Status"),
        Some("Burn") => YolkBombRouting::EnemyStatus("Burn_Status"),
        Some("Confusion") => YolkBombRouting::EnemyStatus("Confusion_Status"),
        Some("Corrosion") => YolkBombRouting::EnemyStatus("Corrosion_Status"),
        Some("Deep Wounds") => YolkBombRouting::EnemyStatus("Deep_Wounds_Status"),
        Some("Disease") => YolkBombRouting::EnemyStatus("Disease_Status"),
        Some("Drowsy") => YolkBombRouting::EnemyStatus("Drowsy_Status"),
        Some("Fear") => YolkBombRouting::EnemyStatus("Scared_Status"),
        Some("Freeze") => YolkBombRouting::EnemyStatus("Freeze_Status"),
        Some("Frostbite") => YolkBombRouting::EnemyStatus("Frostbite_Status"),
        Some("Gale") => YolkBombRouting::EnemyStatus("Water_Gale_Status"),
        Some("Heartbroken") => YolkBombRouting::EnemyStatus("Heartbroken_Status"),
        Some("Heat Wave") => YolkBombRouting::EnemyStatus("Heat_Wave_Status"),
        Some("Hypothermia") => YolkBombRouting::EnemyStatus("Hypothermia_Status"),
        Some("Injury") => YolkBombRouting::EnemyStatus("Injury_Status"),
        Some("Malice's Mark") => YolkBombRouting::EnemyStatus("Malices_Mark"),
        Some("Necropoison") => YolkBombRouting::EnemyStatus("Necropoison_Status"),
        Some("Poison") => YolkBombRouting::EnemyStatus("Poison_Status"),
        Some("Shock") => YolkBombRouting::EnemyStatus("Shock_Status"),
        Some("Shredded Wings") => YolkBombRouting::EnemyStatus("Shredded_Wings"),
        Some("Slowed") => YolkBombRouting::EnemyStatus("Slow_Status"),
        Some("Sticky Teeth") => YolkBombRouting::EnemyStatus("Sticky_Teeth_Status"),
        Some("Stolen Speed") => YolkBombRouting::EnemyStatus("Stolen_Speed_Status"),
        Some("Torn Ligaments") => YolkBombRouting::EnemyStatus("Torn_Ligaments_Status"),

        // ---- ENEMY-target — legacy CamelCase aliases (back-compat with
        // existing `creatures.runtime.json` data; wiki-sync may still
        // emit these for some creatures) ----
        Some("BlurredVision") => YolkBombRouting::EnemyStatus("Blurred_Vision_Status"),
        Some("BadOmen") => YolkBombRouting::EnemyStatus("Bad_Omen"),
        Some("Heatwave") => YolkBombRouting::EnemyStatus("Heat_Wave_Status"),
        Some("Aftershock") => YolkBombRouting::EnemyStatus("Aftershock"),

        _ => YolkBombRouting::None,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn apply_yolk_bomb(
    time: f64,
    value: Option<&str>,
    attacker_stats: &SimpleCombatantStats,
    defender_stats: &SimpleCombatantStats,
    attacker_hp: f64,
    defender_hp: f64,
    attacker_statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    attacker_fortify_immune_until: f64,
    defender_fortify_immune_until: f64,
    attacker_fortify_immune_until_out: &mut f64,
    attacker_fortify_weight_bonus_until_out: &mut f64,
) {
    let routing = resolve_yolk_bomb_routing(value);
    let slow = SimpleAppliedStatus {
        status_id: "Slow_Status".to_string(),
        stacks: YOLK_BOMB_SLOW_STACKS, source_ability: None };
    match routing {
        YolkBombRouting::SelfFortify => {
            let until = time + YOLK_BOMB_FORTIFY_DURATION_SEC;
            if until > *attacker_fortify_immune_until_out {
                *attacker_fortify_immune_until_out = until;
            }
            if until > *attacker_fortify_weight_bonus_until_out {
                *attacker_fortify_weight_bonus_until_out = until;
            }
            apply_incoming_statuses_to_target_with_fortify_immunity(
                time, attacker_stats, attacker_hp, attacker_statuses, &[slow],
                attacker_fortify_immune_until,
            );
        }
        YolkBombRouting::SelfStatus(status_id) => {
            let statuses = [
                SimpleAppliedStatus {
                    status_id: status_id.to_string(),
                    stacks: YOLK_BOMB_VALUE_STACKS, source_ability: None },
                slow,
            ];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                time, attacker_stats, attacker_hp, attacker_statuses, &statuses,
                attacker_fortify_immune_until,
            );
        }
        YolkBombRouting::EnemyStatus(status_id) => {
            let statuses = [
                SimpleAppliedStatus {
                    status_id: status_id.to_string(),
                    stacks: YOLK_BOMB_VALUE_STACKS, source_ability: None },
                slow,
            ];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                time, defender_stats, defender_hp, defender_statuses, &statuses,
                defender_fortify_immune_until,
            );
        }
        YolkBombRouting::None => {}
    }
}
