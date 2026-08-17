// Mirror-domain notice.
//
// The custom domain `cospvpcalc.ru` intermittently fails to resolve for
// users behind ISP / regional DNS that filters the `.ru` name
// (the browser shows ERR_NAME_NOT_RESOLVED). The domain itself is
// healthy - it resolves fine through reputable resolvers (Google /
// Cloudflare DoH) and the `.pages.dev` mirror is never affected.
//
// A user hit by the DNS failure can't load anything served from `.ru`,
// so we cannot show them a banner *during* the outage. Instead we surface
// the mirror URL to everyone who CAN currently open `.ru`, as a heads-up
// to bookmark the fallback before the next intermittent failure.
//
// Shown only on the fragile custom domain; never on the mirror itself,
// localhost, or preview deploys.

import { safeReadLocalStorage, safeWriteLocalStorage } from "../shared/safeStorage";

export const MIRROR_URL = "https://cospvpcalc.pages.dev/";

// Hosts subject to the `.ru` DNS filtering that should advertise the
// mirror. The mirror host itself is deliberately excluded so the notice
// never points a working domain at itself.
const FRAGILE_HOSTS = new Set(["cospvpcalc.ru", "www.cospvpcalc.ru"]);

const DISMISS_KEY = "cos.mirrorNoticeDismissed";

export function shouldOfferMirror(
  hostname: string | undefined = typeof window !== "undefined"
    ? window.location.hostname
    : undefined,
): boolean {
  if (!hostname) return false;
  return FRAGILE_HOSTS.has(hostname.toLowerCase());
}

export function isMirrorNoticeDismissed(): boolean {
  return safeReadLocalStorage(DISMISS_KEY) === "1";
}

export function dismissMirrorNotice(): void {
  safeWriteLocalStorage(DISMISS_KEY, "1");
}
