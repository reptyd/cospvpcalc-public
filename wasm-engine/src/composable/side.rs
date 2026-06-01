// Per-side combat state for the composable engine.
//
// Extracted from composable/mod.rs (light split, behavior-preserving).
//
// 2026-05-12 (Round 58): `stats` and `breath` no longer live on the side.
// Production (Compare / BestBuilds) passes them through `PhaseContext`
// (`ctx.attacker`, `ctx.defender`, `ctx.attacker_breath`,
// `ctx.defender_breath`) so every phase fn that needs them gets a `&`
// directly from the caller's frame — no per-side clone, no lifetime
// gymnastics on the side itself. The two production helpers in `mod.rs`
// that previously read `side.stats` (`apply_compare_start_hp`,
// `seed_env_extras_into_side`) now take an explicit `&SimpleCombatantStats`
// parameter from the caller. The Sandbox runtime owns its `attacker_stats`
// + `attacker_breath` (and B equivalents) on `SandboxRuntime` itself —
// CombatSide stays a pure state-bag in both worlds.
//
// Removing the field eliminates the +22 % BB stage1 regression measured
// in Round 57: 95 616 matchups × 2 sides × ~600 µs clone = ~115 s of
// avoidable work per BB run. Recovers >95 % of the Cow→owned cost while
// keeping the no-lifetime-on-CombatSide design that lets Sandbox box the
// side in its runtime registry without lifetime-invariance pain.

use std::collections::BTreeMap;

use crate::compare_hunger;
use crate::contracts::{SimpleBreathProfile, SimpleCombatantStats, SimpleStatusInstance};

/// Round 36 / A10: bit values for `CombatSide::iter_damage_kinds_*`.
/// Damage phases OR these into the side's mask; the trigger
/// dispatcher reads them to produce `event.is_bite` / `event.is_breath`
/// / `event.is_dot` extras at `on_take_damage` / `on_deal_damage`.
pub const DAMAGE_KIND_BITE: u32 = 1 << 0;
pub const DAMAGE_KIND_BREATH: u32 = 1 << 1;
pub const DAMAGE_KIND_DOT: u32 = 1 << 2;
use crate::statuses::{next_status_decay_at, next_status_tick_at};

use super::breath::runtime_breath_tick_sec;
use super::posture::Posture;

#[derive(Clone)]
pub struct CombatSide {

    // Core combat state
    pub hp: f64,
    pub next_hit: f64,
    pub next_regen: f64,
    pub statuses: BTreeMap<String, SimpleStatusInstance>,
    pub death_time: Option<f64>,

    // Breath state
    pub next_breath: f64,
    pub breath_capacity: f64,
    pub breath_regen_at: f64,
    pub breath_chain: f64,
    pub breath_restart_delay_until: Option<f64>,
    pub last_breath_tick: Option<f64>,
    pub cloud_breath_muddy_progress: f64,

    // Lance state
    pub lance_armed_until: f64,
    pub lance_cooldown_until: f64,
    pub lance_aura_until: f64,
    pub lance_aura_next_tick_at: Option<f64>,

    // Spirit Glare state
    pub breath_auto_fire_delay_until: Option<f64>,
    pub breath_auto_fire_cooldown_until: f64,

    // Plasma Beam state — discrete shot charges. `plasma_charges_remaining`
    // starts at `breath.charges_max` and is decremented at the end of each
    // capacity drain. `plasma_next_charge_at` is the next clock time a free
    // charge will be granted (background regen), capped at `charges_max`.
    pub plasma_charges_remaining: f64,
    pub plasma_next_charge_at: f64,

    // Posture state (Compare-only; Phase 1 sets the fields but the
    // policy that drives transitions lives in a later phase). Three
    // values together describe the side's posture:
    //   - `posture_current`: the settled posture. Multipliers (regen,
    //     ailment decay, incoming damage) read from this value only.
    //   - `posture_pending`: the posture being transitioned TO. While
    //     `posture_pending != posture_current` a transition is live and
    //     `posture_transition_complete_at` holds the clock time when
    //     `posture_current` will be promoted to `posture_pending`.
    //   - `posture_transition_complete_at`: time at which the active
    //     transition settles. Meaningful only while pending != current.
    pub posture_current: Posture,
    pub posture_pending: Posture,
    pub posture_transition_complete_at: f64,
    /// Next clock time the posture policy is scheduled to evaluate
    /// this side. Initialised to 0.0 so the first decision fires at
    /// t=0 when the policy is enabled, then advances by
    /// `DECISION_PERIODIC_SEC` (5 s) after each evaluation. Regen-
    /// aware mode additionally pulls this forward when an upcoming
    /// regen tick is close enough that a Standing → Laying transition
    /// can complete in time.
    pub posture_next_decision_at: f64,

