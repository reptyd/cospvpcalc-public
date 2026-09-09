// Display rounding for the user-facing UI: 1 decimal place, no
// trailing ".0" on integers. `Math.round(value * 10) / 10` returns
// a `number` whose `String(...)` already drops trailing zeros, so
// 3 -> "3", 3.5 -> "3.5", 3.04 -> "3", 0.499 -> "0.5".
export function roundDisplayNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function formatRoundedNumber(value: number): string {
  return String(roundDisplayNumber(value));
}

// Breath capacity, as "left / max". Rounds like everything else, with one extra
// rule: a value below the maximum never renders AS the maximum. Capacity tops
// out around 10, so plain rounding turns 9.5 into "10 / 10" - full, which is
// the one state the number exists to distinguish. Below the maximum it rounds
// down instead. HP is not run through this: at four digits the last tenth is
// noise, and it rounds.
export function formatBreathCapacity(value: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(max)) return "0";
  const clamped = Math.max(0, value);
  if (clamped >= max) return formatRoundedNumber(max);
  const rounded = roundDisplayNumber(clamped);
  return String(rounded >= max ? Math.floor(clamped * 10) / 10 : rounded);
}

export function formatRoundedPercent(value: number): string {
  return `${roundDisplayNumber(value)}%`;
}

export function formatRoundedSeconds(value: number): string {
  return `${roundDisplayNumber(value)}s`;
}
