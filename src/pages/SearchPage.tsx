import { useEffect, useMemo, useState } from "react";
import { QueryGroup } from "../components/search/QueryGroup";
import { SearchResultsList } from "../components/search/SearchResultsList";
import {
  NUMERIC_STAT_CATEGORIES,
  NUMERIC_STAT_LABELS,
  SEARCHABLE_CREATURES,
  createEmptyRootGroup,
  runSearch,
  summarizeQueriedFields,
  type NumericStatField,
  type QueryGroup as QueryGroupModel,
} from "../engine/creatureSearch";
import {
  countPredicates,
  filterByName,
  loadSearchQueryState,
  loadVisibleFields,
  saveSearchQueryState,
  saveVisibleFields,
  sortResults,
  type SortDir,
  type SortKey,
} from "./searchPageShared";

export type SearchPageProps = {
  getCreatureIcon: (name: string) => string | null;
  onNameAChange?: (name: string) => void;
  onNameBChange?: (name: string) => void;
};

export default function SearchPage({
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
}: SearchPageProps) {
  const persistedQuery = useMemo(() => loadSearchQueryState(), []);
  const [root, setRoot] = useState<QueryGroupModel>(() => persistedQuery.root ?? createEmptyRootGroup());
  const [nameQuery, setNameQuery] = useState(persistedQuery.nameQuery ?? "");
  const [sortKey, setSortKey] = useState<SortKey>(persistedQuery.sortKey ?? "name");
  const [sortDir, setSortDir] = useState<SortDir>(persistedQuery.sortDir ?? "asc");
  const [visibleFields, setVisibleFields] = useState<NumericStatField[]>(loadVisibleFields);

  useEffect(() => {
    saveVisibleFields(visibleFields);
  }, [visibleFields]);

  useEffect(() => {
    saveSearchQueryState({ root, nameQuery, sortKey, sortDir });
  }, [root, nameQuery, sortKey, sortDir]);

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
