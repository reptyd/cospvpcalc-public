/**
 * Textual DSL for UserTimingSpec - paste pseudocode → custom
 * timing policy. Mirrors abilityDsl.ts but for the policy half.
 *
 * Syntax:
 *
 *   timing user.fast_burst "Fast Burst"
 *     candidates: 0, 0.1, 0.5
 *     horizon: 15
 *     threshold: 0.001
 *     force_skip: self.hp_ratio < 0.1
 *     force_fire: opp.hp_ratio < 0.2
 */

import { parseExpr, printExpr } from "./exprDsl";
import type { UserTimingSpec } from "./customAbilityTypes";

export type ParseResult =
  | { ok: true; spec: UserTimingSpec }
  | { ok: false; error: string; line?: number };

export function parseTiming(source: string): ParseResult {
  const lines = source
    .split(/\r?\n/)
    .map((l, i) => ({ raw: i + 1, text: l.replace(/\s+$/, "") }))
    .filter(({ text }) => {
      const stripped = text.trimStart();
      return stripped && !stripped.startsWith("//") && !stripped.startsWith("#");
    });
  if (lines.length === 0) return { ok: false, error: "empty source" };

  const headerRaw = lines[0];
  const stripped = headerRaw.text.trimStart();
  const m = stripped.match(/^timing\s+(\S+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/);
  if (!m) {
    return {
      ok: false,
      error: `expected: timing <id> "<display name>" - got: ${stripped}`,
      line: headerRaw.raw,
    };
  }
  const spec: UserTimingSpec = {
    id: m[1],
    display_name: (m[2] ?? m[3] ?? m[4] ?? "").trim(),
    candidates: [],
    horizon_sec: 0,
  };

  for (let i = 1; i < lines.length; i += 1) {
    const { raw, text } = lines[i];
    const t = text.trimStart();
    const candM = t.match(/^candidates\s*:\s*(.+)$/);
    if (candM) {
      const parts = candM[1].split(",").map((p) => p.trim()).filter(Boolean);
      const nums = parts.map(Number);
      if (!nums.every((n) => Number.isFinite(n) && n >= 0)) {
        return { ok: false, error: `bad candidates: ${candM[1]}`, line: raw };
      }
      spec.candidates = nums;
      continue;
    }
    const horM = t.match(/^horizon(?:_sec)?\s*:\s*([0-9.eE+-]+)$/);
    if (horM) {
      spec.horizon_sec = Number(horM[1]);
      continue;
    }
    const threshM = t.match(/^threshold\s*:\s*([0-9.eE+-]+)$/);
    if (threshM) {
      spec.threshold = Number(threshM[1]);
      continue;
    }
    const forceM = t.match(/^(force_skip|force_fire)\s*:\s*(.+)$/);
    if (forceM) {
      const expr = parseExpr(forceM[2]);
      if (!expr.ok) {
        return { ok: false, error: `expr in ${forceM[1]}: ${expr.error}`, line: raw };
      }
      if (forceM[1] === "force_skip") spec.force_skip = expr.expr;
      else spec.force_fire = expr.expr;
      continue;
    }
    return { ok: false, error: `unrecognized line: ${t}`, line: raw };
  }

  if (spec.candidates.length === 0) {
    return { ok: false, error: "candidates: required and must be non-empty" };
  }
  return { ok: true, spec };
}

export function printTiming(spec: UserTimingSpec): string {
  const lines: string[] = [];
  lines.push(`timing ${spec.id || "user."} "${spec.display_name || ""}"`);
  lines.push(`  candidates: ${spec.candidates.join(", ")}`);
  lines.push(`  horizon: ${spec.horizon_sec}`);
  if (spec.threshold !== undefined) {
    lines.push(`  threshold: ${spec.threshold}`);
  }
  if (spec.force_skip) {
    lines.push(`  force_skip: ${printExpr(spec.force_skip)}`);
  }
  if (spec.force_fire) {
    lines.push(`  force_fire: ${printExpr(spec.force_fire)}`);
  }
  return lines.join("\n");
}
