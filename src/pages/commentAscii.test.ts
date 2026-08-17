import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This repository is mirrored in public, so a comment is read by strangers who
// cannot ask what a glyph was meant to say. A comment stays inside ASCII: `->`
// for an arrow, `x` for a product, `<=` and `>=` for the inequalities, `-` for
// a dash, `...` for an ellipsis, a spelled-out name for a Greek letter, and no
// box-drawing rules. The rule reaches comments only. A string literal is text
// the program carries, and `referenceContent.ts` writes the multiplication sign
// on purpose - docs/reference_style.md makes that a rule of its own.
//
// Comments are found by parsing, not by matching the start of a line, because
// both cheap failures matter here: `// ...` inside a string literal is not a
// comment, and most of the glyphs sit on wrapped continuation lines that open
// with an ordinary word.

type Lang = "ts" | "rust";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SOURCES: { dir: string; lang: Lang; ext: RegExp }[] = [
  { dir: join(REPO_ROOT, "src"), lang: "ts", ext: /\.tsx?$/ },
  { dir: join(REPO_ROOT, "wasm-engine", "src"), lang: "rust", ext: /\.rs$/ },
];

/**
 * The one exemption, written down with its reason rather than skipped quietly.
 *
 * A Reference entry is the specification, and its prose writes a product with
 * the multiplication sign by a rule of its own (docs/reference_style.md). Two
 * kinds of comment quote that prose verbatim: the `// Bullet N: "..."` heads in
 * the Rust reference tests, which `referenceBulletQuote.test.ts` checks are
 * still character-for-character the bullet they name, and the generated
 * spec-constant files, whose doc comment carries the excerpt each number was
 * read out of. Converting the glyph inside one of those quotes turns the
 * quotation into a paraphrase: the binding test fails, or - worse - the
 * generator puts it back on the next run and nobody looks. So the quotation is
 * excused, and only the quotation.
 *
 * The exemption is not a promise a comment can make about itself. A character
 * is excused only where it sits inside a double-quoted run that
 * referenceContent.ts still contains verbatim, and only in the files below.
 * Prose around the quote on the same line is held to the rule like any other
 * comment.
 */
const QUOTED_REFERENCE_TEXT = [
  "wasm-engine/src/composable/reference_tests/",
  "src/engine/specConstants.generated.ts",
  "wasm-engine/src/spec_constants.rs",
];

const REFERENCE_ENTRIES = readFileSync(join(REPO_ROOT, "src", "pages", "referenceContent.ts"), "utf8")
  .replace(/\s+/g, " ");

function filesUnder(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full, ext);
    return ext.test(entry.name) ? [full] : [];
  });
}

/** True at every character of the source that sits inside a comment. */
function commentMask(source: string, lang: Lang): boolean[] {
  const mask = new Array<boolean>(source.length).fill(false);
  const mark = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) mask[k] = true;
  };
  // The last few characters of code, so a `/` can be told from the start of a
  // regular expression by what precedes it.
  let code = "";
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i, i + 2);
    if (rest === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      mark(i, stop);
      i = stop;
      continue;
    }
    if (rest === "/*") {
      const from = i;
      let depth = 0;
      while (i < source.length) {
        if (source.startsWith("/*", i)) {
          depth += 1;
          i += 2;
          continue;
        }
        if (source.startsWith("*/", i)) {
          depth -= 1;
          i += 2;
          // Rust nests block comments; TypeScript closes on the first `*/`.
          if (depth === 0 || lang === "ts") break;
          continue;
        }
        i += 1;
      }
      mark(from, i);
      continue;
    }
    const c = source[i];
    if (lang === "rust" && c === "'") {
      // `'a'` is a character literal; `'a` is a lifetime and carries no text.
      const literal = /^'(?:\\.|[^\\'])'/.exec(source.slice(i, i + 12));
      i += literal ? literal[0].length : 1;
      code = "'";
      continue;
    }
    if (lang === "rust" && (c === "r" || c === "b") && !/[A-Za-z0-9_]$/.test(code)) {
      const raw = /^b?r(#*)"/.exec(source.slice(i, i + 16));
      if (raw) {
        const close = `"${raw[1]}`;
        const at = source.indexOf(close, i + raw[0].length);
        i = at === -1 ? source.length : at + close.length;
        code = '"';
        continue;
      }
    }
    if (c === '"' || c === "'" || (lang === "ts" && c === "`")) {
      i = endOfString(source, i, c, lang);
      code = c;
      continue;
    }
    if (lang === "ts" && c === "/" && startsRegex(code, source[i + 1])) {
      const end = endOfRegex(source, i);
      if (end !== null) {
        i = end;
        code = "/";
        continue;
      }
    }
    if (!/\s/.test(c)) code = (code + c).slice(-10);
    i += 1;
  }
  return mask;
}