    // Hunker state
    pub hunker_on: bool,
    pub hunker_effect_starts_at: f64,
    pub hunker_activation_count: u32,
    pub hunker_last_decision_at: f64,

    // Self-destruct state (reworked 2026-04-21):
    // `armed` becomes true when the arming status (3 stacks, standard decay)
    // is applied; cleared on explosion. `cooldown_until` starts after each
    // explosion. Arming lifetime is tracked by the status itself, not a
    // separate timer field.
    pub self_destruct_armed: bool,
    pub self_destruct_cooldown_until: f64,

    // Thorn Trap state
    pub next_thorn_trap: f64,
    pub thorn_trap_cooldown_until: f64,

    // Toxic Trap state
    pub next_toxic_trap: f64,
    pub toxic_trap_cooldown_until: f64,
    pub toxic_trap_bites_remaining: i32,
    pub toxic_trap_next_tick_at: Option<f64>,

    // Frost Snare state
    pub next_frost_snare: f64,
    pub frost_snare_cooldown_until: f64,
    // Poison Area state
    pub next_poison_area: f64,
    pub poison_area_cooldown_until: f64,
    // Yolk Bomb state
    pub next_yolk_bomb: f64,
    pub yolk_bomb_cooldown_until: f64,
    // Divination state
    pub next_divination: f64,
    pub divination_cooldown_until: f64,
    pub divination_charges_left: i32,

    // Aura state (any subtype: Disease, Corrosion, ...)
    pub aura_next_tick_at: Option<f64>,
    pub filter_corrosion_from_breath: bool,

    // Healing Step state (owner-only heal, compare-only Trails passive)
    pub healing_step_next_tick_at: Option<f64>,

    // Healing Pulse state (compare-only disputed active). Owner casts at t=0
    // and every 90s; each cast applies Healing_Ailment stacks. `next_healing_pulse`
    // schedules the next cast attempt; `healing_pulse_cooldown_until` gates it.
    pub next_healing_pulse: f64,
    pub healing_pulse_cooldown_until: f64,

    // Healing Ailment discrete tick scheduler. Armed when the status is first
    // applied (Some(time + 15s)); cleared when stacks reach 0. Each tick heals
    // +7% of the owner's max HP flat, bypassing bleed/burn regen-disable.
    pub healing_ailment_next_tick_at: Option<f64>,

    // Expunge state (compare-only disputed active). The ideal policy fires
    // inline at bite time, so only a cooldown timer is tracked. 45s CD begins
    // the moment the bonus bite lands; stays 0 until first use.
    pub expunge_cooldown_until: f64,

    // Damage trails state (shared counter for all 4 damage trails owned by this side)
    pub damage_trail_next_tick_at: Option<f64>,

    // Trails/Step facetank override state (Compare-only). While at least one of
    // the side's trail or step abilities is active (HP-threshold-gated), No
    // Move Facetank is overridden off so PvP-persistent statuses decay
    // normally. Mirrors TS `state.trailsFacetankOverrideActive` set by
    // `applyTrailsFacetankOverride` in `specialEventsRuntime.ts:427-439`. The
    // TS `trailsFacetankOverridePrev` field has no Rust counterpart because
    // the base value lives in `ComposableAbilityConfig` (immutable per run);
    // restore is implicit when the override clears. Read via
    // `effective_block_persistent_decay`.
    pub trails_facetank_override_active: bool,

    // Compare-only Gourmandizer static weight factor (1.0 = no bonus; 1.15 max).
    pub gourmandizer_weight_factor: f64,

    // Cursed Sigil state
    pub cursed_sigil_cooldown_until: f64,

    // Fortify state
    pub fortify_cooldown_until: f64,
    pub fortify_immune_until: f64,
    pub fortify_weight_bonus_until: f64,
    pub fortify_planned_at: f64,

    // Harden state
    pub harden_active_until: f64,
    pub harden_cooldown_until: f64,

    // Drowsy Area state
    pub drowsy_area_cooldown_until: f64,

    // Unbridled Rage state
    pub unbridled_rage_active_until: f64,
    pub unbridled_rage_cooldown_until: f64,
    pub unbridled_rage_planned_at: f64,

