/**
 * TypeScript wrapper around the WASM-side custom-ability /
 * custom-timing registration calls. Lives one layer above the raw
 * `getLoadedRustGeneratedModule` accessor so the storage layer
 * (`customAbilities.ts` / `customTimings.ts`) and any future
 * editor UI can call typed functions instead of poking at
 * `JsValue`.
 *
 * The functions all feature-detect: when the loaded WASM bundle
 * predates custom-ability support (no `register_user_*_js` exports), the
 * wrappers fall through with a `console.warn` and a soft "skipped"
 * result instead of throwing. That lets the UI persist specs to
 * localStorage and run TS-side validation today, then re-sync to
 * the engine after `npm run rust:build` refreshes the bundle.
 */

import {
  getLoadedRustGeneratedModule,
  loadRustMatchupBridge,
} from "../optimizer/rustMatchupLoader";
import type {
  EngineRegistryEntry,
  RegistrationResult,
  UserAbilitySpec,
  UserStatusSpec,
  UserTimingSpec,
} from "./customAbilityTypes";

export type BridgeOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "skipped"; reason: BridgeSkippedReason }
  | { status: "rejected"; error: string };

export type BridgeSkippedReason =
  | "wasm-not-loaded"
  | "wasm-bundle-stale"
  | "wasm-disabled";

async function getModule(): Promise<{
  module: ReturnType<typeof getLoadedRustGeneratedModule>;
  reason?: BridgeSkippedReason;
}> {
  await loadRustMatchupBridge();
  const mod = getLoadedRustGeneratedModule();
  if (!mod) {
    return { module: null, reason: "wasm-not-loaded" };
  }
  return { module: mod };
}

/** TS-side `TimingMode` is snake_case (`really_fast`, `semi_ideal`)
 * because that is what the user types in the DSL and what the
 * templates / validator emit. The Rust enum
 * `SimpleAbilityTimingMode` declares `#[serde(rename_all = "camelCase")]`,
 * so deserialization expects `reallyFast` / `semiIdeal`. The struct
 * field name `timing_mode_override` itself is fine (Rust keeps it
 * snake_case), but its VALUE has to be camelCase. Convert at the
 * bridge so the rest of the TS layer (DSL parser, templates, UI
 * dropdowns) keeps the user-friendly snake_case form. */
const TIMING_MODE_TS_TO_RUST: Record<string, string> = {
  really_fast: "reallyFast",
  fast: "fast",
  semi_ideal: "semiIdeal",
  ideal: "ideal",
  extreme: "extreme",
};

/** Recursively convert a TS-shaped UserAbilitySpec object into the
 * exact JSON shape the Rust serde contract expects. Two cases:
 *
 * 1. `timing_mode_override`: enum value is snake_case in TS but
 *    camelCase in Rust (see `TIMING_MODE_TS_TO_RUST`).
 * 2. `apply_status_to_target.status`: embeds `SimpleAppliedStatus`
 *    from `contracts.rs`, which has explicit
 *    `#[serde(rename = "statusId")]` / `"sourceAbility"`. Other
 *    EffectKind variants (ClearStatus, ConsumeStatusForDamage, …)
 *    keep `status_id` snake_case as direct fields, so we only
 *    rename when the parent key is `status` - i.e., when the value
 *    is a SimpleAppliedStatus payload, not a sibling field.
 *
 * **Schema-fragility note.** This walker assumes
 * `parentKey === "status"` uniquely identifies a SimpleAppliedStatus
 * payload across ALL future EffectKind variants. A new EffectKind
 * that reuses a `status` parent key for a different payload shape
 * would silently get its `status_id`/`source_ability` fields renamed
 * - wrong behaviour. The TS validator (`customAbilityValidate.ts`)
 * rejects unknown EffectKind variants, but the bridge here is the
 * second line of defence. Reviewer checklist when adding an
 * EffectKind:
 *   - Does the new variant have a `status` field?
 *   - If yes: is that field a SimpleAppliedStatus, or something else?
 *   - If something else: this walker needs a `kind`-aware branch
 *     before merging, OR the new variant must use a different
 *     parent-key name (recommended).
 * Tests in `customAbilityBridge.test.ts` lock the current behaviour;
 * extend them when an EffectKind with a non-SimpleAppliedStatus
 * `status` field lands. */
