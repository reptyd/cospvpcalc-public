//! Serde DTO contract layer.
//!
//! The canonical shapes that cross the WASM boundary — e.g.
//! [`SimpleCombatantStats`], [`crate::composable::ComposableAbilityConfig`],
//! [`BestBuildsMatchupSummary`], and [`Winner`]. These types are mirrored on the
//! TypeScript side by `RustSimpleCombatantStats` etc. in
//! `src/optimizer/rustMatchupBridge.ts`; field renames here must stay in sync
//! with that mirror.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum Winner {
    A,
    B,
    #[default]
    Draw,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BestBuildsMatchupSummary {
    pub winner: Winner,
    #[serde(rename = "deathTimeA")]
    pub death_time_a: Option<f64>,
    #[serde(default, rename = "deathTimeB")]
    pub death_time_b: Option<f64>,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "dpsAtoB")]
    pub dps_a_to_b: f64,
    #[serde(default, rename = "dpsBtoA")]
    pub dps_b_to_a: f64,
    #[serde(rename = "ttkAtoB")]
    pub ttk_a_to_b: f64,
    #[serde(default, rename = "ttkBtoA")]
    pub ttk_b_to_a: f64,
    #[serde(rename = "damageDealtA")]
    pub damage_dealt_a: f64,
    #[serde(default, rename = "damageDealtB")]
    pub damage_dealt_b: f64,
    #[serde(rename = "damageDealtAAtBDeath")]
    pub damage_dealt_a_at_b_death: f64,
    #[serde(default, rename = "damageDealtBAtADeath")]
    pub damage_dealt_b_at_a_death: f64,
    #[serde(rename = "extendedDamagePotentialA")]
    pub extended_damage_potential_a: f64,
    #[serde(default, rename = "extendedDamagePotentialB")]
    pub extended_damage_potential_b: f64,
    #[serde(default, rename = "finalHpA")]
    pub final_hp_a: f64,
    #[serde(default, rename = "finalHpB")]
    pub final_hp_b: f64,
    #[serde(default, rename = "maxHpA")]
    pub max_hp_a: f64,
    #[serde(default, rename = "maxHpB")]
    pub max_hp_b: f64,
    #[serde(default, rename = "hpAAtBDeath")]
    pub hp_a_at_b_death: f64,
    #[serde(default, rename = "hpBAtADeath")]
    pub hp_b_at_a_death: f64,
    #[serde(default, rename = "damageDealtA_untilBDeath")]
    pub damage_dealt_a_until_b_death: f64,
    #[serde(default, rename = "damageDealtB_untilADeath")]
    pub damage_dealt_b_until_a_death: f64,
    #[serde(default, rename = "ehpA")]
    pub ehp_a: f64,
    #[serde(default, rename = "ehpB")]
    pub ehp_b: f64,
    #[serde(default, rename = "regenHealedA")]
    pub regen_healed_a: f64,
    #[serde(default, rename = "regenHealedB")]
    pub regen_healed_b: f64,
    #[serde(default, rename = "regenTicksA")]
    pub regen_ticks_a: u32,
    #[serde(default, rename = "regenTicksB")]
    pub regen_ticks_b: u32,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "combatLog")]
    pub combat_log: Option<Vec<CombatLogEntry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug: Option<SimulationDebugBySide>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "badOmenOutcome")]
    pub bad_omen_outcome: Option<SimpleBadOmenOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CombatLogEntry {
    pub time: f64,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub attacker: String,
    pub damage: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub healing: Option<f64>,
    pub actor_hp_after: f64,
    pub hp_side: String,
    pub hp_after: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "statusId")]
    pub status_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulationDebug {
    #[serde(default)]
    pub total_damage_dealt: f64,
    #[serde(default)]
    pub total_life_leech_healed: f64,
    #[serde(default)]
    pub dot_dps: f64,
    #[serde(default)]
    pub regen_ticks: u32,
    #[serde(default)]
    pub regen_healed: f64,
    #[serde(default)]
    pub weight_ratio: f64,
    #[serde(default)]
    pub weight_ratio_cap_hit: bool,
    #[serde(default)]
    pub attacker_weight: f64,
    #[serde(default)]
    pub opponent_weight: f64,
    #[serde(default)]
    pub warden_rage_on: bool,
    #[serde(default)]
    pub warden_rage_stacks: i32,
    #[serde(default)]
    pub warden_rage_cooldown_until: f64,
    #[serde(default)]
    pub warden_rage_tap_until: f64,
    #[serde(default)]
    pub next_regen_at: Option<f64>,
    #[serde(default)]
    pub warden_rage_events: Vec<String>,
    #[serde(default)]
    pub ability_timing_events: Vec<String>,
    #[serde(default)]
    pub ability_policy_overrides: BTreeMap<String, String>,
    #[serde(default)]
    pub warden_resistance_active: bool,
    #[serde(default)]
    pub reflect_active_until: f64,
    #[serde(default)]
    pub totem_next_tick_at: Option<f64>,
    #[serde(default)]
    pub drowsy_active: bool,
    #[serde(default)]
    pub plushie_offensive_stacks_applied: f64,
    #[serde(default)]
    pub plushie_defensive_stacks_applied: f64,
    #[serde(default)]
    pub abilities_present: Vec<String>,
    #[serde(default)]
    pub abilities_modeled: Vec<String>,
    #[serde(default)]
    pub abilities_applied: Vec<AbilityAppliedCount>,
    #[serde(default)]
    pub abilities_not_modeled: Vec<String>,
    #[serde(default)]
    pub status_stacks_applied: BTreeMap<String, f64>,
    #[serde(default)]
    pub status_stacks_blocked: BTreeMap<String, f64>,
    #[serde(default)]
    pub status_stack_block_fractions: BTreeMap<String, f64>,
    #[serde(default)]
    pub bite_count: u32,
    #[serde(default)]
    pub breath_tick_count: u32,
    #[serde(default)]
    pub compare_hunger: f64,
    #[serde(default)]
    pub compare_starting_hunger: f64,
    #[serde(default)]
    pub compare_appetite_base: f64,
    #[serde(default)]
    pub compare_hunger_rule_enabled: bool,
}

