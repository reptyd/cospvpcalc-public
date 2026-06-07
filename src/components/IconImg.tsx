import { useState } from "react";

const PLACEHOLDER_ICON =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><rect width='80' height='80' rx='12' fill='%23dde3ea'/><path d='M22 46h36v8H22zM22 26h36v14H22z' fill='%23b9c3cf'/></svg>";

function cleanIconUrl(raw: string): string {
  let url = raw;
  // Some inputs end with a trailing slash after an image extension (...png/), which 404s.
  url = url.replace(/\.(png|jpg|jpeg|webp|gif)\/$/i, ".$1");
  return url;
}

function swapIconDomainToSonaria(raw: string): string {
  return raw.replace(
    /static\.wikia\.nocookie\.net\/creatures-of-agartha-official\//i,
    "static.wikia.nocookie.net/creatures-of-sonaria-official/",
  );
}

export function IconImg({ src, alt, size }: { src: string | null; alt: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const primarySrc = src ? cleanIconUrl(src) : null;
  const url = !primarySrc || failed ? PLACEHOLDER_ICON : fallbackUrl ?? primarySrc;

  return (
    <img
      className="icon-img"
      src={url}
      alt={alt}
      loading="lazy"
      width={size}
      height={size}
      style={{ width: `${size}px`, height: `${size}px`, flexShrink: 0 }}
      onError={() => {
        if (!primarySrc) {
          setFailed(true);
          return;
        }

        // Try a small sequence of fallbacks once, then give up to avoid spamming requests.
        if (!fallbackUrl) {
          if (url.includes("?")) {
            const cleaned = cleanIconUrl(url.split("?")[0]);
            console.warn("Icon URL failed, retry without query:", url);
            setFallbackUrl(cleaned);
            return;
          }

          const revIdx = url.indexOf("/revision/latest");
          if (revIdx >= 0) {
            const base = cleanIconUrl(url.slice(0, revIdx));
            console.warn("Icon URL failed, retry base without revision:", url);
            setFallbackUrl(base);
            return;
          }

          if (url.includes("creatures-of-agartha-official")) {
            const swapped = cleanIconUrl(swapIconDomainToSonaria(url));
            console.warn("Icon URL failed, retry with sonaria domain:", url);
            setFallbackUrl(swapped);
            return;
          }
        }

        setFailed(true);
      }}
    />
  );
}
