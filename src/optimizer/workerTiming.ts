export function getWorkerTimerApi(): Pick<typeof globalThis, "setTimeout" | "clearTimeout"> {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function" && typeof window.clearTimeout === "function") {
    return window;
  }
  return globalThis;
}
