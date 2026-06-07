export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      className={`switch ${checked ? "on" : "off"}`}
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