/// Per-ability activation counter. Mirrors TS shape
/// `Array<{ name: string; count: number }>` on `SimulationDebug.abilitiesApplied`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AbilityAppliedCount {
    pub name: String,
    pub count: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SimulationDebugBySide {
    #[serde(rename = "A")]
    pub a: SimulationDebug,
    #[serde(rename = "B")]
    pub b: SimulationDebug,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BestBuildAggregate {
    pub win: f64,
    pub draw: f64,
    pub survival: f64,
    #[serde(rename = "avgDps")]
    pub avg_dps: f64,
    #[serde(rename = "ttkWin")]
    pub ttk_win: f64,
    #[serde(rename = "immortalDamage")]
    pub immortal_damage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchupFixture {
    pub name: String,
    pub summary: BestBuildsMatchupSummary,
    pub expected_aggregate: BestBuildAggregate,
}

/// Read-only creature identity attributes surfaced to the custom-ability
/// decision DSL (Phase 5 / G8). These never affect combat math directly —
/// they exist so user abilities can gate on *who* the creature is via the
/// boolean-builtin read-vars `<side>.is_type.<T>` / `.is_diet.<D>` /
/// `.is_elder[.<V>]` and the numeric `<side>.tier`. Sourced from
/// `FinalStats` at the TS bridge (`toRustSimpleStats`); see
/// `SimpleCombatantStats::identity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CreatureIdentity {
    /// Game creature type, e.g. `"Flier"`. Empty when unknown. The
    /// resolver compares case-insensitively, so casing here is free.
    #[serde(default, rename = "type")]
    pub creature_type: String,
    /// Diet, e.g. `"Carnivore"` / `"Herbivore"` / `"Omnivore"`. Empty
    /// when unknown.
    #[serde(default)]
    pub diet: String,
    /// Elder variant: `"None"` / `"Devious"` / `"Gentle"` / `"Powerful"`.
    /// Empty or `"None"` ⇒ not an elder (bare `is_elder` resolves false).
    #[serde(default)]
    pub elder: String,
    /// Rarity / power tier (numeric). 0 when unknown. Read via the
    /// numeric `<side>.tier` var (ordinal — `opp.tier >= 4` works).
    #[serde(default)]
    pub tier: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SimpleCombatantStats {
    pub health: f64,
    pub weight: f64,
    pub damage: f64,
    #[serde(rename = "biteCooldown")]
    pub bite_cooldown: f64,
    /// Wiki-sourced secondary-attack damage (`stats.damage2` in
    /// `data/creatures.runtime.json`). Zero means the creature has no
    /// in-game secondary attack. Read by the BiteVariant policy when
    /// dynamic mode is on; otherwise unused — the binary "Use
    /// secondary attack only" Compare toggle still routes through
    /// `damage` (it overrides at the TS bridge before serialization).
    #[serde(default)]
    pub damage2: f64,
    #[serde(default)]
    #[serde(rename = "healthRegen")]
    pub health_regen: f64,
    #[serde(default = "default_active_cooldown_multiplier")]
    #[serde(rename = "activeCooldownMultiplier")]
    pub active_cooldown_multiplier: f64,
    #[serde(default)]
    #[serde(rename = "quickRecoveryHpRatioThreshold")]
    pub quick_recovery_hp_ratio_threshold: f64,
    #[serde(default)]
    #[serde(rename = "unbreakableDamageCapPct")]
    pub unbreakable_damage_cap_pct: f64,
    #[serde(default = "default_damage_taken_multiplier")]
    #[serde(rename = "damageTakenMultiplierOnBeingBitten")]
    pub damage_taken_multiplier_on_being_bitten: f64,
    #[serde(default)]
    #[serde(rename = "breathResistance")]
    pub breath_resistance: f64,
    #[serde(default = "default_berserk_bite_cooldown_multiplier")]
    #[serde(rename = "berserkBiteCooldownMultiplier")]
    pub berserk_bite_cooldown_multiplier: f64,
    #[serde(default)]
    #[serde(rename = "berserkHpRatioThreshold")]
    pub berserk_hp_ratio_threshold: f64,
    #[serde(default)]
    #[serde(rename = "firstStrikePct")]
    pub first_strike_pct: f64,
    #[serde(default = "default_first_strike_hp_ratio_threshold")]
    #[serde(rename = "firstStrikeHpRatioThreshold")]
    pub first_strike_hp_ratio_threshold: f64,
    #[serde(default)]
    #[serde(rename = "hasWardenResistance")]
    pub has_warden_resistance: bool,
    #[serde(default)]
    #[serde(rename = "hasReflect")]
    pub has_reflect: bool,
    #[serde(default)]
    #[serde(rename = "immuneStatusIds")]
    pub immune_status_ids: Vec<String>,
    #[serde(default)]
    #[serde(rename = "hunkerReductionPct")]
    pub hunker_reduction_pct: f64,
    #[serde(default)]
    #[serde(rename = "selfDestructProfile")]
    pub self_destruct_profile: Option<SimpleSelfDestructProfile>,
    #[serde(default)]
    #[serde(rename = "onHitStatuses")]
    pub on_hit_statuses: Vec<SimpleAppliedStatus>,
    #[serde(default)]
    #[serde(rename = "onHitTakenStatuses")]
    pub on_hit_taken_statuses: Vec<SimpleAppliedStatus>,
    #[serde(default)]
    #[serde(rename = "startingStatuses")]
    pub starting_statuses: Vec<SimpleAppliedStatus>,
    #[serde(default)]
    #[serde(rename = "statusResistFractions")]
    pub status_resist_fractions: BTreeMap<String, f64>,
    #[serde(default)]
    #[serde(rename = "plushieStatusBlockFractions")]
    pub plushie_status_block_fractions: BTreeMap<String, f64>,
    /// Knight plushie: reflects this % of incoming bite/breath damage back to
    /// attacker after the target takes the damage. No stat credit to target.
    /// Matches TS hitRuntime.ts Knight reflect logic.
    #[serde(default)]
    #[serde(rename = "plushieReflectAvgPct")]
    pub plushie_reflect_avg_pct: f64,
    /// Normalized ability names to skip during combat. Callers must normalize
    /// names via TS `normalizeAbilityName` before passing. Applied at wasm
    /// entry (apply_disabled_abilities) — filters on-hit/on-hit-taken statuses
    /// by `source_ability` and zeroes passive-ability fields whose
    /// corresponding ability is disabled (Berserk, First Strike, Reflect,
    /// Warden's Resistance, Breath Resistance, Hunker, Quick Recovery,
    /// Unbreakable, Self Destruct).
    #[serde(default)]
    #[serde(rename = "disabledAbilities")]
    pub disabled_abilities: Vec<String>,
    /// Compare-only Special Air PvP Rule: fixed bite cooldown that bypasses
    /// all status/berserk modifiers. 0.0 = disabled (normal calc). When > 0,
    /// `current_simple_bite_cooldown_with_statuses` returns `max(0.1, this)`
    /// directly. Mirrors TS `currentBiteCooldown` early-return on
    /// `compareAirRuleEnabled`. Set to the same value on both sides.
    #[serde(default)]
    #[serde(rename = "compareAirRuleCooldownSec")]
    pub compare_air_rule_cooldown_sec: f64,
    /// Custom-ability ids attached to this side. Populated at the
    /// TS bridge from the per-creature attachment list — Sprint 5
    /// per-creature wiring. Each id is looked up in the global
    /// user-ability registry at simulation start; missing ids are
    /// dropped silently (the engine never rejects a side because
    /// of a stale reference, just skips that ability).
    ///
    /// Default-empty so creatures without custom abilities serialize
    /// byte-identical to the pre-Sprint-5 schema.
    #[serde(default)]
    #[serde(rename = "userAbilityIds")]
    pub user_ability_ids: Vec<String>,
    /// Phase 5 / G8: read-only creature identity for the decision-DSL
    /// `is_type` / `is_diet` / `is_elder` / `tier` read-vars. Default-None
    /// so pre-Phase-5 payloads round-trip byte-identical (every identity
    /// read then resolves to `0.0` / false).
    #[serde(default)]
    pub identity: Option<CreatureIdentity>,
}

fn default_first_strike_hp_ratio_threshold() -> f64 {
    1.0
}

fn default_active_cooldown_multiplier() -> f64 {
    1.0
}

fn default_berserk_bite_cooldown_multiplier() -> f64 {
    1.0
}

fn default_damage_taken_multiplier() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SimpleAppliedStatus {
    #[serde(rename = "statusId")]
    pub status_id: String,
    pub stacks: f64,
    /// Normalized producing ability. None = plushie/breath/intrinsic (not
    /// filterable by `disabled_abilities`).
    #[serde(default)]
    #[serde(rename = "sourceAbility")]
    pub source_ability: Option<String>,
}

/// Preprocess a combatant profile against its `disabled_abilities` list.
///
/// Mirrors TS `combatantRuntimeFactory.filterEffectsByDisabled` + passive-flag
/// gating. Callers must pre-normalize names via TS `normalizeAbilityName`.
///
/// Side effects:
/// - Drops on-hit / on-hit-taken / starting statuses whose `source_ability`
///   is in the disabled set.
/// - Zeroes passive fields whose controlling ability is disabled: Berserk,
///   First Strike, Reflect, Warden's Resistance, Breath Resistance, Hunker,
///   Quick Recovery, Unbreakable (clears immune ids), Self-Destruct.
///
/// Intrinsic values (None source_ability) pass through — they are not tied
/// to any ability and cannot be disabled.
pub fn apply_disabled_abilities(stats: &mut SimpleCombatantStats) {
    if stats.disabled_abilities.is_empty() {
        return;
    }
    let disabled: std::collections::HashSet<&str> =
        stats.disabled_abilities.iter().map(String::as_str).collect();

    let retain_by_source = |list: &mut Vec<SimpleAppliedStatus>| {
        list.retain(|s| match &s.source_ability {
            Some(name) => !disabled.contains(name.as_str()),
            None => true,
        });
    };
    retain_by_source(&mut stats.on_hit_statuses);
    retain_by_source(&mut stats.on_hit_taken_statuses);
    retain_by_source(&mut stats.starting_statuses);

    if disabled.contains("Berserk") {
        stats.berserk_bite_cooldown_multiplier = 1.0;
        stats.berserk_hp_ratio_threshold = 0.0;
    }
    if disabled.contains("First Strike") {
        stats.first_strike_pct = 0.0;
        stats.first_strike_hp_ratio_threshold = 1.0;
    }
    if disabled.contains("Reflect") {
        stats.has_reflect = false;
    }
    if disabled.contains("Warden's Resistance") {
        stats.has_warden_resistance = false;
    }
    if disabled.contains("Breath Resistance") {
        stats.breath_resistance = 0.0;
    }
    if disabled.contains("Hunker") {
        stats.hunker_reduction_pct = 0.0;
    }
    if disabled.contains("Quick Recovery") {
        stats.quick_recovery_hp_ratio_threshold = 0.0;
    }
    if disabled.contains("Unbreakable") {
        stats.immune_status_ids.clear();
        stats.unbreakable_damage_cap_pct = 0.0;
    }
    if disabled.contains("Self-Destruct") {
        stats.self_destruct_profile = None;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SimpleBreathProfile {
    #[serde(rename = "dpsPct")]
    pub dps_pct: f64,
    pub capacity: f64,
    #[serde(rename = "regenRate")]
    pub regen_rate: f64,
    #[serde(rename = "critChancePct")]
    pub crit_chance_pct: f64,
    pub chain: f64,
    #[serde(rename = "chainMaxStacks")]
    pub chain_max_stacks: f64,
    #[serde(default)]
    #[serde(rename = "specialKind")]
    pub special_kind: Option<String>,
    #[serde(default)]
    #[serde(rename = "selfHealPct")]
    pub self_heal_pct: f64,
    #[serde(default)]
    #[serde(rename = "cleanseStacks")]
    pub cleanse_stacks: f64,
    #[serde(default)]
    #[serde(rename = "lanceDamagePct")]
    pub lance_damage_pct: f64,
    #[serde(default)]
    #[serde(rename = "lanceChargeSec")]
    pub lance_charge_sec: f64,
    #[serde(default)]
    #[serde(rename = "lanceCooldownSec")]
    pub lance_cooldown_sec: f64,
    #[serde(default)]
    #[serde(rename = "lanceStatusId")]
    pub lance_status_id: Option<String>,
    #[serde(default)]
    #[serde(rename = "autoFireDelaySec")]
    pub auto_fire_delay_sec: f64,
    #[serde(default)]
    #[serde(rename = "autoFireCooldownSec")]
    pub auto_fire_cooldown_sec: f64,
    /// Plasma Beam–style charges. When `special_kind == Some("plasma_beam")`
    /// this is the discrete number of shot-charges the breath holds at
    /// fight start (also the cap). Each charge fires one capacity-worth of
    /// ticks; consecutive charges fire back-to-back, each gated by
    /// `auto_fire_delay_sec`. When all charges are spent, the breath waits
    /// for `chargeRegenSec` to refill one charge.
    #[serde(default)]
    #[serde(rename = "chargesMax")]
    pub charges_max: f64,
    /// Seconds between background charge regenerations (one charge per
    /// `chargeRegenSec`, capped at `charges_max`). Only consulted when
    /// `special_kind == Some("plasma_beam")`.
    #[serde(default)]
    #[serde(rename = "chargeRegenSec")]
    pub charge_regen_sec: f64,
    #[serde(default)]
    #[serde(rename = "specialStatuses")]
    pub special_statuses: Vec<SimpleAppliedStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleMeleeFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    pub max_time_sec: f64,
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleBreathMatchupFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "abilityPolicy", default)]
    pub ability_policy: Option<SimpleAbilityTimingMode>,
    pub max_time_sec: f64,
    pub expected_summary: BestBuildsMatchupSummary,
}

/// Phase 9 (programmable statuses): per-iteration cache of a dynamic user
/// status's Expr-overridden numeric knobs, resolved at loop level (where a
/// `PolicyState` exists) and read back by the status seams (which only have
/// the instance in scope, not the side). `None` field ⇒ the static spec knob
/// is used, so a status with no Expr overrides leaves every field `None` and
/// the seams stay byte-identical. Runtime-only — never serialized (the field
/// on `SimpleStatusInstance` is `#[serde(skip)]`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ResolvedStatusScalars {
    /// Combined per-tick DoT/HoT magnitude (overrides `tick_base +
    /// tick_per_stack·stacks`, pre-pct-scaling).
    pub tick_amount: Option<f64>,
    pub incoming_damage_mult: Option<f64>,
    pub outgoing_damage_mult: Option<f64>,
    pub bite_cooldown_mult: Option<f64>,
    /// Combined regen modifier percent (overrides `regen_mod_total_pct`).
    pub regen_mod_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SimpleStatusInstance {
    pub stacks: f64,
    #[serde(default)]
    #[serde(rename = "nextTickAt")]
    pub next_tick_at: Option<f64>,
    #[serde(default)]
    #[serde(rename = "nextDecayAt")]
    pub next_decay_at: Option<f64>,
    #[serde(rename = "remainingSec")]
    pub remaining_sec: f64,
    #[serde(default)]
    #[serde(rename = "stackValueMode")]
    pub stack_value_mode: Option<String>,
    #[serde(default)]
    #[serde(rename = "lichMarkOwnedStacks")]
    pub lich_mark_owned_stacks: Option<f64>,
    /// Permanent (weather) instance: never decays. The DoT tick keeps
    /// firing (next_tick_at stays scheduled) but the per-stack decay
    /// loop is skipped, so a single-stack weather status persists for
    /// the whole fight. Set by `apply_simple_status_list` from the
    /// matching `SimpleAppliedStatus.no_decay`.
    #[serde(default)]
    #[serde(rename = "noDecay")]
    pub no_decay: bool,
    /// Phase 9: per-iteration Expr-resolve cache (runtime-only, never
    /// serialized). Populated at loop level for dynamic statuses with Expr
    /// overrides; `None` ⇒ static spec knobs (byte-identical).
    #[serde(skip)]
    pub resolved_scalars: Option<ResolvedStatusScalars>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SimpleStatusTickExpected {
    #[serde(rename = "hpAfter")]
    pub hp_after: f64,
    #[serde(rename = "sourceDamageDealt")]
    pub source_damage_dealt: f64,
    #[serde(rename = "sourceDotDamageDealt")]
    pub source_dot_damage_dealt: f64,
    pub status: Option<SimpleStatusInstance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleStatusTickFixture {
    pub name: String,
    #[serde(rename = "statusId")]
    pub status_id: String,
    pub stacks: f64,
    #[serde(rename = "maxHp")]
    pub max_hp: f64,
    #[serde(rename = "tickTime")]
    pub tick_time: f64,
    pub expected: SimpleStatusTickExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleStatusApplicationExpected {
    pub statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "appliedStacks")]
    pub applied_stacks: f64,
    #[serde(rename = "blockedStacks")]
    pub blocked_stacks: f64,
    #[serde(rename = "effectiveFraction")]
    pub effective_fraction: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleStatusApplicationFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "statusId")]
    pub status_id: String,
    pub stacks: f64,
    #[serde(rename = "startingStatuses")]
    pub starting_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "resistFraction")]
    pub resist_fraction: f64,
    #[serde(rename = "plushieBlockFraction")]
    pub plushie_block_fraction: f64,
    pub expected: SimpleStatusApplicationExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleRewindExpected {
    pub hp: f64,
    pub statuses: BTreeMap<String, SimpleStatusInstance>,
    pub rewind_cooldown_until: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleRewindFixture {
    pub name: String,
    #[serde(rename = "maxHp")]
    pub max_hp: f64,
    pub time: f64,
    #[serde(rename = "currentHp")]
    pub current_hp: f64,
    #[serde(rename = "currentStatuses")]
    pub current_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "snapshotHp")]
    pub snapshot_hp: f64,
    #[serde(rename = "snapshotStatuses")]
    pub snapshot_statuses: BTreeMap<String, SimpleStatusInstance>,
    pub expected: SimpleRewindExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFrostSnareExpected {
    #[serde(rename = "frostSnareCooldownUntil")]
    pub frost_snare_cooldown_until: f64,
    #[serde(rename = "defenderStatuses")]
    pub defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFrostSnareFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "startingCooldownUntil")]
    pub starting_cooldown_until: f64,
    #[serde(rename = "startingStatuses")]
    pub starting_statuses: BTreeMap<String, SimpleStatusInstance>,
    pub expected: SimpleFrostSnareExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleSelfDestructProfile {
    #[serde(rename = "triggerHpRatioLte")]
    pub trigger_hp_ratio_lte: f64,
    #[serde(rename = "damagePct")]
    pub damage_pct: f64,
    /// Reworked semantics: attacker HP is capped DOWN to this %
    /// of max HP if currently higher; if already below, untouched.
    #[serde(rename = "selfHpFloorPct")]
    pub self_hp_floor_pct: f64,
    #[serde(rename = "applyStatuses")]
    pub apply_statuses: Vec<SimpleAppliedStatus>,
    #[serde(rename = "cooldownSec", default = "default_self_destruct_cooldown_sec")]
    pub cooldown_sec: f64,
    #[serde(rename = "armingStacks", default = "default_arming_stacks")]
    pub arming_stacks: f64,
}

