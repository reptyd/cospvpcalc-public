import { useEffect, useState } from "react";
import type { FinalStats } from "../../engine";
import { IconImg } from "../IconImg";

type AbilityCoverageEntry = {
  name: string;
  status: string;
  detail?: string;
};

// Display-only mirror of the EffectShape stat_modifier healthRegenPct in
// statusCatalog.ts NAME_TO_EFFECT_META for the three temp-buff statuses
// that can be active simultaneously on the same combatant. Phase 4 will
// read the canonical catalog directly; Phase 3 hardcodes here so the
// display refactor doesn't depend on the catalog being a build-time
// dependency of StatCard.
const TEMP_BUFF_HP_REGEN_PCT: Record<string, { label: string; pct: number }> = {
  Muddy_Status: { label: "Muddy", pct: 25 },
  Clean_Water_Status: { label: "Clean Water", pct: 20 },
  Refreshed_Status: { label: "Refreshed", pct: 5 },
};

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatTempBuffHpRegen(
  base: number | null | undefined,
  activeBuffIds: readonly string[],
): string {
  if (typeof base !== "number" || !Number.isFinite(base)) return "N/A";
  const matched = activeBuffIds
    .map((id) => TEMP_BUFF_HP_REGEN_PCT[id])
    .filter((entry): entry is { label: string; pct: number } => entry != null);
  if (matched.length === 0) return formatNumber(base);
  let multiplier = 1;
  for (const buff of matched) multiplier *= 1 + buff.pct / 100;
  const boosted = base * multiplier;
  const annotation = matched.map((b) => `${b.label} +${b.pct}%`).join(", ");
  return `${formatNumber(base)} → ${formatNumber(boosted)} (${annotation})`;
}

export function StatCard({
  title,
  stats,
  getIcon,
  compareAirRuleEnabled = false,
  compareAirRuleCooldownSec = null,
  activeTempBuffIds = [],
}: {
  title: string;
  stats: FinalStats | null;
  getIcon: (name: string) => string | null;
  compareAirRuleEnabled?: boolean;
  compareAirRuleCooldownSec?: number | null;
  activeTempBuffIds?: readonly string[];
}) {
  const iconUrl = stats ? getIcon(stats.name) : null;
  const [abilityInfo, setAbilityInfo] = useState<AbilityCoverageEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!stats) {
      setAbilityInfo([]);
      return;
    }
    void import("../../optimizer/abilityCoverage")
      .then((module) => {
        if (cancelled) return;
        setAbilityInfo(module.getAbilityCoverage(stats.name) as AbilityCoverageEntry[]);
      })
      .catch(() => {
        if (cancelled) return;
        setAbilityInfo([]);
      });
    return () => {
      cancelled = true;
    };
  }, [stats]);

  return (
    <div className="panel-block">
      <div className="card-title">
        <IconImg src={iconUrl} alt={stats?.name ?? title} size={64} />
        <h3>{title}</h3>
      </div>
      {!stats && <div className="muted">Select a creature.</div>}
      {stats && (
        <ul className="stat-list">
          <li>HP: {stats.health}</li>
          <li>Weight: {stats.weight}</li>
          <li>Damage: {stats.damage}</li>
          <li>
            Bite Cooldown:{" "}
            {compareAirRuleEnabled && typeof compareAirRuleCooldownSec === "number"
              ? `${compareAirRuleCooldownSec} (Special Air PvP Rule)`
              : stats.biteCooldown}
          </li>
          {compareAirRuleEnabled && typeof compareAirRuleCooldownSec === "number" ? (
            <li>Base Bite Cooldown: {stats.biteCooldown} (ignored in battle)</li>
          ) : null}
          <li>
            HP Regen:{" "}
            {activeTempBuffIds.length > 0
              ? formatTempBuffHpRegen(stats.healthRegen, activeTempBuffIds)
              : (stats.healthRegen ?? "N/A")}
          </li>
          <li>Stam Regen: {stats.stamRegen ?? "N/A"}</li>
          <li>Elder: {stats.elder ?? "None"}</li>
          <li>Breath: {stats.hasBreath ? stats.breathType : "None"}</li>
          <li>Tier: {stats.tier}</li>
          <li>Type: {stats.type ?? "N/A"}</li>
        </ul>
      )}
      {stats && (
        <details className="ability-list">
          <summary>Abilities</summary>
          <ul>
            {abilityInfo.map((ability) => (
              <li key={ability.name} className={`ability-${ability.status}`}>
                <span>
                  {ability.name}
                  {ability.detail ? ` (${ability.detail})` : ""}
                </span>
                <em>{ability.status}</em>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