    // Hunter's Curse state
    pub hunters_curse_active_until: f64,
    pub hunters_curse_cooldown_until: f64,
    pub hunters_curse_planned_at: f64,
    pub hunters_curse_activation_count: u32,

    // Generic ability activation counter — populated by `record_ability_event`
    // when any ability not already carrying a typed counter fires. Keyed by the
    // ability display name (e.g. "Fortify", "Flame Trail"). Used by
    // `snapshot_debug` to populate `abilities_applied` so the UI can render a
    // usage summary.
    pub ability_activation_counts: BTreeMap<String, u32>,

    // Conditional passive timeline state. These passives are modeled as
    // current-state modifiers, so their visible activation/deactivation log
    // needs separate transition tracking.
    pub berserk_active_logged: bool,
    pub first_strike_active_logged: bool,
    pub warden_resistance_active_logged: bool,

    // Life Leech state
    pub life_leech_active_until: f64,
    pub life_leech_cooldown_until: f64,

    // Rewind state
    pub rewind_cooldown_until: f64,
    pub rewind_history: Vec<(f64, f64, BTreeMap<String, SimpleStatusInstance>)>,

    // Warden's Rage state
    pub warden_rage_on: bool,
    pub warden_rage_stacks: i32,
    pub warden_rage_tap_until: f64,
    pub warden_rage_cooldown_until: f64,
    pub warden_rage_regen_buffered: bool,

    // Adrenaline state
    pub adrenaline_active_until: f64,
    pub adrenaline_cooldown_until: f64,
    pub adrenaline_planned_at: f64,

    // Lich Mark state
    pub lich_mark_armed_until: f64,
    pub lich_mark_cooldown_until: f64,
    pub lich_mark_pending_payload_status_id: Option<String>,
    pub lich_mark_owned_payload_status_id: Option<String>,

    // Spite state
    pub spite_armed: bool,
    pub spite_charge_ready_at: f64,
    pub spite_cooldown_until: f64,

    // Frost Nova state
    pub frost_nova_active_until: f64,
    pub frost_nova_cooldown_until: f64,
    pub frost_nova_next_tick_at: Option<f64>,

    // Reflux state
    pub reflux_armed: bool,
    pub reflux_charge_ready_at: f64,
    pub reflux_puddle_until: f64,
    pub reflux_cooldown_until: f64,
    pub reflux_next_tick_at: Option<f64>,

    // Totem state
    pub totem_active_until: f64,
    pub totem_cooldown_until: f64,
    pub totem_next_tick_at: Option<f64>,

    // Reflect (activated) state
    pub reflect_active_until: f64,
    pub reflect_cooldown_until: f64,

    // Cocoon state (3-phase active, 120s cooldown).
    // Ph1 [cocoon_phase1_until - 5.0 .. cocoon_phase1_until): user keeps playing
    //   normally — bite cadence, actives, and defensive ailment procs all fire.
    //   Damage taken is normal, the user can die.
    // Ph2 [cocoon_phase1_until .. cocoon_phase2_until): fully invincible, status
    //   immune, heal +6% maxHP/s linear. User cannot bite or activate other
    //   abilities during this window.
    // Ph3 (after cocoon_phase2_until, while Cocoon_Damage status > 0): +15% damage.
    pub cocoon_cooldown_until: f64,
    pub cocoon_phase1_until: f64,
    pub cocoon_phase2_until: f64,

    // Cause Fear state
    pub cause_fear_cooldown_until: f64,

    // Grim Lariat state
    pub grim_lariat_cooldown_until: f64,

    // Shadow Barrage state
    pub shadow_barrage_cooldown_until: f64,
    pub shadow_barrage_base_damage: f64,
    pub shadow_barrage_remaining_hits: i32,
    pub shadow_barrage_next_hit_at: Option<f64>,
    pub shadow_barrage_total_hits: i32,
    pub last_melee_hit_at: f64,
    pub last_melee_hit_damage: f64,
    /// Tracks whether the side's first melee hit has already been processed.
    /// Used to gate Power Charge (+50% dmg + 2 Shredded Wings) and Gore Charge
    /// (2 Bleed + 10 Deep Wounds). Set true after the first melee event,
    /// regardless of whether the hit landed damage (matches TS behavior).
    pub first_melee_hit_taken: bool,

