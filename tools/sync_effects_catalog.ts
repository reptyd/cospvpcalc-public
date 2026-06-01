/**
 * Effects-catalog generator. Derives
 * `data/effects_catalog.runtime.v2.json` deterministically from
 * `data/creatures.runtime.json` + the mapping rules in
 * `effects_catalog_rules.ts`.
 *
 * Usage:
 *   npx tsx tools/sync_effects_catalog.ts            # write catalog
 *   npx tsx tools/sync_effects_catalog.ts --dry      # print diff stats, no write
 *
 * Integrated into `wiki-sync.ts` so every wiki refresh re-derives the
 * catalog. Replaces the pre-2026-05-12 manual maintenance flow that
 * drifted (12 creatures missing, 116 entries with wrong Necropoison
 * mapping).
 *
 * Determinism contract: identical inputs ⇒ byte-identical output. The
 * generator sorts every collection and emits keys in a stable order.
 * Re-running on the produced output is a no-op (idempotent).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  EffectsCatalogByCreature,
  SpecialAbilityDef,
} from "../src/engine/types";
import {
  resolveAbilityDef,
  resolveAttackStatusId,
  resolveBlockStatusId,
  resolveDefensiveStatusId,
} from "./effects_catalog_rules";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CREATURES_FILE = path.join(ROOT, "data", "creatures.runtime.json");
const EFFECTS_FILE = path.join(
  ROOT,
  "data",
  "effects_catalog.runtime.v2.json",
);

interface AbilityRef {
  abilityId: string;
  name: string;
  value: number | string | null;
  semantics: string;
  subtype: string | null;
}

interface CreatureRuntime {
  name: string;
  stats: Record<string, unknown>;
  passiveAbilities: AbilityRef[];
  activatedAbilities: AbilityRef[];
  breathAbilities: AbilityRef[];
}

interface EffectsCatalogRoot {
  byCreature: Record<string, EffectsCatalogByCreature>;
}

function toNumber(value: AbilityRef["value"]): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

/**
 * Throw if an ability that requires a numeric value (status-mapping or
 * `paramFromCreatureValue` def) is missing one. The catalog reader
 * silently treated missing values as 0 pre-2026-05-12, which masked
 * wiki-sync data bugs — a Block with no fraction blocked nothing, a
 * First Strike with no value boosted by 0. This fails loudly so the
 * problem surfaces at sync time rather than as a quiet combat outcome.
 */
function requireNumericValue(creatureName: string, ability: AbilityRef): void {
  if (typeof ability.value === "number" && Number.isFinite(ability.value)) {
    return;
  }
  throw new Error(
    `effects-catalog sync: ${creatureName}.${ability.name} requires a numeric value (Block %, attack stacks, paramFromCreatureValue, etc.), got ${JSON.stringify(ability.value)}. Fix the entry in creatures.runtime.json (most likely a wiki page that doesn't carry the number — fill it in manually or correct wiki-sync's parse).`,
  );
}

/**
 * Derive the effects-catalog entry for one creature from its
 * passive / activated / breath ability lists.
 *
 * Output shape mirrors the historical hand-curated catalog. Every
 * decision is rule-driven (see `effects_catalog_rules.ts`); the
 * per-creature `value` field is the only data the generator copies
 * verbatim from the source.
 */
export function deriveEffectsForCreature(
  creature: CreatureRuntime,
): EffectsCatalogByCreature {
  const applyStatusOnHit: Array<{
    statusId: string;
    stacks: number;
    sourceAbility: string;
  }> = [];
  const applyStatusOnHitTaken: typeof applyStatusOnHit = [];
  const resistStatus: Array<{
    statusId: string;
    fraction: number;
    sourceAbility: string;
  }> = [];
  const specialAbilities: Array<{
    name: string;
    value: number | null;
    source: string;
  }> = [];
  const specialAbilitiesDetailed: Array<{
    name: string;
    value: number | null;
    def: SpecialAbilityDef;
  }> = [];
  const otherAbilities: Array<{
    name: string;
    value: number | string | null;
    semantics: string;
  }> = [];

  const allAbilities = [
    ...creature.passiveAbilities,
    ...creature.activatedAbilities,
    ...creature.breathAbilities,
  ];

  for (const ability of allAbilities) {
    const name = ability.name;

    // 1. Status-resist (`Block X`): pull the resisted status id from the
    //    rules table. Fraction comes from the creature's value.
    const resistStatusId = resolveBlockStatusId(name);
    if (resistStatusId !== null) {
      requireNumericValue(creature.name, ability);
      resistStatus.push({
        statusId: resistStatusId,
        fraction: toNumber(ability.value),
        sourceAbility: name,
      });
      continue;
    }

    // 2. Offensive on-hit (`X Attack`, `Ligament Tear`).
    const attackStatusId = resolveAttackStatusId(name);
    if (attackStatusId !== null) {
      requireNumericValue(creature.name, ability);
      applyStatusOnHit.push({
        statusId: attackStatusId,
        stacks: toNumber(ability.value),
        sourceAbility: name,
      });
      // Ligament Tear also carries a def — fall through to the def
      // check below so it lands in specialAbilitiesDetailed too.
      const def = resolveAbilityDef(name);
      if (def === null) continue;
    }

    // 3. Defensive on-being-bitten (`Defensive X`).
    const defensiveStatusId = resolveDefensiveStatusId(name);
    if (defensiveStatusId !== null) {
      requireNumericValue(creature.name, ability);
      applyStatusOnHitTaken.push({
        statusId: defensiveStatusId,
        stacks: toNumber(ability.value),
        sourceAbility: name,
      });
      continue;
    }

    // 4. Structured `def` block (Berserk, First Strike, …). The def
    //    shape is uniform per ability; only the creature's value
    //    varies and is preserved. For defs that declare
    //    `paramFromCreatureValue: true` (First Strike's boost
    //    percentage, Breath Resistance's reduction fraction), the
    //    value is load-bearing — fail loudly if missing rather than
    //    silently shipping a 0% effect.
    const def = resolveAbilityDef(name);
    if (def !== null) {
      const defRequiresValue =
        "paramFromCreatureValue" in def && def.paramFromCreatureValue === true;
      if (defRequiresValue) requireNumericValue(creature.name, ability);
      const value =
        typeof ability.value === "number" && Number.isFinite(ability.value)
          ? ability.value
          : null;
      specialAbilities.push({ name, value, source: name });
      specialAbilitiesDetailed.push({ name, value, def });
      continue;
    }

    // 5. Fallback: every other ability flows into otherAbilities with
    //    its semantics preserved (block / offensive / defensive /
    //    neutral). Out-of-model + modeled-but-def-less abilities all
    //    land here — same convention as the hand-curated catalog.
    otherAbilities.push({
      name,
      value: ability.value,
      semantics: ability.semantics,
    });
  }

  // Deterministic ordering: sort each list by primary key so re-runs
  // produce byte-identical output.
  applyStatusOnHit.sort((a, b) =>
    a.sourceAbility.localeCompare(b.sourceAbility),
  );
  applyStatusOnHitTaken.sort((a, b) =>
    a.sourceAbility.localeCompare(b.sourceAbility),
  );
  resistStatus.sort((a, b) => a.sourceAbility.localeCompare(b.sourceAbility));
  specialAbilities.sort((a, b) => a.name.localeCompare(b.name));
  specialAbilitiesDetailed.sort((a, b) => a.name.localeCompare(b.name));
  otherAbilities.sort((a, b) => a.name.localeCompare(b.name));

  return {
    applyStatusOnHit,
    applyStatusOnHitTaken,
    resistStatus,
    specialAbilities,
    otherAbilities,
    specialAbilitiesDetailed,
  };
}

