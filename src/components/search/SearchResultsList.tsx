import { IconImg } from "../IconImg";
import {
  NUMERIC_STAT_CATEGORIES,
  NUMERIC_STAT_LABELS,
  STATUS_SLOT_LABELS,
  statusIdToDisplayName,
  type NumericStatField,
  type QueryFieldSummary,
  type SearchableCreature,
} from "../../engine/creatureSearch";

// Short column headers for the dense result cards; fields without a
// short form fall back to the full NUMERIC_STAT_LABELS name.
const SHORT_LABELS: Partial<Record<NumericStatField, string>> = {
  health: "HP",
  weight: "Wt",
  damage: "DMG",
  biteCooldown: "Bite CD",
  stamina: "Stam",
  // HPR = HP regenerated per regen tick (~15s cadence in-game). NOT
  // HP/sec - calling it that would mislead users into thinking the
  // number applies per second.
  healthRegen: "HPR",
};
const SUFFIXES: Partial<Record<NumericStatField, string>> = {
  biteCooldown: "s",
  growthTime: " min",
};

function columnLabel(field: NumericStatField): string {
  return SHORT_LABELS[field] ?? NUMERIC_STAT_LABELS[field];
}

export function SearchResultsList({
  results,
  getCreatureIcon,
  summary,
  visibleFields,
  onToggleField,
  onUseAsA,
  onUseAsB,
}: {
  results: SearchableCreature[];
  getCreatureIcon: (name: string) => string | null;
  summary: QueryFieldSummary;
  visibleFields: NumericStatField[];
  onToggleField: (field: NumericStatField) => void;
  onUseAsA?: (name: string) => void;
  onUseAsB?: (name: string) => void;
}) {
  // Render the user-selected columns, plus any queried numeric field not
  // already selected (highlighted) - so a query for `sprintSpeed > 100`
  // always surfaces sprint speed on each card even if the column is off.
  const selected = new Set(visibleFields);
  const visibleStats = [
    ...visibleFields.map((field) => ({
      field,
      label: columnLabel(field),
      suffix: SUFFIXES[field],
      highlighted: summary.numericFields.has(field),
    })),
    ...[...summary.numericFields]
      .filter((field) => !selected.has(field))
      .map((field) => ({
        field,
        label: columnLabel(field),
        suffix: SUFFIXES[field],
        highlighted: true,
      })),
  ];

  return (
    <>
      <details className="search-column-picker">
        <summary className="muted">Columns · {visibleFields.length} shown</summary>
        <div className="search-column-groups">
          {NUMERIC_STAT_CATEGORIES.map((category) => (
            <div key={category.label} className="search-column-group">
              <span className="search-column-group-label">{category.label}</span>
              <div className="search-column-pills">
                {category.fields.map((field) => (
                  <button
                    key={field}
                    type="button"
                    className={`search-column-pill${selected.has(field) ? " is-active" : ""}`}
                    onClick={() => onToggleField(field)}
                    aria-pressed={selected.has(field)}
                  >
                    {NUMERIC_STAT_LABELS[field]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
      {results.length === 0 ? (
        <div className="search-results-empty muted">
          No creatures match the current filters. Loosen a comparator, clear the name search, or remove a condition.
        </div>
      ) : (
        <div className="search-results-grid">
          {results.map(({ creature, effects }) => {
            const stats = creature.stats as Record<string, number | string | undefined>;
            return (
              <div key={creature.name} className="search-result-card">
                <div className="search-result-head">
                  <IconImg src={getCreatureIcon(creature.name)} alt={creature.name} size={44} />
                  <div className="search-result-name-block">
                    <strong>{creature.name}</strong>
                    <div className="muted search-result-subline">
                      Tier {stats.tier} · {stats.diet ?? "-"} · {stats.type ?? "-"}
                    </div>
                  </div>
                </div>
                <div className="search-result-stats">
                  {visibleStats.map((entry) => (
                    <SearchStat
                      key={entry.field}
                      label={entry.label}
                      value={typeof stats[entry.field] === "number" ? (stats[entry.field] as number) : undefined}
                      suffix={entry.suffix}
                      highlighted={entry.highlighted}
                    />
                  ))}
                </div>
                {summary.abilityPredicates.length > 0 || summary.statusPredicates.length > 0 ? (
                  <MatchBadges creature={creature} effects={effects} summary={summary} />
                ) : null}
                {onUseAsA || onUseAsB ? (
                  <div className="row-actions search-result-actions">
                    {onUseAsA ? (
                      <button type="button" className="secondary" onClick={() => onUseAsA(creature.name)}>
                        Use as A
                      </button>
                    ) : null}
                    {onUseAsB ? (
                      <button type="button" className="secondary" onClick={() => onUseAsB(creature.name)}>
                        Use as B
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function SearchStat({
  label,
  value,
  suffix,
  highlighted,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
  highlighted?: boolean;
}) {
  return (
    <div className={`search-result-stat${highlighted ? " is-matched" : ""}`}>
      <span className="muted search-result-stat-label">{label}</span>
      <span className="search-result-stat-value">
        {typeof value === "number" && Number.isFinite(value) ? value : "-"}
        {suffix && typeof value === "number" ? suffix : ""}
      </span>
    </div>
  );
}

function MatchBadges({
  creature,
  effects,
  summary,
}: {
  creature: SearchableCreature["creature"];
  effects: SearchableCreature["effects"];
  summary: QueryFieldSummary;
}) {
  // Deduplicate predicates by what the badge displays:
  // - ability badges identified by (kind, name, mode) - same triple
  //   produces identical text and the same creature lookup, so a
  //   second copy adds no information.
  // - status badges identified by (slot, status) - the badge shows
  //   the creature's actual stat for that slot+status, not the
  //   predicate threshold, so duplicates render the same number.
  // The user's noisy "Offensive Bleed: - × 8" came from leaving
  // multiple default status predicates around the tree.
  const badges: Array<{ key: string; text: string; tone: "ability" | "status" }> = [];
  const seenAbilityKeys = new Set<string>();
  for (const predicate of summary.abilityPredicates) {
    const dedupKey = `${predicate.abilityKind}|${predicate.name}|${predicate.mode}`;
    if (seenAbilityKeys.has(dedupKey)) continue;
    seenAbilityKeys.add(dedupKey);
    const lists = (() => {
      switch (predicate.abilityKind) {
        case "passive": return [creature.passiveAbilities];
        case "activated": return [creature.activatedAbilities];
        case "breath": return [creature.breathAbilities];
        case "special": return [effects.specialAbilities, effects.specialAbilitiesDetailed];
        case "other": return [effects.otherAbilities];
      }
    })();
    const has = lists.some((list) =>
      (list ?? []).some((entry: { name: string }) => entry.name === predicate.name),
    );
    if ((predicate.mode === "has" && has) || (predicate.mode === "lacks" && !has)) {
      badges.push({
        key: `ability-${dedupKey}`,
        text: predicate.mode === "has" ? `✓ ${predicate.name}` : `✕ ${predicate.name}`,
        tone: "ability",
      });
    }
  }
  const seenStatusKeys = new Set<string>();
  for (const predicate of summary.statusPredicates) {
    const dedupKey = `${predicate.slot}|${predicate.status}`;
    if (seenStatusKeys.has(dedupKey)) continue;
    seenStatusKeys.add(dedupKey);
    const list = (() => {
      switch (predicate.slot) {
        case "offensive": return effects.applyStatusOnHit ?? [];
        case "defensive": return effects.applyStatusOnHitTaken ?? [];
        case "resist": return effects.resistStatus ?? [];
      }
    })();
    const total = list
      .filter((entry) => entry.statusId === predicate.status)
      .reduce((sum, entry) => {
        if ("stacks" in entry) return sum + entry.stacks;
        if ("fraction" in entry) return sum + entry.fraction;
        return sum;
      }, 0);
    const slotLabel = STATUS_SLOT_LABELS[predicate.slot].split(" ")[0]; // "Offensive" / "Defensive" / "Resist"
    badges.push({
      key: `status-${dedupKey}`,
      text: `${slotLabel} ${statusIdToDisplayName(predicate.status)}: ${formatStatusValue(total, predicate.slot)}`,
      tone: "status",
    });
  }
  if (badges.length === 0) return null;
  return (
    <div className="search-result-badges">
      {badges.map((badge) => (
        <span key={badge.key} className={`search-result-badge search-result-badge-${badge.tone}`}>
          {badge.text}
        </span>
      ))}
    </div>
  );
}

function formatStatusValue(total: number, slot: "offensive" | "defensive" | "resist"): string {
  if (total <= 0) return "-";
  if (slot === "resist") return `${(total * 100).toFixed(0)}%`;
  return total.toFixed(total < 1 ? 2 : 0);
}
