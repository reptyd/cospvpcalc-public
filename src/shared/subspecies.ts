// Subspecies detection. A subspecies is a creature whose name is
// "<prefix...> <Base>" where Base is itself a creature in the roster
// (e.g. "Icebreaker Meorlark" -> "Meorlark", "Ashen Sochuri" -> "Sochuri").
// The wiki once separated subspecies out; it now lists them as ordinary
// creatures, so the tag is derived from the roster instead of a hand-kept
// list. Manual overrides cover the rare heuristic miss or false positive.
//
// Pure and dependency-free so both the app (bundled data) and the wiki-sync
// tool (data read from disk) can share one source of truth.

export interface SubspeciesOverrides {
  /** Names to force-mark as subspecies even if the heuristic misses them
   *  (e.g. a variant whose base creature is not in the roster). */
  forceInclude: string[];
  /** Names the heuristic wrongly flags - kept as ordinary creatures. */
  forceExclude: string[];
}

export const EMPTY_SUBSPECIES_OVERRIDES: SubspeciesOverrides = {
  forceInclude: [],
  forceExclude: [],
};

/**
 * Derive the base creature for `name` from the roster, or null if it does not
 * look like a subspecies. The name must be at least two words and its trailing
 * words must spell another creature; the longest such trailing match wins so
 * "Origin Caldonterrus" resolves to "Caldonterrus" rather than a shorter
 * coincidental suffix.
 */
export function heuristicBaseOf(name: string, rosterLower: Set<string>): string | null {
  const tokens = name.trim().split(/\s+/);
  for (let drop = 1; drop < tokens.length; drop += 1) {
    const candidate = tokens.slice(drop).join(" ");
    if (
      candidate.toLowerCase() !== name.trim().toLowerCase() &&
      rosterLower.has(candidate.toLowerCase())
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Map every subspecies name in `names` to its base creature (or null when a
 * force-included name has no derivable base). Overrides win: `forceExclude`
 * drops a name, `forceInclude` adds one the heuristic missed.
 */
export function computeSubspecies(
  names: string[],
  overrides: SubspeciesOverrides = EMPTY_SUBSPECIES_OVERRIDES,
  tierOf?: (name: string) => number | null | undefined,
): Map<string, string | null> {
  const rosterLower = new Set(names.map((n) => n.toLowerCase()));
  const excluded = new Set((overrides.forceExclude ?? []).map((n) => n.toLowerCase()));
  const result = new Map<string, string | null>();
  for (const name of names) {
    if (excluded.has(name.toLowerCase())) continue;
    const base = heuristicBaseOf(name, rosterLower);
    if (!base) continue;
    // A real subspecies shares its base's tier ("Icebreaker Meorlark" and
    // "Meorlark" are both T4). "Buff Eulopii" (T4) vs "Eulopii" (T1) only
    // matches by name, so drop a candidate when both tiers are known and
    // differ - it is a coincidental name, not a subspecies.
    if (tierOf) {
      const subTier = tierOf(name);
      const baseTier = tierOf(base);
      if (subTier != null && baseTier != null && subTier !== baseTier) continue;
    }
    result.set(name, base);
  }
  for (const name of overrides.forceInclude ?? []) {
    if (excluded.has(name.toLowerCase()) || result.has(name)) continue;
    result.set(name, heuristicBaseOf(name, rosterLower));
  }
  return result;
}

/** Convenience: the set of subspecies names derived from a roster. `tierOf`, if
 *  given, enforces the tier-match rule that rejects coincidental name matches. */
export function buildSubspeciesSet(
  names: string[],
  overrides?: SubspeciesOverrides,
  tierOf?: (name: string) => number | null | undefined,
): Set<string> {
  return new Set(computeSubspecies(names, overrides, tierOf).keys());
}
