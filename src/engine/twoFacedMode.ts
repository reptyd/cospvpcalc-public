// Two-Faced trait mode - a tiny shared constant + type. Extracted into its own
// zero-import leaf so boot-reachable code (compareSpecialAbilities, pulled in by
// matchSnapshot -> snapshotDefaults) can read the default WITHOUT importing
// buildRules, which statically imports the effects catalog (data.ts). buildRules
// re-exports these for its existing consumers.
export type TwoFacedMode = "tranquility" | "madness";
export const DEFAULT_TWO_FACED_MODE: TwoFacedMode = "madness";
