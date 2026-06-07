/**
 * Reference-driven coverage gap report.
 *
 * Parses src/pages/referenceContent.ts (the user-authored primary spec) and
 * cross-checks against Rust fixtures in wasm-engine/fixtures/. Emits a
 * markdown report listing every ability/status with its Reference status
 * and whether at least one fixture appears to cover it.
 *
 * Matching heuristic: slugified name must appear either in a fixture file
 * name OR in the file contents. Heuristic, intentionally loose - false
 * positives are acceptable (coverage claim), false negatives flag real gaps.
 *
 * Usage: npx tsx scripts/reference_coverage_gap.ts
 *        npx tsx scripts/reference_coverage_gap.ts --only-gaps
 *        npx tsx scripts/reference_coverage_gap.ts --json
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MODELED_ABILITY_REFERENCE_DRAFTS,
  STATUS_REFERENCE_DRAFTS,
  COMPARE_ONLY_REFERENCE_DRAFTS,
  KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  type ReferenceStatus,
} from "../src/pages/referenceContent";

type EntryKind = "ability" | "status" | "approximation" | "compare-only";

interface FlatEntry {
  kind: EntryKind;
  name: string;
  status: ReferenceStatus | "Compare-only" | "Approximation";
}

interface CoverageRow extends FlatEntry {
  slug: string;
  fixtureFiles: string[];
  covered: boolean;
  expected: boolean; // is this entry expected to have a fixture?
}

const FIXTURES_DIR = resolve(
  new URL(".", import.meta.url).pathname.replace(/^\//, ""),
  "..",
  "wasm-engine",
  "fixtures",
);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Additional search tokens beyond the primary slug. Used when the fixture
 * names or JSON fields use a shorter form (e.g. fixture "warden_rage" vs
 * Reference "Warden's Rage" → slug "wardens_rage").
 */
const EXTRA_TOKENS: Record<string, string[]> = {
  wardens_rage: ["warden_rage", "wardenrage", "wr"],
  warden_s_resistance: ["warden_resistance", "wardenresistance"],
  hunters_curse: ["hunters_curse", "hunterscurse", "hc"],
  hunters_mark: ["hunters_mark", "huntersmark"],
  unbridled_rage: ["unbridledrage", "ur"],
  life_leech: ["lifeleech"],
  frost_nova: ["frostnova"],
  frost_snare: ["frostsnare"],
  drowsy_area: ["drowsyarea"],
  thorn_trap: ["thorntrap"],
  cursed_sigil: ["cursedsigil"],
  self_destruct: ["selfdestruct", "self_destruct"],
  shadow_barrage: ["shadowbarrage"],
  lich_mark: ["lichmark"],
  bad_omen: ["badomen"],
  quick_recovery: ["quickrecovery", "qr"],
  healing_ailment: ["healingailment"],
  defiled_ground: ["defiledground"],
  first_strike: ["firststrike"],
  cause_fear: ["causefear"],
  breath_resistance: ["breathresistance"],
  cloud_breath: ["cloudbreath"],
  fire_breath: ["firebreath"],
  ice_breath: ["icebreath"],
  acid_breath: ["acidbreath"],
  water_breath: ["waterbreath"],
  toxin_breath: ["toxinbreath"],
  crystal_breath: ["crystalbreath"],
  gold_breath: ["goldbreath"],
  green_fire_breath: ["greenfirebreath"],
  haunt_breath: ["hauntbreath"],
  plague_breath: ["plaguebreath"],
  rock_breath: ["rockbreath"],
  sand_breath: ["sandbreath"],
  virus_breath: ["virusbreath"],
  energy_breath: ["energybreath"],
  glacier_breath: ["glacierbreath"],
  lightning_breath: ["lightningbreath"],
  storm_breath: ["stormbreath"],
  heal_breath: ["healbreath"],
  miasma_breath: ["miasmabreath"],
  spirit_glare: ["spiritglare"],
  solar_beam: ["solarbeam"],
  serrated_teeth: ["serratedteeth"],
  wing_shredder: ["wingshredder"],
  ligament_tear: ["ligamenttear"],
  sticky_fur: ["stickyfur"],
  grim_lariat: ["grimlariat"],
  stubborn_stacker: ["stubbornstacker"],
  two_faced: ["twofaced"],
};

/** Slugs that are too short or too ambiguous to match safely. Require the
 *  full slug only (no substring match). */
const STRICT_SHORT_SLUGS = new Set([
  "ur",
  "hc",
  "wr",
  "qr",
  "aura",
  "charge",
  "spite",
  "lance",
  "guilt",
  "bleed",
  "burn",
  "totem",
  "sickly",
  "muddy",
]);

function candidateTokens(name: string): string[] {
  const primary = slugify(name);
  const extras = EXTRA_TOKENS[primary] ?? [];
  return Array.from(new Set([primary, ...extras]));
}

function flattenReference(): FlatEntry[] {
  const out: FlatEntry[] = [];
  for (const e of MODELED_ABILITY_REFERENCE_DRAFTS) {
    out.push({ kind: "ability", name: e.name, status: e.status });
  }
  for (const e of STATUS_REFERENCE_DRAFTS) {
    out.push({ kind: "status", name: e.name, status: e.status });
  }
  for (const e of COMPARE_ONLY_REFERENCE_DRAFTS) {
    out.push({ kind: "compare-only", name: e.name, status: e.status });
  }
  for (const e of KNOWN_APPROXIMATION_REFERENCE_DRAFTS) {
    out.push({ kind: "approximation", name: e.name, status: "Approximation" });
  }
  return out;
}