function endOfString(source: string, start: number, quote: string, lang: Lang): number {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (lang === "ts" && quote === "`" && c === "$" && source[i + 1] === "{") {
      i = endOfSubstitution(source, i + 2);
      continue;
    }
    // An unterminated single-line string is a syntax error, but reading past
    // the newline would swallow the rest of the file, so stop at it.
    if (c === "\n" && quote !== "`") return i;
    i += 1;
  }
  return i;
}

/** Past the `}` that closes a `${` substitution, ignoring braces inside strings. */
function endOfSubstitution(source: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(source, i, c, "ts");
      continue;
    }
    if (c === "{") depth += 1;
    if (c === "}") depth -= 1;
    i += 1;
  }
  return i;
}

/** Whether a `/` opens a regular expression rather than dividing. */
function startsRegex(code: string, next: string | undefined): boolean {
  if (next === undefined || next === "/" || next === "*" || next === "=" || /\s/.test(next)) return false;
  return /(?:[=(,:[!&|?{};+\-*%~^<>]|\breturn|\btypeof|\bcase|\bin|\bof|\byield|\bawait)$/.test(code) || code === "";
}

/** Past the closing `/` and flags, or null when the line ends first. */
function endOfRegex(source: string, start: number): number | null {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "\n") return null;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i += 1;
      while (i < source.length && /[a-z]/.test(source[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return null;
}

type Place = { line: number; col: number };
type CommentLine = { line: number; chars: { ch: string; col: number }[] };

const MARKER = /^\s*(?:\/{2,3}!?|\/\*+!?|\*\/|\*)[ \t]?/;

/** The comment text of each line, with the marker dropped and columns kept. */
function commentLines(source: string, lang: Lang): CommentLine[] {
  const mask = commentMask(source, lang);
  const out: CommentLine[] = [];
  let line = 1;
  let col = 1;
  let chars: { ch: string; col: number }[] = [];
  for (let i = 0; i <= source.length; i += 1) {
    const c = source[i];
    if (c === "\n" || i === source.length) {
      if (chars.length > 0) out.push({ line, chars: dropMarker(chars) });
      chars = [];
      line += 1;
      col = 1;
      continue;
    }
    if (mask[i]) chars.push({ ch: c, col });
    col += 1;
  }
  return out;
}

function dropMarker(chars: { ch: string; col: number }[]): { ch: string; col: number }[] {
  const marker = MARKER.exec(chars.map((c) => c.ch).join(""));
  return marker ? chars.slice(marker[0].length) : chars;
}

/**
 * The places inside a quotation of Reference text.
 *
 * A quoted run wraps across comment lines - the head opens it and the line
 * below closes it - so the run is read over the whole comment block rather
 * than one line at a time. `...` in a quote is an elision, so the fragments
 * either side of it are looked up separately, the same way the bullet-quote
 * test reads them.
 */
function quotedReferencePlaces(source: string, lang: Lang): Set<string> {
  const exempt = new Set<string>();
  const lines = commentLines(source, lang);
  let block: CommentLine[] = [];
  const flush = () => {
    if (block.length > 0) markQuotes(block, exempt);
    block = [];
  };
  for (const current of lines) {
    if (block.length > 0 && current.line !== block[block.length - 1].line + 1) flush();
    block.push(current);
  }
  flush();
  return exempt;
}

function markQuotes(block: CommentLine[], exempt: Set<string>): void {
  // One string for the block, with a space where a line ended, and the place
  // of every character kept alongside it.
  let text = "";
  const places: (Place | null)[] = [];
  for (const { line, chars } of block) {
    if (text !== "") {
      text += " ";
      places.push(null);
    }
    for (const { ch, col } of chars) {
      text += ch;
      places.push({ line, col });
    }
  }
  for (const run of text.matchAll(/"([^"]*)"/g)) {
    const from = run.index + 1;
    for (const [at, length] of fragments(run[1])) {
      const fragment = run[1].slice(at, at + length).replace(/\s+/g, " ").trim();
      if (fragment.length < 4 || !REFERENCE_ENTRIES.includes(fragment)) continue;
      for (let k = from + at; k < from + at + length; k += 1) {
        const place = places[k];
        if (place) exempt.add(`${place.line}:${place.col}`);
      }
    }
  }
}

/** The `[start, length]` of each run of a quote that an elision does not break. */
function fragments(quote: string): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const elision of quote.matchAll(/\s*(?:\[\s*\.\.\.\s*\]|\.\.\.)\s*/g)) {
    out.push([at, elision.index - at]);
    at = elision.index + elision[0].length;
  }
  out.push([at, quote.length - at]);
  return out.filter(([, length]) => length > 0);
}

type Offence = { file: string; line: number; col: number; ch: string; text: string; exempt: boolean };

function offences(file: string, source: string, lang: Lang): Offence[] {
  const exempt = quotedReferencePlaces(source, lang);
  const text = source.split(/\r?\n/);
  const found: Offence[] = [];
  for (const { line, chars } of commentLines(source, lang)) {
    for (const { ch, col } of chars) {
      if (ch.charCodeAt(0) < 128) continue;
      found.push({ file, line, col, ch, text: text[line - 1].trim(), exempt: exempt.has(`${line}:${col}`) });
    }
  }
  return found;
}

const SCANNED = SOURCES.flatMap(({ dir, lang, ext }) =>
  filesUnder(dir, ext).map((path) => {
    const source = readFileSync(path, "utf8");
    const file = relative(REPO_ROOT, path).replace(/\\/g, "/");
    return { file, lines: commentLines(source, lang).length, offences: offences(file, source, lang) };
  }),
);

const ALL_OFFENCES = SCANNED.flatMap((file) => file.offences);

function describeOffence({ file, line, col, ch, text }: Offence): string {
  const point = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
  return `${file}:${line}:${col}  ${point} ${JSON.stringify(ch)}\n    ${text}`;
}

describe("a comment reads as ASCII", () => {
  it("census - what the scan reaches", () => {
    const files = SCANNED.filter((file) => file.lines > 0).length;
    const lines = SCANNED.reduce((count, file) => count + file.lines, 0);
    expect(lines, `${lines} comment lines across ${files} files`).toBeGreaterThan(20_000);
  });

  it("no comment line carries a non-ASCII character", () => {
    const offending = ALL_OFFENCES.filter((offence) => !offence.exempt);
    const chars = [...new Set(offending.map((offence) => offence.ch))].join(" ");
    expect(
      offending.map(describeOffence),
      `${offending.length} non-ASCII characters (${chars}) in comment lines. Write the ASCII the `
      + "glyph stands for: -> for an arrow, x for a product, <= and >= for the inequalities, - for a "
      + "dash, ... for an ellipsis, the name of a Greek letter, and delete a box-drawing rule.",
    ).toEqual([]);
  });

  it("the quotation exemption stays where it was written", () => {
    const stray = ALL_OFFENCES.filter(
      (offence) => offence.exempt && !QUOTED_REFERENCE_TEXT.some((path) => offence.file.startsWith(path)),
    );
    expect(
      stray.map(describeOffence),
      "A comment outside the reference tests and the generated spec constants is quoting Reference "
      + "text to keep a glyph. Add the file to QUOTED_REFERENCE_TEXT with the reason, or write the "
      + "ASCII:",
    ).toEqual([]);
  });
});
