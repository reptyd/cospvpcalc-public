import { useState } from "react";
import type { SimulationSummary } from "../../engine";
import { formatRoundedNumber, formatRoundedSeconds } from "../../shared/displayFormat";
import { ToggleSwitch } from "../ToggleSwitch";
import { getActualBattleEndTime, getViewCombatLog, getViewCutoffTime, getViewDetails, type CompareResultViewMode, type ViewCombatLogEntry } from "./compareResultView";
import { resolveCompareDisplayNames } from "./compareDisplayNames";

type CombatLogEntry = ViewCombatLogEntry;
type TimelineEventKind = "damage" | "heal" | "ability" | "status" | "decay" | "utility" | "death";
type TimelineSide = "A" | "B";
type TimelineEventVisibility = Record<TimelineEventKind, boolean>;
type TimelineSourceVisibility = Record<string, boolean>;
type TimelineSourceGroup = "Core Actions" | "Abilities" | "Statuses" | "Recovery" | "Reactive" | "Other";
type TimelineSourceOption = {
  id: string;
  label: string;
  group: TimelineSourceGroup;
  description: string;
  count: number;
};

const TIMELINE_EVENT_OPTIONS: Array<{ kind: TimelineEventKind; label: string; description: string }> = [
  { kind: "damage", label: "Damage", description: "Bites, breath ticks, ailment ticks, and direct hits." },
  { kind: "heal", label: "Healing", description: "Events that restore HP." },
  { kind: "ability", label: "Ability", description: "Ability activations and windups without direct status changes." },
  { kind: "status", label: "Status", description: "Status applications and refreshes." },
  { kind: "decay", label: "Decay", description: "Natural decay and expiration events." },
  { kind: "utility", label: "Utility", description: "Other entries without an HP swing." },
  { kind: "death", label: "Death", description: "Death markers for this side." },
];

const DEFAULT_TIMELINE_EVENT_VISIBILITY: TimelineEventVisibility = {
  damage: true,
  heal: true,
  ability: true,
  status: true,
  decay: true,
  utility: true,
  death: true,
};

function formatCombatEventLabel(type: CombatLogEntry["type"]): string {
  if (type === "bite") return "Bite hit";
  if (type === "dot") return "Ailment tick";
  if (type === "breath") return "Breath tick";
  return "Active ability";
}

function getDisplayedAbilities(applied: Array<{ name: string; count: number }> | undefined): Array<{ name: string; count: number }> {
  return (applied ?? []).filter((entry) => entry.name !== "Breath");
}

function renderTimelineActor(entry: CombatLogEntry, displayA: string, displayB: string): string {
  return entry.attacker === "A" ? displayA : displayB;
}

function isShadowBarrageTimelineDescription(description: string): boolean {
  const normalized = description.toLowerCase();
  return (
    normalized === "shadow barrage hit" ||
    normalized.startsWith("shadow barrage applied ") ||
    normalized.startsWith("shadow barrage removed ")
  );
}

function isShadowBarrageNormalized(normalized: string): boolean {
  return (
    normalized === "shadow barrage hit" ||
    normalized.startsWith("shadow barrage applied ") ||
    normalized.startsWith("shadow barrage removed ")
  );
}

export function getTimelineEventKind(entry: CombatLogEntry): TimelineEventKind {
  if (entry.timelineKindOverride === "death") return "death";
  const description = entry.description ?? "";
  // Lowercase once - every classification branch below reads against the
  // normalized form. At Kendyll scale the timeline can hold ~100k entries
  // and the prior path lowercased twice per entry on the Shadow Barrage
  // probe path.
  const normalized = description.toLowerCase();
  if (isShadowBarrageNormalized(normalized)) return "ability";
  if ((entry.healing ?? 0) > 0) return "heal";
  if (entry.damage > 0) return "damage";
  if (normalized.includes("naturally decayed") || normalized.includes("naturally expired")) return "decay";
  if (normalized.includes("applied") || normalized.includes("removed")) return "status";
  if (
    normalized.endsWith(" activated") ||
    normalized.endsWith(" deactivated") ||
    normalized.endsWith(" active") ||
    normalized === "reflux charge started"
  ) return "ability";
  return "utility";
}

function getTimelineEventBadge(entry: CombatLogEntry): string {
  const kind = getTimelineEventKind(entry);
  if (kind === "damage" && entry.type === "dot") return "Ailment";
  if (kind === "damage" && entry.type === "breath") return "Breath";
  if (kind === "damage") return "Damage";
  if (kind === "heal") return "Heal";
  if (kind === "ability") return "Ability";
  if (kind === "status") return "Status";
  if (kind === "decay") return "Decay";
  if (kind === "death") return "Death";
  return "Utility";
}

