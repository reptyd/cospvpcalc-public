import { useMemo, useState } from "react";
import { IconImg } from "./IconImg";

export type BlacklistOption = {
  id: string;
  label: string;
  selected: boolean;
  icon: string | null;
  description?: string;
};

/** A collapsed list of things to rule out, with the count of what is already
 * ruled out on the summary. Shared by Best Builds and Speed Builds so "I do not
 * own this one" is the same control wherever it is asked. */
export function BlacklistDropdown({
  label,
  summaryLabel,
  count,
  options,
  onToggle,
}: {
  label: string;
  summaryLabel: string;
  count: number;
  options: BlacklistOption[];
  onToggle: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  return (
    <div className="field">
      <label>{label}</label>
      <details className="blacklist-dropdown">
        <summary className="blacklist-summary">
          <span>{summaryLabel}</span>
          <span className="blacklist-summary-meta">{count > 0 ? `${count} selected` : "None selected"}</span>
        </summary>
        <div className="blacklist-dropdown-body">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${summaryLabel.toLowerCase()}...`}
            aria-label={`Filter ${summaryLabel.toLowerCase()}`}
          />
          <div className="blacklist-list">
            {filteredOptions.map((option, index) => (
              <label key={`${option.id}-${index}`} className={`blacklist-item ${option.selected ? "selected" : ""}`}>
                <input type="checkbox" checked={option.selected} onChange={() => onToggle(option.id)} />
                <IconImg src={option.icon} alt={option.label} size={22} />
                <span className="pool-name">{option.label}</span>
                {option.description && <span className="plushie-effect-note">{option.description}</span>}
              </label>
            ))}
          </div>
        </div>
      </details>
      <div className="note">In blacklist: {count}</div>
    </div>
  );
}