function specForRust(spec: UserAbilitySpec): unknown {
  return walkSpec(spec, undefined);
}

/** Test-only re-export. Used by `customAbilityBridge.test.ts` to
 * verify the snake-case → camelCase conversion table without
 * spinning up WASM. NOT for production use - call sites should go
 * through `registerUserAbility`. */
export const __test_specForRust = specForRust;
export const __test_convertMaps = convertMaps;

function walkSpec(value: unknown, parentKey: string | undefined): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => walkSpec(v, undefined));
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = walkSpec(v, k);
  }

  // SimpleAppliedStatus payload: only when the parent key was
  // `status`. Renames are silent - the Rust contract has no field
  // called `status_id` or `source_ability` on this type.
  if (parentKey === "status" && "status_id" in out) {
    if (out.status_id !== undefined && out.status_id !== null) {
      out.statusId = out.status_id;
    }
    delete out.status_id;
    if ("source_ability" in out) {
      const sa = out.source_ability;
      if (sa !== undefined && sa !== null) {
        out.sourceAbility = sa;
      }
      delete out.source_ability;
    }
  }

  // Top-level UserAbilitySpec field - convert its enum value.
  if (
    parentKey === undefined &&
    typeof out.timing_mode_override === "string"
  ) {
    const camel = TIMING_MODE_TS_TO_RUST[out.timing_mode_override];
    if (camel) out.timing_mode_override = camel;
  }

  return out;
}

