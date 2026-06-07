/* tslint:disable */
/* eslint-disable */

export function aggregate_best_builds_matchup_summary_js(summary: any): any;

/**
 * Module-load hook (wasm-bindgen invokes this once when the WASM
 * binary is instantiated). Installs `console_error_panic_hook` so
 * any Rust panic is rendered as a readable JS console.error with the
 * real panic message, instead of the default JS `TypeError: encoded
 * data was not valid for encoding utf-8` that arrives when the
 * panic-payload pointer/length read back from WASM memory has been
 * invalidated by unwind. Without the hook, debugging engine
 * regressions in Compare requires reproducing them under cargo test.
 */
export function init_panic_hook(): void;

/**
 * Read-only snapshot of every registered user ability id +
 * display name. Used by the UI to confirm the engine and the
 * localStorage view agree on the registered set after a page load.
 */
export function list_user_abilities_js(): any;

export function list_user_statuses_js(): any;

export function list_user_timings_js(): any;

/**
 * Parse + validate + store a user ability spec. Returns
 * `{ id, display_name }` on success; rejects with a string error
 * on JSON parse failure or validation failure (id namespace,
 * missing fields, etc.).
 */
export function register_user_ability_js(spec_json: string): any;

/**
 * Parse + validate + store a user status spec. Same shape
 * as `register_user_ability_js`.
 */
export function register_user_status_js(spec_json: string): any;

/**
 * Parse + validate + store a user timing spec. Same shape as
 * `register_user_ability_js`.
 */
export function register_user_timing_js(spec_json: string): any;

export function rust_matchup_contract_version(): string;

export function sandbox_apply_hp_js(id: bigint, payload: any): any;

export function sandbox_apply_status_js(id: bigint, payload: any): any;

export function sandbox_clear_overrides_js(id: bigint, payload: any): any;

export function sandbox_create_js(payload: any): any;

export function sandbox_destroy_js(id: bigint): any;

export function sandbox_force_ability_js(id: bigint, payload: any): any;

export function sandbox_force_bite_js(id: bigint, payload: any): any;

export function sandbox_force_breath_js(id: bigint, payload: any): any;

/**
 * List the abilities/effects the Sandbox UI can toggle via the
 * Override Type → Ability/Effect dropdown. Returned as a JS array
 * of canonical name strings; the UI populates its dropdown from
 * this list so adding a new entry in
 * `composable::sandbox::OVERRIDABLE_ABILITY_FLAGS` automatically
 * appears in the UI without any TS-side change.
 */
export function sandbox_overridable_abilities_js(): any;

/**
 * List the value-bearing abilities the Sandbox can override, with
 * their value kind (number vs string). The UI uses this to render
 * the right input element per ability - number input vs. dropdown
 * sourced from `getAbilityValueOptions`. Returned as
 * `[{ name, kind }]` JSON; `kind` is `"number" | "string"`.
 */
export function sandbox_overridable_ability_values_js(): any;

/**
 * List the stat-field passive abilities the Sandbox can override,
 * with their value kind (`number` or `bool`). UI uses this to pick
 * between a number input vs. a plain enable toggle for the passive.
 */
export function sandbox_overridable_passives_js(): any;

export function sandbox_override_ability_js(id: bigint, payload: any): any;

export function sandbox_override_ability_number_js(id: bigint, payload: any): any;

export function sandbox_override_ability_string_js(id: bigint, payload: any): any;

export function sandbox_override_breath_js(id: bigint, payload: any): any;

export function sandbox_override_defensive_status_js(id: bigint, payload: any): any;

export function sandbox_override_offensive_status_js(id: bigint, payload: any): any;

export function sandbox_override_passive_bool_js(id: bigint, payload: any): any;

export function sandbox_override_passive_number_js(id: bigint, payload: any): any;

export function sandbox_override_resist_js(id: bigint, payload: any): any;

export function sandbox_override_stat_js(id: bigint, payload: any): any;

export function sandbox_step_js(id: bigint): any;

export function sandbox_step_to_time_js(id: bigint, target_time: number): any;

export function sandbox_view_js(id: bigint): any;

export function simulate_composable_matchup_js(attacker: any, defender: any, attacker_breath: any, defender_breath: any, ability_policy: any, ability_config: any, max_time_sec: number, record_trace?: boolean | null): any;

/**
 * `simulate_composable_matchup_with_bite_variant_script_js` is the WASM
 * bridge for the bite-variant benchmark and engine-replay inner replay.
 * Script entries are `(time_sec, "primary" | "secondary")`. The override
 * returns the LAST entry with `time ≤ now` (primary for any time before
 * the first entry). Falls back to primary on creatures with `damage2
 * <= 0` regardless of script.
 */
export function simulate_composable_matchup_with_bite_variant_script_js(attacker: any, defender: any, attacker_breath: any, defender_breath: any, ability_policy: any, ability_config: any, max_time_sec: number, bite_variant_script: any, self_is_attacker: boolean): any;

/**
 * Bridge variant of `simulate_composable_matchup_js` that overrides
 * the engine's posture decision on the indicated side with a
 * scripted timeline. Used by vitest benchmarks to evaluate arbitrary
 * posture trajectories under REAL Compare config (built via
 * `toRustComposableArgsFromCompare`) without duplicating that
 * wiring on the Rust side.
 *
 * `posture_script` is a JS-side array of `[time_sec, action_string]`
 * tuples. Action strings are camelCase variants of `PostureAction`:
 * `"stay" | "startSit" | "startLay" | "standUp"`. Each tuple fires
 * the action at the first engine iter past `time_sec`.
 */
export function simulate_composable_matchup_with_posture_script_js(attacker: any, defender: any, attacker_breath: any, defender_breath: any, ability_policy: any, ability_config: any, max_time_sec: number, posture_script: any, self_is_attacker: boolean): any;

/**
 * Remove a previously-registered user ability. Idempotent - silently
 * no-ops on unknown ids so the UI can call this defensively.
 */
export function unregister_user_ability_js(id: string): any;

export function unregister_user_status_js(id: string): any;

export function unregister_user_timing_js(id: string): any;
