// ───────────────────────────────────────────────────────────────────────────
// `engine.ts` - thin re-export shim.
//
// The TypeScript combat simulator that used to live here has been
// removed. The Rust crate in `wasm-engine/` is the
// authoritative combat engine, dispatched through
// `optimizer/rustCompareDispatch::trySimulateRustCompareMatchup`.
//
// What survives is a handful of pure-math primitives - build-rule
// resolution and per-hit damage helpers - that the React UI and
// the Rust-bridge mappers both still use. They are not part of any
// simulation loop; treat them as TS data utilities, not as combat
// code.
// ───────────────────────────────────────────────────────────────────────────

import { applyRulesAndBuild } from "./buildRules";
import { computeBreathDamage, computeMeleeDamagePerHit } from "./subsystems/damage";

export { applyRulesAndBuild, computeMeleeDamagePerHit, computeBreathDamage };
