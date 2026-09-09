export type { AbilityScopeStatus } from "../pages/referenceContent";

// Which bucket an ability falls in is the `status` on its Reference entry and
// nothing else - see REFERENCE_ABILITY_SCOPE in src/pages/referenceContent.ts,
// and abilityCoverageRegistry for the predicates built on it. A hand-maintained
// list beside the entries is a second source that can disagree with the first,
// which is why there is none here.
//
// Routing - "the engine runs this rather than skipping the matchup" - is a
// different fact from the label, and lives on the ability's own registry record
// as `routedDespitePartialModel`.
