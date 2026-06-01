// Display rounding for the user-facing UI: 1 decimal place, no
// trailing ".0" on integers. `Math.round(value * 10) / 10` returns
// a `number` whose `String(...)` already drops trailing zeros, so
// 3 → "3", 3.5 → "3.5", 3.04 → "3", 0.499 → "0.5".
export function roundDisplayNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function formatRoundedNumber(value: number): string {
  return String(roundDisplayNumber(value));
}

export function formatRoundedPercent(value: number): string {
  return `${roundDisplayNumber(value)}%`;
}

export function formatRoundedSeconds(value: number): string {
  return `${roundDisplayNumber(value)}s`;
}
