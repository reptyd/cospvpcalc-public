/**
 * Early Changes - apply pre-wiki stat drops and user-specific overrides to the
 * local data, preview how the text was interpreted, manage their lifecycle, and
 * push to prod + announce on Discord under the tool's own signature.
 *
 * Input shapes, auto-detected: delta blocks and Notion buff/nerf asides fold
 * straight into creatures.runtime.json (so the change is live in the app) plus
 * an anchored override that keeps the value pinned through wiki syncs until the
 * wiki catches up; a subspecies materialises from base + deltas; a full
 * "Creature: X / Basic Stats: ..." stat block materialises a whole new creature.
 *
 * Usage:
 *   npx tsx tools/early-changes.ts --menu              # interactive menu (the launcher's mode)
 *   npx tsx tools/early-changes.ts                     # preview the interpretation
 *   npx tsx tools/early-changes.ts --apply             # write the changes to local data
 *   npx tsx tools/early-changes.ts --apply --dry       # show the entries, write nothing
 *   npx tsx tools/early-changes.ts --push              # apply + commit + push to prod
 *   npx tsx tools/early-changes.ts --send-discord      # announce to Discord (own signature)
 *   npx tsx tools/early-changes.ts --push --send-discord --dry  # full dry run
 *   npx tsx tools/early-changes.ts --list              # list overrides + lifecycle status
 *   npx tsx tools/early-changes.ts --retire <id>       # manually expire an override
 *
 * Input (pick one): --clipboard (paste), --stdin (piped), or --input <file>
 * (default tools/early-changes.input.txt).
 *
 * Apply flags:
 *   --channel <c>     early | user-specific        (default early)
 *   --released        the change is already released (dev site drop, wiki not
 *                     yet updated); the Discord post says so instead of the
 *                     default "upcoming, may still change before release"
 *   --source <name>   provenance recorded on each entry (default early-changes)
 *   --note <text>     note recorded on each entry   (default: the creature insight)
 *   --expires <ISO>   date hard cutoff on each entry (e.g. 2026-09-01)
 *   --no-anchor       do NOT anchor to the wiki's current value (manual expiry only)
 *
 * Re-applying a change updates its existing override in place (same id) rather
 * than piling up "-2" duplicates.
 *
 * Push / Discord (own signature; --dry suppresses every side effect):
 *   --push            commit + push the touched data files to origin/main
 *   --send-discord    post the change summary via the webhook (env
 *                     COS_WIKI_SYNC_DISCORD_WEBHOOK or tools/wiki-sync.webhook.local)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  parseEarlyChanges,
  type ParsedCreatureChange,
  type ParsedDelta,
} from "./lib/earlyChangeParser";
import { loadRoster, type CreatureRoster } from "./lib/creatureRoster";
import { loadCreatureRefs } from "./lib/creatureRefs";
import {
  describeEntry,
  lifecycleStatus,
  parseRetireSelection,
  readManualOverrides,
  retireEntry,
  writeManualOverrides,
  type ManualOverrideEntry,
  type OverrideChannel,
} from "./lib/manualOverrides";
import { creatureDeltasToOverrides } from "./lib/applyEarlyChanges";
import { abilityMatches, dropValueToRuntime, runtimeValueToDrop } from "./lib/abilityMatch";
import {
  commitAndPushPaths,
  gitStatusFor,
  readWebhook,
  sendDiscordMessages,
} from "./lib/toolkit";
import {
  buildEarlyChangesDiscord,
  buildNewCreaturesDiscord,
  type ReleaseStage,
} from "./lib/earlyChangesDiscord";
import { applyDeltasToExisting, materializeSubspecies } from "./lib/materializeSubspecies";
import {
  CREATURES_RUNTIME_REPO_PATH,
  readCreaturesFile,
  upsertCreature,
  writeCreaturesFile,
} from "./lib/creaturesFile";
import { syncEffectsCatalog } from "./sync_effects_catalog";
import type { CreatureRuntime } from "./lib/creatureRoster";
import {
  materializeNewCreature,
  parseFullCreatures,
  type ParsedFullCreature,
} from "./lib/fullCreatureParser";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const DEFAULT_INPUT = path.join(ROOT, "tools", "early-changes.input.txt");
// Early changes post to the SAME Discord channel as wiki-sync - they're the same
// kind of update from the user's side - so this reads wiki-sync's webhook. The
// posts carry an "early" marker (see earlyChangesDiscord) so they're still
// distinguishable from an official wiki sync in that channel.
const WEBHOOK_ENV = "COS_WIKI_SYNC_DISCORD_WEBHOOK";
const WEBHOOK_FILE = path.join(ROOT, "tools", "wiki-sync.webhook.local");
const USER_AGENT = "CoS-PvP-Calc/2.0 (early-changes)";
const OVERRIDES_PATH = "data/manual_overrides.json";
const EFFECTS_CATALOG_PATH = "data/effects_catalog.runtime.v2.json";

function commitMessage(): string {
  return process.env.COS_EARLY_CHANGES_COMMIT_MESSAGE?.trim() || "Apply early changes";
}
function pushBranch(): string {
  return process.env.COS_EARLY_CHANGES_PUSH_BRANCH?.trim() || "main";
}

const argv = process.argv.slice(2);
const hasFlag = (name: string): boolean => argv.includes(name);
const readArg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

type InputSource = { kind: "clipboard" } | { kind: "stdin" } | { kind: "file"; path: string };

interface RunConfig {
  source: InputSource;
  channel: OverrideChannel;
  stage: ReleaseStage;
  write: boolean;
  push: boolean;
  discord: boolean;
  dry: boolean;
  replace: boolean;
  yes: boolean;
  anchor: boolean;
  provenance: string;
  note?: string;
  expiresAt?: string;
}

function configFromArgv(): RunConfig {
  const push = hasFlag("--push");
  return {
    source: hasFlag("--clipboard")
      ? { kind: "clipboard" }
      : hasFlag("--stdin")
        ? { kind: "stdin" }
        : { kind: "file", path: readArg("--input") ?? DEFAULT_INPUT },
    channel: (readArg("--channel") as OverrideChannel) ?? "early",
    stage: hasFlag("--released") ? "released" : "upcoming",
    write: hasFlag("--apply") || push,
    push,
    discord: hasFlag("--send-discord"),
    dry: hasFlag("--dry"),
    replace: hasFlag("--replace"),
    yes: hasFlag("--yes") || hasFlag("-y"),
    anchor: !hasFlag("--no-anchor"),
    provenance: readArg("--source") ?? "early-changes",
    note: readArg("--note"),
    expiresAt: readArg("--expires"),
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// One shared readline feeding a line queue - rl.question only listens while a
// question is pending, so type-ahead lines arriving between questions would be
// dropped. EOF aborts the pending ask instead of hanging it.
let prompts: readline.Interface | null = null;
let inputClosed = false;
const pendingLines: string[] = [];
const lineWaiters: Array<(line: string | null) => void> = [];

function ensurePrompts(): void {
  if (prompts) return;
  prompts = readline.createInterface({ input: process.stdin, output: process.stdout });
  prompts.on("line", (line) => {
    const waiter = lineWaiters.shift();
    if (waiter) waiter(line);
    else pendingLines.push(line);
  });
  prompts.on("close", () => {
    inputClosed = true;
    for (const waiter of lineWaiters.splice(0)) waiter(null);
  });
}

async function ask(question: string): Promise<string> {
  ensurePrompts();
  process.stdout.write(question);
  const line = pendingLines.length
    ? pendingLines.shift()!
    : await new Promise<string | null>((resolve) => {
        if (inputClosed) resolve(null);
        else lineWaiters.push(resolve);
      });
  if (line === null) throw new Error("Input ended - aborted.");
  return line.trim();
}

function closePrompts(): void {
  prompts?.close();
  prompts = null;
}

async function askYesNo(question: string): Promise<boolean> {
  const answer = (await ask(`${question} [y/N] `)).toLowerCase();
  return answer === "y" || answer === "yes";
}

/** Ask for a yes/no before a write / push / Discord send. --yes skips it.
 *  Piped (--stdin) input leaves no console to prompt on, so it refuses rather
 *  than act silently - re-run with --yes or preview with --dry. */
