import { startTransition, useDeferredValue, useState } from "react";
import {
  ABILITY_POLICY_REFERENCE_DRAFTS,
  COMPARE_ONLY_REFERENCE_DRAFTS,
  KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  MODELED_ABILITY_REFERENCE_DRAFTS,
  PLUSHIE_REFERENCE_DRAFTS,
  STATUS_REFERENCE_DRAFTS,
  type ReferenceStatus,
} from "./referenceContent";

const REFERENCE_SECTIONS = [
  {
    id: "modeled-abilities",
    title: "Abilities",
    description: "Main registry for abilities, with expandable entries and implementation notes.",
  },
  {
    id: "ability-policies",
    title: "Ability Policies",
    description: "Policy explanations such as really fast, fast, and the shared semi-ideal / ideal / extreme family.",
  },
  {
    id: "statuses-and-blocks",
    title: "Statuses and Ailments",
    description: "Status entries, ailment math, and related combat formulas.",
  },
  {
    id: "compare-only-rules",
    title: "Compare-Only Rules and Abilities",
    description: "Rules, abilities, and disputed assumptions that exist only in Compare and do not move into Best Builds.",
  },
  {
    id: "known-approximations",
    title: "Known Approximations",
    description: "Known simplifications, disputed assumptions, and places where the model is intentionally partial.",
  },
  {
    id: "plushies",
    title: "Plushies",
    description: "Plushie effects that are modeled in the simulation.",
  },
] as const;

type SectionId = (typeof REFERENCE_SECTIONS)[number]["id"];
type SortMode = "reference" | "name-asc" | "name-desc" | "support-desc" | "support-asc" | "detail-desc";

type ReferenceDisplayEntry = {
  id: string;
  name: string;
  summary: string;
  mechanics?: string[];
  notes: string[];
  status?: ReferenceStatus;
  whyItsNotModeledHere?: string[];
  policyDifferences?: string[];
  parentId?: string;
  gameTruth?: string[];
  currentApproximation?: string[];
  whyApproximated?: string;
  originalIndex: number;
};

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "reference", label: "Reference Order" },
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "support-desc", label: "Most Modeled First" },
  { value: "support-asc", label: "Least Modeled First" },
  { value: "detail-desc", label: "Most Detailed First" },
];

const STATUS_PRIORITY: Record<ReferenceStatus, number> = {
  Modeled: 0,
  Partial: 1,
  "Compare-only": 2,
  "Sandbox-only": 3,
  Disputed: 4,
  "Out of model": 5,
  "Not modeled yet": 6,
  "Not planned": 7,
};

function getReferenceBadgeClass(status: string): string {
  if (status === "Partial") return "reference-entry-badge reference-entry-badge-partial";
  if (status === "Out of model") return "reference-entry-badge reference-entry-badge-out-of-model";
  if (status === "Not modeled yet") return "reference-entry-badge reference-entry-badge-not-modeled-yet";
  if (status === "Not planned") return "reference-entry-badge reference-entry-badge-not-planned";
  if (status === "Disputed") return "reference-entry-badge reference-entry-badge-disputed";
  return "reference-entry-badge";
}

function sortReferenceEntriesByName<T extends { name: string }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function buildSearchText(entry: ReferenceDisplayEntry): string {
  return [
    entry.name,
    entry.summary,
    entry.status ?? "",
    ...(entry.mechanics ?? []),
    ...(entry.whyItsNotModeledHere ?? []),
    ...(entry.policyDifferences ?? []),
    ...(entry.gameTruth ?? []),
    ...(entry.currentApproximation ?? []),
    entry.whyApproximated ?? "",
    ...entry.notes,
  ]
    .join(" ")
    .toLowerCase();
}

function getEntryDetailScore(entry: ReferenceDisplayEntry): number {
  return (
    entry.summary.length +
    (entry.mechanics?.length ?? 0) * 40 +
    (entry.whyItsNotModeledHere?.length ?? 0) * 40 +
    (entry.policyDifferences?.length ?? 0) * 40 +
    (entry.gameTruth?.length ?? 0) * 40 +
    (entry.currentApproximation?.length ?? 0) * 40 +
    (entry.whyApproximated ? 30 : 0) +
    entry.notes.length * 30
  );
}

function compareReferenceEntries(left: ReferenceDisplayEntry, right: ReferenceDisplayEntry, sortMode: SortMode): number {
  if (sortMode === "name-asc") {
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  if (sortMode === "name-desc") {
    return right.name.localeCompare(left.name, undefined, { sensitivity: "base" });
  }

  if (sortMode === "support-desc") {
    const leftRank = left.status ? STATUS_PRIORITY[left.status] : 99;
    const rightRank = right.status ? STATUS_PRIORITY[right.status] : 99;
    return leftRank - rightRank || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  if (sortMode === "support-asc") {
    const leftRank = left.status ? STATUS_PRIORITY[left.status] : -1;
    const rightRank = right.status ? STATUS_PRIORITY[right.status] : -1;
    return rightRank - leftRank || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  if (sortMode === "detail-desc") {
    return getEntryDetailScore(right) - getEntryDetailScore(left) || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  return left.originalIndex - right.originalIndex;
}

function toggleFilterValue<T extends string>(current: T[], value: T): T[] {
  if (current.length === 0) return [value];
  if (current.includes(value)) {
    const next = current.filter((item) => item !== value);
    return next;
  }
  return [...current, value];
}

export default function ReferencePage() {
  const [searchInput, setSearchInput] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("reference");
  const [sectionFilter, setSectionFilter] = useState<SectionId[]>([]);
  const [statusFilter, setStatusFilter] = useState<ReferenceStatus[]>([]);

  const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
  const modeledAbilities = sortReferenceEntriesByName(MODELED_ABILITY_REFERENCE_DRAFTS);
  const statuses = sortReferenceEntriesByName(STATUS_REFERENCE_DRAFTS);
  const compareOnlyEntries = sortReferenceEntriesByName(COMPARE_ONLY_REFERENCE_DRAFTS);
  const abilityPolicies = ABILITY_POLICY_REFERENCE_DRAFTS;
  const knownApproximations = KNOWN_APPROXIMATION_REFERENCE_DRAFTS;
  const plushies = sortReferenceEntriesByName(PLUSHIE_REFERENCE_DRAFTS);
  const sectionEntries: Record<SectionId, ReferenceDisplayEntry[]> = {
    "modeled-abilities": modeledAbilities.map((entry, index) => ({ ...entry, originalIndex: index })),
    "ability-policies": abilityPolicies.map((entry, index) => ({ ...entry, originalIndex: index })),
    "statuses-and-blocks": statuses.map((entry, index) => ({ ...entry, originalIndex: index })),
    "compare-only-rules": compareOnlyEntries.map((entry, index) => ({ ...entry, originalIndex: index })),
    "known-approximations": knownApproximations.map((entry, index) => ({ ...entry, originalIndex: index })),
    plushies: plushies.map((entry, index) => ({ ...entry, originalIndex: index })),
  };
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
            This page explains modeled abilities, ability policies, status math, compare-only rules, and known
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
              ) : section.id === "compare-only-rules" ? (
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

                        <div className="reference-entry-block">
                          <div className="reference-entry-title">How It Works Here</div>
                          <ul className="reference-entry-points">
                            {(entry.mechanics ?? []).map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>

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
