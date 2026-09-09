import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Every cooldown an activation charges goes through `charge_active_cooldown`,
// which takes both decisions in one place: the cooldown runs from the moment
// the ability was used, and it is multiplied by the creature's ability cooldown
// multiplier. The game does the same, and no ability differs on either. Four
// abilities here did: while each wrote its own `*_cooldown_until`, Seedling
// Mist, Lance and the auto-fire breath dropped the multiplier, and Reflux
// counted from the puddle rather than from the cast.
//
// This is the static half. A site that writes a cooldown without the helper
// within three lines has to be named below with a reason.

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_SRC = resolve(HERE, "..", "..", "wasm-engine", "src");

// Assignments that are not an activation charging a cooldown. Each line says
// why, and a new line here is a claim that needs the same kind of reason.
const ALLOWED = new Map<string, string>([
  [
    "composable/setup.rs",
    "Spite starts a fight already 20 seconds into its cooldown; that is a starting state, not an activation.",
  ],
  [
    "actives.rs",
    "Self-Destruct is passive: the figure is its fuse, and no activation charges it.",
  ],
]);

// Test files set cooldowns to arrange a state rather than to model an
// activation, so they are read as fixtures.
const TEST_FILE = /(^|[\\/])(phase_tests|tests|fixture_tests|reference_tests|policy_tests|posture_tests)([\\/]|\.rs$)/;

const ASSIGNMENT = /(\w+_cooldown_until)\s*=\s*(.*)$/;
// A right-hand side that carries no interval: a reset, a copy, or the loop's
// own clock.
const NOT_AN_INTERVAL = /^(0\.0|now|time|f64::INFINITY|\w+_cooldown_until)\s*[;,]?$/;

function rustFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      rustFiles(full, out);
    } else if (name.endsWith(".rs")) {
      out.push(full);
    }
  }
  return out;
}

type Site = { file: string; line: number; text: string };

function unscaledSites(): Site[] {
  const sites: Site[] = [];
  for (const file of rustFiles(ENGINE_SRC)) {
    const rel = relative(ENGINE_SRC, file).split(sep).join("/");
    if (TEST_FILE.test(rel)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.trim().startsWith("//")) return;
      const match = ASSIGNMENT.exec(line);
      if (!match) return;
      if (NOT_AN_INTERVAL.test(match[2].trim())) return;
      const window = lines.slice(Math.max(0, index - 3), index + 3).join(" ");
      if (window.includes("charge_active_cooldown")) return;
      sites.push({ file: rel, line: index + 1, text: line.trim() });
    });
  }
  return sites;
}

describe("active cooldown scaling", () => {
  it("every cooldown an activation charges is scaled by the ability cooldown multiplier", () => {
    const unexplained = unscaledSites().filter((site) => !ALLOWED.has(site.file));
    expect(
      unexplained.map((site) => `${site.file}:${site.line} ${site.text}`),
      "these cooldowns are written without `charge_active_cooldown`, so the moment they start and " +
        "the multiplier they carry are decided here instead of in one place. Charge them through the " +
        "helper, or - if no activation charges it - name the file in ALLOWED with the reason.",
    ).toEqual([]);
  });

  it("every allowed file still has a site to explain", () => {
    const files = new Set(unscaledSites().map((site) => site.file));
    const stale = [...ALLOWED.keys()].filter((file) => !files.has(file));
    expect(
      stale,
      "these files are named in ALLOWED but no longer hold an unscaled cooldown - drop the line",
    ).toEqual([]);
  });
});
