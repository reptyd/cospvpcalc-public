// Bespoke beta "Combat Reference" - routed in place of ReferencePage when the
// beta design is active. The idea: a documentation knowledge-base. A persistent
// left filter + navigation rail (sort, section/status filters, jump-to-section
// TOC) beside a constrained, highly readable entry column. Modeled-status is a
// first-class, color-coded signal. Reuses ALL of referencePageShared so the
// content + filtering is byte-identical to the classic page; only the chrome
// differs. Root class `.rfb` avoids `.panel`/`.reference-*`, so none of the
// classic coupling applies - styled solely by referenceBeta.css.

import { startTransition, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, RotateCcw, Search as SearchIcon, SlidersHorizontal } from "lucide-react";
import { BetaSelect } from "../components/beta/BetaSelect";
import {
  REFERENCE_SECTIONS,
  SORT_OPTIONS,
  STATUS_PRIORITY,
  buildSearchText,
  buildSectionEntries,
  compareReferenceEntries,
  statusSlug,
  toggleFilterValue,
  type ReferenceDisplayEntry,
  type ReferenceStatus,
  type SectionId,
  type SortMode,
  referenceParentLabel,
} from "./referencePageShared";
import "../components/beta/betaSelect.css";
import "./compareBeta.css";
import "./referenceBeta.css";