async function confirmProceed(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.log("  Non-interactive input - not proceeding. Re-run with --yes to go ahead, or --dry to preview.");
    return false;
  }
  return askYesNo(question);
}

function fmtVal(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "-" : String(value);
}

function currentAbility(creature: CreatureRuntime, name: string): { value: number | string | null } | null {
  for (const list of [creature.passiveAbilities, creature.activatedAbilities, creature.breathAbilities]) {
    const found = list.find((a) => abilityMatches(name, a));
    if (found) return found;
  }
  return null;
}

// When the creature already exists, each delta is shown as "current -> your
// value" plus whether it is already set, a real change, or a no-op - so the
// paste can be checked against what the data actually holds. Without a match
// (new creature / subspecies) it falls back to the text's own from -> to.
function renderDelta(delta: ParsedDelta, creature?: CreatureRuntime): string {
  const pad = (s: string) => s.padEnd(18);
  const same = (a: unknown, b: unknown) => String(a) === String(b);

  if (!creature) {
    switch (delta.kind) {
      case "stat":
        return `  stat     ${pad(delta.field ?? "")} ${fmtVal(delta.from)} -> ${fmtVal(delta.to)}`;
      case "ability-value":
        return `  ability  ${pad(delta.ability ?? "")} ${fmtVal(delta.from)} -> ${fmtVal(delta.to)}`;
      case "ability-add":
        return `  + add    ${delta.ability}${delta.value != null ? ` (${delta.value})` : ""}`;
      case "ability-remove":
        return `  - remove ${delta.ability}`;
      case "unknown":
        return `  ? unknown  "${delta.raw}"${delta.note ? ` - ${delta.note}` : ""}`;
    }
  }

  switch (delta.kind) {
    case "stat": {
      const cur = (creature.stats as Record<string, unknown>)[delta.field ?? ""];
      return `  stat     ${pad(delta.field ?? "")} ${fmtVal(cur as never)} -> ${fmtVal(delta.to)}   ${same(cur, delta.to) ? "already set" : "CHANGE"}`;
    }
    case "ability-value": {
      const ab = currentAbility(creature, delta.ability ?? "");
      const targetRuntime = dropValueToRuntime(delta.ability ?? "", delta.to ?? null);
      const status = !ab ? "adds (absent now)" : same(ab.value, targetRuntime) ? "already set" : "CHANGE";
      const cur = ab ? fmtVal(runtimeValueToDrop(delta.ability ?? "", ab.value)) : "(absent)";
      return `  ability  ${pad(delta.ability ?? "")} ${cur} -> ${fmtVal(delta.to)}   ${status}`;
    }
    case "ability-add": {
      const has = currentAbility(creature, delta.ability ?? "");
      return `  + add    ${delta.ability}${delta.value != null ? ` (${delta.value})` : ""}   ${has ? "already present" : "new"}`;
    }
    case "ability-remove": {
      const has = currentAbility(creature, delta.ability ?? "");
      return `  - remove ${delta.ability}   ${has ? "present -> removes" : "not present (no-op)"}`;
    }
    case "unknown":
      return `  ? unknown  "${delta.raw}"${delta.note ? ` - ${delta.note}` : ""}`;
  }
}

