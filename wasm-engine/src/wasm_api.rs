//! WASM bridge surface — the `wasm-bindgen` JS API the TypeScript bridge calls.
//!
//! Exposes the `*_js` entrypoints consumed by `src/optimizer/`: the simulate
//! export ([`simulate_composable_matchup_js`]), the aggregate helper
//! ([`aggregate_best_builds_matchup_summary_js`]), and the custom-ability
//! registration surface ([`register_user_ability_js`] and siblings).

// WASM bridge surface for best builds / optimizer.
//
// On 2026-04-10 the bespoke contour exports (simulate_simple_melee_matchup_js,
// simulate_simple_status_melee_matchup_js, simulate_simple_active_melee_matchup_js,
// simulate_simple_life_leech_*_matchup_js, and 12 bespoke breath exports) were
// deleted after full composable fixture parity. The TS bridge in
// src/optimizer/rustMatchupLoader.ts now consumes a single entry point:
//   simulate_composable_matchup_js
//
// `rust_matchup_contract_version` is kept so the TS bridge can still stamp a
// version on the loaded bridge object for diagnostics.
// `aggregate_best_builds_matchup_summary_js` is kept because it is re-used by
// the TS fallback path in `aggregateBestBuildsMatchupSummary`.
//
// Sprint 1 (Custom Abilities, 2026-05-09) added the `register_user_*_js`
// surface — see `crate::user_registry` for the storage layer.

use std::collections::BTreeMap;
use std::sync::{OnceLock, RwLock};

use wasm_bindgen::prelude::*;

use crate::aggregate_best_builds_matchup_summary;
use crate::composable::{
    simulate_composable_matchup_with_posture_script, simulate_composable_matchup_with_trace,
    ComposableAbilityConfig,
};
use crate::contracts::{
    BestBuildsMatchupSummary, SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats,
};
use crate::policy::user_ability::{parse_user_ability_spec, UserAbilitySpec};
use crate::policy::user_timing::{parse_user_timing_spec, UserTimingSpec};
use crate::user_status::{parse_user_status_spec, UserStatusSpec};

/// Module-load hook (wasm-bindgen invokes this once when the WASM
/// binary is instantiated). Installs `console_error_panic_hook` so
/// any Rust panic is rendered as a readable JS console.error with the
/// real panic message, instead of the default JS `TypeError: encoded
/// data was not valid for encoding utf-8` that arrives when the
/// panic-payload pointer/length read back from WASM memory has been
/// invalidated by unwind. Without the hook, debugging engine
/// regressions in Compare requires reproducing them under cargo test.
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn simulate_composable_matchup_js(
    attacker: JsValue,
    defender: JsValue,
    attacker_breath: JsValue,
    defender_breath: JsValue,
    ability_policy: JsValue,
    ability_config: JsValue,
    max_time_sec: f64,
    record_trace: Option<bool>,
) -> Result<JsValue, JsValue> {
    let attacker: SimpleCombatantStats = serde_wasm_bindgen::from_value(attacker)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let defender: SimpleCombatantStats = serde_wasm_bindgen::from_value(defender)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let attacker_breath: Option<SimpleBreathProfile> =
        serde_wasm_bindgen::from_value(attacker_breath)
            .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let defender_breath: Option<SimpleBreathProfile> =
        serde_wasm_bindgen::from_value(defender_breath)
            .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let ability_policy: SimpleAbilityTimingMode = serde_wasm_bindgen::from_value(ability_policy)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let ability_config: ComposableAbilityConfig = serde_wasm_bindgen::from_value(ability_config)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let summary = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        attacker_breath.as_ref(),
        defender_breath.as_ref(),
        ability_policy,
        &ability_config,
        max_time_sec,
        record_trace.unwrap_or(false),
    );
    serde_wasm_bindgen::to_value(&summary).map_err(|err| JsValue::from_str(&err.to_string()))
}

/// Bridge variant of `simulate_composable_matchup_js` that overrides
/// the engine's posture decision on the indicated side with a
/// scripted timeline. Used by vitest benchmarks to evaluate arbitrary
/// posture trajectories under REAL Compare config (built via
/// `toRustComposableArgsFromCompare`) without duplicating that
/// wiring on the Rust side.
///
/// `posture_script` is a JS-side array of `[time_sec, action_string]`
/// tuples. Action strings are camelCase variants of `PostureAction`:
/// `"stay" | "startSit" | "startLay" | "standUp"`. Each tuple fires
/// the action at the first engine iter past `time_sec`.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn simulate_composable_matchup_with_posture_script_js(
    attacker: JsValue,
    defender: JsValue,
    attacker_breath: JsValue,
    defender_breath: JsValue,
    ability_policy: JsValue,
    ability_config: JsValue,
    max_time_sec: f64,
    posture_script: JsValue,
    self_is_attacker: bool,
) -> Result<JsValue, JsValue> {
    let attacker: SimpleCombatantStats = serde_wasm_bindgen::from_value(attacker)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let defender: SimpleCombatantStats = serde_wasm_bindgen::from_value(defender)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let attacker_breath: Option<SimpleBreathProfile> =
        serde_wasm_bindgen::from_value(attacker_breath)
            .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let defender_breath: Option<SimpleBreathProfile> =
        serde_wasm_bindgen::from_value(defender_breath)
            .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let ability_policy: SimpleAbilityTimingMode = serde_wasm_bindgen::from_value(ability_policy)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let ability_config: ComposableAbilityConfig = serde_wasm_bindgen::from_value(ability_config)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let script: Vec<(f64, crate::composable::posture_policy::PostureAction)> =
        serde_wasm_bindgen::from_value(posture_script)
            .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let summary = simulate_composable_matchup_with_posture_script(
        &attacker, &defender,
        attacker_breath.as_ref(), defender_breath.as_ref(),
        ability_policy, &ability_config, max_time_sec,
        &script, self_is_attacker,
    );
    serde_wasm_bindgen::to_value(&summary).map_err(|err| JsValue::from_str(&err.to_string()))
}

