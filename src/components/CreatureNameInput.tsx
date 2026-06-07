import { useEffect, useMemo, useRef, useState } from "react";
import { creatureNameMatchesQuery, normalizeCreatureSearchName } from "../engine/creatureData";

type CreatureNameInputProps = {
  value: string;
  onChange: (value: string) => void;
  creatureNames: string[];
  placeholder?: string;
  className?: string;
  maxSuggestions?: number;
  /** Pass-through `id` for the inner `<input>` so a sibling
   * `<label htmlFor>` can target it. */
  id?: string;
  /** Accessible name for the inner `<input>` when there is no sibling
   * `<label htmlFor>` (e.g. the Optimizer cards label via heading only). */
  ariaLabel?: string;
};

function rankCreatureNameMatch(name: string, query: string): number {
  const normalizedName = normalizeCreatureSearchName(name);
  const normalizedQuery = normalizeCreatureSearchName(query);
  if (!normalizedQuery) return 0;
  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.startsWith(normalizedQuery)) return 1;
  const wordStartIndex = normalizedName.indexOf(` ${normalizedQuery}`);
  if (wordStartIndex >= 0) return 2;
  return 3;
}

export function CreatureNameInput({
  value,
  onChange,
  creatureNames,
  placeholder,
  className,
  maxSuggestions = 8,
  id,
  ariaLabel,
}: CreatureNameInputProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const suggestions = useMemo(() => {
    const query = value.trim();
    const filtered = query
      ? creatureNames.filter((name) => creatureNameMatchesQuery(name, query))
      : creatureNames;
    return filtered
      .slice()
      .sort((a, b) => {
        const rankDiff = rankCreatureNameMatch(a, query) - rankCreatureNameMatch(b, query);
        if (rankDiff !== 0) return rankDiff;
        return a.localeCompare(b);
      })
      .slice(0, maxSuggestions);
  }, [creatureNames, maxSuggestions, value]);

  const showSuggestions = isFocused && suggestions.length > 0;

  return (
    <div ref={wrapperRef} className={`creature-name-input${className ? ` ${className}` : ""}`}>
      <input
        id={id}
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={() => setIsFocused(true)}
        onChange={(event) => {
          setIsFocused(true);
          onChange(event.target.value);
        }}
      />
      {showSuggestions ? (
        <div className="creature-name-input-menu">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              className={`creature-name-input-option${name === value ? " selected" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(name);
                setIsFocused(false);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
