import { useEffect, useState } from "react";
import {
  getRustMatchupBridgeFailureError,
  getRustMatchupBridgeStatus,
  subscribeRustMatchupBridgeStatus,
  type RustMatchupBridgeStatus,
} from "../optimizer/rustMatchupLoader";
import { getVitalsSnapshot, type VitalsSnapshot } from "../observability/webVitals";
import { getRecentErrorReports, type ErrorReport } from "../observability/errorSink";
import {
  formatBridgeFailure,
  formatDiagnosticSnapshot,
  formatErrorBody,
} from "../observability/diagnosticSnapshot";

/**
 * Self-service diagnostic overlay. Surfaces the three observability
 * primitives the rest of the app already feeds:
 *
 *  - **Web Vitals** (LCP, INP, CLS + `performance.measure` aggregates)
 *    from `__cosCalcVitals`.
 *  - **WASM bridge state** (idle/loading/ready/failed + last failure
 *    error) from `rustMatchupLoader`.
 *  - **Recent error reports** (last 20) from `errorSink`'s ring buffer.
 *
 * Plus build hash + WASM mtime version so a bug report unambiguously
 * names the build the user is hitting.
 *
 * **Access:** triggered by `#diagnose` URL fragment OR `Ctrl+Shift+D`
 * keyboard chord. Not in the main nav — this is a power-user surface,
 * not a feature page. Press the chord again or close the panel to hide.
 *
 * Why a single panel instead of e.g. a Sentry SDK: the project is
 * solo-maintained and the data here is enough for 90 % of "it broke
 * on my screen" bug reports. A copy-to-clipboard button dumps the
 * whole snapshot as text the user can paste into the issue tracker.
 */
export function DiagnosePanel() {
  const [visible, setVisible] = useState(() => readVisibleFromHash());
  const [bridgeStatus, setBridgeStatus] = useState<RustMatchupBridgeStatus>(getRustMatchupBridgeStatus);
  const [vitals, setVitals] = useState<VitalsSnapshot>(() => getVitalsSnapshot());
  const [reports, setReports] = useState<ErrorReport[]>(() => getRecentErrorReports());
  const [copied, setCopied] = useState(false);

  // Hash-fragment listener — `#diagnose` shows the panel, removing
  // the fragment hides it. Sync state across back/forward nav.
  useEffect(() => {
    const onHash = () => setVisible(readVisibleFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keyboard chord — Ctrl+Shift+D toggles the panel. Mirrors the
  // hash-fragment trigger so users don't need to type a URL.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        toggleHash();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Live bridge-status subscription while the panel is open.
  useEffect(() => {
    if (!visible) return;
    setBridgeStatus(getRustMatchupBridgeStatus());
    const unsubscribe = subscribeRustMatchupBridgeStatus(setBridgeStatus);
    return unsubscribe;
  }, [visible]);

  // Polling for vitals + recent reports while open. Both surfaces
  // mutate via side channels (PerformanceObserver, reportError calls)
  // so a 1-second tick is the cheap way to keep the panel fresh.
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => {
      setVitals(getVitalsSnapshot());
      setReports(getRecentErrorReports());
    }, 1000);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const buildHash = String(import.meta.env.VITE_BUILD_HASH ?? "local");
  const rustVersion = String(import.meta.env.VITE_RUST_WASM_VERSION ?? "unknown");

  const dump = formatDiagnosticSnapshot({
    buildHash,
    rustVersion,
    bridgeStatus,
    bridgeFailureError: getRustMatchupBridgeFailureError(),
    vitals,
    reports,
  });

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(dump);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable on http: or in restricted
      // contexts — fall back to a textarea + select so the user can
      // still copy manually.
      const ta = document.createElement("textarea");
      ta.value = dump;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        // Last resort: the dump <pre> below stays selectable.
      }
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="diagnose-panel" role="dialog" aria-label="Diagnostics">
      <div className="diagnose-panel-header">
        <strong>Diagnostics</strong>
        <span className="muted">
          Build {buildHash} · WASM {rustVersion}
        </span>
        <div className="diagnose-panel-actions">
          <button type="button" className="secondary" onClick={onCopy}>
            {copied ? "Copied" : "Copy snapshot"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={toggleHash}
            aria-label="Close diagnostics"
          >
            ✕
          </button>
        </div>
      </div>

      <section className="diagnose-section">
        <h4>WASM bridge</h4>
        <div className="diagnose-kv">
          <span>Status</span>
          <code>{bridgeStatus}</code>
        </div>
        {bridgeStatus === "failed" ? (
          <pre className="diagnose-pre">
            {formatBridgeFailure(getRustMatchupBridgeFailureError())}
          </pre>
        ) : null}
      </section>

      <section className="diagnose-section">
        <h4>Web Vitals</h4>
        <div className="diagnose-kv">
          <span>LCP</span>
          <code>{vitals.lcp ? `${vitals.lcp.value.toFixed(1)} ms` : "—"}</code>
        </div>
        <div className="diagnose-kv">
          <span>INP</span>
          <code>{vitals.inp ? `${vitals.inp.value.toFixed(1)} ms` : "—"}</code>
        </div>
        <div className="diagnose-kv">
          <span>CLS</span>
          <code>{vitals.cls ? vitals.cls.value.toFixed(4) : "—"}</code>
        </div>
        {Object.keys(vitals.measures).length > 0 ? (
          <details>
            <summary>Performance measures ({Object.keys(vitals.measures).length})</summary>
            <pre className="diagnose-pre">
              {Object.entries(vitals.measures)
                .sort(([, a], [, b]) => b.totalMs - a.totalMs)
                .map(
                  ([name, m]) =>
                    `${name}: ${m.count}× total=${m.totalMs.toFixed(1)}ms last=${m.lastMs.toFixed(1)}ms`,
                )
                .join("\n")}
            </pre>
          </details>
        ) : null}
      </section>

      <section className="diagnose-section">
        <h4>Recent errors ({reports.length})</h4>
        {reports.length === 0 ? (
          <div className="muted">No errors reported this session.</div>
        ) : (
          <pre className="diagnose-pre">
            {reports
              .slice()
              .reverse()
              .map((r) => {
                const when = new Date(r.timestamp).toISOString().slice(11, 23);
                const err = formatErrorBody(r.error);
                return `[${when}] ${r.source}\n  ${err}`;
              })
              .join("\n")}
          </pre>
        )}
      </section>
    </div>
  );
}

function readVisibleFromHash(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hash === "#diagnose";
}

function toggleHash() {
  if (typeof window === "undefined") return;
  if (window.location.hash === "#diagnose") {
    // History.replaceState avoids piling up nav entries when toggling
    // the panel repeatedly.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = "#diagnose";
  }
}
