/**
 * @param {any} summary
 * @returns {any}
 */
export function aggregate_best_builds_matchup_summary_js(summary) {
    const ret = wasm.aggregate_best_builds_matchup_summary_js(summary);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

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
export function init_panic_hook() {
    wasm.init_panic_hook();
}

/**
 * Read-only snapshot of every registered user ability id +
 * display name. Used by the UI to confirm the engine and the
 * localStorage view agree on the registered set after a page load.
 * @returns {any}
 */
export function list_user_abilities_js() {
    const ret = wasm.list_user_abilities_js();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @returns {any}
 */
export function list_user_statuses_js() {
    const ret = wasm.list_user_statuses_js();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @returns {any}
 */
export function list_user_timings_js() {
    const ret = wasm.list_user_timings_js();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Parse + validate + store a user ability spec. Returns
 * `{ id, display_name }` on success; rejects with a string error
 * on JSON parse failure or validation failure (id namespace,
 * missing fields, etc.).
 * @param {string} spec_json
 * @returns {any}
 */
export function register_user_ability_js(spec_json) {
    const ptr0 = passStringToWasm0(spec_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.register_user_ability_js(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Parse + validate + store a user status spec. Same shape
 * as `register_user_ability_js`.
 * @param {string} spec_json
 * @returns {any}
 */
export function register_user_status_js(spec_json) {
    const ptr0 = passStringToWasm0(spec_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.register_user_status_js(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Parse + validate + store a user timing spec. Same shape as
 * `register_user_ability_js`.
 * @param {string} spec_json
 * @returns {any}
 */
export function register_user_timing_js(spec_json) {
    const ptr0 = passStringToWasm0(spec_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.register_user_timing_js(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @returns {string}
 */
export function rust_matchup_contract_version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.rust_matchup_contract_version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_apply_hp_js(id, payload) {
    const ret = wasm.sandbox_apply_hp_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_apply_status_js(id, payload) {
    const ret = wasm.sandbox_apply_status_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_clear_overrides_js(id, payload) {
    const ret = wasm.sandbox_clear_overrides_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_create_js(payload) {
    const ret = wasm.sandbox_create_js(payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @returns {any}
 */
export function sandbox_destroy_js(id) {
    const ret = wasm.sandbox_destroy_js(id);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_force_ability_js(id, payload) {
    const ret = wasm.sandbox_force_ability_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_force_bite_js(id, payload) {
    const ret = wasm.sandbox_force_bite_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_force_breath_js(id, payload) {
    const ret = wasm.sandbox_force_breath_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * List the abilities/effects the Sandbox UI can toggle via the
 * Override Type → Ability/Effect dropdown. Returned as a JS array
 * of canonical name strings; the UI populates its dropdown from
 * this list so adding a new entry in
 * `composable::sandbox::OVERRIDABLE_ABILITY_FLAGS` automatically
 * appears in the UI without any TS-side change.
 * @returns {any}
 */
export function sandbox_overridable_abilities_js() {
    const ret = wasm.sandbox_overridable_abilities_js();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * List the value-bearing abilities the Sandbox can override, with
 * their value kind (number vs string). The UI uses this to render
 * the right input element per ability - number input vs. dropdown
 * sourced from `getAbilityValueOptions`. Returned as
 * `[{ name, kind }]` JSON; `kind` is `"number" | "string"`.
 * @returns {any}
 */
export function sandbox_overridable_ability_values_js() {
    const ret = wasm.sandbox_overridable_ability_values_js();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * List the stat-field passive abilities the Sandbox can override,
 * with their value kind (`number` or `bool`). UI uses this to pick
 * between a number input vs. a plain enable toggle for the passive.
 * @returns {any}
 */
export function sandbox_overridable_passives_js() {
    const ret = wasm.sandbox_overridable_passives_js();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_ability_js(id, payload) {
    const ret = wasm.sandbox_override_ability_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_ability_number_js(id, payload) {
    const ret = wasm.sandbox_override_ability_number_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_ability_string_js(id, payload) {
    const ret = wasm.sandbox_override_ability_string_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_breath_js(id, payload) {
    const ret = wasm.sandbox_override_breath_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_defensive_status_js(id, payload) {
    const ret = wasm.sandbox_override_defensive_status_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_offensive_status_js(id, payload) {
    const ret = wasm.sandbox_override_offensive_status_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_passive_bool_js(id, payload) {
    const ret = wasm.sandbox_override_passive_bool_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_passive_number_js(id, payload) {
    const ret = wasm.sandbox_override_passive_number_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_resist_js(id, payload) {
    const ret = wasm.sandbox_override_resist_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {any} payload
 * @returns {any}
 */
export function sandbox_override_stat_js(id, payload) {
    const ret = wasm.sandbox_override_stat_js(id, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @returns {any}
 */
export function sandbox_step_js(id) {
    const ret = wasm.sandbox_step_js(id);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @param {number} target_time
 * @returns {any}
 */
export function sandbox_step_to_time_js(id, target_time) {
    const ret = wasm.sandbox_step_to_time_js(id, target_time);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {bigint} id
 * @returns {any}
 */
export function sandbox_view_js(id) {
    const ret = wasm.sandbox_view_js(id);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} attacker
 * @param {any} defender
 * @param {any} attacker_breath
 * @param {any} defender_breath
 * @param {any} ability_policy
 * @param {any} ability_config
 * @param {number} max_time_sec
 * @param {boolean | null} [record_trace]
 * @returns {any}
 */
export function simulate_composable_matchup_js(attacker, defender, attacker_breath, defender_breath, ability_policy, ability_config, max_time_sec, record_trace) {
    const ret = wasm.simulate_composable_matchup_js(attacker, defender, attacker_breath, defender_breath, ability_policy, ability_config, max_time_sec, isLikeNone(record_trace) ? 0xFFFFFF : record_trace ? 1 : 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `simulate_composable_matchup_with_bite_variant_script_js` is the WASM
 * bridge for the bite-variant benchmark and engine-replay inner replay.
 * Script entries are `(time_sec, "primary" | "secondary")`. The override
 * returns the LAST entry with `time ≤ now` (primary for any time before
 * the first entry). Falls back to primary on creatures with `damage2
 * <= 0` regardless of script.
 * @param {any} attacker
 * @param {any} defender
 * @param {any} attacker_breath
 * @param {any} defender_breath
 * @param {any} ability_policy
 * @param {any} ability_config
 * @param {number} max_time_sec
 * @param {any} bite_variant_script
 * @param {boolean} self_is_attacker
 * @returns {any}
 */
export function simulate_composable_matchup_with_bite_variant_script_js(attacker, defender, attacker_breath, defender_breath, ability_policy, ability_config, max_time_sec, bite_variant_script, self_is_attacker) {
    const ret = wasm.simulate_composable_matchup_with_bite_variant_script_js(attacker, defender, attacker_breath, defender_breath, ability_policy, ability_config, max_time_sec, bite_variant_script, self_is_attacker);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

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
 * @param {any} attacker
 * @param {any} defender
 * @param {any} attacker_breath
 * @param {any} defender_breath
 * @param {any} ability_policy
 * @param {any} ability_config
 * @param {number} max_time_sec
 * @param {any} posture_script
 * @param {boolean} self_is_attacker
 * @returns {any}
 */
export function simulate_composable_matchup_with_posture_script_js(attacker, defender, attacker_breath, defender_breath, ability_policy, ability_config, max_time_sec, posture_script, self_is_attacker) {
    const ret = wasm.simulate_composable_matchup_with_posture_script_js(attacker, defender, attacker_breath, defender_breath, ability_policy, ability_config, max_time_sec, posture_script, self_is_attacker);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Remove a previously-registered user ability. Idempotent - silently
 * no-ops on unknown ids so the UI can call this defensively.
 * @param {string} id
 * @returns {any}
 */
export function unregister_user_ability_js(id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.unregister_user_ability_js(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {string} id
 * @returns {any}
 */
export function unregister_user_status_js(id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.unregister_user_status_js(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {string} id
 * @returns {any}
 */
export function unregister_user_timing_js(id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.unregister_user_timing_js(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
export function __wbg_Error_83742b46f01ce22d(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return ret;
}
export function __wbg_Number_a5a435bd7bbec835(arg0) {
    const ret = Number(arg0);
    return ret;
}
export function __wbg_String_8564e559799eccda(arg0, arg1) {
    const ret = String(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_bigint_get_as_i64_447a76b5c6ef7bda(arg0, arg1) {
    const v = arg1;
    const ret = typeof(v) === 'bigint' ? v : undefined;
    getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
}
export function __wbg___wbindgen_boolean_get_c0f3f60bac5a78d1(arg0) {
    const v = arg0;
    const ret = typeof(v) === 'boolean' ? v : undefined;
    return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
}
export function __wbg___wbindgen_debug_string_5398f5bb970e0daa(arg0, arg1) {
    const ret = debugString(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_in_41dbb8413020e076(arg0, arg1) {
    const ret = arg0 in arg1;
    return ret;
}
export function __wbg___wbindgen_is_bigint_e2141d4f045b7eda(arg0) {
    const ret = typeof(arg0) === 'bigint';
    return ret;
}
export function __wbg___wbindgen_is_function_3c846841762788c1(arg0) {
    const ret = typeof(arg0) === 'function';
    return ret;
}
export function __wbg___wbindgen_is_object_781bc9f159099513(arg0) {
    const val = arg0;
    const ret = typeof(val) === 'object' && val !== null;
    return ret;
}
export function __wbg___wbindgen_is_string_7ef6b97b02428fae(arg0) {
    const ret = typeof(arg0) === 'string';
    return ret;
}
export function __wbg___wbindgen_is_undefined_52709e72fb9f179c(arg0) {
    const ret = arg0 === undefined;
    return ret;
}
export function __wbg___wbindgen_jsval_eq_ee31bfad3e536463(arg0, arg1) {
    const ret = arg0 === arg1;
    return ret;
}
export function __wbg___wbindgen_jsval_loose_eq_5bcc3bed3c69e72b(arg0, arg1) {
    const ret = arg0 == arg1;
    return ret;
}
export function __wbg___wbindgen_number_get_34bb9d9dcfa21373(arg0, arg1) {
    const obj = arg1;
    const ret = typeof(obj) === 'number' ? obj : undefined;
    getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
}
export function __wbg___wbindgen_string_get_395e606bd0ee4427(arg0, arg1) {
    const obj = arg1;
    const ret = typeof(obj) === 'string' ? obj : undefined;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_throw_6ddd609b62940d55(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbg_call_e133b57c9155d22c() { return handleError(function (arg0, arg1) {
    const ret = arg0.call(arg1);
    return ret;
}, arguments); }
export function __wbg_done_08ce71ee07e3bd17(arg0) {
    const ret = arg0.done;
    return ret;
}
export function __wbg_entries_e8a20ff8c9757101(arg0) {
    const ret = Object.entries(arg0);
    return ret;
}
export function __wbg_error_a6fa202b58aa1cd3(arg0, arg1) {
    let deferred0_0;
    let deferred0_1;
    try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.error(getStringFromWasm0(arg0, arg1));
    } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
    }
}
export function __wbg_get_326e41e095fb2575() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_get_a8ee5c45dabc1b3b(arg0, arg1) {
    const ret = arg0[arg1 >>> 0];
    return ret;
}
export function __wbg_get_unchecked_329cfe50afab7352(arg0, arg1) {
    const ret = arg0[arg1 >>> 0];
    return ret;
}
export function __wbg_get_with_ref_key_6412cf3094599694(arg0, arg1) {
    const ret = arg0[arg1];
    return ret;
}
export function __wbg_instanceof_ArrayBuffer_101e2bf31071a9f6(arg0) {
    let result;
    try {
        result = arg0 instanceof ArrayBuffer;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_Map_f194b366846aca0c(arg0) {
    let result;
    try {
        result = arg0 instanceof Map;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_Uint8Array_740438561a5b956d(arg0) {
    let result;
    try {
        result = arg0 instanceof Uint8Array;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_isArray_33b91feb269ff46e(arg0) {
    const ret = Array.isArray(arg0);
    return ret;
}
export function __wbg_isSafeInteger_ecd6a7f9c3e053cd(arg0) {
    const ret = Number.isSafeInteger(arg0);
    return ret;
}
export function __wbg_iterator_d8f549ec8fb061b1() {
    const ret = Symbol.iterator;
    return ret;
}
export function __wbg_length_b3416cf66a5452c8(arg0) {
    const ret = arg0.length;
    return ret;
}
export function __wbg_length_ea16607d7b61445b(arg0) {
    const ret = arg0.length;
    return ret;
}
export function __wbg_new_227d7c05414eb861() {
    const ret = new Error();
    return ret;
}
export function __wbg_new_49d5571bd3f0c4d4() {
    const ret = new Map();
    return ret;
}
export function __wbg_new_5f486cdf45a04d78(arg0) {
    const ret = new Uint8Array(arg0);
    return ret;
}
export function __wbg_new_a70fbab9066b301f() {
    const ret = new Array();
    return ret;
}
export function __wbg_new_ab79df5bd7c26067() {
    const ret = new Object();
    return ret;
}
export function __wbg_next_11b99ee6237339e3() { return handleError(function (arg0) {
    const ret = arg0.next();
    return ret;
}, arguments); }
export function __wbg_next_e01a967809d1aa68(arg0) {
    const ret = arg0.next;
    return ret;
}
export function __wbg_prototypesetcall_d62e5099504357e6(arg0, arg1, arg2) {
    Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
}
export function __wbg_set_282384002438957f(arg0, arg1, arg2) {
    arg0[arg1 >>> 0] = arg2;
}
export function __wbg_set_6be42768c690e380(arg0, arg1, arg2) {
    arg0[arg1] = arg2;
}
export function __wbg_set_bf7251625df30a02(arg0, arg1, arg2) {
    const ret = arg0.set(arg1, arg2);
    return ret;
}
export function __wbg_stack_3b0d974bbf31e44f(arg0, arg1) {
    const ret = arg1.stack;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_value_21fc78aab0322612(arg0) {
    const ret = arg0.value;
    return ret;
}
export function __wbindgen_cast_0000000000000001(arg0) {
    // Cast intrinsic for `F64 -> Externref`.
    const ret = arg0;
    return ret;
}
export function __wbindgen_cast_0000000000000002(arg0) {
    // Cast intrinsic for `I64 -> Externref`.
    const ret = arg0;
    return ret;
}
export function __wbindgen_cast_0000000000000003(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
}
export function __wbindgen_cast_0000000000000004(arg0) {
    // Cast intrinsic for `U64 -> Externref`.
    const ret = BigInt.asUintN(64, arg0);
    return ret;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}
function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
