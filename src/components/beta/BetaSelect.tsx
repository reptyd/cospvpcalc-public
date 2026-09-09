import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search as SearchIcon } from "lucide-react";

// A beta-native single-select dropdown - the replacement for raw <select> on
// the beta pages (whose native popup the user dislikes). Trigger button shows
// the current label; the panel lists options (optionally grouped) with an
// optional search box. Outside-click / Escape close, basic keyboard. Built to
// be reused anywhere a compact themed picker is needed (Search sort + the
// query builder's field / ability / status / op pickers).

export type BetaSelectOption = { value: string; label: string };
export type BetaSelectGroup = { label: string; options: BetaSelectOption[] };

export type BetaSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options?: BetaSelectOption[];
  groups?: BetaSelectGroup[];
  ariaLabel?: string;
  placeholder?: string;
  /** Force the in-panel search box. Auto-enabled when there are > 8 options. */
  searchable?: boolean;
  /** Extra class on the wrapper (e.g. for width / alignment tweaks). */
  className?: string;
  /** Popover edge alignment relative to the trigger. */
  align?: "left" | "right";
  /** Compact trigger (used in dense predicate rows). */
  size?: "sm" | "md";
  /** Override the trigger's rendered content (defaults to the option label). */
  renderTrigger?: (selected: BetaSelectOption | null) => ReactNode;
};

function flatten(options: BetaSelectOption[] | undefined, groups: BetaSelectGroup[] | undefined): BetaSelectOption[] {
  if (groups) return groups.flatMap((g) => g.options);
  return options ?? [];
}

export function BetaSelect({
  value,
  onChange,
  options,
  groups,
  ariaLabel,
  placeholder = "Select…",
  searchable,
  className,
  align = "left",
  size = "md",
  renderTrigger,
}: BetaSelectProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [openUp, setOpenUp] = useState(false);

  const flat = useMemo(() => flatten(options, groups), [options, groups]);
  const selected = flat.find((o) => o.value === value) ?? null;
  const wantSearch = searchable ?? flat.length > 8;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
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

  useEffect(() => {
    if (open && wantSearch) searchRef.current?.focus();
    if (!open) setQuery("");
  }, [open, wantSearch]);

  const openPanel = () => {
    // Flip upward when the trigger sits low in the viewport so the panel
    // doesn't spill off the bottom.
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) setOpenUp(rect.bottom > window.innerHeight - 320);
    setOpen((v) => !v);
  };

  const q = query.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);
  const filteredGroups = groups
    ?.map((g) => ({ label: g.label, options: g.options.filter((o) => matches(o.label)) }))
    .filter((g) => g.options.length > 0);
  const filteredFlat = !groups ? flat.filter((o) => matches(o.label)) : [];

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const firstMatch = (filteredGroups?.flatMap((g) => g.options) ?? filteredFlat)[0];

  return (
    <div
      ref={wrapperRef}
      className={`bsel${size === "sm" ? " bsel--sm" : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        className="bsel__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={openPanel}
      >
        <span className="bsel__value">
          {renderTrigger ? renderTrigger(selected) : selected?.label ?? <span className="bsel__ph">{placeholder}</span>}
        </span>
        <ChevronDown size={15} strokeWidth={2.2} className="bsel__chev" aria-hidden="true" />
      </button>

      {open ? (
        <div className={`bsel__panel${openUp ? " bsel__panel--up" : ""}${align === "right" ? " bsel__panel--right" : ""}`} role="listbox">
          {wantSearch ? (
            <div className="bsel__search">
              <SearchIcon size={14} strokeWidth={2} aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder="Filter…"
                aria-label="Filter options"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && firstMatch) {
                    e.preventDefault();
                    pick(firstMatch.value);
                  }
                }}
              />
            </div>
          ) : null}
          <div className="bsel__list">
            {groups
              ? (filteredGroups?.length
                  ? filteredGroups.map((g) => (
                      <div key={g.label} className="bsel__group">
                        <div className="bsel__group-label">{g.label}</div>
                        {g.options.map((o) => (
                          <Option key={o.value} option={o} active={o.value === value} onPick={pick} />
                        ))}
                      </div>
                    ))
                  : <div className="bsel__empty">No matches</div>)
              : (filteredFlat.length
                  ? filteredFlat.map((o) => (
                      <Option key={o.value} option={o} active={o.value === value} onPick={pick} />
                    ))
                  : <div className="bsel__empty">No matches</div>)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Option({
  option,
  active,
  onPick,
}: {
  option: BetaSelectOption;
  active: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`bsel__opt${active ? " is-active" : ""}`}
      onClick={() => onPick(option.value)}
    >
      <span className="bsel__opt-label">{option.label}</span>
      {active ? <Check size={14} strokeWidth={2.4} className="bsel__opt-check" aria-hidden="true" /> : null}
    </button>
  );
}
