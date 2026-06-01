import { useEffect, useState } from "react";
import type { AbilityCoverageSummary } from "../components/compare/types";

export function useAbilityCoverage(debugMode: boolean): AbilityCoverageSummary {
  const [abilityCoverage, setAbilityCoverage] = useState<AbilityCoverageSummary>({
    total: 0,
    applied: 0,
    partial: 0,
    deferred: 0,
    outOfModel: 0,
    unresolved: 0,
  });

  useEffect(() => {
    let cancelled = false;
    if (!debugMode) {
      setAbilityCoverage({ total: 0, applied: 0, partial: 0, deferred: 0, outOfModel: 0, unresolved: 0 });
      return;
    }
    void import("../optimizer/abilityCoverage")
      .then((module) => {
        if (cancelled) return;
        setAbilityCoverage(module.computeAbilityCoverageSummary());
      })
      .catch(() => {
        if (cancelled) return;
        setAbilityCoverage({ total: 0, applied: 0, partial: 0, deferred: 0, outOfModel: 0, unresolved: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [debugMode]);

  return abilityCoverage;
}
