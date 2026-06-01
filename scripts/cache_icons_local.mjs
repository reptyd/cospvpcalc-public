import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'public', 'icons');
const creatureDir = path.join(outDir, 'creatures');
const plushieDir = path.join(outDir, 'plushies');
const traitDir = path.join(outDir, 'traits');

function safeName(name) {
  return String(name)
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function ensureDirs() {
  await fs.mkdir(creatureDir, { recursive: true });
  await fs.mkdir(plushieDir, { recursive: true });
  await fs.mkdir(traitDir, { recursive: true });
}

async function download(url, outPath) {
  const res = await fetch(url, { headers: { 'user-agent': 'CoS-PvP-Calc/1.0 (icon cache)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

function chooseExt(url) {
  const u = String(url);
  // Prefer png/jpg/webp based on filename.
  const m = u.match(/\.(png|jpg|jpeg|webp|gif)(?:\?|\/|$)/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  // fallback
  return 'png';
}

async function cacheMap({ icons, outSubdir, label }) {
  const localIcons = {};
  const entries = Object.entries(icons);
  let done = 0;

  // simple concurrency
  const concurrency = 8;
  let idx = 0;

  async function worker() {
    while (idx < entries.length) {
      const my = idx++;
      const [name, url] = entries[my];
      if (!url || typeof url !== 'string') continue;
      const ext = chooseExt(url);
      const file = `${safeName(name)}.${ext}`;
      const outPath = path.join(outSubdir, file);
      try {
        await fs.access(outPath);
      } catch {
        try {
        await download(url, outPath);
      } catch (e) {
        // Skip if cannot fetch
        console.warn(`[${label}] failed:`, name, String(e));
        continue;
      }
      }
      localIcons[name] = `/icons/${label}/${file}`;
      done++;
      if (done % 50 === 0) console.log(`${label}: ${done}/${entries.length}`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return localIcons;
}

async function main() {
  await ensureDirs();

  const cIcons = (await readJson(path.join(root, 'data/creatures.icons.json'))).icons;
  const pIcons = (await readJson(path.join(root, 'data/plushies.icons.json'))).icons;
  const tIcons = (await readJson(path.join(root, 'data/trait_icons.json'))).icons;

  const localCreatures = await cacheMap({ icons: cIcons, outSubdir: creatureDir, label: 'creatures' });
  const localPlushies = await cacheMap({ icons: pIcons, outSubdir: plushieDir, label: 'plushies' });
  const localTraits = await cacheMap({ icons: tIcons, outSubdir: traitDir, label: 'traits' });

  await fs.writeFile(
    path.join(root, 'data/creatures.icons.json'),
    JSON.stringify({ source: 'local-cache', count: Object.keys(localCreatures).length, icons: localCreatures }, null, 2) + '\n',
  );
  await fs.writeFile(
    path.join(root, 'data/plushies.icons.json'),
    JSON.stringify({ source: 'local-cache', count: Object.keys(localPlushies).length, icons: localPlushies }, null, 2) + '\n',
  );
  await fs.writeFile(
    path.join(root, 'data/trait_icons.json'),
    JSON.stringify({ source: 'local-cache', note: 'local cached trait icons', icons: localTraits }, null, 2) + '\n',
  );

  console.log('Done. Local icon coverage:', {
    creatures: Object.keys(localCreatures).length,
    plushies: Object.keys(localPlushies).length,
    traits: Object.keys(localTraits).length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
