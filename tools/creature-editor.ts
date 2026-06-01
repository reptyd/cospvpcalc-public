/**
 * Creature Editor — local web server + UI for adding/editing creatures.
 *
 * Usage:  npx tsx tools/creature-editor.ts
 *         Then open http://localhost:3100 in a browser.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const CREATURES_FILE = path.join(DATA, "creatures.runtime.json");
const ICONS_FILE = path.join(DATA, "creatures.icons.json");
const HTML_FILE = path.join(__dirname, "creature-editor.html");
const PORT = 3100;

/* ------------------------------------------------------------------ */
/*  Data helpers                                                       */
/* ------------------------------------------------------------------ */

interface AbilityRef {
  abilityId: string;
  name: string;
  value: number | string | null;
  semantics: string;
  subtype: string | null;
}

interface CreatureStats {
  tier: number;
  health: number;
  weight: number;
  damage: number;
  biteCooldown: number;
  damage2?: number | null;
  healthRegen?: number | null;
  stamina?: number | null;
  stamRegen?: number | null;
  walkAndSwimSpeed?: number | null;
  sprintSpeed?: number | null;
  turn?: number | null;
  venerationRate?: number | null;
  diet?: string;
  type?: string;
  mobilityOverride?: string;
  breath?: string;
  breathResistance?: number | null;
}

interface CreatureRuntime {
  name: string;
  stats: CreatureStats;
  passiveAbilities: AbilityRef[];
  activatedAbilities: AbilityRef[];
  breathAbilities: AbilityRef[];
}

function readCreatures(): CreatureRuntime[] {
  const raw = JSON.parse(fs.readFileSync(CREATURES_FILE, "utf-8"));
  return raw.creatures as CreatureRuntime[];
}

function writeCreatures(creatures: CreatureRuntime[]) {
  const sorted = [...creatures].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" })
  );
  fs.writeFileSync(
    CREATURES_FILE,
    JSON.stringify({ creatures: sorted }, null, 2) + "\n",
    "utf-8"
  );
}

/** Collect every unique ability seen across all creatures. */
function buildAbilityCatalog(creatures: CreatureRuntime[]) {
  const map = new Map<
    string,
    { abilityId: string; name: string; semantics: string; category: string }
  >();
  for (const c of creatures) {
    for (const a of c.passiveAbilities ?? []) {
      if (!map.has(a.name))
        map.set(a.name, {
          abilityId: a.abilityId,
          name: a.name,
          semantics: a.semantics,
          category: "passive",
        });
    }
    for (const a of c.activatedAbilities ?? []) {
      if (!map.has(a.name))
        map.set(a.name, {
          abilityId: a.abilityId,
          name: a.name,
          semantics: a.semantics,
          category: "activated",
        });
    }
    for (const a of c.breathAbilities ?? []) {
      if (!map.has(a.name))
        map.set(a.name, {
          abilityId: a.abilityId,
          name: a.name,
          semantics: a.semantics,
          category: "breath",
        });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Collect all known breath types. */
function collectBreathTypes(creatures: CreatureRuntime[]): string[] {
  const s = new Set<string>();
  for (const c of creatures) {
    if (c.stats.breath && c.stats.breath !== "N/A") s.add(c.stats.breath);
    for (const a of c.breathAbilities ?? []) {
      if (a.subtype) s.add(a.subtype);
      if (a.name) s.add(a.name);
    }
  }
  return [...s].sort();
}

/* ------------------------------------------------------------------ */
/*  HTTP server                                                        */
/* ------------------------------------------------------------------ */

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function notFound(res: http.ServerResponse) {
  res.writeHead(404);
  res.end("Not Found");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const method = req.method ?? "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    // Serve HTML
    if (url.pathname === "/" && method === "GET") {
      const html = fs.readFileSync(HTML_FILE, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // API: list creatures
    if (url.pathname === "/api/creatures" && method === "GET") {
      const creatures = readCreatures();
      json(res, { creatures });
      return;
    }

    // API: ability catalog
    if (url.pathname === "/api/abilities" && method === "GET") {
      const creatures = readCreatures();
      const catalog = buildAbilityCatalog(creatures);
      const breathTypes = collectBreathTypes(creatures);
      json(res, { abilities: catalog, breathTypes });
      return;
    }

    // API: save creature (add or update)
    if (url.pathname === "/api/creature" && method === "PUT") {
      const body = await parseBody(req);
      const incoming = JSON.parse(body) as CreatureRuntime;
      if (!incoming.name || !incoming.stats) {
        json(res, { error: "Missing name or stats" }, 400);
        return;
      }
      const creatures = readCreatures();
      const idx = creatures.findIndex(
        (c) => c.name.toLowerCase() === incoming.name.toLowerCase()
      );
      if (idx >= 0) {
        creatures[idx] = incoming;
      } else {
        creatures.push(incoming);
      }
      writeCreatures(creatures);
      json(res, { ok: true, total: creatures.length });
      return;
    }

    // API: delete creature
    if (url.pathname === "/api/creature" && method === "DELETE") {
      const name = url.searchParams.get("name");
      if (!name) {
        json(res, { error: "Missing name param" }, 400);
        return;
      }
      const creatures = readCreatures();
      const filtered = creatures.filter(
        (c) => c.name.toLowerCase() !== name.toLowerCase()
      );
      if (filtered.length === creatures.length) {
        json(res, { error: "Creature not found" }, 404);
        return;
      }
      writeCreatures(filtered);
      json(res, { ok: true, total: filtered.length });
      return;
    }

    notFound(res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Server error:", msg);
    json(res, { error: msg }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Creature Editor running at  http://localhost:${PORT}\n`);
  console.log(`  Data file: ${CREATURES_FILE}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
