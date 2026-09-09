import type { BuildOptions } from "../engine";

export function plushiePairKey(plushies: string[]): string {
  if (plushies.length === 0) return "none";
  if (plushies.length === 1) return plushies[0];
  const [a, b] = plushies;
  if (a === b) return `${a}+${a}`;
  return [a, b].sort().join("+");
}

export function computeAscensionCounts(traits: string[], assignments: string[], stage: number): number[] {
  const levels: Record<string, number> = {};
  for (const id of traits) levels[id] = 0;
  for (let i = 0; i < stage; i += 1) {
    const assignment = assignments[i];
    if (!assignment || levels[assignment] === undefined) continue;
    levels[assignment] += 1;
  }
  return traits.map((id) => levels[id] ?? 0);
}

export function buildResultKey(build: BuildOptions, activesOn: boolean, breathOn: boolean): string {
  const plushKey = [...build.plushies].sort().join("+");
  const traitKey = [...build.traits].sort().join("+");
  const ascCounts = computeAscensionCounts(build.traits, build.ascensionAssignments, build.venerationStage)
    .map((count) => String(count))
    .join(",");
  return `${build.venerationStage}::${build.elder ?? "None"}::${traitKey}::${ascCounts}::${plushKey}::${activesOn ? 1 : 0}${breathOn ? 1 : 0}`;
}