function renderCreaturePreview(entry: ParsedCreatureChange, roster: CreatureRoster): string[] {
  const current = roster.get(entry.creature);
  const baseName = current ? null : roster.subspeciesBaseOf(entry.creature);
  const status = current
    ? "ALREADY EXISTS - comparing to current data"
    : baseName
      ? `NEW subspecies of ${baseName}`
      : entry.kind === "new-full"
        ? "NEW creature (full stat block)"
        : "NOT in roster - new creature or unknown name";
  const lines = [`Creature: ${entry.creature}   ${status}`];
  for (const delta of entry.deltas) lines.push(renderDelta(delta, current));
  for (const warning of entry.warnings) lines.push(`  ! ${warning}`);
  if (entry.insight) lines.push(`  insight: ${entry.insight}`);
  return lines;
}

function readClipboard(): string {
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" });
  } catch {
    console.error("Could not read the clipboard. Paste into a file and use --input instead.");
    process.exit(1);
  }
}

/** Source the early-change text: pasted from the clipboard, piped on stdin,
 *  or an input file. */
function loadInput(source: InputSource): { label: string; text: string } {
  if (source.kind === "clipboard") {
    const text = readClipboard();
    if (!text.trim()) {
      console.error("Clipboard is empty - copy the early-change text first.");
      process.exit(1);
    }
    return { label: "clipboard", text };
  }
  if (source.kind === "stdin") {
    const text = fs.readFileSync(0, "utf8");
    if (!text.trim()) {
      console.error("No text received on stdin.");
      process.exit(1);
    }
    return { label: "stdin", text };
  }
  if (!fs.existsSync(source.path)) {
    console.error(`Input file not found: ${source.path}`);
    console.error("Paste into tools/early-changes.input.txt, pass --input <path>, or use --clipboard / --stdin.");
    process.exit(1);
  }
  return {
    label: path.relative(ROOT, source.path).replace(/\\/g, "/"),
    text: fs.readFileSync(source.path, "utf8"),
  };
}