    // Compare-only "Use Hunger Rules" state. When
    // `compare_hunger_rule_enabled` is true, `compare_hunger` drains each
    // tick (1 unit / 30s, modified by Disease, Gourmandizer overfill, and
    // Defiled Ground consumption multiplier) and gates Reflux cast cost.
    // `last_hunger_update_at` tracks the per-side `lastUpdateAt` clock used
    // by TS `updateCompareHunger` to compute delta.
    pub compare_hunger: f64,
    pub compare_appetite_base: f64,
    pub compare_hunger_rule_enabled: bool,
    pub compare_gourmandizer_enabled: bool,
    pub compare_defiled_ground_level: i32,
    pub compare_defiled_ground_weakness_enabled: bool,
    pub compare_plushie_drain_multiplier: f64,
    pub last_hunger_update_at: f64,

    /// Compare-only First Tick Rule (ailments half): records the time at which
    /// a DoT status on this side last transitioned from present → absent.
    /// Used by the per-iteration snapshot sweep to decide whether a freshly
    /// applied DoT should use the shortened first-tick delay instead of the
    /// default tick period. Mirrors TS `compareStatusLastClearedAt` +
    /// `shouldUseCompareFirstAilmentTick` in statusApplyRuntime.ts.
    pub status_last_cleared_at: BTreeMap<String, f64>,

