import type {
  RustAbilityTimingMode,
  LoadedRustMatchupBridge,
  RustComposableAbilityConfig,
  RustMatchupBridge,
  RustMatchupSummary,
  RustSimpleBreathProfile,
  RustSimpleCombatantStats,
} from "./rustMatchupBridge";
import { markCall } from "../observability/webVitals";
import { reportError } from "../observability/errorSink";

let bridgePromise: Promise<RustMatchupBridge | null> | null = null;
let loadedBridge: LoadedRustMatchupBridge | null = null;
let loadedRustModule: GeneratedRustModule | null = null;

/**
 * Status of the WASM bridge load. UI subscribers (e.g. App.tsx)
 * read this to surface a "WASM unavailable, falling back to JS"
 * banner instead of letting the failure be silent. The default
 * `"idle"` lets the page render before the first matchup request
 * triggers a load attempt.
 */
export type RustMatchupBridgeStatus = "idle" | "loading" | "ready" | "failed";
let bridgeStatus: RustMatchupBridgeStatus = "idle";
let bridgeFailureError: unknown = null;
const statusSubscribers = new Set<(status: RustMatchupBridgeStatus) => void>();

/** Recursively strip `null` AND `undefined`-valued properties
 * from an arg before sending it to wasm-bindgen deserialisation.
 *
 * `serde_wasm_bindgen::from_value` treats `Option<T>` and
 * collections strictly: an *absent* property is fine
 * (`#[serde(default)]` kicks in), but a property that *exists*
 * with value `null` or `undefined` and a non-Option type
 * (e.g. `Vec<String>` for `userAbilityIds`) triggers a
 * `Reflect.get on non-object` during deserialisation. The TS
 * shape often spells these out as `T | null` or as omitted
 * fields-via-spread that JS still iterates. Walking once at the
 * bridge boundary keeps callers free to use the friendlier
 * shape.
 */
export function stripNullsForWasm<T>(value: T): T {
  if (value === null || value === undefined) return undefined as unknown as T;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripNullsForWasm(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined) {
      // Drop both - same as absent for serde Option / default semantics.
      continue;
    }
    out[k] = stripNullsForWasm(v);
  }
  return out as T;
}

function setBridgeStatus(next: RustMatchupBridgeStatus): void {
  if (next === bridgeStatus) return;
  bridgeStatus = next;
  for (const subscriber of statusSubscribers) {
    try {
      subscriber(next);
    } catch (error) {
      // Subscriber bug shouldn't break the loader path.
      console.error("[rustMatchupLoader] subscriber threw:", error);
    }
  }
}

export function getRustMatchupBridgeStatus(): RustMatchupBridgeStatus {
  return bridgeStatus;
}

export function getRustMatchupBridgeFailureError(): unknown {
  return bridgeFailureError;
}

export function subscribeRustMatchupBridgeStatus(
  callback: (status: RustMatchupBridgeStatus) => void,
): () => void {
  statusSubscribers.add(callback);
  return () => {
    statusSubscribers.delete(callback);
  };
}

/**
 * TEST-ONLY: reset module-level state so unit tests can drive the
 * status machine independently. Not exported for production callers.
 */
export function __resetRustMatchupBridgeForTests(): void {
  bridgeStatus = "idle";
  bridgeFailureError = null;
  bridgePromise = null;
  loadedBridge = null;
  statusSubscribers.clear();
}

/** TEST-ONLY: drive the status machine without going through the
 * full bundler-managed WASM load path. */
export function __setRustMatchupBridgeStatusForTests(
  next: RustMatchupBridgeStatus,
  error?: unknown,
): void {
  if (error !== undefined) {
    bridgeFailureError = error;
  }
  setBridgeStatus(next);
}
// Memo for isRustMatchupBridgeDisabled. BB hot path reads this ~2x per
// matchup (~340K calls at Kendyll scale); the underlying check touches
// hostname parsing + globalThis probes.
let disabledFlagMemo: boolean | null = null;

export function isRustMatchupBridgeDisabled(): boolean {
  if (disabledFlagMemo !== null) return disabledFlagMemo;
  const computed = computeIsRustMatchupBridgeDisabled();
  disabledFlagMemo = computed;
  return computed;
}