/// `simulate_composable_matchup_with_bite_variant_script_js` is the WASM
/// bridge for the bite-variant benchmark and engine-replay inner replay.
/// Script entries are `(time_sec, "primary" | "secondary")`. The override
/// returns the LAST entry with `time ≤ now` (primary for any time before
/// the first entry). Falls back to primary on creatures with `damage2
/// <= 0` regardless of script.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn simulate_composable_matchup_with_bite_variant_script_js(
    attacker: JsValue,
    defender: JsValue,
    attacker_breath: JsValue,
    defender_breath: JsValue,
    ability_policy: JsValue,
    ability_config: JsValue,
    max_time_sec: f64,
    bite_variant_script: JsValue,
    self_is_attacker: bool,
) -> Result<JsValue, JsValue> {
    let attacker: SimpleCombatantStats = serde_wasm_bindgen::from_value(attacker)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let defender: SimpleCombatantStats = serde_wasm_bindgen::from_value(defender)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let attacker_breath: Option<SimpleBreathProfile> =
        serde_wasm_bindgen::from_value(attacker_breath)
            .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let defender_breath: Option<SimpleBreathProfile> =
        serde_wasm_bindgen::from_value(defender_breath)
            .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let ability_policy: SimpleAbilityTimingMode = serde_wasm_bindgen::from_value(ability_policy)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let ability_config: ComposableAbilityConfig = serde_wasm_bindgen::from_value(ability_config)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let raw_script: Vec<(f64, String)> = serde_wasm_bindgen::from_value(bite_variant_script)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    use crate::policy::decisions::bite_variant::{PRIMARY_VARIANT, SECONDARY_VARIANT};
    let script: Vec<(f64, &'static str)> = raw_script
        .into_iter()
        .map(|(t, v)| {
            let variant: &'static str = match v.as_str() {
                "secondary" => SECONDARY_VARIANT,
                _ => PRIMARY_VARIANT,
            };
            (t, variant)
        })
        .collect();
    let summary = crate::composable::simulate_composable_matchup_with_bite_variant_script(
        &attacker, &defender,
        attacker_breath.as_ref(), defender_breath.as_ref(),
        ability_policy, &ability_config, max_time_sec,
        &script, self_is_attacker,
    );
    serde_wasm_bindgen::to_value(&summary).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn aggregate_best_builds_matchup_summary_js(summary: JsValue) -> Result<JsValue, JsValue> {
    let summary: BestBuildsMatchupSummary = serde_wasm_bindgen::from_value(summary)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    serde_wasm_bindgen::to_value(&aggregate_best_builds_matchup_summary(&summary))
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn rust_matchup_contract_version() -> String {
    "best-builds-matchup-v1".to_string()
}

// ── Custom abilities + custom timings registration ────────────────────────
//
// The TS frontend authors a JSON spec (Constructor or Code mode), hands it
// here, and the engine stores the parsed result in a process-wide registry.
// Sprint 5 wires `composable::simulate_composable_matchup` to consult these
// registries before dispatch so a registered user ability behaves like a
// built-in.
//
// State is stored behind `OnceLock<RwLock<...>>` rather than a free-standing
// `static mut` for thread safety (wasm-bindgen futures can interleave across
// tabs / web workers).

fn user_ability_store() -> &'static RwLock<BTreeMap<String, UserAbilitySpec>> {
    static STORE: OnceLock<RwLock<BTreeMap<String, UserAbilitySpec>>> = OnceLock::new();
    STORE.get_or_init(|| RwLock::new(BTreeMap::new()))
}

/// Read-only snapshot of a single registered user-ability spec.
/// Returns `None` when the id isn't in the registry — the engine
/// dispatcher uses this to silently skip stale references attached
/// to a creature whose ability the user has since unregistered.
/// Cloning the spec is intentional: callers run combat work without
/// holding the registry lock open across iterations.
pub fn snapshot_user_ability(id: &str) -> Option<UserAbilitySpec> {
    let guard = user_ability_store().read().ok()?;
    guard.get(id).cloned()
}

/// Read-only snapshot of a single registered user-timing spec.
/// Same posture as [`snapshot_user_ability`] — clones to release
/// the registry lock.
pub fn snapshot_user_timing(id: &str) -> Option<UserTimingSpec> {
    let guard = user_timing_store().read().ok()?;
    guard.get(id).cloned()
}

fn user_timing_store() -> &'static RwLock<BTreeMap<String, UserTimingSpec>> {
    static STORE: OnceLock<RwLock<BTreeMap<String, UserTimingSpec>>> = OnceLock::new();
    STORE.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn user_status_store() -> &'static RwLock<BTreeMap<String, UserStatusSpec>> {
    static STORE: OnceLock<RwLock<BTreeMap<String, UserStatusSpec>>> = OnceLock::new();
    STORE.get_or_init(|| RwLock::new(BTreeMap::new()))
}

/// Read-only snapshot of a single registered user-status spec (Phase 6 /
/// G6). Returns `None` for unknown ids — the status-runtime seams in
/// `statuses.rs` use this to resolve a `user.`-namespaced status's
/// parametric metadata, falling back to the generated catalog otherwise.
/// Clones to release the registry lock (mirrors [`snapshot_user_ability`]).
pub fn snapshot_user_status(id: &str) -> Option<UserStatusSpec> {
    let guard = user_status_store().read().ok()?;
    guard.get(id).cloned()
}

