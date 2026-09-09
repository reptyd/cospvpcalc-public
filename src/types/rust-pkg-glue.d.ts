// Ambient declaration for the wasm-pack glue module imported directly by the
// Node-run real-WASM tests (wasmMatchupSmoke.test.ts). wasm-pack 0.14 emits the
// glue as plain .js with no committed declaration, so a literal static import of
// it would otherwise trip noImplicitAny on a fresh checkout. Only the surface the
// tests touch is declared here; everything else stays `unknown`.
declare module "*cos_calc_wasm_engine_bg.js" {
  export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
  export function simulate_composable_matchup_js(...args: unknown[]): unknown;
}