function activeEntries(entries: ManualOverrideEntry[]): ManualOverrideEntry[] {
  const now = Date.now();
  return entries.filter((entry) => lifecycleStatus(entry, now) === "active");
}

function runList(): void {
  const entries = readManualOverrides();
  const now = Date.now();
  console.log(`\n=== Manual overrides (${entries.length}) ===\n`);
  for (const entry of entries) {
    const status = lifecycleStatus(entry, now);
    const anchor = "expectedWikiValue" in entry && entry.expectedWikiValue !== undefined
      ? ` [anchor ${JSON.stringify(entry.expectedWikiValue)}]`
      : "";
    const expires = entry.expiresAt ? ` [expires ${entry.expiresAt}]` : "";
    console.log(`  [${status.padEnd(11)}] ${entry.id.padEnd(34)} (${entry.channel})`);
    console.log(`      ${describeEntry(entry)}${anchor}${expires}`);
  }
  console.log("");
}

function runRetire(id: string): void {
  const entries = readManualOverrides();
  const retired = retireEntry(entries, id, todayISO());
  if (!retired) {
    console.error(`No active override with id "${id}" (unknown or already retired).`);
    process.exit(1);
  }
  writeManualOverrides(entries);
  console.log(`Retired ${id} (retiredAt ${retired.retiredAt}). ${describeEntry(retired)}`);
}

/** Numbered multi-retire: pick entries by position, range, channel, or "all".
 *  Retiring stops the override from applying; the app's data returns to wiki
 *  numbers on the next wiki-sync run. */
async function runRetireInteractive(): Promise<void> {
  const entries = readManualOverrides();
  const active = activeEntries(entries);
  if (!active.length) {
    console.log("\n  No active overrides - nothing to retire.\n");
    return;
  }
  // This tool is the only writer of the overrides file, so pending changes in
  // it are a previous run that never reached a push. They are named below and
  // carried into this commit; refusing to push is what left the file dirty for
  // six days and made every later run refuse for the same reason.
  const pendingBefore = gitStatusFor(ROOT, [OVERRIDES_PATH]);

  console.log(`\n  Active overrides (${active.length}):\n`);
  active.forEach((entry, i) => {
    const expires = entry.expiresAt ? `  [expires ${entry.expiresAt}]` : "";
    console.log(`  ${String(i + 1).padStart(3)}. [${entry.channel === "early" ? "early" : "user "}] ${describeEntry(entry)}${expires}`);
  });
  console.log("");

  let picked: ManualOverrideEntry[] | null = null;
  while (!picked) {
    const answer = await ask(`  Retire which? Numbers/ranges ("1 3 5-7"), "early", "user-specific", "all"; Enter cancels: `);
    if (!answer) {
      console.log("  Nothing retired.\n");
      return;
    }
    const result = parseRetireSelection(answer, active);
    if ("error" in result) {
      console.log(`  ${result.error}`);
      continue;
    }
    picked = result.picked;
  }

  console.log("");
  for (const entry of picked) console.log(`    - ${describeEntry(entry)}`);
  if (!(await askYesNo(`  Retire ${picked.length} override(s)?`))) {
    console.log("  Nothing retired.\n");
    return;
  }

  const date = todayISO();
  for (const entry of picked) retireEntry(entries, entry.id, date);
  writeManualOverrides(entries);
  console.log(`  Retired ${picked.length} override(s). App data returns to wiki numbers on the next wiki-sync run.`);

  if (pendingBefore) {
    console.log(`  ${OVERRIDES_PATH} already carried uncommitted changes, and they go into the same commit:`);
    console.log(pendingBefore.split("\n").map((line) => `    ${line}`).join("\n"));
  }
  if (await askYesNo("  Push the retirement to prod?")) {
    const pushed = commitAndPushPaths(ROOT, [OVERRIDES_PATH], "Retire early-change overrides", pushBranch());
    console.log(pushed ? `  Pushed ${OVERRIDES_PATH} to origin/${pushBranch()}.\n` : "  Nothing to push.\n");
  } else {
    console.log("  Retired locally - not pushed.\n");
  }
}