function computeIsRustMatchupBridgeDisabled(): boolean {
  if (typeof globalThis !== "undefined" && (globalThis as { __COS_CALC_DISABLE_RUST_MATCHUP__?: unknown }).__COS_CALC_DISABLE_RUST_MATCHUP__) {
    return true;
  }
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (processEnv?.COS_CALC_DISABLE_RUST_MATCHUP === "1") {
    return true;
  }
  return false;
}

export type GeneratedRustModule = {
  rust_matchup_contract_version: () => string;
  // Breath params are `T | null | undefined`: callers pass `null`
  // (the friendly absence sentinel from the engine path) but
  // `stripNullsForWasm` rewrites that to `undefined` so serde
  // `Option<T>` deserialises cleanly. Allow both at the type level
  // so call sites don't have to lie about which sentinel they pass.
  simulate_composable_matchup_js: (
    attacker: RustSimpleCombatantStats,
    defender: RustSimpleCombatantStats,
    attackerBreath: RustSimpleBreathProfile | null | undefined,
    defenderBreath: RustSimpleBreathProfile | null | undefined,
    abilityPolicy: RustAbilityTimingMode,
    abilityConfig: RustComposableAbilityConfig,
    maxTimeSec: number,
    recordTrace?: boolean,
  ) => unknown;
  // Custom abilities + custom timings (landed in Rust source,
  // require `npm run rust:build` to surface in the WASM bundle). Marked
  // optional so the loader continues to work against an older bundle -
  // see `src/shared/customAbilityBridge.ts` for the feature-detect path
  // that lets the UI degrade gracefully on a stale rust-pkg.
  register_user_ability_js?: (specJson: string) => unknown;
  unregister_user_ability_js?: (id: string) => unknown;
  list_user_abilities_js?: () => unknown;
  register_user_timing_js?: (specJson: string) => unknown;
  unregister_user_timing_js?: (id: string) => unknown;
  list_user_timings_js?: () => unknown;
  register_user_status_js?: (specJson: string) => unknown;
  unregister_user_status_js?: (id: string) => unknown;
  list_user_statuses_js?: () => unknown;
  // Sandbox runtime bindings (created on the refactor branch). Optional so
  // the loader keeps working against an older WASM bundle that predates
  // them - `sandboxBridge.ts` feature-detects before exposing the page.
  sandbox_create_js?: (payload: unknown) => unknown;
  sandbox_destroy_js?: (id: bigint) => unknown;
  sandbox_view_js?: (id: bigint) => unknown;
  sandbox_step_js?: (id: bigint) => unknown;
  sandbox_step_to_time_js?: (id: bigint, targetTime: number) => unknown;
  sandbox_apply_hp_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_apply_status_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_force_bite_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_force_breath_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_force_ability_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_override_stat_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_clear_overrides_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_override_ability_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_override_resist_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_override_offensive_status_js?: (id: bigint, payload: unknown) => unknown;
  sandbox_override_defensive_status_js?: (id: bigint, payload: unknown) => unknown;
  default?: () => Promise<unknown>;
  initSync?: (module: { module: Uint8Array }) => unknown;
};

async function tryLoadNodeWasmBytes(): Promise<Uint8Array | null> {
  const isNodeRuntime =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string";
  if (!isNodeRuntime) return null;

  // Indirect `import()` via the Function constructor so Vite/Rollup doesn't
  // statically resolve "node:fs" at bundle time - the bundler would either
  // throw on the unknown specifier or pull a polyfill into the browser
  // chunk. By hiding the call behind a runtime-built function we keep
  // "node:fs" out of the dependency graph; it only resolves when this
  // branch actually runs under Node (gated by the `isNodeRuntime` check
  // above). Browser bundles never reach this line.
  const dynamicImport = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  try {
    const { readFileSync } = (await dynamicImport("node:fs")) as {
      readFileSync: (path: URL) => Uint8Array;
    };
    return readFileSync(new URL("../rust-pkg/cos_calc_wasm_engine_bg.wasm", import.meta.url));
  } catch {
    return null;
  }
}

