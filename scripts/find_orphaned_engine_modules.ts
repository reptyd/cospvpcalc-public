/**
 * Walks every `.ts` file under `src/engine/` (skipping tests) and
 * flags those NOT reachable via static `import` from any live root.
 * After the recent combat-loop deletion (Phase A4) the deps that
 * used to live behind `legacySimulateFight_DEPRECATED` are no
 * longer reachable; Vite's tree-shaker drops them from the bundle
 * but they still weigh on developer attention and audit scoring.
 *
 * Usage: `npx tsx scripts/find_orphaned_engine_modules.ts`.
 *
 * Live roots = every file under `src/` that is NOT inside
 * `src/engine/` plus any test file. The detector parses each
 * source for `from "..."` / `import "..."` strings, resolves the
 * relative path against the importer's directory, normalises it
 * to one of the candidate engine files, and unions the visited
 * set. Files in `src/engine/` not in the closure are orphans.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = listTsFiles("src").map((p) => p.replace(/\\/g, "/"));
const engineFiles = new Set(
  allFiles.filter((p) => p.startsWith("src/engine/") && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx")),
);

// Live roots: anything outside src/engine/ + tests inside src/engine/
// Tests are roots because they keep a file alive even if nothing else uses it
// (we don't want to delete the test-only path while a test still references it).
const roots = allFiles.filter(
  (p) =>
    !p.startsWith("src/engine/") ||
    p.endsWith(".test.ts") ||
    p.endsWith(".test.tsx"),
);

function resolveImport(importer: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // bare import, not engine
  const baseDir = dirname(importer);
  const resolved = resolve(baseDir, spec).replace(/\\/g, "/");
  // Try .ts / .tsx / index.ts / index.tsx
  for (const candidate of [`${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`, `${resolved}/index.tsx`]) {
    if (existsSync(candidate)) {
      const norm = candidate.replace(/\\/g, "/").replace(`${process.cwd().replace(/\\/g, "/")}/`, "");
      return norm;
    }
  }
  return null;
}

const importPattern = /(?:from|import)\s*['\"]([^'\"]+)['\"]/g;

const visited = new Set<string>();
const queue: string[] = [...roots];
while (queue.length > 0) {
  const file = queue.shift()!;
  if (visited.has(file)) continue;
  visited.add(file);
  let body: string;
  try {
    body = readFileSync(file, "utf-8");
  } catch {
    continue;
  }
  for (const match of body.matchAll(importPattern)) {
    const dep = resolveImport(file, match[1] ?? "");
    if (dep && !visited.has(dep)) {
      queue.push(dep);
    }
  }
}

const orphans = [...engineFiles].filter((f) => !visited.has(f)).sort();

console.log(`Scanned ${allFiles.length} src files (${engineFiles.size} candidate engine files).`);
console.log(`Reachable from live roots: ${visited.size} files.`);
console.log(`\nOrphaned engine files (not reachable from any live root): ${orphans.length}`);
for (const file of orphans) {
  console.log(`  - ${file}`);
}
if (orphans.length === 0) {
  console.log(`  (none — every engine file is on a live import chain)`);
}

// Also surface low-fanout candidates: live engine files whose only consumer
// is another engine file in the orphan set — these become orphans on the
// next pass, useful for staged deletion.
const reachableEngine = [...engineFiles].filter((f) => visited.has(f));
const fanout = new Map<string, string[]>();
for (const file of reachableEngine) {
  fanout.set(file, []);
}
for (const importer of visited) {
  let body: string;
  try {
    body = readFileSync(importer, "utf-8");
  } catch {
    continue;
  }
  for (const match of body.matchAll(importPattern)) {
    const dep = resolveImport(importer, match[1] ?? "");
    if (!dep) continue;
    const list = fanout.get(dep);
    if (list) list.push(importer);
  }
}

const singleConsumer = reachableEngine
  .filter((f) => {
    const consumers = fanout.get(f) ?? [];
    return consumers.length === 1 && consumers[0]?.startsWith("src/engine/") && !consumers[0]?.endsWith(".test.ts");
  })
  .sort();
console.log(`\nLive engine files with a single non-test consumer (potential dead-cluster candidates): ${singleConsumer.length}`);
for (const file of singleConsumer.slice(0, 40)) {
  const consumer = (fanout.get(file) ?? [])[0];
  console.log(`  - ${file} ← ${consumer}`);
}
if (singleConsumer.length > 40) {
  console.log(`  …(+${singleConsumer.length - 40} more)`);
}

void basename;