async function runApply(config: RunConfig): Promise<void> {
  const { label: inputLabel, text } = loadInput(config.source);
  const parsed = parseEarlyChanges(text);
  const opts = {
    channel: config.channel,
    source: config.provenance,
    note: config.note,
    anchor: config.anchor,
    expiresAt: config.expiresAt,
  };

  const roster = loadRoster();
  const existing = readManualOverrides();
  const taken = new Set<string>();

  const mode = config.push ? "apply + push" : config.write ? "apply" : "preview";
  const batchLabel = config.channel === "user-specific" ? config.channel : `${config.channel}, ${config.stage}`;
  console.log(`\n=== Early Changes - ${mode} (${batchLabel}) ===`);
  console.log(`  input:  ${inputLabel}`);
  console.log(`  format: ${parsed.format}\n`);

  const applied: ParsedCreatureChange[] = [];
  const newEntries: ManualOverrideEntry[] = [];
  const materialized: CreatureRuntime[] = [];
  const newFullCreatures: CreatureRuntime[] = [];

  if (parsed.format === "full-creature") {
    for (const full of parseFullCreatures(text, loadCreatureRefs())) {
      const exists = roster.has(full.name);
      let overwrite = config.replace;
      // Interactive runs decide the overwrite on the spot; flag-driven runs
      // keep the explicit --replace contract.
      if (exists && !overwrite && !config.dry && process.stdin.isTTY) {
        console.log(`Creature: ${full.name}   already in the roster.`);
        overwrite = await askYesNo(`  Overwrite it? Any field absent from the block resets to its default.`);
      }
      if (exists && !overwrite) {
        console.log(`Creature: ${full.name}   SKIPPED - already in the roster; a full-block apply would replace it and may drop fields. Use a delta block to change stats, or answer y / pass --replace to overwrite.`);
        console.log("");
        continue;
      }
      if (exists) {
        console.log(`Creature: ${full.name}   REPLACE - overwriting the existing roster entry (any field absent from the block resets to its default).`);
      }
      const result = materializeNewCreature(full);
      for (const line of renderFullCreature(full)) console.log(line);
      for (const warning of result.warnings) {
        if (!full.warnings.includes(warning)) console.log(`  ! ${warning}`);
      }
      materialized.push(result.creature);
      // Only a genuinely new creature is announced as new; a replace is a fix.
      if (!exists) newFullCreatures.push(result.creature);
      console.log("");
    }
  }

  const deltaCreatures = parsed.format === "full-creature" ? [] : parsed.creatures;
  for (const creature of deltaCreatures) {
    // A subspecies not yet in the roster is materialised from its base + deltas.
    if (creature.kind !== "new-full" && !roster.has(creature.creature)) {
      const baseName = roster.subspeciesBaseOf(creature.creature);
      const base = baseName ? roster.get(baseName) : undefined;
      if (base) {
        const result = materializeSubspecies(creature, base, roster);
        for (const line of renderCreaturePreview(creature, roster)) console.log(line);
        for (const warning of result.warnings) {
          if (!creature.warnings.includes(warning)) console.log(`  ! ${warning}`);
        }
        materialized.push(result.creature);
        applied.push(creature);
        console.log("");
        continue;
      }
    }

    const result = creatureDeltasToOverrides(creature, opts, roster, taken);
    if (result.skipped) {
      console.log(`Creature: ${result.creature}   SKIPPED - ${result.skipped}`);
      for (const warning of result.warnings) console.log(`  ! ${warning}`);
    } else {
      for (const line of renderCreaturePreview(creature, roster)) console.log(line);
      for (const warning of result.warnings) {
        if (!creature.warnings.includes(warning)) console.log(`  ! ${warning}`);
      }
      newEntries.push(...result.entries);
      applied.push(creature);
      // The override alone is dormant until the next wiki sync - the app ships
      // data/*.runtime.json. Fold the deltas into the runtime entry too, so the
      // change is live on prod now; the override then keeps it pinned through
      // future syncs until the wiki catches up.
      const current = roster.get(creature.creature);
      const folded = current ? applyDeltasToExisting(creature, current, roster) : null;
      if (folded) {
        materialized.push(folded.creature);
        for (const warning of folded.warnings) {
          if (!creature.warnings.includes(warning)) console.log(`  ! ${warning}`);
        }
      }
    }
    console.log("");
  }
  for (const warning of parsed.warnings) console.log(`  ! ${warning}`);

  // Re-applying a change replaces its existing entry (same id, retired or not)
  // instead of minting "-2" duplicates - re-runs converge on one entry each.
  const merged = [...existing];
  let updatedCount = 0;
  for (const entry of newEntries) {
    const i = merged.findIndex((e) => e.id === entry.id);
    if (i >= 0) {
      merged[i] = entry;
      updatedCount += 1;
    } else {
      merged.push(entry);
    }
  }

  // Paths this run touches: overrides for delta changes; materialised entries
  // (folded deltas, subspecies, full creatures) also rewrite
  // creatures.runtime.json and the effects catalog derived from it.
  const pushPaths: string[] = [];
  if (newEntries.length) pushPaths.push(OVERRIDES_PATH);
  if (materialized.length) pushPaths.push(CREATURES_RUNTIME_REPO_PATH, EFFECTS_CATALOG_PATH);

  // This tool is the only writer of these paths, so pending changes in them are
  // a previous run that never reached a push. They are named and carried into
  // this commit rather than aborting it: an abort leaves the file dirty, and the
  // next run then aborts for the same reason.
  if (config.push && !config.dry && pushPaths.length) {
    const pending = gitStatusFor(ROOT, pushPaths);
    if (pending) {
      console.log("  These paths already carried uncommitted changes, and they go into the same commit:");
      console.log(pending.split("\n").map((line) => `    ${line}`).join("\n"));
    }
  }

  // Build the Discord post NOW so its exact text is shown before any confirm -
  // the run always previews what it changes (above) AND what it posts (here),
  // in one flow, rather than posting something you never saw.
  const discordMessages = config.discord
    ? [
        ...buildEarlyChangesDiscord(applied, config.channel, config.stage),
        ...buildNewCreaturesDiscord(newFullCreatures, config.stage),
      ]
    : [];
  if (config.discord) {
    if (discordMessages.length === 0) {
      console.log("  Discord: nothing to announce.");
    } else {
      console.log("  --- Discord preview (exactly what will be posted) ---");
      for (const [i, m] of discordMessages.entries()) {
        console.log(`  [message ${i + 1}/${discordMessages.length}]\n${m.replace(/^/gm, "  ")}`);
      }
      console.log("");
    }
  }

  // Show what is about to happen and confirm before any side effect.
  if (!config.dry) {
    const actions: string[] = [];
    if (config.write && newEntries.length) {
      const detail = updatedCount ? ` (${updatedCount} updating an existing entry)` : "";
      actions.push(`save ${newEntries.length} override(s)${detail}`);
    }
    if (config.write && materialized.length) actions.push(`write ${materialized.length} creature entr${materialized.length === 1 ? "y" : "ies"} to the roster data`);
    if (config.push && pushPaths.length) actions.push(`commit + push to origin/${pushBranch()}`);
    if (config.discord && discordMessages.length) actions.push(`post ${discordMessages.length} Discord message(s)`);
    if (actions.length) {
      console.log(`  About to: ${actions.join(", ")}.`);
      if (!(await confirmProceed("  Proceed?", config.yes))) {
        console.log("  Aborted - nothing changed.\n");
        return;
      }
      console.log("");
    }
  }

  if (config.write && newEntries.length) {
    if (config.dry) {
      console.log(`  DRY RUN: would write ${newEntries.length} override(s) to ${OVERRIDES_PATH}${updatedCount ? ` (${updatedCount} updating an existing entry)` : ""}.`);
    } else {
      writeManualOverrides(merged);
      console.log(`  Wrote ${newEntries.length} override(s) to ${OVERRIDES_PATH}${updatedCount ? ` (${updatedCount} updated in place)` : ""}.`);
    }
  }

  if (config.write && materialized.length) {
    if (config.dry) {
      console.log(`  DRY RUN: would write ${materialized.length} creature entr${materialized.length === 1 ? "y" : "ies"} to ${CREATURES_RUNTIME_REPO_PATH} + regenerate the effects catalog.`);
    } else {
      const data = readCreaturesFile();
      for (const creature of materialized) {
        console.log(`  ${upsertCreature(data, creature)} ${creature.name} in ${CREATURES_RUNTIME_REPO_PATH}.`);
      }
      writeCreaturesFile(data);
      syncEffectsCatalog();
      console.log(`  Regenerated the effects catalog.`);
    }
  }

  if (config.write && !newEntries.length && !materialized.length) console.log("  Nothing to write.");

  if (config.discord && discordMessages.length) {
    if (config.dry) {
      console.log(`  DRY RUN: would post ${discordMessages.length} Discord message(s) (previewed above).`);
    } else {
      const webhook = readWebhook(WEBHOOK_ENV, WEBHOOK_FILE);
      if (!webhook) {
        console.log(`  Discord: no webhook (set ${WEBHOOK_ENV} or ${path.relative(ROOT, WEBHOOK_FILE).replace(/\\/g, "/")}). Skipped.`);
      } else {
        await sendDiscordMessages(webhook, discordMessages, USER_AGENT);
        console.log(`  Discord: posted ${discordMessages.length} message(s).`);
      }
    }
  }

  if (config.push) {
    if (!pushPaths.length) {
      console.log("  Nothing to push.");
    } else if (config.dry) {
      console.log(`  DRY RUN: would commit + push ${pushPaths.join(", ")} to origin/${pushBranch()}.`);
    } else {
      const pushed = commitAndPushPaths(ROOT, pushPaths, commitMessage(), pushBranch());
      console.log(pushed ? `  Pushed ${pushPaths.join(", ")} to origin/${pushBranch()}.` : "  Nothing to push.");
    }
  }
  console.log("");
}

