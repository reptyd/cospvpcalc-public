import { deriveModeledOtherAbilities } from "../optimizer/abilityRegistry";

// The narrow engine-facing modeled-other list, derived from the single ability
// registry (`modeledOther` flag). Consumers split on the raw display name
// (parenthetical subtypes for wiki-sync, the data.ts backfill, the compare
// toggle options); eligibility uses the normalised set from abilityRegistry.
export const MODELED_OTHER_ABILITIES: readonly string[] = deriveModeledOtherAbilities();
