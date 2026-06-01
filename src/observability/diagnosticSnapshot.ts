/**
 * Plain-text diagnostic snapshot — build/WASM version, bridge state,
 * web vitals, and recent errors formatted for a bug report. Extracted
 * from DiagnosePanel so both the diagnostics overlay and the
 * Share-Match button can produce the same tech block.
 */

import {
  getRustMatchupBridgeFailureError,
  getRustMatchupBridgeStatus,
  type RustMatchupBridgeStatus,
} from "../optimizer/rustMatchupLoader";
import { getVitalsSnapshot, type VitalsSnapshot } from "./webVitals";
import { getRecentErrorReports, type ErrorReport } from "./errorSink";

export type DiagnosticSnapshotInput = {
  buildHash: string;
  rustVersion: string;
  bridgeStatus: RustMatchupBridgeStatus;
  bridgeFailureError: unknown;
  vitals: VitalsSnapshot;
  reports: ErrorReport[];
};

export function formatBridgeFailure(err: unknown): string {
  if (err == null) return "(no error captured)";
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

export function formatErrorBody(err: unknown): string {
  if (err == null) return "(empty)";
  if (err instanceof Error) {
    return err.stack ? err.stack.split("\n").slice(0, 4).join("\n  ") : `${err.name}: ${err.message}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function formatDiagnosticSnapshot(input: DiagnosticSnapshotInput): string {
  const lines: string[] = [];
  lines.push(`COS calc diagnostic snapshot`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Build: ${input.buildHash}`);
  lines.push(`WASM version: ${input.rustVersion}`);
  lines.push(`User agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)"}`);
  lines.push(``);
  lines.push(`WASM bridge status: ${input.bridgeStatus}`);
  if (input.bridgeStatus === "failed") {
    lines.push(`  failure: ${formatBridgeFailure(input.bridgeFailureError)}`);
  }
  lines.push(``);
  lines.push(`Web vitals:`);
  lines.push(`  LCP: ${input.vitals.lcp ? input.vitals.lcp.value.toFixed(1) + " ms" : "—"}`);
  lines.push(`  INP: ${input.vitals.inp ? input.vitals.inp.value.toFixed(1) + " ms" : "—"}`);
  lines.push(`  CLS: ${input.vitals.cls ? input.vitals.cls.value.toFixed(4) : "—"}`);
  const measures = Object.entries(input.vitals.measures);
  if (measures.length > 0) {
    lines.push(`  Performance measures:`);
    for (const [name, m] of measures.sort(([, a], [, b]) => b.totalMs - a.totalMs)) {
      lines.push(`    ${name}: ${m.count}× total=${m.totalMs.toFixed(1)}ms last=${m.lastMs.toFixed(1)}ms`);
    }
  }
  lines.push(``);
  lines.push(`Recent errors (${input.reports.length}):`);
  for (const r of input.reports.slice().reverse()) {
    lines.push(`  [${new Date(r.timestamp).toISOString()}] ${r.source}`);
    lines.push(`    ${formatErrorBody(r.error).replace(/\n/g, "\n    ")}`);
    if (r.context !== undefined) {
      try {
        lines.push(`    context: ${JSON.stringify(r.context)}`);
      } catch {
        // Skip non-serializable context.
      }
    }
  }
  return lines.join("\n");
}

/**
 * Gather every observability surface live and format it. Convenience
 * wrapper for callers (Share-Match) that don't already hold the
 * individual snapshots.
 */
export function captureDiagnosticSnapshot(): string {
  return formatDiagnosticSnapshot({
    buildHash: String(import.meta.env.VITE_BUILD_HASH ?? "local"),
    rustVersion: String(import.meta.env.VITE_RUST_WASM_VERSION ?? "unknown"),
    bridgeStatus: getRustMatchupBridgeStatus(),
    bridgeFailureError: getRustMatchupBridgeFailureError(),
    vitals: getVitalsSnapshot(),
    reports: getRecentErrorReports(),
  });
}
