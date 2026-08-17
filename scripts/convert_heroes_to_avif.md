# Hero image AVIF conversion recipe

The friendly-shell panoramas (`friendly-home-panorama.jpg`,
`friendly-bestbuild-panorama.jpg`, `friendly-battle-panorama.jpg`) are
≈ 555 KB each at the original 2400×1100 JPEG. AVIF at q60 typically
reaches ≈ 80-110 KB with comparable perceptual quality - a ~80 %
reduction on each hero, ~1.4 MB total saved across the three panoramas.

This conversion is left as a deferred build step because it requires an
image tool not in the npm/cargo dependency graph (`sharp` is ~30 MB
when installed, ImageMagick is system-level). This recipe is documented
here so the deploy operator can run it once before each release where
the heroes change.

## Option 1: ImageMagick (recommended for ad-hoc runs)

```bash
cd public
for f in friendly-home-panorama friendly-bestbuild-panorama friendly-battle-panorama; do
  magick "$f.jpg" -quality 60 "$f.avif"
done
```

Verify output sizes:
```bash
ls -lh friendly-*-panorama.avif
```

## Option 2: sharp (one-off via npx, no permanent dep)

```bash
npx -p sharp -- node -e "
const sharp = require('sharp');
for (const name of ['friendly-home-panorama', 'friendly-bestbuild-panorama', 'friendly-battle-panorama']) {
  sharp(\`public/\${name}.jpg\`).avif({ quality: 60 }).toFile(\`public/\${name}.avif\`);
}
"
```

## After conversion: CSS update

Once the `.avif` files exist in `public/`, update
`src/friendly/friendly.css` to use `image-set()` for browser-chosen
format. The current declarations look like:

```css
--friendly-panorama-image: url("/friendly-home-panorama.jpg");
```

Replace with:

```css
--friendly-panorama-image: image-set(
  url("/friendly-home-panorama.avif") type("image/avif"),
  url("/friendly-home-panorama.jpg") type("image/jpeg")
);
```

(Repeat for `bestbuild` and `battle` panoramas.)

Browsers that support AVIF (Chrome 85+, Firefox 113+, Safari 16.4+ -
all in the project's `browserslist`) load the AVIF; older browsers fall
back to the JPEG transparently. No JS or HTML changes needed.

## Why this isn't automated yet

Adding `sharp` as a permanent dev-dep:
- Adds ~30 MB to `node_modules` for what is a once-per-hero-update task.
- Brings native binary dependencies that complicate CI on platforms
  without prebuilt sharp.

A `prebuild` npm script that checks for stale AVIF and regenerates is
the natural follow-up if hero images change more than once a year.

## Verification

After deployment with AVIF heroes:
1. Open the friendly home/bestbuild/battle pages in Chrome.
2. DevTools → Network → filter "panorama" - should see
   `.avif` request, not `.jpg`.
3. File size in Network panel should be ≈ 80-110 KB per panorama.
4. In Safari < 16.4 or Firefox < 113, the request should fall back to
   `.jpg` - verify in those browsers if the supported matrix expands.

If `image-set()` doesn't trigger AVIF in a supporting browser, the most
common cause is a CSS typo (missing `type("...")` or wrong MIME). The
`image-set` spec requires the type hint for correct format negotiation.