async function loadGeneratedRustModule(): Promise<GeneratedRustModule> {
  // `as any` because wasm-bindgen's generated `.js` ships with no .d.ts and
  // varies subtly across `wasm-pack` versions (default-export init vs. sync
  // init vs. ready-to-call). We narrow back to `GeneratedRustModule` after
  // the runtime probe below confirms the export shape.
   
  const mod = (await import("../rust-pkg/cos_calc_wasm_engine.js")) as any;
  if (typeof mod.rust_matchup_contract_version === "function") {
    try {
      mod.rust_matchup_contract_version();
      return mod as GeneratedRustModule;
    } catch {
      // Continue into explicit initialization.
    }
  }

  if (typeof mod.default === "function") {
    try {
      await mod.default();
      mod.rust_matchup_contract_version();
      return mod as GeneratedRustModule;
    } catch {
      // Fall through to Node-specific sync init.
    }
  }

  const wasmBytes = await tryLoadNodeWasmBytes();
  if (wasmBytes && typeof mod.initSync === "function") {
    mod.initSync({ module: wasmBytes });
  }

  mod.rust_matchup_contract_version();
  return mod as GeneratedRustModule;
}

export async function loadRustMatchupBridge(): Promise<RustMatchupBridge | null> {
  if (isRustMatchupBridgeDisabled()) return null;
  if (bridgePromise) return bridgePromise;

  // In runtimes without bundler-managed wasm loading (Node test
  // harness, browsers blocking WebAssembly, asset 404 in production)
  // we resolve to `null` instead of throwing - the engine path is
  // best-effort, callers handle the missing bridge. We still log
  // and broadcast `"failed"` so UI subscribers can show a banner
  // instead of letting the degradation be invisible.
  setBridgeStatus("loading");
  bridgePromise = loadGeneratedRustModule()
    .then((mod) => {
      loadedRustModule = mod;
      loadedBridge = {
        contractVersion: mod.rust_matchup_contract_version(),
        simulateComposableMatchup: (
          attacker: RustSimpleCombatantStats,
          defender: RustSimpleCombatantStats,
          attackerBreath: RustSimpleBreathProfile | null,
          defenderBreath: RustSimpleBreathProfile | null,
          abilityPolicy: RustAbilityTimingMode,
          abilityConfig: RustComposableAbilityConfig,
          maxTimeSec: number,
          recordTrace?: boolean,
        ) =>
          // serde_wasm_bindgen deserialises `Option<T>` from
          // `undefined`, not `null` - passing `null` triggers a
          // `Reflect.get on non-object` error during the
          // `from_value` deserialisation. We walk every arg
          // shallowly stripping nulls before handoff so callers can
          // keep the friendlier `T | null` shape and so nested
          // Option fields on the stats / breath / config structs
          // don't blow up the deserialiser either.
          markCall("rust:simulate_composable_matchup", () =>
            mod.simulate_composable_matchup_js(
              stripNullsForWasm(attacker),
              stripNullsForWasm(defender),
              stripNullsForWasm(attackerBreath ?? undefined),
              stripNullsForWasm(defenderBreath ?? undefined),
              abilityPolicy,
              stripNullsForWasm(abilityConfig),
              maxTimeSec,
              recordTrace,
            ) as RustMatchupSummary,
          ),
      };
      setBridgeStatus("ready");
      return loadedBridge;
    })
    .catch((error) => {
      bridgeFailureError = error;
      reportError("rustMatchupLoader.bridge", error, {
        message: "WASM bridge failed to load",
      });
      setBridgeStatus("failed");
      return null;
    });

  return bridgePromise;
}

export function getLoadedRustMatchupBridge(): LoadedRustMatchupBridge | null {
  if (isRustMatchupBridgeDisabled()) return null;
  return loadedBridge;
}

/**
 * Raw generated WASM module accessor - used by the custom-ability
 * bridge to call `register_user_ability_js` / `list_user_*_js` /
 * etc. The returned object is `null` until `loadRustMatchupBridge`
 * has resolved successfully; callers should `await` that first.
 *
 * The returned module's `register_user_*` / `unregister_user_*` /
 * `list_user_*` functions are optional - they only exist on
 * WASM bundles built from a Rust source containing them.
 * Call sites must feature-detect with
 * `typeof mod.register_user_ability_js === "function"`.
 */
export function getLoadedRustGeneratedModule(): GeneratedRustModule | null {
  if (isRustMatchupBridgeDisabled()) return null;
  return loadedRustModule;
}
