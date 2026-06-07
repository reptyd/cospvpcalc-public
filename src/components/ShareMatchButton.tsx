import { useState } from "react";

/**
 * Two clipboard actions for the active matchup:
 *  - Share: a clean link that replays the matchup state (for sharing a build
 *    with someone). No technical data.
 *  - Report: the same link plus a diagnostic tech block (build / WASM / bridge
 *    / errors) for bug reports. There is no in-app tracker, so a report is
 *    pasted to the Contact channel.
 *
 * The text to copy is built lazily by the parent (App), which owns the global
 * settings and the active-page snapshot provider.
 */
export function ShareMatchButton({
  onBuildShareText,
  onBuildReportText,
}: {
  onBuildShareText: () => string;
  onBuildReportText: () => string;
}) {
  const [copied, setCopied] = useState<null | "share" | "report">(null);

  const copy = async (kind: "share" | "report", build: () => string) => {
    const text = build();
    const flash = () => {
      setCopied(kind);
      window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    };
    try {
      await navigator.clipboard.writeText(text);
      flash();
    } catch {
      // Clipboard API may be unavailable on http: or in restricted contexts -
      // fall back to a hidden textarea + execCommand.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        flash();
      } catch {
        // Last resort - nothing copied; the user can retry.
      }
      document.body.removeChild(ta);
    }
  };

  return (
    <>
      <button
        className="share-match-btn"
        type="button"
        onClick={() => void copy("share", onBuildShareText)}
        title="Copy a clean link that opens this exact matchup"
      >
        {copied === "share" ? "Copied!" : "Share"}
      </button>
      <button
        className="share-match-btn share-match-btn--report"
        type="button"
        onClick={() => void copy("report", onBuildReportText)}
        title="Copy the link plus diagnostics - paste this when reporting a problem"
      >
        {copied === "report" ? "Copied!" : "Report a problem"}
      </button>
    </>
  );
}