function formatStacks(stacks: number): string {
  return formatRoundedNumber(stacks);
}

function formatTimelineNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatTimelineSeconds(value: number): string {
  return `${formatTimelineNumber(value)}s`;
}

function formatStatusLabel(statusId: string | undefined): string {
  if (!statusId) return "Status";
  return statusId.replace(/_Status$/i, "").replace(/_/g, " ");
}

export function getTimelineSourceMeta(entry: CombatLogEntry): Omit<TimelineSourceOption, "count"> {
  if (entry.timelineKindOverride === "death") {
    return { id: "death", label: "Death", group: "Other", description: "Synthetic death marker event." };
  }
  if (entry.type === "bite") {
    return { id: "core:bite", label: "Bite", group: "Core Actions", description: "Standard melee hit entries." };
  }
  if (entry.type === "breath") {
    return { id: "core:breath", label: "Breath", group: "Core Actions", description: "Breath tick entries." };
  }
  if (entry.type === "dot") {
    const status = formatStatusLabel(entry.statusId);
    return { id: `status-dot:${status}`, label: `${status} tick`, group: "Statuses", description: `${status} damage-over-time ticks.` };
  }
  const description = entry.description ?? "";
  const activated = description.match(/^(.*) activated$/);
  if (activated) {
    return {
      id: `ability:${activated[1]}`,
      label: activated[1],
      group: "Abilities",
      description: `${activated[1]} activation events.`,
    };
  }
  const deactivated = description.match(/^(.*) deactivated$/);
  if (deactivated) {
    return {
      id: `ability:${deactivated[1]}`,
      label: deactivated[1],
      group: "Abilities",
      description: `${deactivated[1]} passive transition events.`,
    };
  }
  const active = description.match(/^(.*) active$/);
  if (active) {
    return {
      id: `ability:${active[1]}`,
      label: active[1],
      group: "Abilities",
      description: `${active[1]} passive effect events.`,
    };
  }
  if (description.startsWith("Reflect (")) {
    return { id: "reactive:reflect", label: "Reflect", group: "Reactive", description: "Reflect damage and reflect-trigger entries." };
  }
  if (description === "Life Leech heal") {
    return { id: "recovery:life-leech", label: "Life Leech heal", group: "Recovery", description: "Healing granted by Life Leech." };
  }
  if (description === "Natural regen") {
    return { id: "recovery:natural-regen", label: "Natural regen", group: "Recovery", description: "Passive health regeneration ticks." };
  }
  if (description === "Reflux impact") {
    return { id: "ability:Reflux impact", label: "Reflux impact", group: "Abilities", description: "Reflux direct impact events." };
  }
  if (description === "Reflux puddle tick") {
    return { id: "ability:Reflux puddle tick", label: "Reflux puddle tick", group: "Abilities", description: "Reflux puddle damage ticks." };
  }
  if (description === "Reflux charge started") {
    return { id: "ability:Reflux charge started", label: "Reflux charge started", group: "Abilities", description: "Reflux windup events." };
  }
  if (isShadowBarrageTimelineDescription(description)) {
    return {
      id: "ability:Shadow Barrage",
      label: "Shadow Barrage",
      group: "Abilities",
      description: "Shadow Barrage activation, scheduled damage, and payload events.",
    };
  }
  if (description.includes(" applied ")) {
    const [source] = description.split(" applied ");
    const status = formatStatusLabel(entry.statusId);
    if (source === "Bite" || source === "Breath") {
      return {
        id: `status-apply:${status}`,
        label: `${status} applied`,
        group: "Statuses",
        description: `${status} applications from combat events.`,
      };
    }
    return {
      id: `status-apply:${source || status}`,
      label: `${source || status} applied`,
      group: "Statuses",
      description: `Applied effect events for ${source || status}.`,
    };
  }
  if (description.includes(" removed ")) {
    const [source] = description.split(" removed ");
    const status = formatStatusLabel(entry.statusId);
    return {
      id: `status-remove:${source || status}`,
      label: `${source || status} removed`,
      group: "Statuses",
      description: `Removed effect events for ${source || status}.`,
    };
  }
  if (description.includes("naturally decayed")) {
    const status = formatStatusLabel(entry.statusId);
    return { id: `status-decay:${status}`, label: `${status} decayed`, group: "Statuses", description: `Natural ${status} decay events.` };
  }
  if (description.includes("naturally expired")) {
    const status = formatStatusLabel(entry.statusId);
    return { id: `status-expire:${status}`, label: `${status} expired`, group: "Statuses", description: `Natural ${status} expiration events.` };
  }
  if (description) {
    return { id: `other:${description}`, label: description, group: "Other", description: "Other timeline event source." };
  }
  return { id: "other:unknown", label: "Other", group: "Other", description: "Unclassified timeline source." };
}