interface FixtureIndex {
  files: { path: string; name: string; contentsLower: string }[];
}

function buildFixtureIndex(): FixtureIndex {
  const files: FixtureIndex["files"] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".json")) {
        let contents = "";
        try {
          contents = readFileSync(full, "utf8").toLowerCase();
        } catch {
          /* ignore */
        }
        files.push({ path: full, name: entry.toLowerCase(), contentsLower: contents });
      }
    }
  }
  walk(FIXTURES_DIR);
  return { files };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher(token: string): RegExp {
  // Underscores in the token match any (possibly empty) run of non-alphanum
  // in the target, so the token "storm_breath" matches all of:
  //   storm_breath, storm-breath, storm breath, stormbreath (camelCased after
  //   lowercasing). Left boundary required (start-of-string or non-alphanum)
  //   so "rage" doesn't match "storage". Right side: no boundary required -
  //   this lets camelCase JSON fields like "hardenAvailable" count. For
  //   strict short slugs, require a right boundary too, to prevent "ur"
  //   from matching "url".
  const parts = token.split("_").filter((p) => p.length > 0).map(escapeRegex);
  const joined = parts.join("[^a-z0-9]*");
  if (STRICT_SHORT_SLUGS.has(token)) {
    return new RegExp(`(^|[^a-z0-9])${joined}([^a-z0-9]|$)`);
  }
  return new RegExp(`(^|[^a-z0-9])${joined}`);
}

function findFixtures(name: string, index: FixtureIndex): string[] {
  const tokens = candidateTokens(name);
  const matchers = tokens.map(buildMatcher);
  const hits = new Set<string>();
  for (const f of index.files) {
    for (const re of matchers) {
      if (re.test(f.name) || re.test(f.contentsLower)) {
        hits.add(f.path);
        break;
      }
    }
  }
  return Array.from(hits).sort();
}

function isExpectedToBeCovered(e: FlatEntry): boolean {
  // Only Modeled / Partial entries are expected to have fixtures.
  // Compare-only, Out of model, Not modeled yet, Not planned, Disputed,
  // Sandbox-only, Approximations - not expected in BB path.
  return e.status === "Modeled" || e.status === "Partial";
}

function buildReport(): CoverageRow[] {
  const index = buildFixtureIndex();
  const entries = flattenReference();
  return entries.map((e) => {
    const fixtureFiles = findFixtures(e.name, index);
    return {
      ...e,
      slug: slugify(e.name),
      fixtureFiles,
      covered: fixtureFiles.length > 0,
      expected: isExpectedToBeCovered(e),
    };
  });
}

function renderMarkdown(rows: CoverageRow[], opts: { onlyGaps: boolean }): string {
  const lines: string[] = [];
  lines.push("# Reference Coverage Gap Report");
  lines.push("");
  lines.push(`Source: \`src/pages/referenceContent.ts\` vs \`wasm-engine/fixtures/\``);
  lines.push("");

  const kinds: EntryKind[] = ["ability", "status", "approximation", "compare-only"];
  for (const kind of kinds) {
    const group = rows.filter((r) => r.kind === kind);
    if (group.length === 0) continue;

    const expected = group.filter((r) => r.expected).length;
    const covered = group.filter((r) => r.expected && r.covered).length;
    const gaps = group.filter((r) => r.expected && !r.covered);

    lines.push(`## ${kind} (${covered}/${expected} expected covered)`);
    lines.push("");
    lines.push("| Name | Status | Fixture? | Files |");
    lines.push("|---|---|---|---|");
    const show = opts.onlyGaps ? gaps : group;
    for (const r of show) {
      const fixtureMark = r.expected
        ? r.covered
          ? "YES"
          : "**GAP**"
        : r.covered
          ? "yes (bonus)"
          : "n/a";
      const fileList = r.fixtureFiles
        .map((p) => p.split(/[\\/]/).pop())
        .slice(0, 3)
        .join(", ");
      lines.push(
        `| ${r.name} | ${r.status} | ${fixtureMark} | ${fileList || "-"} |`,
      );
    }
    lines.push("");
  }

  const totalExpected = rows.filter((r) => r.expected).length;
  const totalCovered = rows.filter((r) => r.expected && r.covered).length;
  const totalGaps = totalExpected - totalCovered;
  lines.push(`---`);
  lines.push(`**Summary:** ${totalCovered}/${totalExpected} expected entries covered. ${totalGaps} gaps.`);
  return lines.join("\n");
}

function main() {
  const args = new Set(process.argv.slice(2));
  const rows = buildReport();

  if (args.has("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const onlyGaps = args.has("--only-gaps");
  console.log(renderMarkdown(rows, { onlyGaps }));

  // Exit code 1 if any Modeled/Partial entry has no fixture - CI hook.
  const hasGaps = rows.some((r) => r.expected && !r.covered);
  if (args.has("--ci") && hasGaps) {
    process.exitCode = 1;
  }
}

main();