    /// Sprint 5: per-side custom-ability runtime state. Cooldowns and
    /// active-window timestamps for any user ability owned by this
    /// side (`SimpleCombatantStats::user_ability_ids`). Keys are the
    /// ability `id` (e.g. `"user.pyro_strike"`); values are the
    /// `time + duration` at which the timer expires. Populated by
    /// `EffectKind::SetCooldownUntil` / `SetActiveUntil` running
    /// against this side; consulted at policy-decision time.
    pub user_cooldowns: BTreeMap<String, f64>,
    pub user_active_until: BTreeMap<String, f64>,
    /// Per-(side, ability-id) tick-trigger schedule: timestamp at
    /// which the next `OnTick` should fire for the named ability.
    /// Seeded at simulation start for every attached ability with an
    /// `on_tick` hook (defaulting to `t = 0`); advanced by the engine
    /// after each fire.
    pub user_tick_due_at: BTreeMap<String, f64>,
    /// Cumulative tick count per ability for `event.tick_index`.
    pub user_tick_index: BTreeMap<String, u32>,
    /// Phase 9 (programmable statuses): per-(side, status-id) `on_tick`
    /// schedule for dynamic user statuses CARRIED by this side. Kept
    /// separate from `user_tick_due_at` (ability ticks) and from
    /// `SimpleStatusInstance.next_tick_at` (DOT/HoT) so status-hook cadence
    /// never perturbs built-in tick timing. Entries cleared on teardown.
    pub status_tick_due_at: BTreeMap<String, f64>,
    /// Cumulative `on_tick` count per carried status, for `event.tick_index`.
    pub status_tick_index: BTreeMap<String, u32>,
    /// Phase 9: clock time each carried dynamic user status was first applied
    /// to this side, for the `status.age` Expr var (`time - applied_at`). Seeded
    /// on the absent→present apply, cleared on teardown. Runtime-only (mirrors
    /// the tick maps; never serialized) so it adds no `SimpleStatusInstance`
    /// literal churn.
    pub status_applied_at: BTreeMap<String, f64>,
    /// Per-side scratch space for `EffectKind::ModifyStat` writes
    /// + any other user-ability-driven extras the engine adapter
    ///   needs to surface in `PolicySide.extras`.
    pub user_extras: BTreeMap<String, crate::policy::state::PolicyValue>,
    /// Larger Tier A: side-state snapshots keyed by user-supplied
    /// names. `RecordSnapshot` writes here; `RestoreSnapshot` reads.
    /// Captures hp + statuses + user_extras at snapshot time.
    pub user_snapshots: BTreeMap<String, crate::effects::UserSideSnapshot>,
    /// Larger Tier A: scheduled effects awaiting dispatch.
    /// Each entry is `(due_at_time, effects)`. Drained at the top
    /// of each iteration when `due_at <= time`. Caster owns the
    /// queue (the schedule writer determines who fires when due).
    pub user_scheduled: Vec<crate::effects::ScheduledEntry>,
    /// Round 36 / A10: bitmask of damage kinds that hit this side
    /// during the current loop iteration. Reset at the top of every
    /// iteration; set by the damage phases (bite, breath, dot).
    /// Read at `process_phase_16_post_tick` when populating
    /// `event.is_bite` / `event.is_breath` / `event.is_dot` extras
    /// for `on_take_damage` triggers.
    ///
    /// Bits: 0 = bite, 1 = breath, 2 = dot. Other engine damage
    /// (Lance aura, Reflux, Grim Lariat, traps, etc.) intentionally
    /// does NOT set a bit in this round — those flow through but
    /// leave `event.is_bite/breath/dot` at 0. Future bits can be
    /// added without breaking the shape since each flag is its own
    /// extras key.
    pub iter_damage_kinds_taken: u32,
    /// Round 36 / A10: same shape, but for damage this side DEALT
    /// during the iteration. Surfaced into `event.is_bite/breath/dot`
    /// at on_deal_damage dispatch.
    pub iter_damage_kinds_dealt: u32,
    /// Round 37 / A7: cumulative healing applied to this side during
    /// the current iteration. Heal sites accumulate; reset at the top
    /// of every loop iter. Dispatched to `OnHeal` trigger as
    /// `event.heal_amount` when > 0.
    pub iter_healing_taken: f64,
    /// Round 37 / A7: snapshot of which `user_active_until` keys were
    /// > current time at the START of this iteration. After all phases
    /// > run, the dispatcher diffs this against the live map — any key
    /// > whose value was > pre-time but is now <= current time has just
    /// > expired naturally. Dispatched to `OnActiveEnd` as
    /// > `event.ended.<id>` flags. Only user-scoped keys are tracked.
    pub iter_user_active_until_pre: BTreeMap<String, f64>,
    /// v2 Phase 4 (G5): snapshot of which BUILT-IN active windows were
    /// > current time at the START of this iteration, keyed by a stable
    /// > ability id. Diffed after all phases against `builtin_active_windows()`
    /// > to fire `OnActiveEnd` (`event.ended.<id>`) for built-in windows,
    /// > mirroring the user-window tracking above.
    pub iter_builtin_active_until_pre: BTreeMap<String, f64>,
    /// Round 46 / B2: sliding-window damage event log. Each entry is
    /// `(time, post_mitigation_amount)`. Read at expression eval to
    /// answer `self.damage_taken_last.<N>` / `self.damage_dealt_last.<N>`
    /// where N is the window length in seconds. Bite damage only
    /// instruments this round (matches A13/B4 scope). Pruned
    /// opportunistically at push time to entries within
    /// `B2_MAX_WINDOW_SEC` of `time` so the buffers stay small under
    /// long fights.
    pub recent_damage_taken: Vec<(f64, f64)>,
    pub recent_damage_dealt: Vec<(f64, f64)>,
    /// Round 43 / A10b: cumulative pre-mitigation damage that targeted
    /// this side this iteration (reset at iteration top). Reported as
    /// `event.raw_damage` to `on_take_damage` triggers; the existing
    /// `damage_taken` field carries the post-mitigation amount, so
    /// `prevented = raw - taken`. Bite damage instruments this round;
    /// breath / DOT / trap sources extend in a follow-up.
    pub iter_raw_damage_taken: f64,
    /// Round 43 / A10b: cumulative pre-mitigation damage this side
    /// dealt this iteration. Symmetric counterpart for
    /// `on_deal_damage`.
    pub iter_raw_damage_dealt: f64,
    /// Round 42 / A11: per-fight active level for each user.<id>
    /// attached to this side. Seeded at simulation start from
    /// `AbilityPolicyOverrides::user_ability_levels` (Compare UI
    /// per-matchup override) or, when absent, from the spec's
    /// `default_level`. Read by the user-ability dispatcher to
    /// resolve `scaling.<key>` extras at the right level — overriding
    /// the spec's `default_level` for the duration of THIS fight only
    /// (the spec itself stays unmodified).
    pub user_levels: BTreeMap<String, u32>,
}

impl CombatSide {
    /// True when this side is fully settled in Sitting or Laying (no
    /// active transition). Used by the damage / regen / decay paths to
    /// gate Phase 1 multipliers — they apply ONLY after the transition
    /// to the non-Standing posture has fully completed.
    pub(super) fn posture_settled_non_standing(&self) -> bool {
        super::posture::is_settled_non_standing(self.posture_current, self.posture_pending)
    }

    /// Multiplier applied to bite / breath damage when this side is
    /// the DEFENDER. Returns 1.0 unless settled in non-Standing
    /// posture (×1.5 Sitting, ×1.75 Laying).
    pub(super) fn posture_incoming_damage_mult(&self) -> f64 {
        if self.posture_settled_non_standing() {
            super::posture::settled_incoming_damage_mult(self.posture_current)
        } else {
            1.0
        }
    }

