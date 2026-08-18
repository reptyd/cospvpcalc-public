// Beta "Search" view of the creature roster. Dev-gated (iddqd + Settings beta
// toggle), routed in place of SearchPage when the beta design is active.
// Reuses the shared search engine (runSearch / summarize) and SearchResultsList
// plus the shared sort/filter helpers, so results are byte-identical to the
// classic page. Bespoke to beta: the smart-tree query builder (SearchBetaQuery,
// BetaSelect-driven), the BetaSelect sort + Columns popover toolbar, the
// progressive reveal, and the per-card "add to Best Builds pool" action.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Columns3, RotateCcw, Search as SearchIcon, Trophy, X } from "lucide-react";
import { SearchResultsList } from "../components/search/SearchResultsList";
import { SearchQueryBuilder } from "../components/search/SearchBetaQuery";
import { BetaSelect, type BetaSelectGroup } from "../components/beta/BetaSelect";
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
import { clearBbCustomPool, toggleBbCustomPool, useBbCustomPool } from "../shared/bbCustomPool";
import "../components/beta/betaSelect.css";
import "./compareBeta.css";
import "./searchBeta.css";

export type SearchPageBetaProps = {
  getCreatureIcon: (name: string) => string | null;
  onNameAChange?: (name: string) => void;
  onNameBChange?: (name: string) => void;
};

// One reveal step. ~5 rows on a wide grid - enough to fill the viewport and
// invite a scroll, small enough that the no-filter view isn't a 450-card dump.
const PAGE_SIZE = 24;

// Sort field picker: "Name" first, then the numeric stats grouped by category.
const SORT_GROUPS: BetaSelectGroup[] = [
  { label: "General", options: [{ value: "name", label: "Name" }] },
  ...NUMERIC_STAT_CATEGORIES.map((category) => ({
    label: category.label,
    options: category.fields.map((field) => ({ value: field, label: NUMERIC_STAT_LABELS[field] })),
  })),
];