function renderFullCreature(full: ParsedFullCreature): string[] {
  const lines = [`Creature: ${full.name}   [new full creature]`];
  const stats = Object.entries(full.stats)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("  ");
  if (stats) lines.push(`  stats: ${stats}`);
  const group = (label: string, abs: { name: string; value: number | string | null }[]) => {
    if (abs.length) {
      lines.push(`  ${label}: ${abs.map((a) => (a.value == null ? a.name : `${a.name}(${fmtVal(runtimeValueToDrop(a.name, a.value))})`)).join(", ")}`);
    }
  };
  group("passive", full.passiveAbilities);
  group("activated", full.activatedAbilities);
  if (full.breath) lines.push(`  breath: ${full.breath}`);
  for (const warning of full.warnings) lines.push(`  ! ${warning}`);
  if (full.insight) lines.push(`  insight: ${full.insight}`);
  return lines;
}

function runPreview(config: RunConfig): void {
  const { label: inputLabel, text } = loadInput(config.source);
  const parsed = parseEarlyChanges(text);
  const roster = loadRoster();
  console.log(`\n=== Early Changes - interpretation preview ===`);
  console.log(`  input:  ${inputLabel}`);
  console.log(`  format: ${parsed.format}\n`);

  if (parsed.format === "full-creature") {
    for (const full of parseFullCreatures(text, loadCreatureRefs())) {
      if (roster.has(full.name)) {
        console.log(`Creature: ${full.name}   ALREADY EXISTS - a full block would be skipped (use a delta block to change stats)`);
      }
      for (const line of renderFullCreature(full)) console.log(line);
      console.log("");
    }
    console.log("  Preview only - nothing written. Add --apply to save.\n");
    return;
  }

  if (parsed.creatures.length === 0) console.log("  No creatures parsed. Check the input format.");
  for (const entry of parsed.creatures) {
    for (const line of renderCreaturePreview(entry, roster)) console.log(line);
    console.log("");
  }
  for (const warning of parsed.warnings) console.log(`  ! ${warning}`);
  console.log("\n  Preview only - nothing written.");
  console.log("  Add --apply to save the changes (or --push to also ship them). --list / --retire manage saved overrides.\n");
}

