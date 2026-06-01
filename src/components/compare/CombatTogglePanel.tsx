import { useEffect, useState } from "react";
import type { CreatureRuntime, FinalStats } from "../../engine";
import {
  getCombatToggleOptions,
  getBreathToggleAliases,
  normalizeCompareAbilityName,
  normalizeCompareDisabledAbilities,
  type CombatToggleOption,
  type CombatEffectsLookup,
} from "../../engine/compareCombatToggleOptions";
import { ToggleSwitch } from "../ToggleSwitch";

export function CombatTogglePanel({
  label,
  finalStats,
  creature,
  disabled,
  onChange,
}: {
  label: string;
  finalStats: FinalStats | null;
  creature?: CreatureRuntime;
  disabled: string[];
  onChange: (value: string[]) => void;
}) {
  const [options, setOptions] = useState<CombatToggleOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!finalStats) {
      setOptions([]);
      return;
    }
    void import("../../engine/data")
      .then((module) => {
        if (cancelled) return;
        const effects = (module.effectsCatalog[finalStats.name] ?? {}) as CombatEffectsLookup;
        setOptions(getCombatToggleOptions(finalStats, effects, creature));
      })
      .catch(() => {
        if (cancelled) return;
        setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [finalStats, creature]);

  const normalizedDisabled = normalizeCompareDisabledAbilities(disabled, finalStats);

  const toggle = (id: string) => {
    if (normalizedDisabled.includes(id)) {
      const aliases = id === "Breath" ? new Set(getBreathToggleAliases(finalStats)) : new Set([normalizeCompareAbilityName(id)]);
      onChange(disabled.filter((item) => !aliases.has(normalizeCompareAbilityName(item))));
    }
    else onChange([...disabled, id]);
  };

  if (!finalStats) return <div className="muted">Select {label} creature.</div>;

  return (
    <div className="toggle-group">
      <strong>{label} Toggles</strong>
      {options.length === 0 && <div className="muted">No modeled combat toggles for this creature.</div>}
      {options.map((opt) => (
        <ToggleSwitch key={opt.id} checked={!normalizedDisabled.includes(opt.id)} onChange={() => toggle(opt.id)} label={opt.label} />
      ))}
    </div>
  );
}
