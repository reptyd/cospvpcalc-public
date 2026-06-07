import { useEffect, useMemo, useState } from "react";
import { QueryGroup } from "../components/search/QueryGroup";
import { SearchResultsList } from "../components/search/SearchResultsList";
import { safeReadLocalStorage, safeWriteLocalStorage } from "../shared/safeStorage";
import {
  NUMERIC_STAT_CATEGORIES,
  NUMERIC_STAT_LABELS,
  SEARCHABLE_CREATURES,
  createEmptyRootGroup,
  runSearch,
  summarizeQueriedFields,
  type NumericStatField,
  type QueryGroup as QueryGroupModel,
  type SearchableCreature,
} from "../engine/creatureSearch";

export type SearchPageProps = {
  getCreatureIcon: (name: string) => string | null;
  onNameAChange?: (name: string) => void;
  onNameBChange?: (name: string) => void;
};

type SortKey = "name" | NumericStatField;
type SortDir = "asc" | "desc";

const DEFAULT_VISIBLE_FIELDS: NumericStatField[] = [
  "health", "weight", "damage", "biteCooldown", "stamina", "healthRegen",
];
const COLUMNS_STORAGE_KEY = "cos.searchColumns";

function loadVisibleFields(): NumericStatField[] {
  const raw = safeReadLocalStorage(COLUMNS_STORAGE_KEY);
  if (!raw) return DEFAULT_VISIBLE_FIELDS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_FIELDS;
    const valid = parsed.filter(
      (f): f is NumericStatField => typeof f === "string" && f in NUMERIC_STAT_LABELS,
    );
    return valid.length > 0 ? valid : DEFAULT_VISIBLE_FIELDS;
  } catch {
    return DEFAULT_VISIBLE_FIELDS;
  }
}

export default function SearchPage({
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
}: SearchPageProps) {
  const [root, setRoot] = useState<QueryGroupModel>(() => createEmptyRootGroup());
  const [nameQuery, setNameQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [visibleFields, setVisibleFields] = useState<NumericStatField[]>(loadVisibleFields);

  useEffect(() => {
    safeWriteLocalStorage(COLUMNS_STORAGE_KEY, JSON.stringify(visibleFields));
  }, [visibleFields]);

  const toggleField = (field: NumericStatField) => {
    setVisibleFields((current) =>
      current.includes(field) ? current.filter((f) => f !== field) : [...current, field],
    );
  };

  const summary = useMemo(() => summarizeQueriedFields(root), [root]);
  const rawResults = useMemo(() => runSearch(root), [root]);
  const filteredResults = useMemo(() => filterByName(rawResults, nameQuery), [rawResults, nameQuery]);
  const results = useMemo(() => sortResults(filteredResults, sortKey, sortDir), [filteredResults, sortKey, sortDir]);
  const hasAnyCondition = countPredicates(root) > 0;
  const hasAnyFilter = hasAnyCondition || nameQuery.trim().length > 0;
  const totalCreatures = SEARCHABLE_CREATURES.length;

  const handleReset = () => {
    setRoot(createEmptyRootGroup());
    setNameQuery("");
  };

  return (
    <section className="panel search-page">
      <div className="panel-block">
        <h3>Creature Search</h3>
        <p className="muted">
          Build a multi-criteria query over every creature in the catalog. Add typed conditions
          (numeric stats, categoricals like diet or type, ability presence, offensive / defensive /
          resist statuses) and combine them with AND / OR. Use sub-groups for bracketed expressions
          like <em>damage &gt; 500 AND (offensive Burn ≥ 2 OR defensive Disease ≥ 3)</em>.
        </p>
        <input
          type="text"
          className="search-name-bar"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="Search by creature name…"
          aria-label="Search by creature name"
        />
        <QueryGroup group={root} root={root} onRootChange={setRoot} depth={0} />
      </div>
      <div className="panel-block">
        <div className="search-results-head">
          <h3>Results</h3>
          <div className="search-results-toolbar">
            <span className="muted">
              {hasAnyFilter
                ? `${results.length} of ${totalCreatures} match`
                : `${totalCreatures} creatures (no filters - showing all)`}
            </span>
            <label className="search-sort-label">
              <span className="muted">Sort</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort by">
                <option value="name">Name</option>
                {NUMERIC_STAT_CATEGORIES.map((category) => (
                  <optgroup key={category.label} label={category.label}>
                    {category.fields.map((field) => (
                      <option key={field} value={field}>
                        {NUMERIC_STAT_LABELS[field]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <select value={sortDir} onChange={(e) => setSortDir(e.target.value as SortDir)} aria-label="Sort direction">
                <option value="asc">↑ asc</option>
                <option value="desc">↓ desc</option>
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              onClick={handleReset}
              disabled={!hasAnyFilter}
              title={hasAnyFilter ? "Clear name + all conditions" : "Nothing to clear"}
            >
              Reset
            </button>
          </div>
        </div>
        <SearchResultsList
          results={results}
          getCreatureIcon={getCreatureIcon}
          summary={summary}
          visibleFields={visibleFields}
          onToggleField={toggleField}
          onUseAsA={onNameAChange}
          onUseAsB={onNameBChange}
        />
      </div>
    </section>
  );
}

function filterByName(list: SearchableCreature[], query: string): SearchableCreature[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((entry) => entry.creature.name.toLowerCase().includes(q));
}

function countPredicates(node: QueryGroupModel): number {
  let n = 0;
  for (const child of node.children) {
    if (child.kind === "predicate") n += 1;
    else n += countPredicates(child);
  }
  return n;
}

function sortResults(list: SearchableCreature[], key: SortKey, dir: SortDir): SearchableCreature[] {
  const mult = dir === "asc" ? 1 : -1;
  const copy = [...list];
  copy.sort((left, right) => {
    if (key === "name") return mult * left.creature.name.localeCompare(right.creature.name);
    const lv = readNumber(left.creature.stats as Record<string, unknown>, key);
    const rv = readNumber(right.creature.stats as Record<string, unknown>, key);
    // Missing values sort to the bottom regardless of direction - they
    // can't satisfy a "largest / smallest by this stat" question.
    if (lv == null && rv == null) return left.creature.name.localeCompare(right.creature.name);
    if (lv == null) return 1;
    if (rv == null) return -1;
    if (lv === rv) return left.creature.name.localeCompare(right.creature.name);
    return mult * (lv - rv);
  });
  return copy;
}

function readNumber(stats: Record<string, unknown>, field: string): number | null {
  const raw = stats[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}
