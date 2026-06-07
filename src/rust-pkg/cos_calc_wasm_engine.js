/* @ts-self-types="./cos_calc_wasm_engine.d.ts" */

import * as wasm from "./cos_calc_wasm_engine_bg.wasm";
import { __wbg_set_wasm } from "./cos_calc_wasm_engine_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    aggregate_best_builds_matchup_summary_js, init_panic_hook, list_user_abilities_js, list_user_statuses_js, list_user_timings_js, register_user_ability_js, register_user_status_js, register_user_timing_js, rust_matchup_contract_version, sandbox_apply_hp_js, sandbox_apply_status_js, sandbox_clear_overrides_js, sandbox_create_js, sandbox_destroy_js, sandbox_force_ability_js, sandbox_force_bite_js, sandbox_force_breath_js, sandbox_overridable_abilities_js, sandbox_overridable_ability_values_js, sandbox_overridable_passives_js, sandbox_override_ability_js, sandbox_override_ability_number_js, sandbox_override_ability_string_js, sandbox_override_breath_js, sandbox_override_defensive_status_js, sandbox_override_offensive_status_js, sandbox_override_passive_bool_js, sandbox_override_passive_number_js, sandbox_override_resist_js, sandbox_override_stat_js, sandbox_step_js, sandbox_step_to_time_js, sandbox_view_js, simulate_composable_matchup_js, simulate_composable_matchup_with_bite_variant_script_js, simulate_composable_matchup_with_posture_script_js, unregister_user_ability_js, unregister_user_status_js, unregister_user_timing_js
} from "./cos_calc_wasm_engine_bg.js";
