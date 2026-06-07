/**
 * Lightweight error sink. Single mutable function reference that
 * `AppErrorBoundary` and `rustMatchupLoader` (and any future failure
 * site) call when something goes wrong. Default sink writes to
 * `console.error` so failures stay visible in devtools without any
 * remote setup.
 *
 * To wire a remote sink (Sentry-flavour or a tiny custom endpoint),
 * call `setErrorSink(fn)` once at boot. The `fn` receives an
 * `ErrorReport` and is free to do anything - POST it, drop it,
 * augment with user context, etc. The default sink is restored if
 * you call `setErrorSink(null)`.
 *
 * Why a single mutable hook instead of a richer eventbus: the
 * surface needs to be small enough that contributors don't reach
 * for `console.error` directly out of laziness. One function call,
 * one extension point. Add structure when there's a second consumer.
 */

export type ErrorReport = {
  /** Where the error came from. Stable strings - used for grouping. */
  source: string;
  /** Original error or its serialized form. */
  error: unknown;
  /** Additional structured context. */
  context?: Record<string, unknown>;
  /** Wall-clock timestamp (ms since epoch). */
  timestamp: number;
};

export type ErrorSink = (report: ErrorReport) => void;

const defaultSink: ErrorSink = (report) => {
  // Omit the trailing `context` arg entirely when it's undefined so the
  // devtools panel doesn't show a dangling `undefined` after every error.
   
  if (report.context !== undefined) {
    console.error(`[error-sink ${report.source}]`, report.error, report.context);
  } else {
     
    console.error(`[error-sink ${report.source}]`, report.error);
  }
};

let activeSink: ErrorSink = defaultSink;

// In-memory ring buffer of the most recent reports. Read by the
// `/diagnose` overlay so power users can copy a recent-
// error snapshot for bug reports without setting up a remote sink.
// Capped at `RECENT_REPORT_LIMIT` to bound memory; once full, oldest
// entries fall off the front. Survives across active-sink swaps -
// `setErrorSink(fn)` replaces only the dispatch target, not the log.
const RECENT_REPORT_LIMIT = 20;
const recentReports: ErrorReport[] = [];

/** Snapshot of the most recent reports, oldest first. Returned as a
 * fresh array so callers can iterate without worrying about live
 * mutation. */
export function getRecentErrorReports(): ErrorReport[] {
  return recentReports.slice();
}

/** TEST-ONLY: empty the recent-reports buffer so unit tests don't
 * leak history between cases. */
export function __resetRecentErrorReportsForTests(): void {
  recentReports.length = 0;
}

/**
 * Replace the active sink. Pass `null` to restore the console default.
 * Sinks should not throw - if they do, the throw is caught and
 * logged so an instrumentation bug doesn't break the failing call
 * site even further.
 */
export function setErrorSink(sink: ErrorSink | null): void {
  activeSink = sink ?? defaultSink;
}

/**
 * Fire-and-forget: report a failure. Always succeeds - the wrapper
 * around the active sink swallows any throw so a bad sink doesn't
 * cascade into the original failure site.
 */
export function reportError(source: string, error: unknown, context?: Record<string, unknown>): void {
  const report: ErrorReport = {
    source,
    error,
    context,
    timestamp: Date.now(),
  };
  recentReports.push(report);
  if (recentReports.length > RECENT_REPORT_LIMIT) {
    recentReports.shift();
  }
  try {
    activeSink(report);
  } catch (sinkError) {
     
    console.error("[error-sink] active sink threw:", sinkError, "while reporting:", report);
  }
}

/**
 * TEST-ONLY: reset to the default console sink AND empty the recent-
 * reports buffer so tests don't leak either across cases.
 */
export function __resetErrorSinkForTests(): void {
  activeSink = defaultSink;
  recentReports.length = 0;
}