function buildTimelineSourceOptions(combatLog: CombatLogEntry[], side: TimelineSide): TimelineSourceOption[] {
  const options = new Map<string, TimelineSourceOption>();
  for (const entry of combatLog) {
    if (entry.attacker !== side) continue;
    const meta = getTimelineSourceMeta(entry);
    const existing = options.get(meta.id);
    if (existing) {
      existing.count += 1;
      continue;
    }
    options.set(meta.id, { ...meta, count: 1 });
  }
  return Array.from(options.values()).sort((left, right) => left.group.localeCompare(right.group) || left.label.localeCompare(right.label));
}

function isTimelineEntryVisible(
  entry: CombatLogEntry,
  visibilityBySide: Record<TimelineSide, TimelineEventVisibility>,
  sourceVisibilityBySide: Record<TimelineSide, TimelineSourceVisibility>,
): boolean {
  const side = entry.attacker;
  const source = getTimelineSourceMeta(entry).id;
  const sourceVisible = sourceVisibilityBySide[side][source] ?? true;
  return visibilityBySide[side][getTimelineEventKind(entry)] && sourceVisible;
}

function SideDetailsCard({
  title,
  bites,
  primaryBites,
  secondaryBites,
  breathTimeSec,
  abilities,
  finalEffects,
  dotDamageBreakdown,
}: {
  title: string;
  bites: number;
  /** Primary-bite count for this side. Used to break "Bites: N"
   *  into a "P primary, S secondary" split when at least one
   *  secondary bite landed. When all bites are primary the breakdown
   *  is hidden - the legacy single-number label stays. */
  primaryBites: number;
  secondaryBites: number;
  breathTimeSec: number;
  abilities: Array<{ name: string; count: number }>;
  finalEffects: Array<{ name: string; stacks: number }>;
  dotDamageBreakdown: Array<{ name: string; damage: number }>;
}) {
  // Only show the breakdown when secondary bites actually happened.
  // Older fixtures and any creature without a secondary attack
  // collapse to the plain "Bites: N" line - zero visual change there.
  const showVariantBreakdown = secondaryBites > 0;
  return (
    <div className="panel-block">
      <h3>{title}</h3>
      <ul className="stat-list compare-detail-metrics">
        <li>
          Bites: {bites}
          {showVariantBreakdown ? (
            <span className="muted"> ({primaryBites} primary, {secondaryBites} secondary)</span>
          ) : null}
        </li>
        <li>Breath Time: {formatRoundedSeconds(breathTimeSec)}</li>
      </ul>
      <div className="compare-ability-section">
        <strong>Abilities Used</strong>
        {abilities.length === 0 ? (
          <div className="muted">No active abilities used.</div>
        ) : (
          <ul className="stat-list">
            {abilities.map((entry) => (
              <li key={entry.name}>
                {entry.name}: {entry.count}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="compare-ability-section">
        <strong>Effects At End</strong>
        {finalEffects.length === 0 ? (
          <div className="muted">No active effects at end of battle.</div>
        ) : (
          <ul className="stat-list">
            {finalEffects.map((entry) => (
              <li key={entry.name}>
                {entry.name}: {formatStacks(entry.stacks)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="compare-ability-section">
        <strong>Ailment Damage Taken</strong>
        {dotDamageBreakdown.length === 0 ? (
          <div className="muted">No ailment damage taken.</div>
        ) : (
          <ul className="stat-list">
            {dotDamageBreakdown.map((entry) => (
              <li key={entry.name}>
                {entry.name}: {formatRoundedNumber(entry.damage)} dmg
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TimelineSettingsColumn({
  title,
  visibility,
  sourceVisibility,
  sources,
  onToggle,
  onToggleSource,
  onReset,
}: {
  title: string;
  visibility: TimelineEventVisibility;
  sourceVisibility: TimelineSourceVisibility;
  sources: TimelineSourceOption[];
  onToggle: (kind: TimelineEventKind, next: boolean) => void;
  onToggleSource: (source: string, next: boolean) => void;
  onReset: () => void;
}) {
  const sourceGroups = Array.from(new Set(sources.map((source) => source.group)));

  return (
    <div className="compare-timeline-settings-column">
      <div className="compare-timeline-settings-column-header">
        <div>
          <strong>{title}</strong>
          <span>Controls which events this side contributes to the timeline.</span>
        </div>
        <button type="button" className="secondary compare-timeline-settings-reset" onClick={onReset}>
          Reset
        </button>
      </div>
      <div className="compare-timeline-settings-toggle-list">
        {TIMELINE_EVENT_OPTIONS.map((option) => (
          <ToggleSwitch
            key={option.kind}
            checked={visibility[option.kind]}
            onChange={(next) => onToggle(option.kind, next)}
            label={option.label}
            description={option.description}
          />
        ))}
      </div>
      <div className="compare-timeline-source-section">
        <div className="compare-timeline-source-heading">
          <strong>Specific Sources</strong>
          <span>Abilities, statuses, reflects, regen, and other concrete timeline sources.</span>
        </div>
        {sources.length === 0 ? (
          <div className="muted">No timeline sources recorded for this side.</div>
        ) : (
          <div className="compare-timeline-source-groups">
            {sourceGroups.map((group) => (
              <div key={group} className="compare-timeline-source-group">
                <div className="compare-timeline-source-group-title">{group}</div>
                <div className="compare-timeline-source-toggle-list">
                  {sources.filter((source) => source.group === group).map((source) => (
                    <ToggleSwitch
                      key={source.id}
                      checked={sourceVisibility[source.id] ?? true}
                      onChange={(next) => onToggleSource(source.id, next)}
                      label={`${source.label} (${source.count})`}
                      description={source.description}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CompareBattleDetails({
  summary,
  nameA,
  nameB,
  needsCalc,
  resultViewMode,
  developerMode,
  trueDeveloperMode,
}: {
  summary: SimulationSummary | null;
  nameA: string;
  nameB: string;
  needsCalc: boolean;
  resultViewMode: CompareResultViewMode;
  developerMode: boolean;
  trueDeveloperMode: boolean;
}) {
  const showTimelineSettings = developerMode || trueDeveloperMode;
  const { displayA, displayB } = resolveCompareDisplayNames(nameA, nameB);
  const [timelineVisibilityBySide, setTimelineVisibilityBySide] = useState<Record<TimelineSide, TimelineEventVisibility>>({
    A: { ...DEFAULT_TIMELINE_EVENT_VISIBILITY },
    B: { ...DEFAULT_TIMELINE_EVENT_VISIBILITY },
  });
  const [timelineSourceVisibilityBySide, setTimelineSourceVisibilityBySide] = useState<Record<TimelineSide, TimelineSourceVisibility>>({
    A: {},
    B: {},
  });

  if (!summary) {
    return (
      <div className="compare-detail-stack">
        <div className="panel-block compare-timeline-panel">
          <h3>Timeline</h3>
          <div className="muted">{needsCalc ? "Press Calculate to generate battle details." : "Select both creatures."}</div>
        </div>
      </div>
    );
  }

  const detailsA = getViewDetails(summary, resultViewMode, "A");
  const detailsB = getViewDetails(summary, resultViewMode, "B");
  const combatLog = getViewCombatLog(summary, resultViewMode);
  const timelineSourcesA = buildTimelineSourceOptions(combatLog, "A");
  const timelineSourcesB = buildTimelineSourceOptions(combatLog, "B");
  const cutoffTime = getViewCutoffTime(summary, resultViewMode);
  const actualEndTime = getActualBattleEndTime(summary);
  const filteredCombatLog = showTimelineSettings
    ? combatLog.filter((entry) => isTimelineEntryVisible(entry, timelineVisibilityBySide, timelineSourceVisibilityBySide))
    : combatLog;

  const setTimelineEventVisibility = (side: TimelineSide, kind: TimelineEventKind, next: boolean) => {
    setTimelineVisibilityBySide((current) => ({
      ...current,
      [side]: {
        ...current[side],
        [kind]: next,
      },
    }));
  };

  const resetTimelineVisibility = (side: TimelineSide) => {
    setTimelineVisibilityBySide((current) => ({
      ...current,
      [side]: { ...DEFAULT_TIMELINE_EVENT_VISIBILITY },
    }));
    setTimelineSourceVisibilityBySide((current) => ({
      ...current,
      [side]: {},
    }));
  };

  const setTimelineSourceVisibility = (side: TimelineSide, source: string, next: boolean) => {
    setTimelineSourceVisibilityBySide((current) => ({
      ...current,
      [side]: {
        ...current[side],
        [source]: next,
      },
    }));
  };

  return (
    <div className="compare-detail-stack">
      <div className="compare-detail-grid">
        <SideDetailsCard
          title={`${displayA} Details`}
          bites={detailsA.biteCount}
          primaryBites={detailsA.primaryBiteCount}
          secondaryBites={detailsA.secondaryBiteCount}
          breathTimeSec={detailsA.breathTimeSec}
          abilities={getDisplayedAbilities(detailsA.abilities)}
          finalEffects={detailsA.finalEffects}
          dotDamageBreakdown={detailsA.dotDamageBreakdown}
        />
        <SideDetailsCard
          title={`${displayB} Details`}
          bites={detailsB.biteCount}
          primaryBites={detailsB.primaryBiteCount}
          secondaryBites={detailsB.secondaryBiteCount}
          breathTimeSec={detailsB.breathTimeSec}
          abilities={getDisplayedAbilities(detailsB.abilities)}
          finalEffects={detailsB.finalEffects}
          dotDamageBreakdown={detailsB.dotDamageBreakdown}
        />
      </div>
      {showTimelineSettings ? (
        <div className="panel-block compare-timeline-settings-panel">
          <div className="compare-timeline-settings-header">
            <div>
              <h3>Timeline Settings</h3>
              <div className="muted">Filter timeline entries by source side and event kind.</div>
            </div>
            <div className="compare-timeline-settings-summary">
              Showing {filteredCombatLog.length} of {combatLog.length} events
            </div>
          </div>
          <div className="compare-timeline-settings-grid">
            <TimelineSettingsColumn
              title={`${displayA} Timeline Events`}
              visibility={timelineVisibilityBySide.A}
              sourceVisibility={timelineSourceVisibilityBySide.A}
              sources={timelineSourcesA}
              onToggle={(kind, next) => setTimelineEventVisibility("A", kind, next)}
              onToggleSource={(source, next) => setTimelineSourceVisibility("A", source, next)}
              onReset={() => resetTimelineVisibility("A")}
            />
            <TimelineSettingsColumn
              title={`${displayB} Timeline Events`}
              visibility={timelineVisibilityBySide.B}
              sourceVisibility={timelineSourceVisibilityBySide.B}
              sources={timelineSourcesB}
              onToggle={(kind, next) => setTimelineEventVisibility("B", kind, next)}
              onToggleSource={(source, next) => setTimelineSourceVisibility("B", source, next)}
              onReset={() => resetTimelineVisibility("B")}
            />
          </div>
        </div>
      ) : null}
      <div className="panel-block compare-timeline-panel">
        <div className="compare-timeline-header">
          <h3>Timeline</h3>
          <div className="muted">
            {resultViewMode === "firstDeath"
              ? `Showing events until first death at ${formatTimelineSeconds(cutoffTime)}`
              : `Showing full fight until ${formatTimelineSeconds(actualEndTime)}`}
          </div>
        </div>
        {filteredCombatLog.length === 0 ? (
          <div className="muted">No battle history available.</div>
        ) : (
          <div className="compare-timeline-list">
            {filteredCombatLog.map((entry, index) => (
              <div
                className={`compare-timeline-entry compare-timeline-entry-${getTimelineEventKind(entry)}`}
                key={entry.syntheticKey ?? `${entry.time}-${entry.type}-${index}`}
              >
                <span className="compare-timeline-time">{formatTimelineSeconds(entry.time)}</span>
                <div className="compare-timeline-actor">
                  <strong>{renderTimelineActor(entry, displayA, displayB)}</strong>
                  <div className="why">HP {formatTimelineNumber(entry.actorHpAfter)}</div>
                </div>
                <div className="compare-timeline-copy">
                  <div className="compare-timeline-copy-top">
                    <span className={`compare-timeline-badge compare-timeline-badge-${getTimelineEventKind(entry)}`}>
                      {getTimelineEventBadge(entry)}
                    </span>
                    <span>{entry.timelineKindOverride === "death" ? `${renderTimelineActor(entry, displayA, displayB)} died` : entry.description ?? formatCombatEventLabel(entry.type)}</span>
                  </div>
                  {entry.detail && entry.timelineKindOverride !== "death" ? <div className="why">{entry.detail}</div> : null}
                </div>
                {entry.damage > 0 || (entry.healing ?? 0) > 0 ? (
                  <div className="compare-timeline-result">
                    {entry.damage > 0 ? <span className="compare-timeline-damage">{formatTimelineNumber(entry.damage)} dmg</span> : null}
                    {(entry.healing ?? 0) > 0 ? (
                      <div className="compare-timeline-heal">{formatTimelineNumber(entry.healing ?? 0)} heal</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="compare-timeline-result compare-timeline-result-muted">No HP swing</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
