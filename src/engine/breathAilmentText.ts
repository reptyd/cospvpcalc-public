// The ailment clauses in a breath spec's prose, and the chances the game gives
// them where the prose is wrong. Kept apart from `runtimeHelpers` so a caller
// that only needs to read a breath's chances - the Compare card's note on how
// they resolve - does not pull the status and effect catalogs in behind it.

export type BreathAilment = {
  name: string;
  probability: number;
  stacks?: number | null;
  /** Who the roll lands on. Cloud Breath is the only breath that rolls onto
   *  its own user, and the spec text marks it with a "self-apply" verb. */
  target: "opponent" | "self";
};

// One "<Name> (Probability = N%, ...)" clause. The name is read as the run of
// capitalised words directly in front of the bracket, which is what separates
// it from the lower-case connective ("can also inflict", "and", "the following
// ailments:") that may or may not precede it. Anchoring on a connective
// instead - the previous shape - dropped every ailment introduced by ") and "
// and swallowed the verb into the name when it was introduced by ", and can
// inflict ".
const BREATH_AILMENT_CLAUSE =
  /((?:[A-Z][A-Za-z']*[ -])*[A-Z][A-Za-z']*)\s*,?\s*\(\s*Probability\s*=\s*([0-9.]+)\s*%([^)]*)\)/g;
const BREATH_AILMENT_VERB = /\bself[- ]appl(?:y|ies)\b|\binflicts?\b/gi;

export function parseBreathAilments(raw: string): BreathAilment[] {
  const verbs = [...raw.matchAll(BREATH_AILMENT_VERB)].map((m) => ({
    index: m.index ?? 0,
    self: /^self/i.test(m[0]),
  }));
  const results: BreathAilment[] = [];
  for (const match of raw.matchAll(BREATH_AILMENT_CLAUSE)) {
    const at = match.index ?? 0;
    // A clause inherits the last verb in front of it, so the second half of
    // "self-apply X (...), and Y (...)" stays on the user.
    const verb = verbs.filter((v) => v.index < at).pop();
    const stacksMatch = match[3].match(/stacks?\s*(?:set\s*to|=)\s*([0-9.]+)/i);
    results.push({
      name: match[1].trim(),
      probability: Number(match[2]),
      stacks: stacksMatch ? Number(stacksMatch[1]) : null,
      target: verb?.self ? "self" : "opponent",
    });
  }
  return results;
}

// Chances the scraped spec text gets wrong, against the game's own breath
// table. `wikiPct` is the value being corrected: when a re-scrape brings the
// text in line, the entry stops matching and can be dropped.
export const SPEC_CHANCE_CORRECTIONS: Record<string, Array<{ status: string; wikiPct: number; gamePct: number }>> = {
  "Glacier Breath": [{ status: "Slowed", wikiPct: 30, gamePct: 15 }],
};

// "Slowed Status" and "Slowed" are the same ailment: the prose carries the
// suffix, the correction table does not.
function normalizeAilmentName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+status$/, "").replace(/\s+/g, " ");
}

/**
 * The ailments a breath rolls onto whoever it hits, at the chance the engine
 * uses. Self-rolls (Cloud Breath's Water Regeneration and Muddy) are left out:
 * they land on the user, and the engine applies them itself.
 */
export function breathAilmentsOnTarget(raw: string | undefined, breathName?: string): BreathAilment[] {
  if (!raw) return [];
  const corrections = SPEC_CHANCE_CORRECTIONS[breathName ?? ""] ?? [];
  return parseBreathAilments(raw)
    .filter((ailment) => ailment.target === "opponent")
    .map((ailment) => {
      const fix = corrections.find(
        (c) => normalizeAilmentName(c.status) === normalizeAilmentName(ailment.name)
          && c.wikiPct === ailment.probability,
      );
      return fix ? { ...ailment, probability: fix.gamePct } : ailment;
    });
}
