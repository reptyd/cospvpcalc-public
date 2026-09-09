/**
 * Lightweight, dependency-free observability surface.
 *
 * Captures the three Core Web Vitals (LCP, INP, CLS) via native
 * `PerformanceObserver`s and exposes them on the global
 * `window.__cosCalcVitals` object so power users (and the future
 * `/diagnose` debug panel) can read them from devtools without
 * setting up a remote sink.
 *
 * Also surfaces helper hooks so the WASM bridge and other hot paths
 * can emit `performance.mark`/`performance.measure` entries that show
 * up in the browser's Performance tab. Costs ~20 bytes per call when
 * the API is missing (fall-through), so it's safe to wrap on every
 * matchup call.
 *
 * Why no `web-vitals` npm package: the official lib is ~2 KB gzipped
 * and brings its own thresholds + reporter. We need raw values for
 * the debug panel; the official lib's "rating" classification adds
 * weight without adding signal. If a remote sink lands later we can
 * pipe these primitives into whatever reporter the sink expects.
 */

export type WebVital = {
  /** "LCP" | "INP" | "CLS" - kept open so future axes can extend. */
  name: string;
  /** Final or current best value. LCP/INP in ms; CLS unitless. */
  value: number;
  /** When the observer fired (ms since navigation start). */
  recordedAt: number;
};

export type VitalsSnapshot = {
  lcp: WebVital | null;
  inp: WebVital | null;
  cls: WebVital | null;
  /** Recorded `performance.measure` entries grouped by name. */
  measures: Record<string, MeasureSummary>;
};

export type MeasureSummary = {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  /** Last observed value - useful for the debug panel "what just happened?" view. */
  lastMs: number;
};

const VITALS_GLOBAL_KEY = "__cosCalcVitals";

const state: {
  lcp: WebVital | null;
  inp: WebVital | null;
  cls: WebVital | null;
  measures: Map<string, MeasureSummary>;
} = {
  lcp: null,
  inp: null,
  cls: null,
  measures: new Map(),
};

let installed = false;

/**
 * Wire the three core observers + a measure-aggregating observer.
 * Idempotent. Call once during app boot, before React renders, so
 * the LCP observer sees the actual largest paint.
 */
export function installWebVitalsCapture(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (typeof PerformanceObserver !== "function") return;

  // Expose snapshot accessor to power users via devtools console.
  // Stable global key - easy to reach without imports.
  (window as unknown as Record<string, unknown>)[VITALS_GLOBAL_KEY] = {
    snapshot: getVitalsSnapshot,
    raw: state,
  };

  // LCP: largest-contentful-paint. We track the latest entry as the
  // "current best LCP"; when the page goes hidden the spec stops
  // emitting new ones, so the latest value at hide is final.
  observeQuiet("largest-contentful-paint", (entry) => {
    const e = entry as PerformanceEntry & { renderTime?: number; loadTime?: number };
    const value = e.renderTime ?? e.loadTime ?? entry.startTime;
    state.lcp = { name: "LCP", value, recordedAt: performance.now() };
  });

  // INP: derived from event-timing entries. We track the worst
  // (longest) interaction duration seen, which is what Chrome's
  // INP metric reports at session end.
  observeQuiet(
    "event",
    (entry) => {
      const e = entry as PerformanceEventTiming;
      const dur = e.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      if (state.inp == null || dur > state.inp.value) {
        state.inp = { name: "INP", value: dur, recordedAt: performance.now() };
      }
    },
    { durationThreshold: 16 } as PerformanceObserverInit,
  );

  // CLS: layout-shift entries. Sum all unexpected shifts (excluding
  // the ones that follow user input within 500 ms - Chrome's CLS
  // rules). We accumulate into state.cls.value.
  let cumulativeCls = 0;
  observeQuiet("layout-shift", (entry) => {
    const e = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
    if (e.hadRecentInput) return;
    cumulativeCls += e.value ?? 0;
    state.cls = { name: "CLS", value: cumulativeCls, recordedAt: performance.now() };
  });

  // Aggregating observer for any `performance.measure(name, ...)`
  // calls - the bridge wrapper below feeds this. We aggregate so a
  // hot loop calling `simulate_composable_matchup_js` thousands of
  // times doesn't blow up memory; only summary stats are kept.
  observeQuiet("measure", (entry) => {
    const dur = entry.duration;
    if (!Number.isFinite(dur) || dur < 0) return;
    const prev = state.measures.get(entry.name);
    if (prev) {
      prev.count += 1;
      prev.totalMs += dur;
      prev.minMs = Math.min(prev.minMs, dur);
      prev.maxMs = Math.max(prev.maxMs, dur);
      prev.lastMs = dur;
    } else {
      state.measures.set(entry.name, {
        count: 1,
        totalMs: dur,
        minMs: dur,
        maxMs: dur,
        lastMs: dur,
      });
    }
  });

  installed = true;
}

/**
 * Wrap a synchronous call with `performance.mark`/`performance.measure`
 * so it appears in the Performance tab AND feeds the aggregator above.
 * Fall-through on browsers without the API. The `name` is used as the
 * measure label and the aggregator key - keep it short and stable.
 */
export function markCall<T>(name: string, fn: () => T): T {
  if (
    typeof performance === "undefined" ||
    typeof performance.mark !== "function" ||
    typeof performance.measure !== "function"
  ) {
    return fn();
  }
  const startLabel = `${name}:start`;
  const endLabel = `${name}:end`;
  performance.mark(startLabel);
  try {
    return fn();
  } finally {
    performance.mark(endLabel);
    try {
      performance.measure(name, startLabel, endLabel);
    } catch {
      // Measure can fail if the marks are out of order or were cleared
      // mid-call. Swallow - the timing entry is best-effort.
    }
    // Clean up marks so the entry buffer doesn't fill with start/end
    // pairs on hot paths.
    try {
      performance.clearMarks(startLabel);
      performance.clearMarks(endLabel);
    } catch {
      // Older Safari throws on clearMarks(name). Ignore.
    }
  }
}

export function getVitalsSnapshot(): VitalsSnapshot {
  return {
    lcp: state.lcp,
    inp: state.inp,
    cls: state.cls,
    measures: Object.fromEntries(state.measures.entries()),
  };
}

/**
 * TEST-ONLY: reset internal state so unit tests can drive the
 * snapshot accessor without leaking between cases.
 */
export function __resetVitalsForTests(): void {
  state.lcp = null;
  state.inp = null;
  state.cls = null;
  state.measures.clear();
  installed = false;
}

function observeQuiet(
  type: string,
  cb: (entry: PerformanceEntry) => void,
  options: PerformanceObserverInit = {},
): void {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        cb(entry);
      }
    });
    observer.observe({ type, buffered: true, ...options });
  } catch {
    // Browser doesn't support this entry type - fall through silently.
    // Each observer is independent so an unsupported `event` type
    // doesn't block LCP / CLS from working.
  }
}
