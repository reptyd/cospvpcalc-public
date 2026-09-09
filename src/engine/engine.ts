// `engine.ts` - thin re-export shim.
//
// The Rust crate in `wasm-engine/` is the authoritative combat
// engine, dispatched through
// `optimizer/rustCompareDispatch::trySimulateRustCompareMatchup`.
// No simulation runs from this file.
//
// What it re-exports is a handful of pure-math primitives - build-rule
// resolution and per-hit damage helpers - that the React UI and
// the Rust-bridge mappers both use. They are not part of any
// simulation loop; treat them as TS data utilities, not as combat
// code.

import { applyRulesAndBuild } from "./buildRules";
import { computeBreathDamage, computeMeleeDamagePerHit } from "./subsystems/damage";

export { applyRulesAndBuild, computeMeleeDamagePerHit, computeBreathDamage };
