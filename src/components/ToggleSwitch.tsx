export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  /** Extra class on the switch button (e.g. a filter-chip variant). Optional;
   * default callers are unaffected. */
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`switch ${checked ? "on" : "off"}${className ? ` ${className}` : ""}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="switch-thumb" />
      <span className="switch-body">
        <span className="switch-label">
          {label}
          <span className={`switch-state ${checked ? "on" : "off"}`}>{checked ? "ON" : "OFF"}</span>
        </span>
        {description ? <span className="switch-desc">{description}</span> : null}
      </span>
    </button>
  );
}
