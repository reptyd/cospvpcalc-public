import { describe, expect, it } from "vitest";
import { KNOWN_APPROXIMATION_REFERENCE_DRAFTS } from "./referenceContent";

// An approximation entry splits one subject across three fields: `summary`
// names what is simplified, `currentApproximation` says what the model does
// instead, and `whyApproximated` says why. The reason is the only one of the
// three a reader cannot work out from the others, so it is the one that goes
// wrong: rewriting it tends to pull the consequence back in, and the entry
// then says the same thing twice in a row.
//
// Reading does not catch that - both sentences are true and neither is clumsy.
// Counting the words they share does.

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "but", "by", "for", "from", "has", "have",
  "in", "into", "is", "it", "its", "not", "of", "on", "or", "so", "than", "that", "the", "their",
  "then", "there", "they", "this", "to", "up", "was", "were", "what", "when", "which", "while",
  "with", "would",
]);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

/** Share of the reason's own words that its neighbours already used. */
function overlapWithNeighbours(entry: (typeof KNOWN_APPROXIMATION_REFERENCE_DRAFTS)[number]): number {
  const reason = contentWords(entry.whyApproximated);
  if (reason.size === 0) return 0;
  const neighbours = contentWords([entry.summary, ...entry.currentApproximation].join(" "));
  let shared = 0;
  for (const word of reason) if (neighbours.has(word)) shared += 1;
  return shared / reason.size;
}

// Set from the measured spread rather than chosen: the entry corrected for
// exactly this fault scored 0.70 before and 0.22 after, and every entry that
// has never been questioned sits below 0.5.
const MAX_OVERLAP = 0.5;

describe("An approximation's reason is a reason", () => {
  it("does not restate the fields beside it", () => {
    const offenders = KNOWN_APPROXIMATION_REFERENCE_DRAFTS.map((entry) => ({
      id: entry.id,
      overlap: overlapWithNeighbours(entry),
    }))
      .filter((row) => row.overlap > MAX_OVERLAP)
      .map((row) => `  - ${row.id}: ${(row.overlap * 100).toFixed(0)}% of the reason's words are already beside it`);

    expect(
      offenders,
      `whyApproximated holds the reason. Where most of its words come from the summary or the\n` +
        `approximation, it is repeating them instead.\n\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
