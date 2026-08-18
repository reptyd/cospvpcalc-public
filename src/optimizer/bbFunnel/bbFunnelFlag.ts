// Master switch for the Best Builds funnel: signature dedup, skyline prune,
// measured anchors, a screen on Fortify's fast gate, and an exact completion of
// the leading band against the whole pool. It replaces the staged search, whose
// 1000-skeleton cap and fixed shortlist both dropped true top-10 builds.
//
// Kept as a single const so every funnel module reads the same gate. Set
// `COS_CALC_BB_FUNNEL=0` in node to run the legacy staged path - the funnel's
// own A/B tests use it to score one against the other.
function readEnvOverride(): boolean | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.COS_CALC_BB_FUNNEL;
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

export const BB_FUNNEL_ENABLED: boolean = readEnvOverride() ?? true;
