// Sandbox-runtime bridge.
//
// Thin TS wrapper over the `sandbox_*_js` WASM exports created in
// `wasm-engine/src/wasm_api.rs`. The Rust runtime lives in a registry on
// the WASM side; we hold a numeric `simId` per open sandbox session and
// drive it through these helpers.
//
// Each mutating call returns the fresh `SandboxView` so the UI never has
// to call a separate `view` after every action. `forceAbility` is the one
// exception — it returns `{ recognised, view }` so the UI can warn when
// the engine doesn't know the requested ability name.
//
// Feature-detect against the WASM module so the page can degrade
// gracefully when running against an older bundle that predates the
// sandbox exports.

import { loadRustMatchupBridge, stripNullsForWasm } from "../optimizer/rustMatchupLoader";
import type {
  RustComposableAbilityConfig,
  RustSimpleBreathProfile,
  RustSimpleCombatantStats,
  RustAbilityTimingMode,
} from "../optimizer/rustMatchupBridge";

export type SandboxSide = "A" | "B";

export type SandboxStatusView = {
  id: string;
  stacks: number;
  remainingSec: number;
  nextTickAt: number | null;
  nextDecayAt: number | null;
};

export type SandboxAbilityView = {
  name: string;
  actionLabel: string;
  ready: boolean;
  cooldownLeft: number;
};

export type SandboxSideView = {
  name: string;
  maxHp: number;
  hp: number;
  hpPct: number;
  breathCapacityLeft: number;
  breathCapacityMax: number;
  breathCapacityPct: number;
  nextHitAt: number;
  nextBreathAt: number | null;
  biteReady: boolean;
  breathReady: boolean;
  biteCooldownLeft: number;
  breathCooldownLeft: number | null;
  statuses: SandboxStatusView[];
  abilities: SandboxAbilityView[];
  deathTime: number | null;
};

export type SandboxLogEntryView = {
  time: number;
  side: string;
  eventType: string;
  description: string;
};

export type SandboxView = {
  time: number;
  halted: boolean;
  sideA: SandboxSideView;
  sideB: SandboxSideView;
  log: SandboxLogEntryView[];
};

export type SandboxAutomationMode = "manual" | "semiAuto";

export type SandboxCreatePayload = {
  attacker: RustSimpleCombatantStats;
  defender: RustSimpleCombatantStats;
  attackerBreath?: RustSimpleBreathProfile | null;
  defenderBreath?: RustSimpleBreathProfile | null;
  abilityPolicy: RustAbilityTimingMode;
  config: RustComposableAbilityConfig;
  maxTimeSec: number;
  automationMode: SandboxAutomationMode;
  recordTrace?: boolean;
};

export type SandboxOverrideField =
  | "health"
  | "damage"
  | "bite_cooldown"
  | "weight"
  | "health_regen";

type RustSandboxModule = {
  sandbox_create_js: (payload: unknown) => unknown;
  sandbox_destroy_js: (id: bigint) => unknown;
  sandbox_view_js: (id: bigint) => unknown;
  sandbox_step_js: (id: bigint) => unknown;
  sandbox_step_to_time_js: (id: bigint, targetTime: number) => unknown;
  sandbox_apply_hp_js: (id: bigint, payload: unknown) => unknown;
  sandbox_apply_status_js: (id: bigint, payload: unknown) => unknown;
  sandbox_force_bite_js: (id: bigint, payload: unknown) => unknown;
  sandbox_force_breath_js: (id: bigint, payload: unknown) => unknown;
  sandbox_force_ability_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_stat_js: (id: bigint, payload: unknown) => unknown;
  sandbox_clear_overrides_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_ability_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_ability_number_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_ability_string_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_passive_bool_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_passive_number_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_breath_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_resist_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_offensive_status_js: (id: bigint, payload: unknown) => unknown;
  sandbox_override_defensive_status_js: (id: bigint, payload: unknown) => unknown;
  sandbox_overridable_abilities_js: () => unknown;
  sandbox_overridable_ability_values_js: () => unknown;
  sandbox_overridable_passives_js: () => unknown;
};

