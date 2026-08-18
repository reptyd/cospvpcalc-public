import fs from 'node:fs/promises';
import path from 'node:path';

const PAGE_URL = 'https://creatures-of-sonaria-official.fandom.com/wiki/Plushies';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'CoS-PvP-Calc/1.0 (plushie icons rebuild)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractFromReadabilityLikeText(html) {
  // Very lightweight extraction: keep text-ish parts.
  // We'll just run regexes directly on the HTML; the patterns we need are present.
  return html;
}

function safeName(name) {
  return String(name)
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function chooseExt(url) {
  const m = String(url).match(/\.(png|jpg|jpeg|webp|gif)(?:\?|$)/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  return 'png';
}

async function download(url, outPath) {
  const res = await fetch(url, { headers: { 'user-agent': 'CoS-PvP-Calc/1.0 (plushie icons cache)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

async function main() {
  const root = process.cwd();
  const plushies = (JSON.parse(await fs.readFile(path.join(root, 'data/plushies.runtime.json'), 'utf8'))).plushies;

  const html = extractFromReadabilityLikeText(await fetchText(PAGE_URL));

  // We want mapping Name -> nearby image URL.
  // The page contains repeated patterns:
  //   <img ... src="https://static.wikia.../SomeImage.png/..."> ... then "<h3> <span> Name" or similar.
  // We'll build an index of positions of images and headings and link each heading to the closest preceding image.

  const imageRe = /https:\/\/static\.wikia\.nocookie\.net\/[^\s"']+?\.(png|jpg|jpeg|webp|gif)(?:[^\s"']*)/gi;
  const headingRe = /<h3[^>]*>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/gi;

  const images = [];
  for (const m of html.matchAll(imageRe)) {
    images.push({ idx: m.index ?? 0, url: decodeHtmlEntities(m[0]) });
  }
  const headings = [];
  for (const m of html.matchAll(headingRe)) {
    headings.push({ idx: m.index ?? 0, name: decodeHtmlEntities(m[1]).trim() });
  }

  function findPrevImage(pos) {
    // binary search last image with idx < pos
    let lo = 0, hi = images.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (images[mid].idx < pos) { best = images[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }

  const byName = new Map();
  for (const h of headings) {
    const img = findPrevImage(h.idx);
    if (!img) continue;
    // Prefer first mapping only
    if (!byName.has(h.name)) byName.set(h.name, img.url);
  }

  const outDir = path.join(root, 'public', 'icons', 'plushies');
  await fs.mkdir(outDir, { recursive: true });

  const localIcons = {};
  let ok = 0;
  let miss = 0;

  for (const p of plushies) {
    const url = byName.get(p.name);
    if (!url) {
      miss++;
      continue;
    }
    const ext = chooseExt(url);
    const file = `${safeName(p.name)}.${ext}`;
    const outPath = path.join(outDir, file);
    try {
      await fs.access(outPath);
    } catch {
      try {
        await download(url, outPath);
      } catch (e) {
        console.warn('download failed', p.name, String(e));
        miss++;
        continue;
      }
    }
    localIcons[p.name] = `/icons/plushies/${file}`;
    ok++;
    if (ok % 20 === 0) console.log(`cached ${ok}/${plushies.length}`);
  }

  const out = { source: PAGE_URL, count: ok, icons: localIcons };
  await fs.writeFile(path.join(root, 'data/plushies.icons.json'), JSON.stringify(out, null, 2) + '\n');

  console.log('Done plushies icons. ok=', ok, 'miss=', miss, 'headings=', headings.length, 'images=', images.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