/** The launcher's interactive mode: one menu that covers the everyday flows.
 *  Each add run previews everything and confirms before any side effect. */
async function runMenu(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("--menu needs an interactive console. Use the CLI flags instead.");
    process.exit(1);
  }
  const webhook = readWebhook(WEBHOOK_ENV, WEBHOOK_FILE);
  console.log("\n=== Early Changes ===");
  console.log(webhook
    ? "Discord: posts to the wiki-sync channel"
    : "Discord: NOT configured - nothing will be posted");

  for (;;) {
    console.log("");
    console.log("  [1] Add a change from the clipboard (copy it first)");
    console.log("  [2] Add a change from tools/early-changes.input.txt");
    console.log("  [3] Show saved overrides");
    console.log("  [4] Retire overrides");
    console.log("  [q] Quit");
    const choice = (await ask("> ")).toLowerCase();
    if (choice === "q" || choice === "quit" || choice === "exit") return;
    if (choice === "3") {
      runList();
      continue;
    }
    if (choice === "4") {
      await runRetireInteractive();
      continue;
    }
    if (choice !== "1" && choice !== "2" && choice !== "") {
      console.log("  Pick 1-4 or q.");
      continue;
    }

    console.log("");
    console.log("  What is it?");
    console.log("  [1] Upcoming dev drop - may still change before release");
    console.log("  [2] Released stats - already official, the wiki just lags");
    console.log("  [3] My own correction (user-specific)");
    const kind = await ask("> (Enter = 1) ");
    if (kind && kind !== "1" && kind !== "2" && kind !== "3") {
      console.log("  Pick 1, 2, or 3.");
      continue;
    }

    await runApply({
      source: choice === "2" ? { kind: "file", path: DEFAULT_INPUT } : { kind: "clipboard" },
      channel: kind === "3" ? "user-specific" : "early",
      stage: kind === "2" ? "released" : "upcoming",
      write: true,
      push: true,
      discord: true,
      dry: false,
      replace: false,
      yes: false,
      anchor: true,
      provenance: "early-changes",
    });
  }
}

