import { startTransition, useDeferredValue, useState } from "react";
import {
  REFERENCE_SECTIONS,
  SORT_OPTIONS,
  STATUS_PRIORITY,
  buildSearchText,
  buildSectionEntries,
  compareReferenceEntries,
  getReferenceBadgeClass,
  toggleFilterValue,
  type ReferenceStatus,
  type SectionId,
  type SortMode,
  referenceParentLabel,
} from "./referencePageShared";

export default function ReferencePage() {
  const [searchInput, setSearchInput] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("reference");
  const [sectionFilter, setSectionFilter] = useState<SectionId[]>([]);
  const [statusFilter, setStatusFilter] = useState<ReferenceStatus[]>([]);

  const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
  const sectionEntries = buildSectionEntries();
  const allEntries = REFERENCE_SECTIONS.flatMap((section) => sectionEntries[section.id]);
  const statusOptions = Array.from(
    new Set(allEntries.flatMap((entry) => (entry.status ? [entry.status] : []))),
  ).sort((left, right) => STATUS_PRIORITY[left] - STATUS_PRIORITY[right]);
  const hasActiveFilters =
    deferredSearch.length > 0 || sectionFilter.length > 0 || statusFilter.length > 0 || sortMode !== "reference";
  const visibleSections = REFERENCE_SECTIONS.map((section) => {
    const activeSection =
      sectionFilter.length === 0 ? true : sectionFilter.includes(section.id);
    const filteredEntries = !activeSection
      ? []
      : [...sectionEntries[section.id]]
          .filter((entry) => {
            if (statusFilter.length > 0 && (!entry.status || !statusFilter.includes(entry.status))) return false;
            if (deferredSearch.length > 0 && !buildSearchText(entry).includes(deferredSearch)) return false;
            return true;
          })
          .sort((left, right) => compareReferenceEntries(left, right, sortMode));

    return {
      ...section,
      entries: filteredEntries,
      totalEntries: sectionEntries[section.id].length,
    };
  }).filter((section) => section.entries.length > 0);
  const matchingEntriesCount = visibleSections.reduce((total, section) => total + section.entries.length, 0);

  return (
    <main className="panel">
      <div className="layout-grid">
        <section className="panel-block reference-hero">
          <div className="eyebrow">Work In Progress</div>
          <h2>Combat Reference</h2>
          <p className="note">
            This page explains modeled abilities, ability policies, status math, battle settings, and known
            approximations used by the site.
          </p>
        </section>

        <section className="panel-block reference-controls">
          <div className="reference-controls-top">
            <div className="field reference-search-field">
              <label htmlFor="reference-search">Search Reference</label>
              <input
                id="reference-search"
                type="search"
                value={searchInput}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  startTransition(() => setSearchInput(nextValue));
                }}
                placeholder="Search by ability, effect, rule, status, or text inside an entry"
              />
            </div>

            <div className="field reference-sort-field">
              <label htmlFor="reference-sort">Sort Entries</label>
              <select id="reference-sort" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="reference-control-meta">
            <span>
              Showing <strong>{matchingEntriesCount}</strong> of <strong>{allEntries.length}</strong> entries
            </span>
            {hasActiveFilters ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSearchInput("");
                  setSortMode("reference");
                  setSectionFilter([]);
                  setStatusFilter([]);
                }}
              >
                Reset Search and Filters
              </button>
            ) : (
              <span className="note">Search looks through names, summaries, formulas, notes, and modeled-status labels.</span>
            )}
          </div>

          <div className="reference-filter-group">
            <div className="reference-filter-label">Sections</div>
            <div className="reference-chip-row">
              <button
                type="button"
                className={sectionFilter.length === 0 ? "reference-chip active" : "reference-chip"}
                onClick={() => setSectionFilter([])}
              >
                All Sections
              </button>
              {REFERENCE_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={sectionFilter.includes(section.id) ? "reference-chip active" : "reference-chip"}
                  onClick={() => setSectionFilter(toggleFilterValue(sectionFilter, section.id))}
                >
                  <span>{section.title}</span>
                  <span className="reference-chip-count">{sectionEntries[section.id].length}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="reference-filter-group">
            <div className="reference-filter-label">Modeled Status</div>
            <div className="reference-chip-row">
              <button
                type="button"
                className={statusFilter.length === 0 ? "reference-chip active" : "reference-chip"}
                onClick={() => setStatusFilter([])}
              >
                Any Status
              </button>
              {statusOptions.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={statusFilter.includes(status) ? "reference-chip active" : "reference-chip"}
                  onClick={() => setStatusFilter(toggleFilterValue(statusFilter, status))}
                >
                  <span>{status}</span>
                  <span className="reference-chip-count">
                    {allEntries.filter((entry) => entry.status === status).length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="panel-block">
          <h3>Sections</h3>
          <div className="reference-section-links">
            {visibleSections.map((section) => (
              <a key={section.id} className="secondary reference-section-link" href={`#${section.id}`}>
                {section.title} ({section.entries.length})
              </a>
            ))}
          </div>
          <div className="note">Sections with no current matches are hidden until the search or filters change.</div>
        </section>

        <div className="layout-grid reference-section-stack">
          {visibleSections.length === 0 ? (
            <section className="panel-block reference-empty-state">
              <h3>No Matching Entries</h3>
              <p className="note">
                The current search and filter combination hides every entry. Try clearing a filter, switching sort mode,
                or searching for a broader term.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSearchInput("");
                  setSortMode("reference");
                  setSectionFilter([]);
                  setStatusFilter([]);
                }}
              >
                Reset Search and Filters
              </button>
            </section>
          ) : null}

          {visibleSections.map((section) => (
            <section key={section.id} id={section.id} className="panel-block reference-section">
              <div className="reference-section-header">
                <div>
                  <h3>{section.title}</h3>
                </div>
                <span className="reference-section-status">
                  {section.entries.length === section.totalEntries
                    ? `${section.totalEntries} entries`
                    : `${section.entries.length} of ${section.totalEntries}`}
                </span>
              </div>
              <p className="reference-section-description">{section.description}</p>
              {section.id === "modeled-abilities" ? (
                <div className="reference-entry-list">
                  {section.entries.map((entry) => (
                    <details key={entry.name} className="reference-entry">
                      <summary className="reference-entry-summary">
                        <span>{entry.name}</span>
                        {entry.status ? <span className={getReferenceBadgeClass(entry.status)}>{entry.status}</span> : null}
                      </summary>
                      <div className="reference-entry-body">
                        <p className="reference-entry-lead">{entry.summary}</p>

                        {(entry.mechanics?.length ?? 0) > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">How It Works Here</div>
                            <ul className="reference-entry-points">
                              {(entry.mechanics ?? []).map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {entry.whyItsNotModeledHere && entry.whyItsNotModeledHere.length > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">Why It's Not Modeled Here</div>
                            <ul className="reference-entry-points">
                              {entry.whyItsNotModeledHere.map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {(entry.policyDifferences?.length ?? 0) > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">Policy Differences</div>
                            <ul className="reference-entry-points">
                              {(entry.policyDifferences ?? []).map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="reference-entry-block">
                          <div className="reference-entry-title">Notes</div>
                          <ul className="reference-entry-points">
                            {entry.notes.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              ) : section.id === "ability-policies" ? (
                <div className="reference-entry-list">
                  {section.entries.map((entry) => (
                    <details key={entry.name} className="reference-entry">
                      <summary className="reference-entry-summary">
                        <span>{entry.name}</span>
                      </summary>
                      <div className="reference-entry-body">
                        <p className="reference-entry-lead">{entry.summary}</p>

                        <div className="reference-entry-block">
                          <div className="reference-entry-title">How It Works Here</div>
                          <ul className="reference-entry-points">
                            {(entry.mechanics ?? []).map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="reference-entry-block">
                          <div className="reference-entry-title">Notes</div>
                          <ul className="reference-entry-points">
                            {entry.notes.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              ) : section.id === "statuses-and-blocks" ? (
                <div className="reference-entry-list">
                  {section.entries.map((entry) => (
                    <details key={entry.name} className="reference-entry">
                      <summary className="reference-entry-summary">
                        <span>{entry.name}</span>
                        {entry.status ? <span className={getReferenceBadgeClass(entry.status)}>{entry.status}</span> : null}
                      </summary>
                      <div className="reference-entry-body">
                        <p className="reference-entry-lead">{entry.summary}</p>

                        <div className="reference-entry-block">
                          <div className="reference-entry-title">How It Works Here</div>
                          <ul className="reference-entry-points">
                            {(entry.mechanics ?? []).map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="reference-entry-block">
                          <div className="reference-entry-title">Notes</div>
                          <ul className="reference-entry-points">
                            {entry.notes.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              ) : section.id === "battle-settings" ? (
                <div className="reference-entry-list">
                  {section.entries.map((entry) => (
                    <details key={entry.name} className="reference-entry">
                      <summary className="reference-entry-summary">
                        <span>{entry.name}</span>
                        {entry.status ? <span className={getReferenceBadgeClass(entry.status)}>{entry.status}</span> : null}
                      </summary>
                      <div className="reference-entry-body">
                        <p className="reference-entry-lead">{entry.summary}</p>

                        {(entry.mechanics?.length ?? 0) > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">How It Works Here</div>
                            <ul className="reference-entry-points">
                              {(entry.mechanics ?? []).map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {entry.whyItsNotModeledHere && entry.whyItsNotModeledHere.length > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">Why It's Not Modeled Here</div>
                            <ul className="reference-entry-points">
                              {entry.whyItsNotModeledHere.map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="reference-entry-block">
                          <div className="reference-entry-title">Notes</div>
                          <ul className="reference-entry-points">
                            {entry.notes.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              ) : section.id === "known-approximations" ? (
                <div className="reference-entry-list">
                  {section.entries.map((entry) => (
                    <details key={entry.name} className="reference-entry">
                      <summary className="reference-entry-summary">
                        <span>{entry.name}</span>
                      </summary>
                      <div className="reference-entry-body">
                        <p className="reference-entry-lead">{entry.summary}</p>

                        {referenceParentLabel(entry.parentId) ? (
                          <p className="reference-entry-parent">See {referenceParentLabel(entry.parentId)}.</p>
                        ) : null}

                        {(entry.gameTruth?.length ?? 0) > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">Game Truth</div>
                            <ul className="reference-entry-points">
                              {(entry.gameTruth ?? []).map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {(entry.currentApproximation?.length ?? 0) > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">Current Approximation</div>
                            <ul className="reference-entry-points">
                              {(entry.currentApproximation ?? []).map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {entry.whyApproximated ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">Why Approximated</div>
                            <p className="reference-entry-points">{entry.whyApproximated}</p>
                          </div>
                        ) : null}

                        {entry.notes.length > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">Notes</div>
                            <ul className="reference-entry-points">
                              {entry.notes.map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ))}
                </div>
              ) : section.id === "plushies" ? (
                <div className="reference-entry-list">
                  {section.entries.map((entry) => (
                    <details key={entry.name} className="reference-entry">
                      <summary className="reference-entry-summary">
                        <span>{entry.name}</span>
                        {entry.status ? <span className={getReferenceBadgeClass(entry.status)}>{entry.status}</span> : null}
                      </summary>
                      <div className="reference-entry-body">
                        <p className="reference-entry-lead">{entry.summary}</p>

                        {(entry.mechanics?.length ?? 0) > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">How It Works Here</div>
                            <ul className="reference-entry-points">
                              {(entry.mechanics ?? []).map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {entry.notes.length > 0 ? (
                          <div className="reference-entry-block">
                            <div className="reference-entry-title">Notes</div>
                            <ul className="reference-entry-points">
                              {entry.notes.map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <div className="reference-placeholder">
                  <div className="reference-placeholder-title">Planned Content</div>
                  <div className="reference-placeholder-copy">
                    This section will be filled with the same structured reference entries used in the abilities list.
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
