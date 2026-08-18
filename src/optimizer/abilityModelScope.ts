export type { AbilityScopeStatus } from "../pages/referenceContent";

// The three hand-maintained scope lists that used to live here are gone. Which
// bucket an ability falls in is the `status` on its Reference entry and nothing
// else - see REFERENCE_ABILITY_SCOPE in src/pages/referenceContent.ts, and
// abilityCoverageRegistry for the predicates built on it.
//
// They were deleted because they had drifted from the entries a reader opens:
// seven Compare-only abilities were still listed as out of model, Plasma Beam
// was listed as unmodelled while carrying a full entry and a reference test,
// Agile Swimmer was listed as out of model from before Speed Builds existed,
// and three out-of-model abilities were in no list at all. A second source that
// can disagree with the first is the bug; removing it is the fix.
//
// The pair that used to sit in `PARTIAL_MODELED_ABILITIES` was carrying a
// different fact - "the engine runs this rather than skipping the matchup" -
// which is routing, not a label. That now lives on the ability's own registry
// record as `routedDespitePartialModel`.
