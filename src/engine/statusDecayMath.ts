import type { StatusInstance } from "./runtimeContext";

export function normalizeStatusDecayDelay(remainingSec: number, decaySec: number): number {
  if (!Number.isFinite(remainingSec) || remainingSec <= 0) return 0;
  const remainder = remainingSec % decaySec;
  if (Math.abs(remainder) <= 1e-9) return decaySec;
  return remainder;
}

export function computeStatusRemainingSec(
  instance: Pick<StatusInstance, "stacks" | "nextDecayAt">,
  time: number,
  decaySec: number,
): number {
  if (!Number.isFinite(instance.stacks) || instance.stacks <= 0) return 0;
  const nextDecayDelay =
    instance.nextDecayAt == null ? decaySec : Math.min(decaySec, Math.max(0, instance.nextDecayAt - time));
  return Math.max(0, (Math.max(instance.stacks - 1, 0) * decaySec) + nextDecayDelay);
}

export function refreshStatusRemainingSec(
  instance: StatusInstance,
  time: number,
  decaySec: number,
): void {
  instance.remainingSec = computeStatusRemainingSec(instance, time, decaySec);
}
