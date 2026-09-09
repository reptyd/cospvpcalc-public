import { safeReadLocalStorage } from "../shared/safeStorage";

const OPTIMIZER_DEBUG_STORAGE_KEY = "cos.optimizerDebug";

function isOptimizerDebugEnabled(): boolean {
  const envFlag = import.meta.env.VITE_OPTIMIZER_DEBUG === "1";
  if (envFlag) return true;
  return safeReadLocalStorage(OPTIMIZER_DEBUG_STORAGE_KEY) === "1";
}

export function optimizerDebugLog(message?: unknown, ...optionalParams: unknown[]): void {
  if (!isOptimizerDebugEnabled()) return;
  console.log(message, ...optionalParams);
}