fn default_arming_stacks() -> f64 {
    3.0
}

fn default_self_destruct_cooldown_sec() -> f64 {
    300.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleShadowBarrageActivationExpected {
    #[serde(rename = "shadowBarrageCooldownUntil")]
    pub shadow_barrage_cooldown_until: f64,
    #[serde(rename = "shadowBarrageBaseDamage")]
    pub shadow_barrage_base_damage: f64,
    #[serde(rename = "shadowBarrageRemainingHits")]
    pub shadow_barrage_remaining_hits: i32,
    #[serde(rename = "shadowBarrageNextHitAt")]
    pub shadow_barrage_next_hit_at: Option<f64>,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleShadowBarrageActivationFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "lastMeleeHitAt")]
    pub last_melee_hit_at: f64,
    #[serde(rename = "lastMeleeHitDamage")]
    pub last_melee_hit_damage: f64,
    #[serde(rename = "cooldownUntil")]
    pub cooldown_until: f64,
    #[serde(rename = "remainingHits")]
    pub remaining_hits: i32,
    #[serde(rename = "abilityValue")]
    pub ability_value: f64,
    pub expected: SimpleShadowBarrageActivationExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleShadowBarrageHitExpected {
    #[serde(rename = "damageDealt")]
    pub damage_dealt: f64,
    #[serde(rename = "defenderHp")]
    pub defender_hp: f64,
    #[serde(rename = "defenderStatuses")]
    pub defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "shadowBarrageRemainingHits")]
    pub shadow_barrage_remaining_hits: i32,
    #[serde(rename = "shadowBarrageNextHitAt")]
    pub shadow_barrage_next_hit_at: Option<f64>,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleShadowBarrageHitFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "defenderStartingHp")]
    pub defender_starting_hp: f64,
    #[serde(rename = "baseDamage")]
    pub base_damage: f64,
    #[serde(rename = "totalHits")]
    pub total_hits: f64,
    #[serde(rename = "remainingHits")]
    pub remaining_hits: i32,
    #[serde(rename = "nextHitAt")]
    pub next_hit_at: f64,
    #[serde(rename = "plushieOnHitStatuses")]
    pub plushie_on_hit_statuses: BTreeMap<String, f64>,
    #[serde(rename = "attackerApplyStatusOnHit")]
    pub attacker_apply_status_on_hit: Vec<SimpleAppliedStatus>,
    pub expected: SimpleShadowBarrageHitExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleShadowBarrageFixtures {
    pub activation: Vec<SimpleShadowBarrageActivationFixture>,
    pub hits: Vec<SimpleShadowBarrageHitFixture>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleSpiteActivationExpected {
    #[serde(rename = "spiteArmed")]
    pub spite_armed: bool,
    #[serde(rename = "spiteChargeReadyAt")]
    pub spite_charge_ready_at: f64,
    #[serde(rename = "spiteCooldownUntil")]
    pub spite_cooldown_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleSpiteActivationFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "spiteValue")]
    pub spite_value: f64,
    #[serde(rename = "cooldownUntil")]
    pub cooldown_until: f64,
    #[serde(rename = "alreadyArmed")]
    pub already_armed: bool,
    #[serde(rename = "hasOffensivePayload")]
    pub has_offensive_payload: bool,
    pub expected: SimpleSpiteActivationExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleSpiteBiteExpected {
    #[serde(rename = "damageDelta")]
    pub damage_delta: f64,
    #[serde(rename = "defenderHp")]
    pub defender_hp: f64,
    #[serde(rename = "defenderStatuses")]
    pub defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "spiteArmed")]
    pub spite_armed: bool,
    #[serde(rename = "spiteChargeReadyAt")]
    pub spite_charge_ready_at: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleSpiteBiteFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "baseDamage")]
    pub base_damage: f64,
    #[serde(rename = "spiteValue")]
    pub spite_value: f64,
    #[serde(rename = "spiteChargeReadyAt")]
    pub spite_charge_ready_at: f64,
    #[serde(rename = "defenderStartingHp")]
    pub defender_starting_hp: f64,
    #[serde(rename = "defenderMaxHp")]
    pub defender_max_hp: f64,
    #[serde(rename = "attackerApplyStatusOnHit")]
    pub attacker_apply_status_on_hit: Vec<SimpleAppliedStatus>,
    #[serde(rename = "attackerExplicitStatuses")]
    pub attacker_explicit_statuses: Vec<SimpleAppliedStatus>,
    #[serde(rename = "plushieOnHitStatuses")]
    pub plushie_on_hit_statuses: BTreeMap<String, f64>,
    #[serde(rename = "defenderStartingStatuses")]
    pub defender_starting_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(default)]
    #[serde(rename = "startingAbilityAppliedCount")]
    pub starting_ability_applied_count: u32,
    pub expected: SimpleSpiteBiteExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleSpiteWaitPolicyExpected {
    #[serde(rename = "shouldDelay")]
    pub should_delay: bool,
    #[serde(rename = "nextHitAt")]
    pub next_hit_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleSpiteWaitPolicyFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "baseDamage")]
    pub base_damage: f64,
    #[serde(rename = "spiteValue")]
    pub spite_value: f64,
    #[serde(rename = "spiteChargeReadyAt")]
    pub spite_charge_ready_at: f64,
    #[serde(rename = "attackerHp")]
    pub attacker_hp: f64,
    #[serde(rename = "attackerCurrentHp")]
    pub attacker_current_hp: f64,
    #[serde(rename = "attackerMaxHp")]
    pub attacker_max_hp: f64,
    #[serde(rename = "attackerBiteCooldown")]
    pub attacker_bite_cooldown: f64,
    #[serde(rename = "defenderDamage")]
    pub defender_damage: f64,
    #[serde(rename = "defenderBiteCooldown")]
    pub defender_bite_cooldown: f64,
    pub expected: SimpleSpiteWaitPolicyExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleSpiteFixtures {
    pub activation: Vec<SimpleSpiteActivationFixture>,
    pub bites: Vec<SimpleSpiteBiteFixture>,
    #[serde(rename = "waitPolicy")]
    pub wait_policy: Vec<SimpleSpiteWaitPolicyFixture>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleHunkerPolicyExpected {
    #[serde(rename = "nextHunkerOn")]
    pub next_hunker_on: bool,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleHunkerPolicyFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerCurrentHp")]
    pub attacker_current_hp: f64,
    #[serde(rename = "defenderCurrentHp")]
    pub defender_current_hp: f64,
    #[serde(rename = "startingHunkerOn")]
    pub starting_hunker_on: bool,
    pub expected: SimpleHunkerPolicyExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleLifeLeechActivationExpected {
    #[serde(rename = "lifeLeechActiveUntil")]
    pub life_leech_active_until: f64,
    #[serde(rename = "lifeLeechCooldownUntil")]
    pub life_leech_cooldown_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleLifeLeechActivationFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerHp")]
    pub attacker_hp: f64,
    #[serde(rename = "defenderHp")]
    pub defender_hp: f64,
    pub time: f64,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "abilityPolicy")]
    pub ability_policy: SimpleAbilityTimingMode,
    #[serde(rename = "startingLifeLeechActiveUntil")]
    pub starting_life_leech_active_until: f64,
    #[serde(rename = "startingLifeLeechCooldownUntil")]
    pub starting_life_leech_cooldown_until: f64,
    pub expected: SimpleLifeLeechActivationExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleLifeLeechHitExpected {
    #[serde(rename = "attackerHp")]
    pub attacker_hp: f64,
    #[serde(rename = "lifeLeechHealedDelta")]
    pub life_leech_healed_delta: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleLifeLeechHitFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    #[serde(rename = "attackerHp")]
    pub attacker_hp: f64,
    #[serde(rename = "damageDealt")]
    pub damage_dealt: f64,
    pub time: f64,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "lifeLeechActiveUntil")]
    pub life_leech_active_until: f64,
    pub expected: SimpleLifeLeechHitExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleLifeLeechFixtures {
    pub activation: Vec<SimpleLifeLeechActivationFixture>,
    pub hits: Vec<SimpleLifeLeechHitFixture>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleLifeLeechProfile {
    pub available: bool,
    #[serde(rename = "lifeLeechValue")]
    pub life_leech_value: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SimpleAbilityTimingMode {
    ReallyFast,
    Fast,
    SemiIdeal,
    Ideal,
    /// Debug-only densest variant of `Ideal`. Same precision-policy semantics
    /// as `Ideal`, but with a 0–120s lookahead and a dense delay lattice
    /// (0–12s in 0.05s steps, 12.25–30s in 0.25s steps, 31–120s in 1s steps).
    /// Defined in Reference page; only `policy_framework.rs` distinguishes it
    /// from `Ideal` — every other match treats it as `Ideal`.
    Extreme,
}

pub fn default_simple_ability_timing_mode() -> SimpleAbilityTimingMode {
    SimpleAbilityTimingMode::SemiIdeal
}

/// Per-ability timing-mode override map.
///
/// Mirrors TS `AbilityTimingOverrides` in `src/engine/types.ts`. Field names
/// deserialize from the exact display-name keys TS uses ("Warden's Rage",
/// "Life Leech", etc.), not camelCase. When a field is `Some`, it replaces
/// the default `ability_policy` for that ability's activation decision.
///
/// Reflect and Frost Nova analytics collapse to always-fire (no meaningful
/// policy-sensitivity), so their overrides are accepted for API parity but
/// have no behavioral effect.
/// Per-fight choice of timing for a user-defined ability. Either
/// pin it to a built-in mode or to one of the user's registered
/// custom timings (resolved against the timing registry at
/// dispatch time, like `timing_user_override` on the spec). Stale
/// `User(_)` ids fall back to the spec's own default — never
/// silently turn the ability off.
///
/// Serialized as a tagged union so the JSON shape is unambiguous:
///   { "kind": "builtIn", "mode": "ideal" }
///   { "kind": "user", "timingId": "user.my_aggressive" }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AbilityTimingChoice {
    BuiltIn { mode: SimpleAbilityTimingMode },
    User {
        #[serde(rename = "timingId")]
        timing_id: String,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AbilityPolicyOverrides {
    #[serde(default, rename = "Warden's Rage")]
    pub wardens_rage: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Hunker")]
    pub hunker: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Life Leech")]
    pub life_leech: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Adrenaline")]
    pub adrenaline: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Hunters Curse")]
    pub hunters_curse: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Unbridled Rage")]
    pub unbridled_rage: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Fortify")]
    pub fortify: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Rewind")]
    pub rewind: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Reflect")]
    pub reflect: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Frost Nova")]
    pub frost_nova: Option<SimpleAbilityTimingMode>,
    #[serde(default, rename = "Cocoon")]
    pub cocoon: Option<SimpleAbilityTimingMode>,
    /// Per-user-ability override map. Keys are the user.<...> ids
    /// attached to a creature; values pin the timing for THAT
    /// ability for THIS fight, overriding the spec's
    /// timing_user_override / timing_mode_override / session
    /// default. Useful for Compare-time A/B testing without
    /// editing the persisted ability spec.
    ///
    /// Empty by default; missing keys fall back to spec defaults.
    /// Stale ids (not attached) and stale user-timing values fall
    /// back to spec defaults silently.
    #[serde(default, rename = "userAbilityOverrides")]
    pub user_ability_overrides: std::collections::BTreeMap<String, AbilityTimingChoice>,
    /// Round 42 / A11: per-fight active-level override for each
    /// user.<...> ability attached to this side. Keys are the
    /// ability id; values are the 1-indexed level the engine treats
    /// as active for THIS fight (overriding the spec's
    /// `default_level`). Out-of-range values fall back to the spec's
    /// `default_level` silently; the spec itself is never mutated.
    ///
    /// Empty by default. Missing entries fall back to the spec's
    /// `default_level`.
    #[serde(default, rename = "userAbilityLevels")]
    pub user_ability_levels: std::collections::BTreeMap<String, u32>,
}

/// Resolve the effective timing mode for one ability: override when present,
/// otherwise the session default.
#[inline]
pub fn resolve_ability_policy(
    default: SimpleAbilityTimingMode,
    override_opt: Option<SimpleAbilityTimingMode>,
) -> SimpleAbilityTimingMode {
    override_opt.unwrap_or(default)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleLifeLeechMeleeProfiles {
    pub attacker: SimpleLifeLeechProfile,
    pub defender: SimpleLifeLeechProfile,
    #[serde(default)]
    pub attacker_warden_rage_available: bool,
    #[serde(default)]
    pub defender_warden_rage_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleLifeLeechMeleeFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "lifeLeechProfile")]
    pub life_leech_profile: SimpleLifeLeechMeleeProfiles,
    #[serde(rename = "abilityPolicy")]
    pub ability_policy: SimpleAbilityTimingMode,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleWardenRageExpected {
    #[serde(rename = "wardenRageOn")]
    pub warden_rage_on: bool,
    #[serde(rename = "wardenRageStacks")]
    pub warden_rage_stacks: i32,
    #[serde(rename = "wardenRageTapUntil")]
    pub warden_rage_tap_until: f64,
    #[serde(rename = "wardenRageCooldownUntil")]
    pub warden_rage_cooldown_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleWardenRageFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    #[serde(rename = "attackerHp")]
    pub attacker_hp: f64,
    pub time: f64,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "startingWardenRageOn")]
    pub starting_warden_rage_on: bool,
    #[serde(rename = "startingWardenRageStacks")]
    pub starting_warden_rage_stacks: i32,
    #[serde(rename = "startingWardenRageTapUntil")]
    pub starting_warden_rage_tap_until: f64,
    #[serde(rename = "startingWardenRageCooldownUntil")]
    pub starting_warden_rage_cooldown_until: f64,
    pub expected: SimpleWardenRageExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCursedSigilExpected {
    #[serde(rename = "defenderStatuses")]
    pub defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "cursedSigilCooldownUntil")]
    pub cursed_sigil_cooldown_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCursedSigilFixture {
    pub name: String,
    pub defender: SimpleCombatantStats,
    pub time: f64,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "cursedSigilStacks")]
    pub cursed_sigil_stacks: f64,
    #[serde(rename = "startingDefenderStatuses")]
    pub starting_defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "startingCursedSigilCooldownUntil")]
    pub starting_cursed_sigil_cooldown_until: f64,
    pub expected: SimpleCursedSigilExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFortifyExpected {
    pub statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "fortifyCooldownUntil")]
    pub fortify_cooldown_until: f64,
    #[serde(rename = "fortifyImmuneUntil")]
    pub fortify_immune_until: f64,
    #[serde(rename = "fortifyWeightBonusUntil")]
    pub fortify_weight_bonus_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFortifyFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "startingStatuses")]
    pub starting_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "startingFortifyCooldownUntil")]
    pub starting_fortify_cooldown_until: f64,
    pub expected: SimpleFortifyExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleThornTrapExpected {
    #[serde(rename = "defenderStatuses")]
    pub defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "thornTrapCooldownUntil")]
    pub thorn_trap_cooldown_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleThornTrapFixture {
    pub name: String,
    pub defender: SimpleCombatantStats,
    pub time: f64,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "startingDefenderStatuses")]
    pub starting_defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "startingThornTrapCooldownUntil")]
    pub starting_thorn_trap_cooldown_until: f64,
    pub expected: SimpleThornTrapExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleDrowsyAreaExpected {
    #[serde(rename = "defenderStatuses")]
    pub defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleDrowsyAreaFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "startingDefenderStatuses")]
    pub starting_defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    pub expected: SimpleDrowsyAreaExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFrostNovaExpected {
    #[serde(rename = "defenderHp")]
    pub defender_hp: f64,
    #[serde(rename = "defenderStatuses")]
    pub defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "frostNovaCooldownUntil")]
    pub frost_nova_cooldown_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFrostNovaFixture {
    pub name: String,
    pub time: f64,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "frostNovaValue")]
    pub frost_nova_value: Option<f64>,
    #[serde(rename = "startingDefenderHp")]
    pub starting_defender_hp: f64,
    #[serde(rename = "startingDefenderStatuses")]
    pub starting_defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "startingFrostNovaCooldownUntil")]
    pub starting_frost_nova_cooldown_until: f64,
    pub expected: SimpleFrostNovaExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleAdrenalineExpected {
    #[serde(rename = "adrenalineActiveUntil")]
    pub adrenaline_active_until: f64,
    #[serde(rename = "adrenalineCooldownUntil")]
    pub adrenaline_cooldown_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleAdrenalineFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "abilityDisabled")]
    pub ability_disabled: bool,
    #[serde(rename = "startingAdrenalineActiveUntil")]
    pub starting_adrenaline_active_until: f64,
    #[serde(rename = "startingAdrenalineCooldownUntil")]
    pub starting_adrenaline_cooldown_until: f64,
    pub expected: SimpleAdrenalineExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleHuntersCurseExpected {
    #[serde(rename = "attackerHp")]
    pub attacker_hp: f64,
    #[serde(rename = "huntersCurseActiveUntil")]
    pub hunters_curse_active_until: f64,
    #[serde(rename = "huntersCurseCooldownUntil")]
    pub hunters_curse_cooldown_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleHuntersCurseFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "abilityDisabled")]
    pub ability_disabled: bool,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerHp")]
    pub attacker_hp: f64,
    #[serde(rename = "defenderHp")]
    pub defender_hp: f64,
    #[serde(rename = "startingHuntersCurseActiveUntil")]
    pub starting_hunters_curse_active_until: f64,
    #[serde(rename = "startingHuntersCurseCooldownUntil")]
    pub starting_hunters_curse_cooldown_until: f64,
    pub expected: SimpleHuntersCurseExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleUnbridledRageExpected {
    #[serde(rename = "unbridledRageActiveUntil")]
    pub unbridled_rage_active_until: f64,
    #[serde(rename = "unbridledRageCooldownUntil")]
    pub unbridled_rage_cooldown_until: f64,
    #[serde(rename = "abilityAppliedCount")]
    pub ability_applied_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleUnbridledRageFixture {
    pub name: String,
    pub time: f64,
    #[serde(rename = "activesOn")]
    pub actives_on: bool,
    #[serde(rename = "abilityDisabled")]
    pub ability_disabled: bool,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerHp")]
    pub attacker_hp: f64,
    #[serde(rename = "startingUnbridledRageActiveUntil")]
    pub starting_unbridled_rage_active_until: f64,
    #[serde(rename = "startingUnbridledRageCooldownUntil")]
    pub starting_unbridled_rage_cooldown_until: f64,
    pub expected: SimpleUnbridledRageExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleBerserkCooldownExpected {
    #[serde(rename = "biteCooldown")]
    pub bite_cooldown: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleBerserkCooldownFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    #[serde(rename = "attackerCurrentHp")]
    pub attacker_current_hp: f64,
    #[serde(rename = "startingStatuses")]
    pub starting_statuses: BTreeMap<String, SimpleStatusInstance>,
    pub expected: SimpleBerserkCooldownExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleActiveTimingStartingState {
    #[serde(rename = "maxHp")]
    pub max_hp: f64,
    #[serde(rename = "attackerDamage")]
    pub attacker_damage: f64,
    #[serde(rename = "attackerBiteCooldown")]
    pub attacker_bite_cooldown: f64,
    pub hp: f64,
    pub statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "defenderHp")]
    pub defender_hp: f64,
    #[serde(rename = "defenderMaxHp")]
    pub defender_max_hp: f64,
    #[serde(rename = "defenderDamage")]
    pub defender_damage: f64,
    #[serde(rename = "defenderBiteCooldown")]
    pub defender_bite_cooldown: f64,
    #[serde(rename = "defenderStatuses")]
    pub defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "rewindSnapshotHp")]
    pub rewind_snapshot_hp: Option<f64>,
    #[serde(rename = "rewindSnapshotStatuses")]
    pub rewind_snapshot_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "lastMeleeHitAt")]
    pub last_melee_hit_at: f64,
    #[serde(rename = "lastMeleeHitDamage")]
    pub last_melee_hit_damage: f64,
    #[serde(rename = "spiteArmed")]
    pub spite_armed: bool,
    #[serde(rename = "spiteChargeReadyAt")]
    pub spite_charge_ready_at: f64,
    #[serde(rename = "auraNextTickAt")]
    pub aura_next_tick_at: Option<f64>,
    #[serde(rename = "spiteValue")]
    pub spite_value: Option<f64>,
    #[serde(default)]
    #[serde(rename = "auraSubtype")]
    pub aura_subtype: Option<String>,
    #[serde(rename = "refluxAvailable")]
    pub reflux_available: bool,
    #[serde(rename = "refluxArmed")]
    pub reflux_armed: bool,
    #[serde(rename = "refluxChargeReadyAt")]
    pub reflux_charge_ready_at: f64,
    #[serde(rename = "refluxPuddleUntil")]
    pub reflux_puddle_until: f64,
    #[serde(rename = "refluxNextTickAt")]
    pub reflux_next_tick_at: Option<f64>,
    #[serde(rename = "rewindAvailable")]
    pub rewind_available: bool,
    #[serde(rename = "frostNovaAvailable")]
    pub frost_nova_available: bool,
    #[serde(rename = "frostNovaValue")]
    pub frost_nova_value: Option<f64>,
    #[serde(rename = "startingFrostNovaCooldownUntil")]
    pub starting_frost_nova_cooldown_until: f64,
    #[serde(rename = "startingAdrenalineActiveUntil")]
    pub starting_adrenaline_active_until: f64,
    #[serde(default)]
    #[serde(rename = "startingAdrenalineCooldownUntil")]
    pub starting_adrenaline_cooldown_until: f64,
    #[serde(default)]
    #[serde(rename = "fortifyAvailable")]
    pub fortify_available: bool,
    #[serde(default)]
    #[serde(rename = "huntersCurseAvailable")]
    pub hunters_curse_available: bool,
    #[serde(default)]
    #[serde(rename = "unbridledRageAvailable")]
    pub unbridled_rage_available: bool,
    #[serde(rename = "frostSnareAvailable")]
    pub frost_snare_available: bool,
    #[serde(rename = "cursedSigilAvailable")]
    pub cursed_sigil_available: bool,
    #[serde(rename = "cursedSigilStacks")]
    pub cursed_sigil_stacks: f64,
    #[serde(rename = "thornTrapAvailable")]
    pub thorn_trap_available: bool,
    #[serde(rename = "shadowBarrageAvailable")]
    pub shadow_barrage_available: bool,
    #[serde(rename = "shadowBarrageValue")]
    pub shadow_barrage_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleActiveTimingExpected {
    #[serde(rename = "attackerHp")]
    pub attacker_hp: f64,
    #[serde(rename = "attackerStatuses")]
    pub attacker_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "defenderHp")]
    pub defender_hp: f64,
    #[serde(rename = "defenderStatuses")]
    pub defender_statuses: BTreeMap<String, SimpleStatusInstance>,
    #[serde(rename = "spiteArmed")]
    pub spite_armed: bool,
    #[serde(rename = "spiteChargeReadyAt")]
    pub spite_charge_ready_at: f64,
    #[serde(rename = "auraNextTickAt")]
    pub aura_next_tick_at: Option<f64>,
    #[serde(rename = "refluxArmed")]
    pub reflux_armed: bool,
    #[serde(rename = "refluxChargeReadyAt")]
    pub reflux_charge_ready_at: f64,
    #[serde(rename = "refluxPuddleUntil")]
    pub reflux_puddle_until: f64,
    #[serde(rename = "refluxNextTickAt")]
    pub reflux_next_tick_at: Option<f64>,
    #[serde(rename = "rewindCooldownUntil")]
    pub rewind_cooldown_until: f64,
    #[serde(rename = "adrenalineActiveUntil")]
    pub adrenaline_active_until: f64,
    #[serde(rename = "adrenalineCooldownUntil")]
    pub adrenaline_cooldown_until: f64,
    #[serde(rename = "huntersCurseActiveUntil")]
    pub hunters_curse_active_until: f64,
    #[serde(rename = "huntersCurseCooldownUntil")]
    pub hunters_curse_cooldown_until: f64,
    #[serde(rename = "unbridledRageActiveUntil")]
    pub unbridled_rage_active_until: f64,
    #[serde(rename = "unbridledRageCooldownUntil")]
    pub unbridled_rage_cooldown_until: f64,
    #[serde(rename = "frostNovaCooldownUntil")]
    pub frost_nova_cooldown_until: f64,
    #[serde(rename = "frostSnareCooldownUntil")]
    pub frost_snare_cooldown_until: f64,
    #[serde(rename = "cursedSigilCooldownUntil")]
    pub cursed_sigil_cooldown_until: f64,
    #[serde(rename = "thornTrapCooldownUntil")]
    pub thorn_trap_cooldown_until: f64,
    #[serde(rename = "shadowBarrageCooldownUntil")]
    pub shadow_barrage_cooldown_until: f64,
    #[serde(rename = "shadowBarrageBaseDamage")]
    pub shadow_barrage_base_damage: f64,
    #[serde(rename = "shadowBarrageRemainingHits")]
    pub shadow_barrage_remaining_hits: i32,
    #[serde(rename = "shadowBarrageNextHitAt")]
    pub shadow_barrage_next_hit_at: Option<f64>,
    #[serde(rename = "abilityAppliedCounts")]
    pub ability_applied_counts: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleActiveTimingFixture {
    pub name: String,
    pub time: f64,
    pub starting: SimpleActiveTimingStartingState,
    pub expected: SimpleActiveTimingExpected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimpleBadOmenOutcome {
    #[serde(rename = "statusId")]
    pub status_id: String,
    pub stacks: f64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleActiveProfile {
    #[serde(rename = "spiteValue")]
    pub spite_value: Option<f64>,
    #[serde(default)]
    #[serde(rename = "hardenAvailable")]
    pub harden_available: bool,
    #[serde(default)]
    #[serde(rename = "causeFearAvailable")]
    pub cause_fear_available: bool,
    #[serde(default)]
    #[serde(rename = "grimLariatAvailable")]
    pub grim_lariat_available: bool,
    #[serde(default)]
    #[serde(rename = "reflectAvailable")]
    pub reflect_available: bool,
    #[serde(default)]
    #[serde(rename = "totemAvailable")]
    pub totem_available: bool,
    #[serde(default)]
    #[serde(rename = "fortifyAvailable")]
    pub fortify_available: bool,
    #[serde(default)]
    #[serde(rename = "frostNovaAvailable")]
    pub frost_nova_available: bool,
    #[serde(default)]
    #[serde(rename = "frostNovaValue")]
    pub frost_nova_value: Option<f64>,
    #[serde(default)]
    #[serde(rename = "wardenRageAvailable")]
    pub warden_rage_available: bool,
    #[serde(default)]
    #[serde(rename = "adrenalineAvailable")]
    pub adrenaline_available: bool,
    #[serde(default)]
    #[serde(rename = "huntersCurseAvailable")]
    pub hunters_curse_available: bool,
    #[serde(default)]
    #[serde(rename = "unbridledRageAvailable")]
    pub unbridled_rage_available: bool,
    #[serde(default)]
    #[serde(rename = "drowsyAreaAvailable")]
    pub drowsy_area_available: bool,
    #[serde(default)]
    #[serde(rename = "rewindAvailable")]
    pub rewind_available: bool,
    #[serde(default)]
    #[serde(rename = "lichMarkAvailable")]
    pub lich_mark_available: bool,
    #[serde(default)]
    #[serde(rename = "lichMarkPayloadStatusId")]
    pub lich_mark_payload_status_id: Option<String>,
    #[serde(default)]
    #[serde(rename = "auraSubtype")]
    pub aura_subtype: Option<String>,
    #[serde(rename = "refluxAvailable")]
    pub reflux_available: bool,
    #[serde(rename = "frostSnareAvailable")]
    pub frost_snare_available: bool,
    #[serde(rename = "cursedSigilStacks")]
    pub cursed_sigil_stacks: f64,
    #[serde(rename = "thornTrapAvailable")]
    pub thorn_trap_available: bool,
    #[serde(rename = "shadowBarrageValue")]
    pub shadow_barrage_value: f64,
    #[serde(rename = "explicitOnHitStatuses")]
    pub explicit_on_hit_statuses: Vec<SimpleAppliedStatus>,
    #[serde(rename = "plushieOnHitStatuses")]
    pub plushie_on_hit_statuses: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleActiveMeleeProfiles {
    pub attacker: SimpleActiveProfile,
    pub defender: SimpleActiveProfile,
    #[serde(rename = "badOmenOutcome")]
    pub bad_omen_outcome: Option<SimpleBadOmenOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFortifyStatusMeleeProfiles {
    #[serde(rename = "attackerFortifyAvailable")]
    pub attacker_fortify_available: bool,
    #[serde(rename = "defenderFortifyAvailable")]
    pub defender_fortify_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleCursedSigilStatusMeleeProfiles {
    #[serde(rename = "attackerCursedSigilStacks")]
    pub attacker_cursed_sigil_stacks: f64,
    #[serde(rename = "defenderCursedSigilStacks")]
    pub defender_cursed_sigil_stacks: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleCursedSigilBreathProfiles {
    #[serde(rename = "attackerCursedSigilStacks")]
    pub attacker_cursed_sigil_stacks: f64,
    #[serde(rename = "defenderCursedSigilStacks")]
    pub defender_cursed_sigil_stacks: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleAuraBreathProfiles {
    #[serde(default, rename = "attackerAuraSubtype")]
    pub attacker_aura_subtype: Option<String>,
    #[serde(default, rename = "defenderAuraSubtype")]
    pub defender_aura_subtype: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleUnbridledRageBreathProfiles {
    #[serde(rename = "attackerUnbridledRageAvailable")]
    pub attacker_unbridled_rage_available: bool,
    #[serde(rename = "defenderUnbridledRageAvailable")]
    pub defender_unbridled_rage_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleAdrenalineBreathProfiles {
    #[serde(rename = "attackerAdrenalineAvailable")]
    pub attacker_adrenaline_available: bool,
    #[serde(rename = "defenderAdrenalineAvailable")]
    pub defender_adrenaline_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleHuntersCurseBreathProfiles {
    #[serde(rename = "attackerHuntersCurseAvailable")]
    pub attacker_hunters_curse_available: bool,
    #[serde(rename = "defenderHuntersCurseAvailable")]
    pub defender_hunters_curse_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFrostSnareBreathProfiles {
    #[serde(rename = "attackerFrostSnareAvailable")]
    pub attacker_frost_snare_available: bool,
    #[serde(rename = "defenderFrostSnareAvailable")]
    pub defender_frost_snare_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleThornTrapBreathProfiles {
    #[serde(rename = "attackerThornTrapAvailable")]
    pub attacker_thorn_trap_available: bool,
    #[serde(rename = "defenderThornTrapAvailable")]
    pub defender_thorn_trap_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleDrowsyAreaBreathProfiles {
    #[serde(rename = "attackerDrowsyAreaAvailable")]
    pub attacker_drowsy_area_available: bool,
    #[serde(rename = "defenderDrowsyAreaAvailable")]
    pub defender_drowsy_area_available: bool,
    #[serde(default, rename = "attackerWardenRageAvailable")]
    pub attacker_warden_rage_available: bool,
    #[serde(default, rename = "defenderWardenRageAvailable")]
    pub defender_warden_rage_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleRewindBreathProfiles {
    #[serde(rename = "attackerRewindAvailable")]
    pub attacker_rewind_available: bool,
    #[serde(rename = "defenderRewindAvailable")]
    pub defender_rewind_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleCursedSigilStatusMeleeFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "cursedSigilProfile")]
    pub cursed_sigil_profile: SimpleCursedSigilStatusMeleeProfiles,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleCursedSigilBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "cursedSigilProfile")]
    pub cursed_sigil_profile: SimpleCursedSigilBreathProfiles,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFortifyStatusMeleeFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "fortifyProfile")]
    pub fortify_profile: SimpleFortifyStatusMeleeProfiles,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFortifyBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "fortifyProfile")]
    pub fortify_profile: SimpleFortifyStatusMeleeProfiles,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleAuraBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "auraProfile", alias = "radiationProfile")]
    pub aura_profile: SimpleAuraBreathProfiles,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleUnbridledRageBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "unbridledRageProfile")]
    pub unbridled_rage_profile: SimpleUnbridledRageBreathProfiles,
    #[serde(rename = "abilityPolicy")]
    pub ability_policy: SimpleAbilityTimingMode,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleAdrenalineBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "adrenalineProfile")]
    pub adrenaline_profile: SimpleAdrenalineBreathProfiles,
    #[serde(rename = "abilityPolicy")]
    pub ability_policy: SimpleAbilityTimingMode,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleHuntersCurseBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "huntersCurseProfile")]
    pub hunters_curse_profile: SimpleHuntersCurseBreathProfiles,
    #[serde(rename = "abilityPolicy")]
    pub ability_policy: SimpleAbilityTimingMode,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleFrostSnareBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "frostSnareProfile")]
    pub frost_snare_profile: SimpleFrostSnareBreathProfiles,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleThornTrapBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "thornTrapProfile")]
    pub thorn_trap_profile: SimpleThornTrapBreathProfiles,
    #[serde(rename = "abilityPolicy", default)]
    pub ability_policy: Option<SimpleAbilityTimingMode>,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleDrowsyAreaBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "drowsyAreaProfile")]
    pub drowsy_area_profile: SimpleDrowsyAreaBreathProfiles,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleRewindBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "rewindProfile")]
    pub rewind_profile: SimpleRewindBreathProfiles,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleLifeLeechBreathFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    pub attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    pub defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "lifeLeechProfile")]
    pub life_leech_profile: SimpleLifeLeechMeleeProfiles,
    #[serde(rename = "abilityPolicy")]
    pub ability_policy: SimpleAbilityTimingMode,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleActiveMeleeFixture {
    pub name: String,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    #[serde(rename = "activeProfile")]
    pub active_profile: SimpleActiveMeleeProfiles,
    #[serde(
        rename = "abilityPolicy",
        default = "default_simple_ability_timing_mode"
    )]
    pub ability_policy: SimpleAbilityTimingMode,
    #[serde(rename = "maxTimeSec")]
    pub max_time_sec: f64,
    #[serde(rename = "expectedSummary")]
    pub expected_summary: BestBuildsMatchupSummary,
}

#[allow(dead_code)]
pub fn aggregate_best_builds_matchup_summary(
    summary: &BestBuildsMatchupSummary,
) -> BestBuildAggregate {
    let win = if summary.winner == Winner::A { 1.0 } else { 0.0 };
    let draw = if summary.winner == Winner::Draw { 1.0 } else { 0.0 };
    let survival = summary.death_time_a.unwrap_or(summary.max_time_sec);
    let avg_dps = summary.dps_a_to_b;
    let ttk_win = if summary.winner == Winner::A {
        summary.ttk_a_to_b
    } else {
        summary.max_time_sec
    };
    let immortal_damage = if summary.winner == Winner::A {
        summary.damage_dealt_a_at_b_death + summary.extended_damage_potential_a
    } else {
        summary.damage_dealt_a
    };

    BestBuildAggregate {
        win,
        draw,
        survival,
        avg_dps,
        ttk_win,
        immortal_damage,
    }
}