    /// Multiplier applied to `health_regen` at the regen tick. Settled
    /// non-Standing only (1.5 Sitting, 2.0 Laying).
    pub(super) fn posture_regen_mult(&self) -> f64 {
        if self.posture_settled_non_standing() {
            super::posture::settled_regen_mult(self.posture_current)
        } else {
            1.0
        }
    }

    /// Multiplier applied to the natural decay rate of negative-ailment
    /// statuses on this side. Settled non-Standing only (2.0 Sitting,
    /// 4.0 Laying).
    pub(super) fn posture_decay_mult(&self) -> f64 {
        if self.posture_settled_non_standing() {
            super::posture::settled_decay_mult(self.posture_current)
        } else {
            1.0
        }
    }

    /// True when this side is settled (no live transition) in the Laying
    /// posture. Used to nullify Hypothermia damage during the DoT tick
    /// (laying down stops the cold's health decline).
    pub(super) fn posture_is_settled_laying(&self) -> bool {
        self.posture_current == Posture::Laying && self.posture_pending == Posture::Laying
    }

    /// Build a side from caller-owned stats + breath refs. **No clone
    /// of stats / breath** — the side stores only its mutable battle
    /// state. Stats / breath stay on the caller's frame (production) or
    /// on the Sandbox runtime (which owns them separately and re-passes
    /// the refs into phase contexts).
    pub(super) fn new(
        stats: &SimpleCombatantStats,
        breath: Option<&SimpleBreathProfile>,
    ) -> Self {
        let hp = stats.health;
        let next_regen = if stats.health_regen > 0.0 { 15.0 } else { f64::INFINITY };
        let next_breath = breath
            .map(|b| runtime_breath_tick_sec(stats, b))
            .unwrap_or(f64::INFINITY);
        // For plasma_beam the fuel lives in `plasma_charges_remaining`,
        // not in `breath_capacity` — the very first scheduler call walks
        // step 2 of `tick_breath_plasma`, decrements the charge counter,
        // and refills capacity to `breath.capacity`. Pre-seeding the
        // capacity at full would double-count one charge (it would skip
        // the first startup delay AND not decrement plasma_charges).
        let breath_capacity = match breath {
            Some(b) if b.special_kind.as_deref() == Some("plasma_beam") => 0.0,
            Some(b) => b.capacity,
            None => 0.0,
        };
        // Plasma Beam starts at full charges. For other breath kinds the
        // fields stay at their `0.0` defaults so the standard / auto-fire
        // paths see no change. `plasma_next_charge_at` is left at
        // `f64::INFINITY` until the first charge is spent, so background
        // regen doesn't waste itself capping at `charges_max`.
        let (plasma_charges_remaining, plasma_next_charge_at) = match breath {
            Some(b) if b.special_kind.as_deref() == Some("plasma_beam") => {
                (b.charges_max.max(0.0), f64::INFINITY)
            }
            _ => (0.0, f64::INFINITY),
        };
        CombatSide {
            hp,
            next_hit: 0.0,
            next_regen,
            statuses: BTreeMap::new(),
            death_time: None,
            next_breath,
            breath_capacity,
            breath_regen_at: f64::INFINITY,
            breath_chain: 0.0,
            breath_restart_delay_until: None,
            last_breath_tick: None,
            cloud_breath_muddy_progress: 0.0,
            lance_armed_until: 0.0,
            lance_cooldown_until: 0.0,
            lance_aura_until: 0.0,
            lance_aura_next_tick_at: None,
            breath_auto_fire_delay_until: None,
            breath_auto_fire_cooldown_until: 0.0,
            plasma_charges_remaining,
            plasma_next_charge_at,
            posture_current: Posture::Standing,
            posture_pending: Posture::Standing,
            posture_transition_complete_at: 0.0,
            posture_next_decision_at: 0.0,
            hunker_on: false,
            hunker_effect_starts_at: f64::INFINITY,
            hunker_activation_count: 0,
            hunker_last_decision_at: f64::NEG_INFINITY,
            self_destruct_armed: false,
            self_destruct_cooldown_until: 0.0,
            next_thorn_trap: f64::INFINITY,
            thorn_trap_cooldown_until: 0.0,
            next_toxic_trap: f64::INFINITY,
            toxic_trap_cooldown_until: 0.0,
            toxic_trap_bites_remaining: 0,
            toxic_trap_next_tick_at: None,
            next_frost_snare: f64::INFINITY,
            frost_snare_cooldown_until: 0.0,
            next_poison_area: f64::INFINITY,
            poison_area_cooldown_until: 0.0,
            next_yolk_bomb: f64::INFINITY,
            yolk_bomb_cooldown_until: 0.0,
            next_divination: f64::INFINITY,
            divination_cooldown_until: 0.0,
            divination_charges_left: 0,
            aura_next_tick_at: None,
            filter_corrosion_from_breath: false,
            healing_step_next_tick_at: None,
            next_healing_pulse: f64::INFINITY,
            healing_pulse_cooldown_until: 0.0,
            healing_ailment_next_tick_at: None,
            expunge_cooldown_until: 0.0,
            damage_trail_next_tick_at: None,
            trails_facetank_override_active: false,
            gourmandizer_weight_factor: 1.0,
            cursed_sigil_cooldown_until: 0.0,
            fortify_cooldown_until: 0.0,
            fortify_immune_until: 0.0,
            fortify_weight_bonus_until: 0.0,
            fortify_planned_at: 0.0,
            harden_active_until: 0.0,
            harden_cooldown_until: 0.0,
            drowsy_area_cooldown_until: 0.0,
            unbridled_rage_active_until: 0.0,
            unbridled_rage_cooldown_until: 0.0,
            unbridled_rage_planned_at: 0.0,
            hunters_curse_active_until: 0.0,
            hunters_curse_cooldown_until: 0.0,
            hunters_curse_planned_at: 0.0,
            hunters_curse_activation_count: 0,
            ability_activation_counts: BTreeMap::new(),
            user_cooldowns: BTreeMap::new(),
            user_active_until: BTreeMap::new(),
            user_tick_due_at: BTreeMap::new(),
            user_tick_index: BTreeMap::new(),
            status_tick_due_at: BTreeMap::new(),
            status_tick_index: BTreeMap::new(),
            status_applied_at: BTreeMap::new(),
            user_extras: BTreeMap::new(),
            user_snapshots: BTreeMap::new(),
            user_scheduled: Vec::new(),
            iter_damage_kinds_taken: 0,
            iter_damage_kinds_dealt: 0,
            iter_healing_taken: 0.0,
            iter_user_active_until_pre: BTreeMap::new(),
            iter_builtin_active_until_pre: BTreeMap::new(),
            iter_raw_damage_taken: 0.0,
            iter_raw_damage_dealt: 0.0,
            recent_damage_taken: Vec::new(),
            recent_damage_dealt: Vec::new(),
            user_levels: BTreeMap::new(),
            berserk_active_logged: false,
            first_strike_active_logged: false,
            warden_resistance_active_logged: false,
            life_leech_active_until: 0.0,
            life_leech_cooldown_until: 0.0,
            rewind_cooldown_until: 0.0,
            rewind_history: Vec::new(),
            warden_rage_on: false,
            warden_rage_stacks: 0,
            warden_rage_tap_until: 0.0,
            warden_rage_cooldown_until: 0.0,
            warden_rage_regen_buffered: false,
            adrenaline_active_until: 0.0,
            adrenaline_cooldown_until: 0.0,
            adrenaline_planned_at: 0.0,
            lich_mark_armed_until: 0.0,
            lich_mark_cooldown_until: 0.0,
            lich_mark_pending_payload_status_id: None,
            lich_mark_owned_payload_status_id: None,
            spite_armed: false,
            spite_charge_ready_at: 0.0,
            spite_cooldown_until: 0.0,
            frost_nova_active_until: 0.0,
            frost_nova_cooldown_until: 0.0,
            frost_nova_next_tick_at: None,
            reflux_armed: false,
            reflux_charge_ready_at: 0.0,
            reflux_puddle_until: 0.0,
            reflux_cooldown_until: 0.0,
            reflux_next_tick_at: None,
            totem_active_until: 0.0,
            totem_cooldown_until: 0.0,
            totem_next_tick_at: None,
            reflect_active_until: 0.0,
            reflect_cooldown_until: 0.0,
            cocoon_cooldown_until: 0.0,
            cocoon_phase1_until: 0.0,
            cocoon_phase2_until: 0.0,
            cause_fear_cooldown_until: 0.0,
            grim_lariat_cooldown_until: 0.0,
            shadow_barrage_cooldown_until: 0.0,
            shadow_barrage_base_damage: 0.0,
            shadow_barrage_remaining_hits: 0,
            shadow_barrage_next_hit_at: None,
            shadow_barrage_total_hits: 0,
            last_melee_hit_at: f64::NEG_INFINITY,
            last_melee_hit_damage: 0.0,
            first_melee_hit_taken: false,
            status_last_cleared_at: BTreeMap::new(),
            compare_hunger: compare_hunger::COMPARE_DEFAULT_STARTING_HUNGER,
            compare_appetite_base: compare_hunger::COMPARE_DEFAULT_APPETITE_BASE,
            compare_hunger_rule_enabled: false,
            compare_gourmandizer_enabled: false,
            compare_defiled_ground_level: 0,
            compare_defiled_ground_weakness_enabled: false,
            compare_plushie_drain_multiplier: 1.0,
            last_hunger_update_at: 0.0,
        }
    }

