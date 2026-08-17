import { useEffect, useState } from "react";

// Text-backed numeric input that lets the user type freely (the field keeps the
// raw text) while committing a clamped number on every valid keystroke and on
// blur. The local text is re-synced from the canonical value when it changes
// from the outside (Reset, a sibling reflow) - but never while the field is
// focused, so an in-flight edit is not clobbered.
//
// `allowDecimal` accepts a fractional value and both separators: a comma is
// normalized to a dot (so "0,3" and "0.3" both read as 0.3), and only the first
// dot is kept. Without it the field is integer-only.
export function SmartNumericInput({
  id,
  ariaLabel,
  value,
  clamp,
  onCommit,
  allowDecimal = false,
}: {
  id: string;
  ariaLabel?: string;
  value: number;
  clamp: (raw: number) => number;
  onCommit: (next: number) => void;
  allowDecimal?: boolean;
}) {
  const [text, setText] = useState(() => String(value));
  useEffect(() => {
    if (document.activeElement?.id === id) return;
    setText(String(value));
  }, [value, id]);
  const stripper = allowDecimal
    ? (raw: string) => {
        let cleaned = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
        const firstDot = cleaned.indexOf(".");
        if (firstDot >= 0) {
          cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
        }
        return cleaned;
      }
    : (raw: string) => raw.replace(/[^\d]/g, "");
  return (
    <input
      id={id}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        const next = stripper(e.target.value);
        setText(next);
        if (next === "" || next === ".") return;
        const parsed = Number(next);
        if (!Number.isFinite(parsed)) return;
        onCommit(clamp(parsed));
      }}
      onBlur={() => {
        const trimmed = text.trim();
        const normalized =
          trimmed === "" || trimmed === "." ? clamp(value) : clamp(Number(trimmed) || 0);
        setText(String(normalized));
        onCommit(normalized);
      }}
    />
  );
}
