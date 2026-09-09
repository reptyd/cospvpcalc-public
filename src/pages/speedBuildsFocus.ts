// A one-shot handoff for "open Speed Builds on this creature, with this build".
//
// Compare holds two creatures and Speed Builds holds one, and that one is the
// same state Compare's A side reads. Sending the B side over by writing that
// state would swap the reader's matchup out from under them, so the request is
// left here instead: Speed Builds takes it when it mounts and shows it without
// touching Compare. It is gone after that, so coming back later opens the page
// on whatever the reader left it on.
//
// The build travels with the name because the figures the reader just looked at
// were that build's. Speed Builds opens in manual on it - the page's other mode
// searches for a better build, which answers a different question than the one
// the reader asked by clicking a figure.

import type { BuildOptions } from "../engine/types";

export type SpeedBuildsRequest = { name: string; build: BuildOptions };

let pending: SpeedBuildsRequest | null = null;

export function requestSpeedBuildsCreature(name: string, build: BuildOptions): void {
  pending = { name, build };
}

export function takeRequestedSpeedBuildsCreature(): SpeedBuildsRequest | null {
  const request = pending;
  pending = null;
  return request;
}

