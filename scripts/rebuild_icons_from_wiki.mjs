import fs from 'node:fs/promises';
import path from 'node:path';

const WIKI_API = 'https://creatures-of-sonaria-official.fandom.com/api.php';

async function apiQuery(params) {
  const url = new URL(WIKI_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  // fandom sometimes blocks without UA
  const res = await fetch(url, {
    headers: {
      'user-agent': 'CoS-PvP-Calc/1.0 (icon rebuild)'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getThumbnailForTitle(title, size = 64) {
  const data = await apiQuery({
    action: 'query',
    format: 'json',
    origin: '*',
    redirects: 1,
    titles: title,
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: size,
  });
  const pages = data?.query?.pages;
  if (!pages) return null;
  const page = pages[Object.keys(pages)[0]];
  const thumb = page?.thumbnail?.source;
  return thumb ?? null;
}

async function getFirstThumbnail(titles, size = 64) {
  for (const t of titles) {
    try {
      const thumb = await getThumbnailForTitle(t, size);
      if (thumb) return { title: t, url: thumb };
    } catch {
      // ignore and continue
    }
    await new Promise(r => setTimeout(r, 80));
  }
  return null;
}

function readJson(p) {
  return fs.readFile(p, 'utf8').then(JSON.parse);
}

async function main() {
  const root = process.cwd();
  const creatures = (await readJson(path.join(root, 'data/creatures.runtime.json'))).creatures;
  const plushies = (await readJson(path.join(root, 'data/plushies.runtime.json'))).plushies;
  const traits = (await readJson(path.join(root, 'data/traits.runtime.json'))).traits;

  const outCreatures = { source: WIKI_API, count: creatures.length, icons: {} };
  const outPlushies = { source: WIKI_API, count: plushies.length, icons: {} };
  const outTraits = { source: WIKI_API, note: 'best-effort via pageimages', icons: {} };

  console.log(`Rebuilding creature icons: ${creatures.length}`);
  let i = 0;
  for (const c of creatures) {
    i++;
    const titles = [c.name];
    const found = await getFirstThumbnail(titles, 64);
    if (found) outCreatures.icons[c.name] = found.url;
    if (i % 25 === 0) console.log(`  creatures ${i}/${creatures.length}`);
  }

  console.log(`Rebuilding plushie icons: ${plushies.length}`);
  i = 0;
  for (const p of plushies) {
    i++;
    const base = p.name;
    const titles = [
      base,
      `${base} (Plushie)`,
      `${base} Plushie`,
    ];
    const found = await getFirstThumbnail(titles, 64);
    if (found) outPlushies.icons[p.name] = found.url;
    if (i % 20 === 0) console.log(`  plushies ${i}/${plushies.length}`);
  }

  console.log(`Rebuilding trait icons: ${traits.length}`);
  for (const t of traits) {
    const titles = [t.name, `Trait: ${t.name}`, t.id];
    const found = await getFirstThumbnail(titles, 64);
    if (found) outTraits.icons[t.id] = found.url;
  }

  await fs.writeFile(path.join(root, 'data/creatures.icons.json'), JSON.stringify(outCreatures, null, 2) + '\n');
  await fs.writeFile(path.join(root, 'data/plushies.icons.json'), JSON.stringify(outPlushies, null, 2) + '\n');
  await fs.writeFile(path.join(root, 'data/trait_icons.json'), JSON.stringify(outTraits, null, 2) + '\n');

  console.log('Done. Wrote data/*icons.json');
  console.log('Coverage:', {
    creatures: Object.keys(outCreatures.icons).length,
    plushies: Object.keys(outPlushies.icons).length,
    traits: Object.keys(outTraits.icons).length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