let cachedModule: RustSandboxModule | null = null;
let supported: boolean | null = null;

// serde_wasm_bindgen returns serde_json::Map / BTreeMap as a JS `Map`,
// not a plain object. The Sandbox UI expects property access
// (`view.sideA.hp`, etc.), so we recursively rebuild Map → Object on
// the way back. Same pattern as `unwrapJsValue` in customAbilityBridge.ts.
function unwrapJsValue<T>(value: unknown): T {
  return convertMaps(value) as T;
}

function convertMaps(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      obj[String(k)] = convertMaps(v);
    }
    return obj;
  }
  if (Array.isArray(value)) {
    return value.map(convertMaps);
  }
  if (value && typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[k] = convertMaps(v);
    }
    return obj;
  }
  return value;
}

async function loadSandboxModule(): Promise<RustSandboxModule | null> {
  if (cachedModule) return cachedModule;
  if (supported === false) return null;
  await loadRustMatchupBridge();
  const mod = await import("../rust-pkg/cos_calc_wasm_engine.js");
  const m = mod as unknown as Partial<RustSandboxModule>;
  if (
    typeof m.sandbox_create_js !== "function" ||
    typeof m.sandbox_step_js !== "function" ||
    typeof m.sandbox_view_js !== "function" ||
    typeof m.sandbox_destroy_js !== "function" ||
    typeof m.sandbox_apply_hp_js !== "function" ||
    typeof m.sandbox_apply_status_js !== "function" ||
    typeof m.sandbox_force_bite_js !== "function" ||
    typeof m.sandbox_force_breath_js !== "function" ||
    typeof m.sandbox_force_ability_js !== "function" ||
    typeof m.sandbox_override_stat_js !== "function" ||
    typeof m.sandbox_clear_overrides_js !== "function" ||
    typeof m.sandbox_step_to_time_js !== "function" ||
    typeof m.sandbox_override_ability_js !== "function" ||
    typeof m.sandbox_override_ability_number_js !== "function" ||
    typeof m.sandbox_override_ability_string_js !== "function" ||
    typeof m.sandbox_override_passive_bool_js !== "function" ||
    typeof m.sandbox_override_passive_number_js !== "function" ||
    typeof m.sandbox_override_breath_js !== "function" ||
    typeof m.sandbox_override_resist_js !== "function" ||
    typeof m.sandbox_override_offensive_status_js !== "function" ||
    typeof m.sandbox_override_defensive_status_js !== "function" ||
    typeof m.sandbox_overridable_abilities_js !== "function" ||
    typeof m.sandbox_overridable_ability_values_js !== "function" ||
    typeof m.sandbox_overridable_passives_js !== "function"
  ) {
    supported = false;
    return null;
  }
  supported = true;
  cachedModule = m as RustSandboxModule;
  return cachedModule;
}

/** Returns `true` if the bundled WASM module exposes the sandbox surface.
 * UI code uses this to decide whether to render the Sandbox tab. */
export async function isSandboxBridgeAvailable(): Promise<boolean> {
  return (await loadSandboxModule()) !== null;
}

type SandboxCreateResult = { id: bigint; view: SandboxView };

/** Build a fresh sandbox runtime. Returns the runtime id (use it for
 * subsequent calls) and the initial view at `time = 0`. */
export async function createSandbox(payload: SandboxCreatePayload): Promise<SandboxCreateResult> {
  const mod = await requireSandbox();
  // serde_wasm_bindgen treats `null` on non-Option fields as a hard error
  // ("Reflect.get called on non-object"). Strip both null and undefined so
  // every optional/default field reads as "absent" — same pattern as the
  // Compare bridge.
  const clean = stripNullsForWasm(payload);
  const raw = unwrapJsValue<{ id: bigint | number; view: SandboxView }>(mod.sandbox_create_js(clean));
  return { id: BigInt(raw.id as number | bigint), view: raw.view };
}

