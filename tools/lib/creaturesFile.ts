// Read/upsert/write data/creatures.runtime.json. Writes with the exact shape
// wiki-sync uses (name-sorted, 2-space indent, trailing newline) so adding a
// materialised subspecies produces a minimal diff instead of reflowing the file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CreatureRuntime } from "./creatureRoster";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CREATURES_FILE = path.join(ROOT, "data", "creatures.runtime.json");

export const CREATURES_RUNTIME_REPO_PATH = "data/creatures.runtime.json";

export interface CreaturesFile {
  creatures: CreatureRuntime[];
}

export function readCreaturesFile(): CreaturesFile {
  return JSON.parse(fs.readFileSync(CREATURES_FILE, "utf8")) as CreaturesFile;
}

/** Insert or replace a creature by name (case-insensitive). Returns which. */
export function upsertCreature(data: CreaturesFile, creature: CreatureRuntime): "added" | "replaced" {
  const key = creature.name.toLowerCase();
  const index = data.creatures.findIndex((c) => c.name.toLowerCase() === key);
  if (index >= 0) {
    data.creatures[index] = creature;
    return "replaced";
  }
  data.creatures.push(creature);
  return "added";
}

export function writeCreaturesFile(data: CreaturesFile): void {
  const sorted = [...data.creatures].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
  fs.writeFileSync(CREATURES_FILE, `${JSON.stringify({ creatures: sorted }, null, 2)}\n`);
}
