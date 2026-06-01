import { useState } from "react";

/**
 * Copies a shareable link to the current matchup plus a diagnostic
 * tech block to the clipboard. The link replays the matchup state for
 * a maintainer reviewing a bug report; the tech block carries build /
 * WASM / error context that can't be replayed.
 *
 * The text to copy is built lazily by the parent (App) since it owns
 * the global settings and the active-page snapshot provider.
 */
export function ShareMatchButton({ onBuildShareText }: { onBuildShareText: () => string }) {
  const [copied, setCopied] = useState(false);

  const flashCopied = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const onClick = async () => {
    const text = onBuildShareText();
    try {
      await navigator.clipboard.writeText(text);
      flashCopied();
    } catch {
      // Clipboard API may be unavailable on http: or in restricted
      // contexts — fall back to a hidden textarea + execCommand.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        flashCopied();
      } catch {
        // Last resort — nothing copied; the user can retry.
      }
      document.body.removeChild(ta);
    }
  };

  return (
    <button
      className="share-match-btn"
      type="button"
      onClick={() => void onClick()}
      title="Copy a shareable link to this matchup + diagnostics for bug reports"
    >
      {copied ? "Copied!" : "Share / Report"}
    </button>
  );
}