export async function destroySandbox(id: bigint): Promise<void> {
  const mod = await requireSandbox();
  mod.sandbox_destroy_js(id);
}

export async function sandboxView(id: bigint): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_view_js(id));
}

export async function sandboxStep(id: bigint): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_step_js(id));
}

export async function sandboxStepToTime(id: bigint, targetTime: number): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_step_to_time_js(id, targetTime));
}

export async function sandboxApplyHp(id: bigint, side: SandboxSide, hp: number): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_apply_hp_js(id, { side, hp }));
}

export async function sandboxApplyStatus(
  id: bigint,
  side: SandboxSide,
  statusId: string,
  stacks: number,
): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_apply_status_js(id, { side, statusId, stacks }));
}

export async function sandboxForceBite(id: bigint, side: SandboxSide): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_force_bite_js(id, { side }));
}

export async function sandboxForceBreath(id: bigint, side: SandboxSide): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_force_breath_js(id, { side }));
}

export async function sandboxForceAbility(
  id: bigint,
  side: SandboxSide,
  abilityName: string,
): Promise<{ recognised: boolean; view: SandboxView }> {
  const mod = await requireSandbox();
  return unwrapJsValue<{ recognised: boolean; view: SandboxView }>(
    mod.sandbox_force_ability_js(id, { side, abilityName }),
  );
}

export async function sandboxOverrideStat(
  id: bigint,
  side: SandboxSide,
  field: SandboxOverrideField,
  value: number,
): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_override_stat_js(id, { side, field, value }));
}

export async function sandboxClearOverrides(id: bigint, side: SandboxSide): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_clear_overrides_js(id, { side }));
}

export async function sandboxOverrideAbility(
  id: bigint,
  side: SandboxSide,
  abilityName: string,
  enabled: boolean,
): Promise<{ recognised: boolean; view: SandboxView }> {
  const mod = await requireSandbox();
  return unwrapJsValue<{ recognised: boolean; view: SandboxView }>(
    mod.sandbox_override_ability_js(id, { side, abilityName, enabled }),
  );
}

/// Set a value-bearing ability's numeric value (Cursed Sigil stacks,
/// Life Leech %, Spite damage, Shadow Barrage count, Healing Step %,
/// Trail HP%). Engine treats `value > 0` as the enabled state — pass
/// 0 to disable.
export async function sandboxOverrideAbilityNumber(
  id: bigint,
  side: SandboxSide,
  abilityName: string,
  value: number,
): Promise<{ recognised: boolean; view: SandboxView }> {
  const mod = await requireSandbox();
  return unwrapJsValue<{ recognised: boolean; view: SandboxView }>(
    mod.sandbox_override_ability_number_js(id, { side, abilityName, value }),
  );
}

/// Set a value-bearing ability's string payload (Aura subtype, Yolk
/// Bomb payload, Lich Mark payload). Pass `null` to clear. For
/// abilities with a separate bool gate (Yolk Bomb, Lich Mark) the
/// gate is set via `sandboxOverrideAbility`; this only sets payload.
export async function sandboxOverrideAbilityString(
  id: bigint,
  side: SandboxSide,
  abilityName: string,
  value: string | null,
): Promise<{ recognised: boolean; view: SandboxView }> {
  const mod = await requireSandbox();
  return unwrapJsValue<{ recognised: boolean; view: SandboxView }>(
    mod.sandbox_override_ability_string_js(id, { side, abilityName, value }),
  );
}

/// List of ability/effect names the Sandbox can toggle. Sourced from
/// the engine's `OVERRIDABLE_ABILITY_FLAGS` table so adding a new
/// ability there auto-syncs to the UI dropdown — no per-release TS
/// edit required. Returns an empty array if the WASM bridge isn't
/// loaded (defensive fallback; the UI fixture for unsupported
/// environments shows "No abilities available").
export async function sandboxListOverridableAbilities(): Promise<string[]> {
  const mod = await loadSandboxModule();
  if (!mod) return [];
  return unwrapJsValue<string[]>(mod.sandbox_overridable_abilities_js());
}

