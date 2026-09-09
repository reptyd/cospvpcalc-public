import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABILITY_POLICY_REFERENCE_DRAFTS,
  BATTLE_SETTING_REFERENCE_DRAFTS,
  KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  MODELED_ABILITY_REFERENCE_DRAFTS,
  MOVEMENT_SPEED_REFERENCE_DRAFTS,
  PLUSHIE_REFERENCE_DRAFTS,
  STATUS_REFERENCE_DRAFTS,
} from "./referenceContent";

// A Rust reference test names the bullet it covers and quotes it:
//
//     // [REF:status_bleed]
//     // Bullet 2: "Bleed blocks natural health regeneration completely."
//
// The quote is a comment, so an edit to the bullet leaves it behind and nothing
// says so. This is the check that says so: every quote has to still be the text
// of the bullet it names. The bullet is the specification, so when the two
// disagree it is the comment that is wrong.

const REFERENCE_TESTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "wasm-engine",
  "src",
  "composable",
  "reference_tests",
);

// An approximation carries no `mechanics` and only an ability carries
// `policyDifferences`, so both are read as absent rather than empty.
type SourceEntry = { id: string; name: string; mechanics?: string[]; notes: string[]; policyDifferences?: string[] };
type EntryFields = { name: string; mechanics: string[]; notes: string[]; policyDifferences: string[] };

const SOURCE: SourceEntry[] = [
  ...MODELED_ABILITY_REFERENCE_DRAFTS,
  ...BATTLE_SETTING_REFERENCE_DRAFTS,
  ...STATUS_REFERENCE_DRAFTS,
  ...MOVEMENT_SPEED_REFERENCE_DRAFTS,
  ...PLUSHIE_REFERENCE_DRAFTS,
  ...ABILITY_POLICY_REFERENCE_DRAFTS,
  ...KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
];

const ENTRIES = new Map<string, EntryFields>(
  SOURCE.map((entry) => [
    entry.id,
    {
      name: entry.name,
      mechanics: entry.mechanics ?? [],
      notes: entry.notes,
      policyDifferences: entry.policyDifferences ?? [],
    },
  ]),
);

type Field = "mechanics" | "notes" | "policyDifferences";
/** Where one quote is supposed to have come from. A null index means the head
 *  named the field without a number - `+ note`, `+ policy bullet`. */
type Target = { field: Field; index: number | null };

type Quote = {
  file: string;
  line: number;
  /** The `Bullets 2 + 4` part, verbatim, for the failure message. */
  spec: string;
  ids: string[];
  targets: Target[];
  texts: string[];
};

const HEAD = /^\s*\/\/\s*(Bullets?\b.*)$/;
const COMMENT = /^\s*\/\/(?!\/|!)\s?(.*)$/;
const REF = /\[REF:([a-z0-9_]+)\]/g;

/** `3 + Notes 2`, `5-6`, `1, 2, 4`, `5a`, `1 of each entry`, `3 + final note`. */
function parseTargets(spec: string): Target[] {
  const targets: Target[] = [];
  for (const segment of spec.replace(/\([^)]*\)/g, " ").split("+")) {
    const text = segment.trim();
    const numbered = text.match(/^notes?\s+(\d+)/i);
    if (numbered) {
      targets.push({ field: "notes", index: Number(numbered[1]) });
      continue;
    }
    if (/^(?:final\s+)?notes?\b/i.test(text)) {
      targets.push({ field: "notes", index: null });
      continue;
    }
    if (/^policy\b/i.test(text)) {
      targets.push({ field: "policyDifferences", index: null });
      continue;
    }
    // A leading run of bullet numbers. Trailing prose - `9, against a real
    // appetite rather than the 100-unit default` - stops the run rather than
    // contributing its own numbers.
    let rest = text;
    for (;;) {
      const range = rest.match(/^(\d+)\s*-\s*(\d+)/);
      if (range) {
        for (let n = Number(range[1]); n <= Number(range[2]); n += 1) targets.push({ field: "mechanics", index: n });
        rest = rest.slice(range[0].length);
      } else {
        const one = rest.match(/^(\d+)[a-z]?/);
        if (!one) break;
        targets.push({ field: "mechanics", index: Number(one[1]) });
        rest = rest.slice(one[0].length);
      }
      const comma = rest.match(/^\s*,\s*/);
      if (!comma) break;
      rest = rest.slice(comma[0].length);
    }
  }
  return targets;
}

