import { useEffect, useState } from "react";
import type { AbilityCoverageSummary } from "../components/compare/types";

const EMPTY_COVERAGE: AbilityCoverageSummary = {
  total: 0,
  applied: 0,
  partial: 0,
  speedBuildsOnly: 0,
  outOfModel: 0,
  unresolved: 0,
};

export function useAbilityCoverage(debugMode: boolean): AbilityCoverageSummary {
  const [abilityCoverage, setAbilityCoverage] = useState<AbilityCoverageSummary>(EMPTY_COVERAGE);

  useEffect(() => {
    let cancelled = false;
    if (!debugMode) {
      setAbilityCoverage(EMPTY_COVERAGE);
      return;
    }
    void import("../optimizer/abilityCoverage")
      .then((module) => {
        if (cancelled) return;
        setAbilityCoverage(module.computeAbilityCoverageSummary());
      })
      .catch(() => {
        if (cancelled) return;
        setAbilityCoverage(EMPTY_COVERAGE);
      });
    return () => {
      cancelled = true;
    };
  }, [debugMode]);

  return abilityCoverage;
}