/// Value-bearing ability specs: name + value kind. UI uses the kind to
/// decide between a number input and a string dropdown (sourced from
/// `getAbilityValueOptions`). Sourced from the engine's
/// `OVERRIDABLE_ABILITY_VALUES` table — adding a new value-bearing
/// ability there auto-surfaces it in the UI.
export type SandboxAbilityValueKind = "number" | "string";
export type SandboxAbilityValueSpec = {
  name: string;
  kind: SandboxAbilityValueKind;
};

export async function sandboxListOverridableAbilityValues(): Promise<SandboxAbilityValueSpec[]> {
  const mod = await loadSandboxModule();
  if (!mod) return [];
  return unwrapJsValue<SandboxAbilityValueSpec[]>(mod.sandbox_overridable_ability_values_js());
}

/// Passive abilities the Sandbox can override (Bool toggles for spec-
/// standard passives like Berserk / Quick Recovery / Warden's
/// Resistance, Number for per-creature exceptions like First Strike
/// damage % and Unbreakable cap %). UI uses the kind to render
/// either a number input or a plain enable toggle. Sourced from
/// `OVERRIDABLE_PASSIVE_ABILITIES` in the Rust engine.
export type SandboxPassiveKind = "number" | "bool";
export type SandboxPassiveSpec = {
  name: string;
  kind: SandboxPassiveKind;
};

export async function sandboxListOverridablePassives(): Promise<SandboxPassiveSpec[]> {
  const mod = await loadSandboxModule();
  if (!mod) return [];
  return unwrapJsValue<SandboxPassiveSpec[]>(mod.sandbox_overridable_passives_js());
}

export async function sandboxOverridePassiveBool(
  id: bigint,
  side: SandboxSide,
  passiveName: string,
  enabled: boolean,
): Promise<{ recognised: boolean; view: SandboxView }> {
  const mod = await requireSandbox();
  return unwrapJsValue<{ recognised: boolean; view: SandboxView }>(
    mod.sandbox_override_passive_bool_js(id, { side, passiveName, enabled }),
  );
}

export async function sandboxOverridePassiveNumber(
  id: bigint,
  side: SandboxSide,
  passiveName: string,
  value: number,
): Promise<{ recognised: boolean; view: SandboxView }> {
  const mod = await requireSandbox();
  return unwrapJsValue<{ recognised: boolean; view: SandboxView }>(
    mod.sandbox_override_passive_number_js(id, { side, passiveName, value }),
  );
}

/// Replace (or clear) the side's breath profile. The profile is built
/// in TS via `buildBreathProfileByName` from
/// `rustBestBuildsRuntime.ts` — same conversion the production
/// Compare path uses. Pass `null` to remove the side's breath
/// entirely.
export async function sandboxOverrideBreath(
  id: bigint,
  side: SandboxSide,
  profile: RustSimpleBreathProfile | null,
): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(
    mod.sandbox_override_breath_js(id, { side, profile: stripNullsForWasm(profile) }),
  );
}

export async function sandboxOverrideResist(
  id: bigint,
  side: SandboxSide,
  statusId: string,
  fraction: number,
): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(mod.sandbox_override_resist_js(id, { side, statusId, fraction }));
}

export async function sandboxOverrideOffensiveStatus(
  id: bigint,
  side: SandboxSide,
  statusId: string,
  stacks: number,
): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(
    mod.sandbox_override_offensive_status_js(id, { side, statusId, stacks }),
  );
}

export async function sandboxOverrideDefensiveStatus(
  id: bigint,
  side: SandboxSide,
  statusId: string,
  stacks: number,
): Promise<SandboxView> {
  const mod = await requireSandbox();
  return unwrapJsValue<SandboxView>(
    mod.sandbox_override_defensive_status_js(id, { side, statusId, stacks }),
  );
}