    pub(super) fn has_hunker(stats: &SimpleCombatantStats) -> bool {
        stats.hunker_reduction_pct > 0.0
    }

    /// v2 Phase 4 (G5): the built-in active-buff windows tracked for the
    /// `on_active_end` trigger, keyed by the stable id the user reads as
    /// `event.ended.<id>`. The iter-top snapshot filters these to the ones
    /// active (> time); the Phase-16 diff compares the snapshot against a
    /// fresh call to detect windows that lapsed this iteration. (Fortify's
    /// immune + weight windows share an expiry, so only one `fortify` entry
    /// is exposed.)
    pub(super) fn builtin_active_windows(&self) -> BTreeMap<String, f64> {
        let mut m = BTreeMap::new();
        m.insert("fortify".to_string(), self.fortify_weight_bonus_until);
        m.insert("harden".to_string(), self.harden_active_until);
        m.insert("hunters_curse".to_string(), self.hunters_curse_active_until);
        m.insert("unbridled_rage".to_string(), self.unbridled_rage_active_until);
        m.insert("adrenaline".to_string(), self.adrenaline_active_until);
        m.insert("life_leech".to_string(), self.life_leech_active_until);
        m.insert("reflect".to_string(), self.reflect_active_until);
        m.insert("frost_nova".to_string(), self.frost_nova_active_until);
        m.insert("totem".to_string(), self.totem_active_until);
        m
    }