export default function ReferencePageBeta(): ReactNode {
  const [searchInput, setSearchInput] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("reference");
  const [sectionFilter, setSectionFilter] = useState<SectionId[]>([]);
  const [statusFilter, setStatusFilter] = useState<ReferenceStatus[]>([]);
  // The rail is always shown on desktop; on phones it collapses behind a
  // "Filters & sections" toggle so the long faceted list doesn't bury the
  // entries. CSS keeps it open on desktop regardless of this flag.
  const [railOpen, setRailOpen] = useState(false);

  const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());

  // Section entries, status options, and each entry's lowercased search text
  // are derived purely from static module data - compute ONCE, not on every
  // render/keystroke. Previously this (incl. buildSearchText over ~249 entries)
  // re-ran on every keystroke, the main source of typing lag on phones.
  const { sectionEntries, statusOptions, searchTextByEntry, statusCounts, totalEntryCount } = useMemo(() => {
    const sectionEntries = buildSectionEntries();
    const allEntries = REFERENCE_SECTIONS.flatMap((section) => sectionEntries[section.id]);
    const statusOptions = Array.from(
      new Set(allEntries.flatMap((entry) => (entry.status ? [entry.status] : []))),
    ).sort((left, right) => STATUS_PRIORITY[left] - STATUS_PRIORITY[right]);
    const searchTextByEntry = new Map<ReferenceDisplayEntry, string>();
    const statusCounts = {} as Record<ReferenceStatus, number>;
    for (const entry of allEntries) {
      searchTextByEntry.set(entry, buildSearchText(entry));
      if (entry.status) statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
    }
    return { sectionEntries, statusOptions, searchTextByEntry, statusCounts, totalEntryCount: allEntries.length };
  }, []);

  const hasActiveFilters =
    deferredSearch.length > 0 || sectionFilter.length > 0 || statusFilter.length > 0 || sortMode !== "reference";
  const activeFilterCount = sectionFilter.length + statusFilter.length;

  // Only recompute the filtered/sorted view when an actual input changes - not
  // on unrelated re-renders. Uses the precomputed per-entry search text.
  const visibleSections = useMemo(
    () =>
      REFERENCE_SECTIONS.map((section) => {
        const activeSection = sectionFilter.length === 0 ? true : sectionFilter.includes(section.id);
        const filteredEntries = !activeSection
          ? []
          : [...sectionEntries[section.id]]
              .filter((entry) => {
                if (statusFilter.length > 0 && (!entry.status || !statusFilter.includes(entry.status))) return false;
                if (deferredSearch.length > 0 && !(searchTextByEntry.get(entry) ?? "").includes(deferredSearch)) return false;
                return true;
              })
              .sort((left, right) => compareReferenceEntries(left, right, sortMode));

        return { ...section, entries: filteredEntries, totalEntries: sectionEntries[section.id].length };
      }).filter((section) => section.entries.length > 0),
    [sectionEntries, searchTextByEntry, sectionFilter, statusFilter, deferredSearch, sortMode],
  );

  const matchingEntriesCount = visibleSections.reduce((total, section) => total + section.entries.length, 0);

  const resetAll = () => {
    setSearchInput("");
    setSortMode("reference");
    setSectionFilter([]);
    setStatusFilter([]);
  };

  return (
    <section className="rfb">
      <header className="rfb-hero">
        <span className="rfb-eyebrow">Work in progress</span>
        <h2 className="rfb-hero__title">Combat Reference</h2>
        <p className="rfb-hero__lede">
          How this site models combat — modeled abilities, ability policies, status math, battle settings, and the
          known approximations. Search the full text of every entry, filter by section or modeled-status, and jump
          straight to what you need.
        </p>
      </header>

      <div className="rfb-search">
        <SearchIcon size={17} strokeWidth={2} aria-hidden="true" />
        <input
          type="search"
          value={searchInput}
          onChange={(event) => {
            const next = event.target.value;
            startTransition(() => setSearchInput(next));
          }}
          placeholder="Search by ability, effect, rule, status, or text inside an entry…"
          aria-label="Search reference"
        />
      </div>

      <div className="rfb-body">
        <aside className={`rfb-rail${railOpen ? " is-open" : ""}`}>
          <button
            type="button"
            className="rfb-rail__toggle"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((open) => !open)}
          >
            <SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" />
            <span className="rfb-rail__toggle-label">Filters &amp; sections</span>
            {activeFilterCount > 0 ? <span className="rfb-rail__toggle-count">{activeFilterCount}</span> : null}
            <ChevronDown size={16} strokeWidth={2.2} className="rfb-rail__toggle-chev" aria-hidden="true" />
          </button>
          <div className="rfb-rail__body">
            <div className="rfb-rail__field">
            <span className="rfb-rail__cap">Sort</span>
            <BetaSelect
              className="rfb-sort"
              ariaLabel="Sort entries"
              value={sortMode}
              options={SORT_OPTIONS}
              onChange={(value) => setSortMode(value as SortMode)}
            />
          </div>

          <div className="rfb-group">
            <div className="rfb-group__label">Sections</div>
            <div className="rfb-chips">
              <button
                type="button"
                className={`rfb-chip${sectionFilter.length === 0 ? " is-active" : ""}`}
                onClick={() => setSectionFilter([])}
              >
                All
              </button>
              {REFERENCE_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`rfb-chip${sectionFilter.includes(section.id) ? " is-active" : ""}`}
                  onClick={() => setSectionFilter(toggleFilterValue(sectionFilter, section.id))}
                >
                  <span>{section.title}</span>
                  <span className="rfb-chip__count">{sectionEntries[section.id].length}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rfb-group">
            <div className="rfb-group__label">Modeled status</div>
            <div className="rfb-chips">
              <button
                type="button"
                className={`rfb-chip${statusFilter.length === 0 ? " is-active" : ""}`}
                onClick={() => setStatusFilter([])}
              >
                Any
              </button>
              {statusOptions.map((status) => (
                <button
                  key={status}
                  type="button"
                  data-status={statusSlug(status)}
                  className={`rfb-chip rfb-chip--status${statusFilter.includes(status) ? " is-active" : ""}`}
                  onClick={() => setStatusFilter(toggleFilterValue(statusFilter, status))}
                >
                  <span>{status}</span>
                  <span className="rfb-chip__count">{statusCounts[status] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          {visibleSections.length > 0 ? (
            <nav className="rfb-group rfb-toc" aria-label="Jump to section">
              <div className="rfb-group__label">Jump to</div>
              <ul className="rfb-toc__list">
                {visibleSections.map((section) => (
                  <li key={section.id}>
                    <a href={`#rfb-${section.id}`} className="rfb-toc__link">
                      <span className="rfb-toc__name">{section.title}</span>
                      <span className="rfb-toc__count">{section.entries.length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          </div>
        </aside>

        <main className="rfb-main">
          <div className="rfb-mainhead">
            <span className="rfb-mainhead__count">
              Showing <strong>{matchingEntriesCount}</strong> of <strong>{totalEntryCount}</strong> entries
            </span>
            {hasActiveFilters ? (
              <button type="button" className="cb-ghostbtn rfb-reset" onClick={resetAll}>
                <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
                Reset
              </button>
            ) : null}
          </div>

          {visibleSections.length === 0 ? (
            <div className="rfb-empty">
              <div className="rfb-empty__title">No matching entries</div>
              <p>
                The current search and filter combination hides every entry. Try clearing a filter, switching sort mode,
                or searching for a broader term.
              </p>
              <button type="button" className="cb-ghostbtn" onClick={resetAll}>
                <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
                Reset search &amp; filters
              </button>
            </div>
          ) : (
            visibleSections.map((section) => (
              <section key={section.id} id={`rfb-${section.id}`} className="rfb-section">
                <div className="rfb-section__head">
                  <h3 className="rfb-section__title">{section.title}</h3>
                  <span className="rfb-section__count">
                    {section.entries.length === section.totalEntries
                      ? `${section.totalEntries} entries`
                      : `${section.entries.length} of ${section.totalEntries}`}
                  </span>
                </div>
                <p className="rfb-section__desc">{section.description}</p>
                <div className="rfb-entries">
                  {section.entries.map((entry) => (
                    <ReferenceEntry key={entry.id} entry={entry} />
                  ))}
                </div>
              </section>
            ))
          )}
        </main>
      </div>
    </section>
  );
}

// One expandable entry. Renders every content block that has content, in a
// fixed order - empty blocks are dropped (the classic page sometimes rendered
// empty "Notes" / "How It Works Here" headers; the beta omits them). The left
// accent border + badge are keyed to the modeled-status via `data-status`.
function ReferenceEntry({ entry }: { entry: ReferenceDisplayEntry }): ReactNode {
  const slug = entry.status ? statusSlug(entry.status) : undefined;
  return (
    <details className="rfb-entry" data-status={slug}>
      <summary className="rfb-entry__summary">
        <ChevronDown size={16} strokeWidth={2.4} className="rfb-entry__chev" aria-hidden="true" />
        <span className="rfb-entry__name">{entry.name}</span>
        {entry.status ? <span className={`rfb-badge rfb-badge--${slug}`}>{entry.status}</span> : null}
      </summary>
      <div className="rfb-entry__body">
        <p className="rfb-entry__lead">{entry.summary}</p>
        {referenceParentLabel(entry.parentId) ? (
          <p className="rfb-entry__parent">See {referenceParentLabel(entry.parentId)}.</p>
        ) : null}
        <PointsBlock title="How It Works Here" points={entry.mechanics} />
        <PointsBlock title="Why It's Not Modeled Here" points={entry.whyItsNotModeledHere} />
        <PointsBlock title="Policy Differences" points={entry.policyDifferences} />
        <PointsBlock title="Game Truth" points={entry.gameTruth} />
        <PointsBlock title="Current Approximation" points={entry.currentApproximation} />
        {entry.whyApproximated ? (
          <div className="rfb-block">
            <div className="rfb-block__title">Why Approximated</div>
            <p className="rfb-block__text">{entry.whyApproximated}</p>
          </div>
        ) : null}
        <PointsBlock title="Notes" points={entry.notes} />
      </div>
    </details>
  );
}

function PointsBlock({ title, points }: { title: string; points?: string[] }): ReactNode {
  if (!points || points.length === 0) return null;
  return (
    <div className="rfb-block">
      <div className="rfb-block__title">{title}</div>
      <ul className="rfb-points">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}