/// Parse + validate + store a user ability spec. Returns
/// `{ id, display_name }` on success; rejects with a string error
/// on JSON parse failure or validation failure (id namespace,
/// missing fields, etc.).
#[wasm_bindgen]
pub fn register_user_ability_js(spec_json: &str) -> Result<JsValue, JsValue> {
    let spec = parse_user_ability_spec(spec_json)
        .map_err(|err| JsValue::from_str(&format!("{err}")))?;
    let id = spec.id.clone();
    let display_name = spec.display_name.clone();
    user_ability_store()
        .write()
        .map_err(|err| JsValue::from_str(&format!("registry poisoned: {err}")))?
        .insert(id.clone(), spec);
    let result = serde_json::json!({
        "ok": true,
        "id": id,
        "display_name": display_name,
    });
    serde_wasm_bindgen::to_value(&result).map_err(|err| JsValue::from_str(&err.to_string()))
}

/// Parse + validate + store a user timing spec. Same shape as
/// `register_user_ability_js`.
#[wasm_bindgen]
pub fn register_user_timing_js(spec_json: &str) -> Result<JsValue, JsValue> {
    let spec = parse_user_timing_spec(spec_json)
        .map_err(|err| JsValue::from_str(&format!("{err}")))?;
    let id = spec.id.clone();
    let display_name = spec.display_name.clone();
    user_timing_store()
        .write()
        .map_err(|err| JsValue::from_str(&format!("registry poisoned: {err}")))?
        .insert(id.clone(), spec);
    let result = serde_json::json!({
        "ok": true,
        "id": id,
        "display_name": display_name,
    });
    serde_wasm_bindgen::to_value(&result).map_err(|err| JsValue::from_str(&err.to_string()))
}

