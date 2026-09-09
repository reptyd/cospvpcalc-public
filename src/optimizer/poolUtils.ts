import { creatureByName, creaturesData, resolveCreatureName } from "../engine/creatureData";

export type DefaultPoolScope = "sameOrHigher" | "sameOrLower" | "withinOneTier" | "exactTiers";

export function encodeCreaturePoolCode(names: string[]): string {
  return names.join("|");
}

export function parseCreaturePoolCode(input: string): string[] {
  if (!input.trim()) return [];
  const tokens = input
    .split(/[\n,|]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const resolved = resolveCreatureName(token);
    if (!resolved) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

export function buildDefaultMetaPool(
  sourceName: string,
  size: number,
  scope: DefaultPoolScope = "sameOrHigher",
  allowedTiers: number[] = [],
): string[] {
  const resolvedSourceName = resolveCreatureName(sourceName);
  const source = resolvedSourceName ? creatureByName[resolvedSourceName] : undefined;
  if (!source) return [];
  const sourceTier = source.stats.tier;
  const exactTierSet = scope === "exactTiers" && allowedTiers.length > 0 ? new Set(allowedTiers) : null;
  const all = creaturesData
    .filter((creature) => {
      if (creature.name === source.name) return false;
      if (scope === "exactTiers") return exactTierSet?.has(creature.stats.tier) ?? false;
      if (scope === "sameOrLower") return creature.stats.tier <= sourceTier;
      if (scope === "withinOneTier") return Math.abs(creature.stats.tier - sourceTier) <= 1;
      return creature.stats.tier >= sourceTier;
    })
    .map((creature) => creature.name);
  if (all.length <= size) return all;

  const byTier = new Map<number, string[]>();
  for (const name of all) {
    const tier = creatureByName[name]?.stats.tier ?? sourceTier;
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push(name);
  }
  for (const names of byTier.values()) {
    names.sort((a, b) => {
      const ca = creatureByName[a];
      const cb = creatureByName[b];
      if (!ca || !cb) return a.localeCompare(b);
      const sa = ca.stats.weight + ca.stats.damage * 8 + ca.stats.health / 4;
      const sb = cb.stats.weight + cb.stats.damage * 8 + cb.stats.health / 4;
      return sa - sb;
    });
  }

  const tiers = Array.from(byTier.keys()).sort((a, b) => b - a);
  const selected: string[] = [];
  const used = new Set<string>();
  while (selected.length < size) {
    let moved = false;
    for (const tier of tiers) {
      const list = byTier.get(tier);
      if (!list || list.length === 0) continue;
      const idx = Math.floor((list.length - 1) * (selected.length / Math.max(1, size - 1)));
      const candidate = list[idx] ?? list[0];
      list.splice(idx, 1);
      if (used.has(candidate)) continue;
      used.add(candidate);
      selected.push(candidate);
      moved = true;
      if (selected.length >= size) break;
    }
    if (!moved) break;
  }
  return selected.slice(0, size);
}

export function buildAdaptiveQuickOpponents(pool: string[], count: number): string[] {
  if (pool.length <= count) return [...pool];
  const ranked = [...pool].sort((a, b) => {
    const ca = creatureByName[a];
    const cb = creatureByName[b];
    if (!ca || !cb) return a.localeCompare(b);
    const sa = ca.stats.health * 0.25 + ca.stats.weight * 0.2 + ca.stats.damage * 8 + (1 / Math.max(0.1, ca.stats.biteCooldown)) * 100;
    const sb = cb.stats.health * 0.25 + cb.stats.weight * 0.2 + cb.stats.damage * 8 + (1 / Math.max(0.1, cb.stats.biteCooldown)) * 100;
    return sa - sb;
  });
  const picked: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor((i / Math.max(1, count - 1)) * (ranked.length - 1));
    const name = ranked[idx];
    if (name && !picked.includes(name)) picked.push(name);
  }
  if (picked.length < count) {
    for (const name of ranked) {
      if (picked.length >= count) break;
      if (!picked.includes(name)) picked.push(name);
    }
  }
  return picked;
}

