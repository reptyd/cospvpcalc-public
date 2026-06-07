import { useMemo, useState } from "react";

export function FriendlyTopBar({
  title,
  description,
  onBack: _onBack,
}: {
  title: string;
  description: string;
  onBack?: () => void;
}) {
  return (
    <div className="friendly-topbar">
      <div className="friendly-topbar-copy">
        <span className="friendly-kicker">Beta version</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function FacetPicker({
  title,
  values,
  selectedValues,
  onToggle,
}: {
  title: string;
  values: string[];
  selectedValues: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="facet-picker">
      <span>{title}</span>
      <div className="facet-grid">
        {values.map((value) => (
          <button
            key={value}
            className={`facet-chip${selectedValues.includes(value) ? " active" : ""}`}
            type="button"
            onClick={() => onToggle(value)}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChoiceCard({
  title,
  body,
  active,
  onClick,
}: {
  title: string;
  body: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`choice-card${active ? " active" : ""}`} type="button" onClick={onClick}>
      <strong>{title}</strong>
      <p>{body}</p>
    </button>
  );
}

export function TagSelector({
  items,
  selected,
  maxSelected,
  onToggle,
  formatLabel = defaultFriendlyLabel,
  footerText,
}: {
  items: string[];
  selected: string[];
  maxSelected: number;
  onToggle: (value: string) => void;
  formatLabel?: (value: string) => string;
  footerText?: string;
}) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => item.toLowerCase().includes(normalized));
  }, [items, query]);
  const visibleItems = filteredItems.slice(0, visibleCount);

  return (
    <div className="tag-selector">
      <label className="friendly-field">
        <span>Search</span>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(24);
          }}
          placeholder="Filter options"
        />
      </label>
      <div className="facet-grid">
        {visibleItems.map((item) => (
          <button
            key={item}
            className={`facet-chip${selected.includes(item) ? " active" : ""}`}
            type="button"
            onClick={() => onToggle(item)}
          >
            {formatLabel(item)}
          </button>
        ))}
      </div>
      {filteredItems.length > visibleItems.length ? (
        <button className="friendly-secondary selector-more-btn" type="button" onClick={() => setVisibleCount((count) => count + 24)}>
          Show More
        </button>
      ) : null}
      <p className="friendly-muted">
        {footerText ?? `Selected ${selected.length} / ${maxSelected}`}
      </p>
    </div>
  );
}

function defaultFriendlyLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function HealthBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="health-bar-wrap">
      <span>{label}</span>
      <div className="health-bar">
        <div className="health-bar-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function FriendlySectionRail({
  activePage,
  onGoHome,
  onGoBestBuild,
  onGoBattle,
}: {
  activePage: "home" | "bestBuild" | "battle";
  onGoHome: () => void;
  onGoBestBuild: () => void;
  onGoBattle: () => void;
}) {
  return (
    <nav className="friendly-section-rail" aria-label="Friendly flow sections">
      <button className={activePage === "home" ? "active" : ""} type="button" onClick={onGoHome}>
        Home
      </button>
      <button className={activePage === "bestBuild" ? "active" : ""} type="button" onClick={onGoBestBuild}>
        Best Build
      </button>
      <button className={activePage === "battle" ? "active" : ""} type="button" onClick={onGoBattle}>
        Who Wins
      </button>
    </nav>
  );
}