/**
 * Regenerate the entire `byCreature` map from creatures.runtime.
 * Sorts keys alphabetically for stable output. Existing entries are
 * fully replaced — generator is the authority.
 */
export function regenerateCatalog(
  creatures: CreatureRuntime[],
): EffectsCatalogRoot {
  const byCreature: Record<string, EffectsCatalogByCreature> = {};
  const sortedNames = creatures.map((c) => c.name).sort();
  const byName = new Map(creatures.map((c) => [c.name, c]));
  for (const name of sortedNames) {
    const creature = byName.get(name);
    if (!creature) continue;
    byCreature[name] = deriveEffectsForCreature(creature);
  }
  return { byCreature };
}

function readCreatures(): CreatureRuntime[] {
  const raw = JSON.parse(fs.readFileSync(CREATURES_FILE, "utf-8")) as {
    creatures: CreatureRuntime[];
  };
  return raw.creatures;
}

function readExistingCatalog(): EffectsCatalogRoot | null {
  try {
    return JSON.parse(fs.readFileSync(EFFECTS_FILE, "utf-8")) as EffectsCatalogRoot;
  } catch {
    return null;
  }
}

function writeCatalog(root: EffectsCatalogRoot): void {
  fs.writeFileSync(
    EFFECTS_FILE,
    JSON.stringify(root, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Public entry point. Called from wiki-sync.ts after
 * `writeLocalCreatures()` and from the standalone CLI.
 *
 * Returns counts so callers can log the work done.
 */
export function syncEffectsCatalog(options: { dryRun?: boolean } = {}): {
  totalCreatures: number;
  added: number;
  removed: number;
  changed: number;
} {
  const creatures = readCreatures();
  const existing = readExistingCatalog();
  const regenerated = regenerateCatalog(creatures);

  let added = 0;
  let removed = 0;
  let changed = 0;
  const existingByCreature = existing?.byCreature ?? {};
  const newByCreature = regenerated.byCreature;

  for (const name of Object.keys(newByCreature)) {
    if (!(name in existingByCreature)) {
      added++;
    } else if (
      JSON.stringify(existingByCreature[name]) !==
      JSON.stringify(newByCreature[name])
    ) {
      changed++;
    }
  }
  for (const name of Object.keys(existingByCreature)) {
    if (!(name in newByCreature)) removed++;
  }

  if (!options.dryRun) {
    writeCatalog(regenerated);
  }

  return {
    totalCreatures: Object.keys(newByCreature).length,
    added,
    removed,
    changed,
  };
}

// CLI entry point: `npx tsx tools/sync_effects_catalog.ts [--dry]`.
// Detect direct invocation by matching the resolved module URL against
// argv[1]. Windows quirk: process.argv[1] has back-slashes and
// import.meta.url has slashes and triple-slash prefix, so we normalise
// both to absolute paths via pathToFileURL.
import { pathToFileURL } from "node:url";
const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  const dry = process.argv.includes("--dry");
  const result = syncEffectsCatalog({ dryRun: dry });
  const action = dry ? "would write" : "wrote";
  console.log(
    `Effects catalog sync (${dry ? "dry-run" : "applied"}): ${action} ${result.totalCreatures} entries — added ${result.added}, removed ${result.removed}, changed ${result.changed}.`,
  );
}
