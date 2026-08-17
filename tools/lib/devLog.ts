// Pure helpers for the dev-log tool: split a finished post into Discord
// messages and lint it against the style guide's post rules
// (docs/internal/dev_log_style_guide.md). Kept out of the CLI so they can be tested.

export const MESSAGE_LIMIT = 2000;
export const CHUNK_LIMIT = 1900;

export interface LintResult {
  errors: string[];
  warnings: string[];
}

const EM_DASH = /—/;
const HORIZONTAL_RULE = /^\s*---\s*$/m;
// High-precision subset of the guide's banned words - the ambiguous ones
// ("just", "big") are left to the human, since they have legitimate uses.
const HYPE = /\b(massive|huge|finally|exciting|basically|a little|kind of)\b/i;
// The log is one person's, so a plural author is always wrong.
const PLURAL_AUTHOR = /\b(we|our|us)\b/i;
// Singular first person is allowed, for a limit or a judgement call the reader
// would otherwise read as the calculator being broken. It stops being a note
// about the release and starts being a message once it is everywhere, so the
// budget is a count rather than a ban.
const SELF = /\b(i|my|me)\b/gi;
const SELF_BUDGET = 2;
// Emoji blocks and dingbats. Deliberately excludes the arrows and technical
// ranges so `→`, `×`, and `⌈ ⌉` in formulas don't trip it.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

/**
 * Split a finished post into as few messages as fit under the limit, breaking
 * only on `## ` category boundaries. Everything before the first category (ping,
 * title) stays on the first message. Throws if one section alone is too large to
 * place, since there is no safe cut inside it.
 */
export function splitPost(text: string, limit = CHUNK_LIMIT): string[] {
  const body = text.replace(/\s+$/, "");
  if (body.length <= limit) return [body];
  const messages: string[] = [];
  let current = "";
  for (const part of body.split(/\n(?=## )/)) {
    const candidate = current ? `${current}\n${part}` : part;
    if (candidate.length > limit && current) {
      messages.push(current);
      current = part;
    } else {
      current = candidate;
    }
    if (current.length > limit) {
      throw new Error(
        `A section is ${current.length} chars, over the ${limit} limit and cannot be split on a category boundary. Shorten it.`,
      );
    }
  }
  if (current) messages.push(current);
  return messages;
}

/**
 * Check a draft against the post rules. Errors block a send (a broken or
 * off-voice public post); warnings are advisory.
 */
export function lint(text: string): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const body = text.replace(/\s+$/, "");

  const pings = body.match(/<@&\d+>/g) ?? [];
  const firstLine = (body.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
  if (pings.length === 0) errors.push("no role ping (<@&ID>) found");
  else if (pings.length > 1) errors.push(`the role ping appears ${pings.length} times; it must appear once`);
  else if (!/^<@&\d+>/.test(firstLine)) errors.push("the role ping must be the first line");

  if (EM_DASH.test(body)) errors.push("contains an em dash; use a period, comma, or a plain -");
  if (HORIZONTAL_RULE.test(body)) errors.push("contains a `---` line; Discord renders it literally");
  if (!/^# .+/m.test(body)) warnings.push("no `# ` title line");

  const prose = stripCode(body);
  const hype = prose.match(HYPE);
  if (hype) warnings.push(`hype/filler word "${hype[0]}"; the register is plain`);
  const plural = prose.match(PLURAL_AUTHOR);
  if (plural) warnings.push(`plural author "${plural[0]}"; the log has one`);
  const selves = prose.match(SELF)?.length ?? 0;
  if (selves > SELF_BUDGET) {
    warnings.push(`first person ${selves} times, over the budget of ${SELF_BUDGET}; keep it for a limit or a call you made`);
  }
  if (EMOJI.test(body)) warnings.push("contains an emoji; the register is emoji-free");

  return { errors, warnings };
}
