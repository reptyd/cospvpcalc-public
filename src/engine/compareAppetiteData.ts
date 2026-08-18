export type CompareAppetiteEntry = {
  appetite: number;
};

// Built-in creature appetite comes from creature.stats.appetite (synced
// from the wiki). This registry holds only custom-creature appetite
// overrides, registered/unregistered as custom records load.
const COMPARE_APPETITE_BY_CREATURE: Record<string, CompareAppetiteEntry> = {};
const customCompareAppetiteNames = new Set<string>();

export function getCompareAppetiteEntry(creatureName: string | null | undefined): CompareAppetiteEntry | null {
  if (!creatureName) return null;
  return COMPARE_APPETITE_BY_CREATURE[creatureName] ?? null;
}

export function registerTemporaryCompareAppetiteEntry(creatureName: string, entry: CompareAppetiteEntry): void {
  COMPARE_APPETITE_BY_CREATURE[creatureName] = entry;
  customCompareAppetiteNames.add(creatureName);
}

export function unregisterTemporaryCompareAppetiteEntry(creatureName: string): void {
  if (!customCompareAppetiteNames.has(creatureName)) return;
  customCompareAppetiteNames.delete(creatureName);
  delete COMPARE_APPETITE_BY_CREATURE[creatureName];
}