/// Remove a previously-registered user ability. Idempotent — silently
/// no-ops on unknown ids so the UI can call this defensively.
#[wasm_bindgen]
pub fn unregister_user_ability_js(id: &str) -> Result<JsValue, JsValue> {
    user_ability_store()
        .write()
        .map_err(|err| JsValue::from_str(&format!("registry poisoned: {err}")))?
        .remove(id);
    serde_wasm_bindgen::to_value(&serde_json::json!({ "ok": true, "id": id }))
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn unregister_user_timing_js(id: &str) -> Result<JsValue, JsValue> {
    user_timing_store()
        .write()
        .map_err(|err| JsValue::from_str(&format!("registry poisoned: {err}")))?
        .remove(id);
    serde_wasm_bindgen::to_value(&serde_json::json!({ "ok": true, "id": id }))
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

/// Parse + validate + store a user status spec (Phase 6 / G6). Same shape
/// as `register_user_ability_js`.
#[wasm_bindgen]
pub fn register_user_status_js(spec_json: &str) -> Result<JsValue, JsValue> {
    let spec =
        parse_user_status_spec(spec_json).map_err(|err| JsValue::from_str(&format!("{err}")))?;
    let id = spec.id.clone();
    let display_name = spec.display_name.clone();
    user_status_store()
        .write()
        .map_err(|err| JsValue::from_str(&format!("registry poisoned: {err}")))?
        .insert(id.clone(), spec);
    let result = serde_json::json!({
        "ok": true,
        "id": id,
        "display_name": display_name,
    });
    serde_wasm_bindgen::to_value(&result).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn unregister_user_status_js(id: &str) -> Result<JsValue, JsValue> {
    user_status_store()
        .write()
        .map_err(|err| JsValue::from_str(&format!("registry poisoned: {err}")))?
        .remove(id);
    serde_wasm_bindgen::to_value(&serde_json::json!({ "ok": true, "id": id }))
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

/// Read-only snapshot of every registered user ability id +
/// display name. Used by the UI to confirm the engine and the
/// localStorage view agree on the registered set after a page load.
#[wasm_bindgen]
pub fn list_user_abilities_js() -> Result<JsValue, JsValue> {
    let store = user_ability_store()
        .read()
        .map_err(|err| JsValue::from_str(&format!("registry poisoned: {err}")))?;
    let entries: Vec<_> = store
        .values()
        .map(|spec| {
            serde_json::json!({
                "id": spec.id,
                "display_name": spec.display_name,
            })
        })
        .collect();
    serde_wasm_bindgen::to_value(&entries).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn list_user_timings_js() -> Result<JsValue, JsValue> {
    let store = user_timing_store()
        .read()
        .map_err(|err| JsValue::from_str(&format!("registry poisoned: {err}")))?;
    let entries: Vec<_> = store
        .values()
        .map(|spec| {
            serde_json::json!({
                "id": spec.id,
                "display_name": spec.display_name,
            })
        })
        .collect();
    serde_wasm_bindgen::to_value(&entries).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn list_user_statuses_js() -> Result<JsValue, JsValue> {
    let store = user_status_store()
        .read()
        .map_err(|err| JsValue::from_str(&format!("registry poisoned: {err}")))?;
    let entries: Vec<_> = store
        .values()
        .map(|spec| {
            serde_json::json!({
                "id": spec.id,
                "display_name": spec.display_name,
            })
        })
        .collect();
    serde_wasm_bindgen::to_value(&entries).map_err(|err| JsValue::from_str(&err.to_string()))
}

/// TEST-ONLY: read the parsed spec back so unit tests can assert
/// the registry round-tripped what was registered. Not exported to
/// JS (the wasm_bindgen-exposed list_*_js calls return summary data
/// only; the full spec round-trip is engine-internal).
#[cfg(test)]
pub(crate) fn debug_get_user_ability(id: &str) -> Option<UserAbilitySpec> {
    user_ability_store()
        .read()
        .ok()
        .and_then(|store| store.get(id).cloned())
}

#[cfg(test)]
pub(crate) fn debug_get_user_timing(id: &str) -> Option<UserTimingSpec> {
    user_timing_store()
        .read()
        .ok()
        .and_then(|store| store.get(id).cloned())
}

/// TEST-ONLY: parse + register a user status (so `statuses.rs` runtime
/// tests can exercise the seams) and read it back. Mirrors the ability /
/// timing test helpers.
#[cfg(test)]
pub(crate) fn register_status_for_test(spec_json: &str) -> Result<String, String> {
    let spec = parse_user_status_spec(spec_json).map_err(|e| e.to_string())?;
    let id = spec.id.clone();
    user_status_store()
        .write()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), spec);
    Ok(id)
}

#[cfg(test)]
pub(crate) fn unregister_status_for_test(id: &str) {
    if let Ok(mut store) = user_status_store().write() {
        store.remove(id);
    }
}

#[cfg(test)]
pub(crate) fn debug_get_user_status(id: &str) -> Option<UserStatusSpec> {
    user_status_store()
        .read()
        .ok()
        .and_then(|store| store.get(id).cloned())
}

#[cfg(test)]
pub fn test_install_user_ability(spec: UserAbilitySpec) {
    let _ = user_ability_store()
        .write()
        .map(|mut store| store.insert(spec.id.clone(), spec));
}

#[cfg(test)]
pub fn test_remove_user_ability(id: &str) {
    let _ = user_ability_store().write().map(|mut store| store.remove(id));
}

#[cfg(test)]
pub fn test_install_user_timing(spec: UserTimingSpec) {
    let _ = user_timing_store()
        .write()
        .map(|mut store| store.insert(spec.id.clone(), spec));
}

#[cfg(test)]
pub fn test_remove_user_timing(id: &str) {
    let _ = user_timing_store().write().map(|mut store| store.remove(id));
}

// ── Sandbox runtime bindings ──────────────────────────────────────────────
//
// The Sandbox page in the TS UI holds a numeric `simId` for each open
// sandbox session and drives it through these exports. Lifecycle:
//
//   `sandbox_create_js({ attacker, defender, breaths, config, ... })`
//       → returns `{ id }`. The runtime lives in the WASM-side registry.
//
//   `sandbox_step_js(id)`, `sandbox_step_to_time_js(id, target)`,
//   `sandbox_apply_hp_js(id, ...)`, `sandbox_apply_status_js(id, ...)`,
//   `sandbox_force_bite_js(id, side)`, `sandbox_force_breath_js(id, side)`,
//   `sandbox_force_ability_js(id, side, name)`,
//   `sandbox_override_stat_js(id, side, field, value)`,
//   `sandbox_clear_overrides_js(id, side)`
//       → each mutates the runtime and returns the fresh `SandboxView`.
//
//   `sandbox_view_js(id)` → returns the current view without mutating.
//
//   `sandbox_destroy_js(id)` → removes the runtime from the registry.
//
// Same storage idiom as `user_ability_store`: `OnceLock<RwLock<...>>` for
// thread-safe interior mutability. Sandbox runtime values are `Box`'d so
// their heap addresses stay stable for the lifetime of the registry entry
// (the runtime's `CombatSide` self-references rely on it — see
// `crate::composable::sandbox`).

use std::sync::atomic::{AtomicU64, Ordering};

use crate::composable::sandbox::{SandboxAutomationMode, SandboxRuntime, SandboxSide};

fn sandbox_store() -> &'static RwLock<BTreeMap<u64, Box<SandboxRuntime>>> {
    static STORE: OnceLock<RwLock<BTreeMap<u64, Box<SandboxRuntime>>>> = OnceLock::new();
    STORE.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn next_sandbox_id() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

fn with_sandbox<F, R>(id: u64, f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut SandboxRuntime) -> R,
{
    let mut guard = sandbox_store()
        .write()
        .map_err(|err| JsValue::from_str(&format!("sandbox registry poisoned: {err}")))?;
    let runtime = guard
        .get_mut(&id)
        .ok_or_else(|| JsValue::from_str(&format!("sandbox id {id} not found")))?;
    Ok(f(runtime))
}

fn sandbox_view_result(id: u64) -> Result<JsValue, JsValue> {
    let view = with_sandbox(id, |rt| rt.snapshot_view())?;
    serde_wasm_bindgen::to_value(&view).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxCreatePayload {
    attacker: SimpleCombatantStats,
    defender: SimpleCombatantStats,
    attacker_breath: Option<SimpleBreathProfile>,
    defender_breath: Option<SimpleBreathProfile>,
    ability_policy: SimpleAbilityTimingMode,
    config: ComposableAbilityConfig,
    max_time_sec: f64,
    #[serde(default)]
    automation_mode: SandboxAutomationMode,
    #[serde(default)]
    record_trace: bool,
}

#[wasm_bindgen]
pub fn sandbox_create_js(payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxCreatePayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let runtime = SandboxRuntime::new(
        req.attacker,
        req.defender,
        req.attacker_breath,
        req.defender_breath,
        req.config,
        req.ability_policy,
        req.automation_mode,
        req.max_time_sec,
        req.record_trace,
    );
    let view = runtime.snapshot_view();
    let id = next_sandbox_id();
    sandbox_store()
        .write()
        .map_err(|err| JsValue::from_str(&format!("sandbox registry poisoned: {err}")))?
        .insert(id, runtime);
    let body = serde_json::json!({
        "id": id,
        "view": view,
    });
    serde_wasm_bindgen::to_value(&body).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn sandbox_destroy_js(id: u64) -> Result<JsValue, JsValue> {
    let removed = sandbox_store()
        .write()
        .map_err(|err| JsValue::from_str(&format!("sandbox registry poisoned: {err}")))?
        .remove(&id)
        .is_some();
    serde_wasm_bindgen::to_value(&serde_json::json!({ "ok": removed }))
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn sandbox_view_js(id: u64) -> Result<JsValue, JsValue> {
    sandbox_view_result(id)
}

#[wasm_bindgen]
pub fn sandbox_step_js(id: u64) -> Result<JsValue, JsValue> {
    let _ = with_sandbox(id, |rt| rt.step_to_next_event())?;
    sandbox_view_result(id)
}

#[wasm_bindgen]
pub fn sandbox_step_to_time_js(id: u64, target_time: f64) -> Result<JsValue, JsValue> {
    with_sandbox(id, |rt| rt.step_to_time(target_time))?;
    sandbox_view_result(id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxApplyHpPayload {
    side: SandboxSide,
    hp: f64,
}

#[wasm_bindgen]
pub fn sandbox_apply_hp_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxApplyHpPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.apply_hp(req.side, req.hp))?;
    sandbox_view_result(id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxApplyStatusPayload {
    side: SandboxSide,
    status_id: String,
    stacks: f64,
}

#[wasm_bindgen]
pub fn sandbox_apply_status_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxApplyStatusPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.apply_status(req.side, &req.status_id, req.stacks))?;
    sandbox_view_result(id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxSidePayload {
    side: SandboxSide,
}

#[wasm_bindgen]
pub fn sandbox_force_bite_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxSidePayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.force_bite(req.side))?;
    sandbox_view_result(id)
}

#[wasm_bindgen]
pub fn sandbox_force_breath_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxSidePayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.force_breath(req.side))?;
    sandbox_view_result(id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxForceAbilityPayload {
    side: SandboxSide,
    ability_name: String,
}

#[wasm_bindgen]
pub fn sandbox_force_ability_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxForceAbilityPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let recognised = with_sandbox(id, |rt| rt.force_ability(req.side, &req.ability_name))?;
    let view = with_sandbox(id, |rt| rt.snapshot_view())?;
    let body = serde_json::json!({
        "recognised": recognised,
        "view": view,
    });
    serde_wasm_bindgen::to_value(&body).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxOverrideStatPayload {
    side: SandboxSide,
    field: String,
    value: f64,
}

#[wasm_bindgen]
pub fn sandbox_override_stat_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverrideStatPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.override_stat(req.side, &req.field, req.value))?;
    sandbox_view_result(id)
}

#[wasm_bindgen]
pub fn sandbox_clear_overrides_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxSidePayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.clear_overrides(req.side))?;
    sandbox_view_result(id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxOverrideAbilityPayload {
    side: SandboxSide,
    ability_name: String,
    enabled: bool,
}

#[wasm_bindgen]
pub fn sandbox_override_ability_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverrideAbilityPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let recognised = with_sandbox(id, |rt| rt.override_ability(req.side, &req.ability_name, req.enabled))?;
    let view = with_sandbox(id, |rt| rt.snapshot_view())?;
    let body = serde_json::json!({ "recognised": recognised, "view": view });
    serde_wasm_bindgen::to_value(&body).map_err(|err| JsValue::from_str(&err.to_string()))
}

/// List the abilities/effects the Sandbox UI can toggle via the
/// Override Type → Ability/Effect dropdown. Returned as a JS array
/// of canonical name strings; the UI populates its dropdown from
/// this list so adding a new entry in
/// `composable::sandbox::OVERRIDABLE_ABILITY_FLAGS` automatically
/// appears in the UI without any TS-side change.
#[wasm_bindgen]
pub fn sandbox_overridable_abilities_js() -> Result<JsValue, JsValue> {
    let names: Vec<&'static str> =
        crate::composable::sandbox::overridable_ability_names();
    serde_wasm_bindgen::to_value(&names).map_err(|err| JsValue::from_str(&err.to_string()))
}

/// List the value-bearing abilities the Sandbox can override, with
/// their value kind (number vs string). The UI uses this to render
/// the right input element per ability — number input vs. dropdown
/// sourced from `getAbilityValueOptions`. Returned as
/// `[{ name, kind }]` JSON; `kind` is `"number" | "string"`.
#[wasm_bindgen]
pub fn sandbox_overridable_ability_values_js() -> Result<JsValue, JsValue> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Entry {
        name: &'static str,
        kind: crate::composable::sandbox::AbilityValueKind,
    }
    let specs: Vec<Entry> = crate::composable::sandbox::overridable_ability_value_specs()
        .into_iter()
        .map(|(name, kind)| Entry { name, kind })
        .collect();
    serde_wasm_bindgen::to_value(&specs).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxOverrideAbilityNumberPayload {
    side: SandboxSide,
    ability_name: String,
    value: f64,
}

#[wasm_bindgen]
pub fn sandbox_override_ability_number_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverrideAbilityNumberPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let recognised = with_sandbox(id, |rt| {
        rt.override_ability_number(req.side, &req.ability_name, req.value)
    })?;
    let view = with_sandbox(id, |rt| rt.snapshot_view())?;
    let body = serde_json::json!({ "recognised": recognised, "view": view });
    serde_wasm_bindgen::to_value(&body).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxOverrideAbilityStringPayload {
    side: SandboxSide,
    ability_name: String,
    /// `None` (or `null` from JS) clears the payload.
    #[serde(default)]
    value: Option<String>,
}

#[wasm_bindgen]
pub fn sandbox_override_ability_string_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverrideAbilityStringPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let recognised = with_sandbox(id, |rt| {
        rt.override_ability_string(req.side, &req.ability_name, req.value.clone())
    })?;
    let view = with_sandbox(id, |rt| rt.snapshot_view())?;
    let body = serde_json::json!({ "recognised": recognised, "view": view });
    serde_wasm_bindgen::to_value(&body).map_err(|err| JsValue::from_str(&err.to_string()))
}

/// List the stat-field passive abilities the Sandbox can override,
/// with their value kind (`number` or `bool`). UI uses this to pick
/// between a number input vs. a plain enable toggle for the passive.
#[wasm_bindgen]
pub fn sandbox_overridable_passives_js() -> Result<JsValue, JsValue> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Entry {
        name: &'static str,
        kind: crate::composable::sandbox::PassiveAbilityKind,
    }
    let specs: Vec<Entry> = crate::composable::sandbox::overridable_passive_specs()
        .into_iter()
        .map(|(name, kind)| Entry { name, kind })
        .collect();
    serde_wasm_bindgen::to_value(&specs).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxOverridePassiveBoolPayload {
    side: SandboxSide,
    passive_name: String,
    enabled: bool,
}

#[wasm_bindgen]
pub fn sandbox_override_passive_bool_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverridePassiveBoolPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let recognised = with_sandbox(id, |rt| {
        rt.override_passive_bool(req.side, &req.passive_name, req.enabled)
    })?;
    let view = with_sandbox(id, |rt| rt.snapshot_view())?;
    let body = serde_json::json!({ "recognised": recognised, "view": view });
    serde_wasm_bindgen::to_value(&body).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxOverridePassiveNumberPayload {
    side: SandboxSide,
    passive_name: String,
    value: f64,
}

#[wasm_bindgen]
pub fn sandbox_override_passive_number_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverridePassiveNumberPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let recognised = with_sandbox(id, |rt| {
        rt.override_passive_number(req.side, &req.passive_name, req.value)
    })?;
    let view = with_sandbox(id, |rt| rt.snapshot_view())?;
    let body = serde_json::json!({ "recognised": recognised, "view": view });
    serde_wasm_bindgen::to_value(&body).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxOverrideBreathPayload {
    side: SandboxSide,
    /// `None` clears the side's breath. `Some(profile)` replaces it
    /// with a wiki-spec-derived profile built by
    /// `buildBreathProfileByName` in `rustBestBuildsRuntime.ts`.
    #[serde(default)]
    profile: Option<crate::contracts::SimpleBreathProfile>,
}

#[wasm_bindgen]
pub fn sandbox_override_breath_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverrideBreathPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.override_breath(req.side, req.profile.clone()))?;
    sandbox_view_result(id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxOverrideResistPayload {
    side: SandboxSide,
    status_id: String,
    fraction: f64,
}

#[wasm_bindgen]
pub fn sandbox_override_resist_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverrideResistPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.override_resist(req.side, &req.status_id, req.fraction))?;
    sandbox_view_result(id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxOverrideStatusPayload {
    side: SandboxSide,
    status_id: String,
    stacks: f64,
}

#[wasm_bindgen]
pub fn sandbox_override_offensive_status_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverrideStatusPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.override_offensive_status(req.side, &req.status_id, req.stacks))?;
    sandbox_view_result(id)
}

#[wasm_bindgen]
pub fn sandbox_override_defensive_status_js(id: u64, payload: JsValue) -> Result<JsValue, JsValue> {
    let req: SandboxOverrideStatusPayload = serde_wasm_bindgen::from_value(payload)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    with_sandbox(id, |rt| rt.override_defensive_status(req.side, &req.status_id, req.stacks))?;
    sandbox_view_result(id)
}

#[cfg(test)]
mod tests {
    //! Integration tests for the JS-bridge surface. The
    //! `wasm_bindgen` exports take `JsValue` which is awkward to
    //! drive from a Rust unit test, so we exercise the
    //! parse-validate-store path through a thin adapter that
    //! mirrors the wasm_bindgen entry. Sprint 5 will add the
    //! browser-driven Playwright flow.
    use super::*;
    use crate::policy::user_ability::Expr;

    fn register_ability_for_test(spec_json: &str) -> Result<String, String> {
        let spec = parse_user_ability_spec(spec_json).map_err(|e| format!("{e}"))?;
        let id = spec.id.clone();
        user_ability_store()
            .write()
            .map_err(|e| format!("{e}"))?
            .insert(id.clone(), spec);
        Ok(id)
    }

    fn register_timing_for_test(spec_json: &str) -> Result<String, String> {
        let spec = parse_user_timing_spec(spec_json).map_err(|e| format!("{e}"))?;
        let id = spec.id.clone();
        user_timing_store()
            .write()
            .map_err(|e| format!("{e}"))?
            .insert(id.clone(), spec);
        Ok(id)
    }

    fn sample_ability_json_with_id(id: &str) -> String {
        serde_json::to_string(&serde_json::json!({
            "id": id,
            "display_name": "Heal At Half",
            "utility": { "kind": "const", "value": 100.0 },
            "is_available": {
                "kind": "bin",
                "op": "lte",
                "left": { "kind": "var", "path": "self.hp_ratio" },
                "right": { "kind": "const", "value": 0.5 }
            },
            "on_fire": {
                "name": "Heal At Half",
                "effects": [
                    {
                        "kind": "heal_hp",
                        "target": "caster",
                        "amount": 1500.0
                    }
                ]
            }
        }))
        .unwrap()
    }

    fn sample_timing_json_with_id(id: &str) -> String {
        serde_json::to_string(&serde_json::json!({
            "id": id,
            "display_name": "Brisk",
            "candidates": [0.0, 0.5, 1.5],
            "horizon_sec": 12.0,
        }))
        .unwrap()
    }

    // Tests use per-test unique ids so they're safe against
    // cargo's default parallel test execution against the shared
    // global registry. Each test cleans up its own ids at the end.

    fn cleanup_ids(ability: &[&str], timing: &[&str]) {
        if let Ok(mut s) = user_ability_store().write() {
            for id in ability {
                s.remove(*id);
            }
        }
        if let Ok(mut s) = user_timing_store().write() {
            for id in timing {
                s.remove(*id);
            }
        }
    }

    #[test]
    fn register_round_trips_ability() {
        let id = "user.tests.round_trips_ability";
        let parsed = register_ability_for_test(&sample_ability_json_with_id(id)).expect("register");
        assert_eq!(parsed, id);
        let stored = debug_get_user_ability(id).expect("present");
        assert_eq!(stored.display_name, "Heal At Half");
        assert_eq!(stored.on_fire.as_ref().unwrap().effects.len(), 1);
        match stored.is_available {
            Expr::Bin { .. } => {}
            _ => panic!("is_available should parse as a Bin expression"),
        }
        cleanup_ids(&[id], &[]);
    }

    #[test]
    fn register_round_trips_timing() {
        let id = "user.tests.round_trips_timing";
        let parsed = register_timing_for_test(&sample_timing_json_with_id(id)).expect("register");
        assert_eq!(parsed, id);
        let stored = debug_get_user_timing(id).expect("present");
        assert_eq!(stored.candidates, vec![0.0, 0.5, 1.5]);
        assert_eq!(stored.horizon_sec, 12.0);
        cleanup_ids(&[], &[id]);
    }

    fn sample_status_json_with_id(id: &str) -> String {
        serde_json::to_string(&serde_json::json!({
            "id": id,
            "display_name": "Searing",
            "polarity": "negative",
            "tick_kind": "dot_pct_max_hp",
            "tick_base": 0.2,
            "tick_per_stack": 0.05,
            "tick_interval_sec": 3.0,
            "decay_interval_sec": 4.0,
            "max_stacks": 5.0,
        }))
        .unwrap()
    }

    #[test]
    fn register_round_trips_status() {
        let id = "user.tests.round_trips_status";
        let parsed = register_status_for_test(&sample_status_json_with_id(id)).expect("register");
        assert_eq!(parsed, id);
        let stored = debug_get_user_status(id).expect("present");
        assert_eq!(stored.display_name, "Searing");
        assert_eq!(stored.max_stacks, Some(5.0));
        // Cleanse-eligibility is polarity-derived now (negative ⇒ removable).
        assert!(crate::statuses::is_fortify_removable_status(id));
        // (0.2 + 0.05·5)% of 10_000 = 45.
        assert!((stored.dot_damage(10_000.0, 5.0) - 45.0).abs() < 1e-9);
        unregister_status_for_test(id);
        assert!(debug_get_user_status(id).is_none());
    }

    #[test]
    fn user_status_drives_runtime_seams_and_leaves_builtins_intact() {
        let id = "user.tests.searing_seams";
        register_status_for_test(&sample_status_json_with_id(id)).expect("register");

        // User status resolves all metadata seams from its spec.
        assert_eq!(crate::statuses::status_tick_sec(id), Some(3.0));
        assert_eq!(crate::statuses::status_decay_sec(id), 4.0);
        assert_eq!(crate::statuses::status_max_stacks(id), Some(5.0));
        assert!(crate::statuses::is_fortify_removable_status(id));
        assert!((crate::statuses::compute_simple_dot_damage(10_000.0, id, 5.0, 3.0) - 45.0).abs() < 1e-9);

        // Regression guard: the user-first branch must not alter built-ins.
        assert_eq!(crate::statuses::status_decay_sec("Poison_Status"), 3.0);
        assert_eq!(crate::statuses::status_tick_sec("Poison_Status"), Some(3.0));
        let poison = crate::statuses::compute_simple_dot_damage(10_000.0, "Poison_Status", 5.0, 3.0);
        assert!((poison - (10_000.0 * (0.2 + 0.05 * 5.0) / 100.0)).abs() < 1e-9);
        assert!(crate::statuses::is_fortify_removable_status("Poison_Status"));

        // After unregister the id is inert: no tick, baseline 3 s decay, 0 DoT.
        unregister_status_for_test(id);
        assert_eq!(crate::statuses::status_tick_sec(id), None);
        assert_eq!(crate::statuses::status_decay_sec(id), 3.0);
        assert_eq!(crate::statuses::compute_simple_dot_damage(10_000.0, id, 5.0, 3.0), 0.0);
    }

    #[test]
    fn user_status_modifier_seams_compose_in_combat() {
        // Phase 6 / G6 step 2 (6b): the spec's stat-modifier knobs reach the
        // combat.rs seams — incoming/outgoing damage %, regen mult, bite cd.
        let id = "user.tests.modifiers";
        let json = serde_json::to_string(&serde_json::json!({
            "id": id,
            "display_name": "Modifiers",
            "incoming_damage_mult": 1.5,
            "outgoing_damage_mult": 0.5,
            "bite_cooldown_mult": 0.8,
            "regen_mod_pct": -50.0,
        }))
        .unwrap();
        register_status_for_test(&json).expect("register");

        let mut map = BTreeMap::new();
        map.insert(
            id.to_string(),
            crate::SimpleStatusInstance {
                stacks: 1.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 0.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );

        // (mult - 1)·100 folds into the additive-percent accumulators.
        assert!((crate::combat::incoming_damage_pct_from_statuses(&map) - 50.0).abs() < 1e-9);
        assert!((crate::combat::outgoing_damage_pct_from_statuses(&map) - (-50.0)).abs() < 1e-9);
        // regen modifier composes multiplicatively: 1 + (-50)/100 = 0.5.
        assert!((crate::combat::hp_regen_multiplier_from_statuses(&map) - 0.5).abs() < 1e-9);

        let stats: crate::SimpleCombatantStats = serde_json::from_str(
            r#"{"health":10000.0,"weight":100.0,"damage":100.0,"biteCooldown":2.0}"#,
        )
        .expect("stats");
        let cd = crate::combat::current_simple_bite_cooldown_with_statuses(&stats, stats.health, &map);
        assert!((cd - 2.0 * 0.8).abs() < 1e-9, "expected 1.6, got {cd}");

        // Regression: empty / built-in maps are untouched by the user branch.
        let empty: BTreeMap<String, crate::SimpleStatusInstance> = BTreeMap::new();
        assert_eq!(crate::combat::incoming_damage_pct_from_statuses(&empty), 0.0);
        assert_eq!(crate::combat::hp_regen_multiplier_from_statuses(&empty), 1.0);
        let mut storm = BTreeMap::new();
        storm.insert(
            "Storming_Status".to_string(),
            crate::SimpleStatusInstance {
                stacks: 1.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 0.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        assert!((crate::combat::incoming_damage_pct_from_statuses(&storm) - 10.0).abs() < 1e-9);

        unregister_status_for_test(id);
    }

    #[test]
    fn fortify_cleanse_skips_permanent_weather_instances() {
        // User-arbitrated 2026-05-30: weather cataclysms (Acid Rain / Heat Wave /
        // Hypothermia) are seeded as permanent (no_decay) environment and must
        // NOT be removed by Fortify / cleanse — only ability-applied (decaying)
        // instances are. The TYPE-level predicate stays negative so the
        // Fortify-immunity gate still blocks incoming negatives.
        use crate::statuses::{is_fortify_cleansable_instance, is_fortify_removable_status};
        let decaying = crate::SimpleStatusInstance {
            stacks: 5.0,
            next_tick_at: None,
            next_decay_at: None,
            remaining_sec: 0.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        };
        let permanent = crate::SimpleStatusInstance { no_decay: true, ..decaying.clone() };

        // Normal negative ailments are cleansable.
        assert!(is_fortify_cleansable_instance("Bleed_Status", &decaying));
        assert!(is_fortify_cleansable_instance("Malices_Mark", &decaying));
        // A permanent weather instance is NOT cleansed — but its TYPE is still
        // negative (immunity gate unchanged).
        assert!(!is_fortify_cleansable_instance("Acid_Rain_Status", &permanent));
        assert!(is_fortify_removable_status("Acid_Rain_Status"));
        // Ability-applied (decaying) Heat Wave / Hypothermia stay cleansable.
        assert!(is_fortify_cleansable_instance("Heat_Wave_Status", &decaying));
        assert!(is_fortify_cleansable_instance("Hypothermia_Status", &decaying));
    }

    #[test]
    fn register_rejects_invalid_ability_id() {
        let bad = serde_json::to_string(&serde_json::json!({
            "id": "builtin.cheat",
            "display_name": "Cheat",
            "utility": { "kind": "const", "value": 1 },
            "is_available": { "kind": "const", "value": 1 },
            "on_fire": { "name": "x", "effects": [
                { "kind": "deal_direct_damage", "target": "opponent", "amount": 1 }
            ] }
        }))
        .unwrap();
        let err = register_ability_for_test(&bad).unwrap_err();
        assert!(err.contains("user."), "error should mention namespace: {err}");
    }

    #[test]
    fn register_rejects_malformed_json() {
        let err = register_ability_for_test("{ this is not valid json").unwrap_err();
        assert!(err.contains("invalid JSON"), "error should mention JSON: {err}");
    }

    #[test]
    fn unregister_is_idempotent() {
        let id = "user.tests.unregister";
        register_ability_for_test(&sample_ability_json_with_id(id)).unwrap();
        assert!(debug_get_user_ability(id).is_some());
        user_ability_store().write().unwrap().remove(id);
        assert!(debug_get_user_ability(id).is_none());
        // Calling again on a missing id must not panic.
        user_ability_store().write().unwrap().remove(id);
        cleanup_ids(&[id], &[]);
    }

    #[test]
    fn registries_isolate_abilities_and_timings() {
        let ability_id = "user.tests.isolation_ability";
        let timing_id = "user.tests.isolation_timing";
        register_ability_for_test(&sample_ability_json_with_id(ability_id)).unwrap();
        register_timing_for_test(&sample_timing_json_with_id(timing_id)).unwrap();
        assert!(debug_get_user_ability(ability_id).is_some());
        assert!(debug_get_user_timing(timing_id).is_some());
        assert!(debug_get_user_timing(ability_id).is_none());
        assert!(debug_get_user_ability(timing_id).is_none());
        cleanup_ids(&[ability_id], &[timing_id]);
    }
}