function unwrapJsValue<T>(value: unknown): T {
  // serde_wasm_bindgen's default serializer maps `serde_json::Map`
  // (and `BTreeMap` / `HashMap`) to a JS `Map` rather than a plain
  // object. Callers expect property access (`reg.value.id`), so we
  // recursively rebuild any Map nodes into plain objects. Arrays
  // and primitives pass through unchanged.
  //
  // Recursion depth is bounded by the engine-side type shape - the
  // deepest nesting today is ~3 levels (RegistrationResult →
  // EngineRegistryEntry → spec.metadata). No stack-safety guard
  // here; if a future engine type adds unbounded nesting (e.g. a
  // recursive AST), revisit before that lands.
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

function stringifyError(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Register a parsed `UserAbilitySpec` with the engine's process-wide
 * store. The TS spec is `JSON.stringify`-d before being handed to
 * `register_user_ability_js`; the bundled JSON shape matches the
 * Rust serde contract. */
export async function registerUserAbility(
  spec: UserAbilitySpec,
): Promise<BridgeOutcome<RegistrationResult>> {
  const { module, reason } = await getModule();
  if (!module) return { status: "skipped", reason: reason ?? "wasm-not-loaded" };
  if (typeof module.register_user_ability_js !== "function") {
     
    console.warn(
      "[customAbilityBridge] register_user_ability_js missing from WASM bundle - run `npm run rust:build` to refresh.",
    );
    return { status: "skipped", reason: "wasm-bundle-stale" };
  }
  try {
    const raw = module.register_user_ability_js(
      JSON.stringify(specForRust(spec)),
    );
    return { status: "ok", value: unwrapJsValue<RegistrationResult>(raw) };
  } catch (err) {
    return { status: "rejected", error: stringifyError(err) };
  }
}

export async function unregisterUserAbility(
  id: string,
): Promise<BridgeOutcome<{ ok: true; id: string }>> {
  const { module, reason } = await getModule();
  if (!module) return { status: "skipped", reason: reason ?? "wasm-not-loaded" };
  if (typeof module.unregister_user_ability_js !== "function") {
    return { status: "skipped", reason: "wasm-bundle-stale" };
  }
  try {
    const raw = module.unregister_user_ability_js(id);
    return { status: "ok", value: unwrapJsValue(raw) };
  } catch (err) {
    return { status: "rejected", error: stringifyError(err) };
  }
}

export async function listUserAbilities(): Promise<
  BridgeOutcome<EngineRegistryEntry[]>
> {
  const { module, reason } = await getModule();
  if (!module) return { status: "skipped", reason: reason ?? "wasm-not-loaded" };
  if (typeof module.list_user_abilities_js !== "function") {
    return { status: "skipped", reason: "wasm-bundle-stale" };
  }
  try {
    const raw = module.list_user_abilities_js();
    return { status: "ok", value: unwrapJsValue<EngineRegistryEntry[]>(raw) };
  } catch (err) {
    return { status: "rejected", error: stringifyError(err) };
  }
}

export async function registerUserTiming(
  spec: UserTimingSpec,
): Promise<BridgeOutcome<RegistrationResult>> {
  const { module, reason } = await getModule();
  if (!module) return { status: "skipped", reason: reason ?? "wasm-not-loaded" };
  if (typeof module.register_user_timing_js !== "function") {
     
    console.warn(
      "[customAbilityBridge] register_user_timing_js missing from WASM bundle - run `npm run rust:build` to refresh.",
    );
    return { status: "skipped", reason: "wasm-bundle-stale" };
  }
  try {
    const raw = module.register_user_timing_js(JSON.stringify(spec));
    return { status: "ok", value: unwrapJsValue<RegistrationResult>(raw) };
  } catch (err) {
    return { status: "rejected", error: stringifyError(err) };
  }
}

export async function unregisterUserTiming(
  id: string,
): Promise<BridgeOutcome<{ ok: true; id: string }>> {
  const { module, reason } = await getModule();
  if (!module) return { status: "skipped", reason: reason ?? "wasm-not-loaded" };
  if (typeof module.unregister_user_timing_js !== "function") {
    return { status: "skipped", reason: "wasm-bundle-stale" };
  }
  try {
    const raw = module.unregister_user_timing_js(id);
    return { status: "ok", value: unwrapJsValue(raw) };
  } catch (err) {
    return { status: "rejected", error: stringifyError(err) };
  }
}

export async function listUserTimings(): Promise<
  BridgeOutcome<EngineRegistryEntry[]>
> {
  const { module, reason } = await getModule();
  if (!module) return { status: "skipped", reason: reason ?? "wasm-not-loaded" };
  if (typeof module.list_user_timings_js !== "function") {
    return { status: "skipped", reason: "wasm-bundle-stale" };
  }
  try {
    const raw = module.list_user_timings_js();
    return { status: "ok", value: unwrapJsValue<EngineRegistryEntry[]>(raw) };
  } catch (err) {
    return { status: "rejected", error: stringifyError(err) };
  }
}

// ── User-defined statuses ─────────────────────────────────
// The spec mirrors the Rust serde shape in snake_case, so it serializes
// directly (no `specForRust` transform - same as timings).

export async function registerUserStatus(
  spec: UserStatusSpec,
): Promise<BridgeOutcome<RegistrationResult>> {
  const { module, reason } = await getModule();
  if (!module) return { status: "skipped", reason: reason ?? "wasm-not-loaded" };
  if (typeof module.register_user_status_js !== "function") {

    console.warn(
      "[customAbilityBridge] register_user_status_js missing from WASM bundle - run `npm run rust:build` to refresh.",
    );
    return { status: "skipped", reason: "wasm-bundle-stale" };
  }
  try {
    const raw = module.register_user_status_js(JSON.stringify(spec));
    return { status: "ok", value: unwrapJsValue<RegistrationResult>(raw) };
  } catch (err) {
    return { status: "rejected", error: stringifyError(err) };
  }
}

export async function unregisterUserStatus(
  id: string,
): Promise<BridgeOutcome<{ ok: true; id: string }>> {
  const { module, reason } = await getModule();
  if (!module) return { status: "skipped", reason: reason ?? "wasm-not-loaded" };
  if (typeof module.unregister_user_status_js !== "function") {
    return { status: "skipped", reason: "wasm-bundle-stale" };
  }
  try {
    const raw = module.unregister_user_status_js(id);
    return { status: "ok", value: unwrapJsValue(raw) };
  } catch (err) {
    return { status: "rejected", error: stringifyError(err) };
  }
}

export async function listUserStatuses(): Promise<
  BridgeOutcome<EngineRegistryEntry[]>
> {
  const { module, reason } = await getModule();
  if (!module) return { status: "skipped", reason: reason ?? "wasm-not-loaded" };
  if (typeof module.list_user_statuses_js !== "function") {
    return { status: "skipped", reason: "wasm-bundle-stale" };
  }
  try {
    const raw = module.list_user_statuses_js();
    return { status: "ok", value: unwrapJsValue<EngineRegistryEntry[]>(raw) };
  } catch (err) {
    return { status: "rejected", error: stringifyError(err) };
  }
}
