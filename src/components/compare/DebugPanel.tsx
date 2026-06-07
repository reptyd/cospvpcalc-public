import type { SimulationSummary } from "../../engine";
import { formatRoundedNumber, formatRoundedPercent, formatRoundedSeconds } from "../../shared/displayFormat";
import type { AbilityCoverageSummary } from "./types";

function formatAbilityPolicyOverrides(overrides: NonNullable<SimulationSummary["debug"]>["A"]["abilityPolicyOverrides"]): string {
  const entries = Object.entries(overrides ?? {});
  if (entries.length === 0) return "None";
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, mode]) => `${name}: ${mode}`)
    .join(", ");
}

export function DebugPanel({
  debug,
  abilityCoverage,
  summary,
}: {
  debug: NonNullable<SimulationSummary["debug"]>;
  abilityCoverage: AbilityCoverageSummary;
  summary: SimulationSummary;
}) {
  const trackedStatuses = ["Bleed_Status", "Burn_Status", "Poison_Status", "Frostbite_Status", "Necropoison_Status"];
  const renderStatusCounters = (side: "A" | "B") => {
    const applied = debug[side].statusStacksApplied ?? {};
    const blocked = debug[side].statusStacksBlocked ?? {};
    const fractions = debug[side].statusBlockFractions ?? {};
    return (
      <ul className="stat-list">
        {trackedStatuses.map((statusId) => (
          <li key={`${side}-${statusId}`}>
            {statusId}: applied {formatRoundedNumber((applied[statusId] ?? 0) as number)}, blocked {formatRoundedNumber((blocked[statusId] ?? 0) as number)}, blockFrac{" "}
            {formatRoundedPercent(((fractions[statusId] ?? 0) as number) * 100)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <details className="debug-panel">
      <summary>Debug / Explain</summary>
      <div className="debug-grid">
        <div>
          <strong>Ability Coverage</strong>
          <div>Applied: {abilityCoverage.applied} / {abilityCoverage.total}</div>
          <div>Partial: {abilityCoverage.partial}</div>
          <div>Deferred: {abilityCoverage.deferred}</div>
          <div>Out of model: {abilityCoverage.outOfModel}</div>
          <div>Not modeled yet: {abilityCoverage.unresolved}</div>
          <div>Extended Damage A: {formatRoundedNumber(summary.extendedDamagePotentialA)}</div>
          <div>Extended Damage B: {formatRoundedNumber(summary.extendedDamagePotentialB)}</div>
          <div>Bad Omen Outcome: {summary.badOmenOutcome?.label ?? "Auto"}</div>
          <div>Creature A ability audit:</div>
          <ul className="stat-list">
            <li>Present: {debug.A.abilitiesPresent?.length ?? 0}</li>
            <li>Modeled: {debug.A.abilitiesModeled?.length ?? 0}</li>
            <li>Applied in sim: {debug.A.abilitiesApplied?.length ?? 0}</li>
            <li>Present but not modeled: {debug.A.abilitiesNotModeled?.length ?? 0}</li>
          </ul>
          <div>Creature B ability audit:</div>
          <ul className="stat-list">
            <li>Present: {debug.B.abilitiesPresent?.length ?? 0}</li>
            <li>Modeled: {debug.B.abilitiesModeled?.length ?? 0}</li>
            <li>Applied in sim: {debug.B.abilitiesApplied?.length ?? 0}</li>
            <li>Present but not modeled: {debug.B.abilitiesNotModeled?.length ?? 0}</li>
          </ul>
        </div>
        <div>
          <strong>Creature A</strong>
          <div>Total Damage Dealt: {formatRoundedNumber(debug.A.totalDamageDealt)}</div>
          <div>Life Leech Healed: {formatRoundedNumber(debug.A.totalLifeLeechHealed)}</div>
          <div>DoT DPS: {formatRoundedNumber(debug.A.dotDps)}</div>
          <div>Regen Ticks: {debug.A.regenTicks}</div>
          <div>Regen Healed: {formatRoundedNumber(debug.A.regenHealed)}</div>
          <div>Weight Ratio: {debug.A.weightRatio != null ? formatRoundedNumber(debug.A.weightRatio) : "N/A"} {debug.A.weightRatioCapHit ? "(cap)" : ""}</div>
          <div>Weights A/B: {debug.A.attackerWeight ?? "N/A"} / {debug.A.opponentWeight ?? "N/A"}</div>
          <div>Warden Rage: {debug.A.wardenRageOn ? "ON" : "OFF"} ({debug.A.wardenRageStacks})</div>
          <div>WR Cooldown Until: {debug.A.wardenRageCooldownUntil != null ? formatRoundedSeconds(debug.A.wardenRageCooldownUntil) : "N/A"}</div>
          <div>WR Tap Until: {debug.A.wardenRageTapUntil != null ? formatRoundedSeconds(debug.A.wardenRageTapUntil) : "N/A"}</div>
          <div>Next Regen At: {debug.A.nextRegenAt != null ? formatRoundedSeconds(debug.A.nextRegenAt) : "N/A"}</div>
          <div>WR Events: {debug.A.wardenRageEvents?.join(", ") || "None"}</div>
          <div>Timing Overrides: {formatAbilityPolicyOverrides(debug.A.abilityPolicyOverrides)}</div>
          <div>Warden Resistance Active: {debug.A.wardenResistanceActive ? "Yes" : "No"}</div>
          <div>Reflect Active Until: {debug.A.reflectActiveUntil ?? "N/A"}</div>
          <div>Totem Next Tick: {debug.A.totemNextTickAt ?? "N/A"}</div>
          <div>Drowsy Active: {debug.A.drowsyActive ? "Yes" : "No"}</div>
          <div>Plushie Stacks Applied (Off/Def): {debug.A.plushieOffensiveStacksApplied ?? 0} / {debug.A.plushieDefensiveStacksApplied ?? 0}</div>
          <div>Status stacks applied/blocked:</div>
          {renderStatusCounters("A")}
        </div>
        <div>
          <strong>Creature B</strong>
          <div>Total Damage Dealt: {formatRoundedNumber(debug.B.totalDamageDealt)}</div>
          <div>Life Leech Healed: {formatRoundedNumber(debug.B.totalLifeLeechHealed)}</div>
          <div>DoT DPS: {formatRoundedNumber(debug.B.dotDps)}</div>
          <div>Regen Ticks: {debug.B.regenTicks}</div>
          <div>Regen Healed: {formatRoundedNumber(debug.B.regenHealed)}</div>
          <div>Weight Ratio: {debug.B.weightRatio != null ? formatRoundedNumber(debug.B.weightRatio) : "N/A"} {debug.B.weightRatioCapHit ? "(cap)" : ""}</div>
          <div>Weights B/A: {debug.B.attackerWeight ?? "N/A"} / {debug.B.opponentWeight ?? "N/A"}</div>
          <div>Warden Rage: {debug.B.wardenRageOn ? "ON" : "OFF"} ({debug.B.wardenRageStacks})</div>
          <div>WR Cooldown Until: {debug.B.wardenRageCooldownUntil != null ? formatRoundedSeconds(debug.B.wardenRageCooldownUntil) : "N/A"}</div>
          <div>WR Tap Until: {debug.B.wardenRageTapUntil != null ? formatRoundedSeconds(debug.B.wardenRageTapUntil) : "N/A"}</div>
          <div>Next Regen At: {debug.B.nextRegenAt != null ? formatRoundedSeconds(debug.B.nextRegenAt) : "N/A"}</div>
          <div>WR Events: {debug.B.wardenRageEvents?.join(", ") || "None"}</div>
          <div>Timing Overrides: {formatAbilityPolicyOverrides(debug.B.abilityPolicyOverrides)}</div>
          <div>Warden Resistance Active: {debug.B.wardenResistanceActive ? "Yes" : "No"}</div>
          <div>Reflect Active Until: {debug.B.reflectActiveUntil ?? "N/A"}</div>
          <div>Totem Next Tick: {debug.B.totemNextTickAt ?? "N/A"}</div>
          <div>Drowsy Active: {debug.B.drowsyActive ? "Yes" : "No"}</div>
          <div>Plushie Stacks Applied (Off/Def): {debug.B.plushieOffensiveStacksApplied ?? 0} / {debug.B.plushieDefensiveStacksApplied ?? 0}</div>
          <div>Status stacks applied/blocked:</div>
          {renderStatusCounters("B")}
        </div>
      </div>
    </details>
  );
}