export default function SearchPageBeta({
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
}: SearchPageBetaProps) {
  const persistedQuery = useMemo(() => loadSearchQueryState(), []);
  const [root, setRoot] = useState<QueryGroupModel>(() => persistedQuery.root ?? createEmptyRootGroup());
  const [nameQuery, setNameQuery] = useState(persistedQuery.nameQuery ?? "");
  const [sortKey, setSortKey] = useState<SortKey>(persistedQuery.sortKey ?? "name");
  const [sortDir, setSortDir] = useState<SortDir>(persistedQuery.sortDir ?? "asc");
  const [visibleFields, setVisibleFields] = useState<NumericStatField[]>(loadVisibleFields);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const pool = useBbCustomPool();
  const pooledSet = useMemo(() => new Set(pool), [pool]);

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

  // A fresh query / sort restarts the reveal from the top.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [results]);

  const hasAnyCondition = countPredicates(root) > 0;
  const hasAnyFilter = hasAnyCondition || nameQuery.trim().length > 0;
  const totalCreatures = SEARCHABLE_CREATURES.length;

  const shown = Math.min(visibleCount, results.length);
  const hasMore = shown < results.length;
  const slicedResults = useMemo(() => results.slice(0, visibleCount), [results, visibleCount]);

  // Auto-load the next page as the sentinel approaches the viewport, so the
  // reveal feels continuous; the visible button is the explicit control + the
  // no-JS fallback.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((current) => current + PAGE_SIZE);
        }
      },
      { rootMargin: "700px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, shown]);

  const handleReset = () => {
    setRoot(createEmptyRootGroup());
    setNameQuery("");
  };

  return (
    <section className="sr">
      <div className="sr-builder">
        <div className="sr-builder__intro">
          <h3 className="sr-builder__title">Creature Search</h3>
          <p className="sr-builder__lede">
            Build a multi-criteria query over every creature in the catalog — numeric stats,
            categoricals like diet or type, ability presence, and offensive / defensive / resist
            statuses — combined with AND / OR and bracketed sub-groups. AND is checked before OR,
            so “A AND B OR C” means “both A and B, or else C on its own”. Need a different grouping?
            Wrap conditions in a sub-group.
          </p>
        </div>

        <div className="sr-namebar">
          <SearchIcon size={16} strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Filter by creature name…"
            aria-label="Search by creature name"
          />
        </div>

        <SearchQueryBuilder root={root} onRootChange={setRoot} />
      </div>

      <div className="sr-results">
        <div className="sr-results__head">
          <span className="sr-results__title">Results</span>
          <span className="sr-results__count">
            {hasAnyFilter
              ? `${results.length} of ${totalCreatures} match`
              : `${totalCreatures} creatures`}
          </span>
          {pool.length > 0 ? (
            <span className="sr-pool-chip" title="Opponents queued for Best Builds (Custom pool)">
              <Trophy size={13} strokeWidth={2} aria-hidden="true" />
              Pool · {pool.length}
              <button type="button" className="sr-pool-chip__clear" onClick={() => clearBbCustomPool()} aria-label="Clear Best Builds pool" title="Clear pool">
                <X size={12} strokeWidth={2.6} aria-hidden="true" />
              </button>
            </span>
          ) : null}
          <div className="sr-results__tools">
            <div className="sr-sort">
              <span className="sr-sort__cap">Sort</span>
              <BetaSelect
                className="sr-sort__sel"
                ariaLabel="Sort by"
                value={sortKey}
                groups={SORT_GROUPS}
                onChange={(v) => setSortKey(v as SortKey)}
              />
              <div className="cb-seg sr-dir" role="group" aria-label="Sort direction">
                <button
                  type="button"
                  className={`cb-seg__opt${sortDir === "asc" ? " is-active" : ""}`}
                  onClick={() => setSortDir("asc")}
                  title="Ascending"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={`cb-seg__opt${sortDir === "desc" ? " is-active" : ""}`}
                  onClick={() => setSortDir("desc")}
                  title="Descending"
                >
                  ↓
                </button>
              </div>
            </div>
            <ColumnsControl visibleFields={visibleFields} onToggle={toggleField} />
            <button
              type="button"
              className="cb-ghostbtn sr-reset"
              onClick={handleReset}
              disabled={!hasAnyFilter}
              title={hasAnyFilter ? "Clear name + all conditions" : "Nothing to clear"}
            >
              <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>

        <SearchResultsList
          results={slicedResults}
          getCreatureIcon={getCreatureIcon}
          summary={summary}
          visibleFields={visibleFields}
          onToggleField={toggleField}
          onUseAsA={onNameAChange}
          onUseAsB={onNameBChange}
          showColumnPicker={false}
          pooledSet={pooledSet}
          onTogglePool={toggleBbCustomPool}
        />

        {results.length > 0 && hasMore ? (
          <div className="sr-more" ref={sentinelRef}>
            <button
              type="button"
              className="sr-more__btn"
              onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
            >
              <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
              Show {Math.min(PAGE_SIZE, results.length - shown)} more
            </button>
            <span className="sr-more__count">
              Showing {shown} of {results.length}
            </span>
          </div>
        ) : null}
        {!hasMore && results.length > PAGE_SIZE ? (
          <div className="sr-more sr-more--done">
            <span className="sr-more__count">All {results.length} shown</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// Columns popover - beta redesign of the column picker (was a <details> inside
// SearchResultsList). Grouped toggle-chips in an anchored panel, matching the
// BetaSelect look.
function ColumnsControl({
  visibleFields,
  onToggle,
}: {
  visibleFields: NumericStatField[];
  onToggle: (field: NumericStatField) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = new Set(visibleFields);
  return (
    <div ref={ref} className="sr-cols">
      <button type="button" className="sr-cols__trigger" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Columns3 size={14} strokeWidth={2} aria-hidden="true" />
        Columns
        <span className="sr-cols__count">{visibleFields.length}</span>
      </button>
      {open ? (
        <div className="sr-cols__panel">
          {NUMERIC_STAT_CATEGORIES.map((category) => (
            <div key={category.label} className="sr-cols__group">
              <div className="sr-cols__group-label">{category.label}</div>
              <div className="sr-cols__chips">
                {category.fields.map((field) => (
                  <button
                    key={field}
                    type="button"
                    className={`sr-cols__chip${selected.has(field) ? " is-active" : ""}`}
                    aria-pressed={selected.has(field)}
                    onClick={() => onToggle(field)}
                  >
                    {NUMERIC_STAT_LABELS[field]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