function printHelp(): void {
  console.log(`
Early Changes - apply pre-wiki stat drops + user-specific overrides.

  npx tsx tools/early-changes.ts [flags]

Modes:
  --menu             interactive menu (what run_early_changes.bat opens)
  (default)          preview how the input text was interpreted
  --apply            write the changes to local data
  --push             apply + commit + push to origin/main (own signature)
  --send-discord     announce the changes on Discord (stats only)
  --list             list every override with its lifecycle status
  --retire <id>      manually expire an override (the menu retires in bulk)
  --help, -h         this text

Flags:
  --clipboard        read the pasted text straight from the clipboard (Windows)
  --stdin            read the text piped on stdin
  --input <file>     input text file (default tools/early-changes.input.txt)
  --dry              show what would happen; write / push / send nothing
  --channel <c>      early | user-specific (default early)
  --released         change is already released, wiki just lags - the Discord
                     post drops the "may still change before release" wording
  --replace          let a full stat block overwrite an existing creature
  --yes              skip the confirmation prompt
  --source <name>    provenance on each override (default early-changes)
  --note <text>      note on each override (default: the creature insight)
  --expires <ISO>    date cutoff on each override (e.g. 2026-09-01)
  --no-anchor        do not anchor to the wiki value (manual expiry only)

Inputs (auto-detected): delta blocks + Notion buff/nerf asides -> folded into
the runtime data (live in the app) + anchored overrides that hold through wiki
syncs; a subspecies materialises from base + deltas; a full "Creature: X /
Basic Stats: ..." block -> a whole new creature in creatures.runtime.json.
`);
}

async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) return printHelp();
  if (hasFlag("--menu")) return runMenu();
  if (hasFlag("--list")) return runList();
  const retireId = readArg("--retire");
  if (retireId) return runRetire(retireId);
  const config = configFromArgv();
  if (config.write || config.discord) return runApply(config);
  return runPreview(config);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePrompts);