/** Filter set used by the "Next Any / Next Damage / Next Effects / Next
 * Ability" buttons in the Sandbox Controls panel. Mirrors the old TS
 * Sandbox's `SandboxEventFilter`. */
export type SandboxEventFilter = "any" | "damage" | "effects" | "ability";

const DAMAGE_LOG_TYPES = new Set(["bite", "dot", "breath"]);
const ABILITY_LOG_TYPES = new Set(["ability"]);
// Anything else (statusApply / statusDecay / regen / etc.) counts as
// "effects". Sandbox combat log uses lowercase type tags coming from
// `CombatLogEntry.entry_type`.

function logMatchesFilter(newEntries: SandboxLogEntryView[], filter: SandboxEventFilter): boolean {
  if (newEntries.length === 0) return false;
  if (filter === "any") return true;
  if (filter === "damage") return newEntries.some((e) => DAMAGE_LOG_TYPES.has(e.eventType));
  if (filter === "ability") return newEntries.some((e) => ABILITY_LOG_TYPES.has(e.eventType));
  // "effects"
  return newEntries.some(
    (e) => !DAMAGE_LOG_TYPES.has(e.eventType) && !ABILITY_LOG_TYPES.has(e.eventType),
  );
}

/** Step the sandbox forward until the requested event type fires (or
 * the sim halts, or the step budget runs out). Returns the resulting
 * view. */
export async function sandboxStepUntilEvent(
  id: bigint,
  filter: SandboxEventFilter,
  maxSteps = 2000,
): Promise<SandboxView> {
  const initial = await sandboxView(id);
  let prevLogLen = initial.log.length;
  let view = initial;
  for (let i = 0; i < maxSteps; i++) {
    view = await sandboxStep(id);
    if (view.halted) return view;
    const newEntries = view.log.slice(prevLogLen);
    if (logMatchesFilter(newEntries, filter)) return view;
    prevLogLen = view.log.length;
  }
  return view;
}

export type SandboxReadyKind = "bite" | "breath" | "ability";

/** Step the sandbox forward until the chosen side's bite / breath / next
 * ability is ready. Mirrors old TS Sandbox's `advanceSandboxToNextReady`
 * — computes the precise target time (next_hit_at / next_breath_at /
 * min(ability cooldownLeft)) and jumps via `stepToTime`, which uses the
 * tail-advance fallback when Manual mode's filtered scheduler has no
 * intermediate passive events. */
export async function sandboxStepUntilReady(
  id: bigint,
  side: SandboxSide,
  kind: SandboxReadyKind,
): Promise<SandboxView> {
  const view = await sandboxView(id);
  const s = side === "A" ? view.sideA : view.sideB;
  let target: number | null = null;
  if (kind === "bite") {
    if (s.biteReady) return view;
    target = s.nextHitAt;
  } else if (kind === "breath") {
    if (s.breathReady) return view;
    target = s.nextBreathAt;
  } else {
    // "ability": the side surfaces a per-ability `cooldownLeft` list;
    // jump to the smallest pending cooldown.
    const pending = s.abilities.filter((a) => !a.ready && a.cooldownLeft > 0);
    if (pending.length === 0) return view;
    const minLeft = pending.reduce((min, a) => Math.min(min, a.cooldownLeft), Number.POSITIVE_INFINITY);
    target = view.time + minLeft;
  }
  if (target == null || !Number.isFinite(target) || target <= view.time) {
    return view;
  }
  return sandboxStepToTime(id, target);
}

async function requireSandbox(): Promise<RustSandboxModule> {
  const mod = await loadSandboxModule();
  if (!mod) {
    throw new Error("Sandbox WASM bindings unavailable — rebuild the WASM module via `npm run rust:build`.");
  }
  return mod;
}