    pub(super) fn next_status_tick(&self) -> f64 {
        next_status_tick_at(&self.statuses)
    }

    pub(super) fn next_status_decay(&self, after_time: f64) -> f64 {
        next_status_decay_at(&self.statuses, after_time)
    }

    /// True iff any status currently has a decay scheduled at or before
    /// `time` (within `1e-9` slack). Unlike `next_status_decay`, this does
    /// NOT filter to strict-greater-than: it answers the due-mask question
    /// "is the StatusDecay phase pending at this exact `time`?".
    pub(super) fn any_status_decay_due(&self, time: f64) -> bool {
        self.statuses
            .values()
            .any(|inst| inst.next_decay_at.is_some_and(|d| d <= time + 1e-9))
    }

    pub(super) fn next_lance_aura_tick(&self) -> f64 {
        if let Some(next_tick) = self.lance_aura_next_tick_at {
            if next_tick <= self.lance_aura_until {
                next_tick
            } else {
                f64::INFINITY
            }
        } else {
            f64::INFINITY
        }
    }

    /// Returns the next scheduled self-destruct-driven event time.
    /// Arming stacks are tracked as a status, so their decay is already
    /// scheduled by `next_status_decay`. This method returns the HP-trigger
    /// wake-up: since the trigger is passive on HP, the scheduler already
    /// reaches it via `next_hit` / `next_status_tick` / regen. Returning
    /// INFINITY here is correct — no extra wake-up needed beyond those.
    pub(super) fn next_self_destruct_event(&self) -> f64 {
        f64::INFINITY
    }

    /// True when this side is currently inside Cocoon Phase 2 — the
    /// invincibility window between `cocoon_phase1_until` and
    /// `cocoon_phase2_until`. Used as the gate for "user cannot bite or
    /// activate other abilities". Phase 1 (the wind-up window between
    /// activation and `cocoon_phase1_until`) is no longer treated as a
    /// lock-out — the user keeps playing normally there.
    pub(super) fn in_cocoon_phase_2(&self, time: f64) -> bool {
        self.cocoon_phase2_until > 0.0
            && time >= self.cocoon_phase1_until
            && time < self.cocoon_phase2_until
    }
}