/** The quoted runs the head opens with, chained by `+`. Prose after them may
 *  quote a word of its own, and that is not a bullet. */
function parseQuotes(rest: string): string[] {
  const quotes: string[] = [];
  let text = rest;
  for (;;) {
    text = text.replace(/^\s*/, "");
    if (!text.startsWith('"')) break;
    const close = text.indexOf('"', 1);
    if (close === -1) break;
    quotes.push(text.slice(1, close));
    text = text.slice(close + 1);
    const chain = text.match(/^\s*\+\s*(?=")/);
    if (!chain) break;
    text = text.slice(chain[0].length);
  }
  return quotes;
}

function collectQuotes(file: string, source: string): Quote[] {
  const lines = source.split(/\r?\n/);
  const quotes: Quote[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(HEAD);
    if (!head) continue;

    // The markers that name the entry sit in the same comment block, above the
    // head - one test body can cover several entries, so the block is the scope
    // rather than the file.
    const ids: string[] = [];
    for (let up = i - 1; up >= 0 && COMMENT.test(lines[up]); up -= 1) {
      for (const marker of lines[up].matchAll(REF)) ids.unshift(marker[1]);
    }

    // A quote that runs past the end of its line continues on the comment lines
    // below, up to the next head or the end of the block.
    const parts = [head[1]];
    for (let down = i + 1; down < lines.length; down += 1) {
      const body = lines[down].match(COMMENT);
      if (!body || HEAD.test(lines[down]) || /\[REF:/.test(lines[down])) break;
      parts.push(body[1].trim());
    }
    const joined = parts.join(" ").replace(/\s+/g, " ").trim();
    const split = joined.match(/^Bullets?\b([^:]*):\s*([\s\S]*)$/);
    if (!split) continue;

    const texts = parseQuotes(split[2]);
    if (texts.length === 0) continue; // a paraphrase names its bullet but quotes nothing
    quotes.push({ file, line: i + 1, spec: split[1].trim(), ids, targets: parseTargets(split[1]), texts });
  }
  return quotes;
}

/** Whitespace-normalized substring. `...` or `[...]` in a quote is an elision,
 *  so the fragments either side have to appear in the bullet in that order. */
const ELISION = /\s*(?:\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…)\s*/;

function quoted(quote: string, bullet: string): boolean {
  const flat = bullet.replace(/\s+/g, " ").trim();
  let at = 0;
  for (const fragment of quote.replace(/\s+/g, " ").trim().split(ELISION)) {
    if (!fragment) continue;
    const found = flat.indexOf(fragment, at);
    if (found === -1) return false;
    at = found + fragment.length;
  }
  return true;
}

function bulletsFor(id: string, target: Target): string[] | null {
  const entry = ENTRIES.get(id);
  if (!entry) return null;
  const field = entry[target.field];
  if (target.index === null) return field;
  return target.index - 1 < field.length ? [field[target.index - 1]] : [];
}

function label(target: Target): string {
  const field = target.field === "mechanics" ? "bullet" : target.field === "notes" ? "note" : "policy bullet";
  return target.index === null ? `any ${field}` : `${field} ${target.index}`;
}

const ALL_QUOTES = readdirSync(REFERENCE_TESTS_DIR)
  .filter((name) => name.endsWith(".rs") && name !== "mod.rs")
  .flatMap((name) => collectQuotes(name, readFileSync(join(REFERENCE_TESTS_DIR, name), "utf8")));

/**
 * Pair each quoted run with the bullet it came from.
 *
 * A head naming one bullet and carrying one quote is the ordinary case. A head
 * naming several and carrying as many pairs them off in order. A head naming
 * several and carrying one quote spans them, so the quote is looked for in each
 * and one hit is enough - which is all the binding can honestly claim there.
 */
type Binding = { quote: Quote; text: string; targets: Target[] };

function bind(quote: Quote): { pairs: Binding[]; unresolved: string | null } {
  if (quote.ids.length === 0) return { pairs: [], unresolved: "no [REF:] marker in the comment block" };
  const unknown = quote.ids.filter((id) => !ENTRIES.has(id));
  if (unknown.length === quote.ids.length) return { pairs: [], unresolved: `no such entry: ${unknown.join(", ")}` };
  if (quote.targets.length === 0) return { pairs: [], unresolved: "the head names no bullet number" };
  if (quote.texts.length === quote.targets.length) {
    return { pairs: quote.texts.map((text, at) => ({ quote, text, targets: [quote.targets[at]] })), unresolved: null };
  }
  if (quote.texts.length === 1) {
    return { pairs: [{ quote, text: quote.texts[0], targets: quote.targets }], unresolved: null };
  }
  return {
    pairs: [],
    unresolved: `${quote.texts.length} quoted runs against ${quote.targets.length} bullets - which goes with which is a guess`,
  };
}

/** A binding holds when the quote sits in one of the bullets it names, in any
 *  entry the block marks. `Bullet 1 of each entry` is one comment over thirteen. */
function holds(binding: Binding): boolean {
  return binding.quote.ids.some((id) =>
    binding.targets.some((target) => (bulletsFor(id, target) ?? []).some((text) => quoted(binding.text, text))),
  );
}

function describeFailure(binding: Binding): string {
  const { quote, targets, text } = binding;
  const found = quote.ids
    .flatMap((id) => {
      const entry = ENTRIES.get(id);
      if (!entry) return [`  ${id}: no such Reference entry`];
      return targets.map((target) => {
        const bullets = bulletsFor(id, target) ?? [];
        if (bullets.length === 0) {
          return `  ${id} (${entry.name}): has no ${label(target)} - ${entry[target.field].length} in that field`;
        }
        return bullets.map((bullet) => `  ${id} (${entry.name}) ${label(target)} now reads:\n    ${bullet}`).join("\n");
      });
    })
    .join("\n");
  return `${quote.file}:${quote.line}  "Bullet${quote.spec ? ` ${quote.spec}` : ""}"\n  quoted:\n    ${text}\n${found}`;
}

describe("a reference test quotes the bullet it names", () => {
  it("census - what the binding reaches", () => {
    const files = new Set(ALL_QUOTES.map((quote) => quote.file));
    const runs = ALL_QUOTES.reduce((count, quote) => count + quote.texts.length, 0);
    expect(
      ALL_QUOTES.length,
      `${runs} quoted runs in ${ALL_QUOTES.length} comments across ${files.size} files`,
    ).toBeGreaterThan(200);
  });

  it("every quote binds to a bullet", () => {
    const unresolved = ALL_QUOTES.map((quote) => ({ quote, ...bind(quote) }))
      .filter((result) => result.unresolved)
      .map((result) => `${result.quote.file}:${result.quote.line}  Bullet ${result.quote.spec}: ${result.unresolved}`);
    expect(
      unresolved,
      "These comments quote a bullet without saying which one, so nothing can check them. Name the "
      + "bullet number in the head:\n" + unresolved.join("\n"),
    ).toEqual([]);
  });

  it("every quote is the text of the bullet it names", () => {
    const drifted = ALL_QUOTES.flatMap((quote) => bind(quote).pairs)
      .filter((binding) => !holds(binding))
      .map(describeFailure);
    expect(
      drifted,
      `${drifted.length} quoted bullets have drifted from the entry. The bullet is the specification and `
      + "the comment quotes it, so correct the comment - never referenceContent.ts:\n\n" + drifted.join("\n\n"),
    ).toEqual([]);
  });
});
