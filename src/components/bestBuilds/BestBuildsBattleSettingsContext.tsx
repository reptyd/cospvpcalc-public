import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_BB_BATTLE_SETTINGS,
  type BestBuildsBattleSettings,
} from "./bestBuildsBattleSettingsTypes";

type BestBuildsBattleSettingsContextValue = {
  settings: BestBuildsBattleSettings;
  setSettings: (next: BestBuildsBattleSettings) => void;
};

const BestBuildsBattleSettingsContext = createContext<BestBuildsBattleSettingsContextValue | null>(null);

/**
 * Single source of truth for the Best Builds / Optimizer Battle Settings.
 * The provider wraps both pages so a change made in Best Builds is the
 * same value Optimizer sees, and vice versa - the two surfaces cannot
 * drift apart.
 */
export function BestBuildsBattleSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BestBuildsBattleSettings>(DEFAULT_BB_BATTLE_SETTINGS);
  const value = useMemo<BestBuildsBattleSettingsContextValue>(
    () => ({ settings, setSettings }),
    [settings],
  );
  return (
    <BestBuildsBattleSettingsContext.Provider value={value}>
      {children}
    </BestBuildsBattleSettingsContext.Provider>
  );
}

/**
 * Returns the shared Battle Settings + its setter. Throws if used outside
 * the provider, which surfaces wiring mistakes early (a silent
 * stand-alone state would let BB and Optimizer drift apart again).
 */
export function useBestBuildsBattleSettings(): BestBuildsBattleSettingsContextValue {
  const ctx = useContext(BestBuildsBattleSettingsContext);
  if (!ctx) {
    throw new Error(
      "useBestBuildsBattleSettings must be used inside a <BestBuildsBattleSettingsProvider>.",
    );
  }
  return ctx;
}

// React Fast Refresh limitation: this file mixes a component (Provider),
// a hook (useBestBuildsBattleSettings), and a module-level Context
// object. On HMR the Context identity gets replaced while the live
// Provider keeps the old identity, so consumers read the new context's
// `null` default and throw. Force a full reload on every update to keep
// dev parity with production.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
