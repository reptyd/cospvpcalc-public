// Beta "Fight Playback" view of the Compare tab. Dev-gated (iddqd +
// Settings toggle). Shares the engine wiring with the default ComparePage
// via useComparePageController, so the simulation is identical - only the
// presentation differs. The fight is the hero: HP-over-time (derived from
// the real combat log) + a playback scrubber + a live combatant HUD. The
// full real config lives in an on-demand Setup overlay (tabbed, with a
// beta-native identity hero per creature), and the breakdown below renders
// beta-native sheets (CreatureSheet) plus the canonical SummaryCard /
// CompareBattleDetails so nothing from the default is lost.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Play, Pause, SkipBack, ChevronLeft, ChevronRight, X, Settings2 } from "lucide-react";
import type { BuildOptions, CreatureRuntime, FinalStats } from "../engine";
import type { SimulationSummary } from "../engine/types";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { IconImg } from "../components/IconImg";
import { CreatureNameInput } from "../components/CreatureNameInput";
import { CreatureSelectorCard } from "../components/compare/CreatureSelectorCard";
import { AscensionSelectors, ElderSelector, PlushiePickerBeta, TraitSelectors } from "../components/BuildSelectors";
import { veneration } from "../engine/buildData";
import { formatTempBuffHpRegen } from "../components/compare/StatCard";
import { CompareBattleDetails } from "../components/compare/CompareBattleDetails";
import { fixedCadenceFor } from "../engine/compareAirRule";
import { BattleSettingsPanel, describeDpsSettings } from "../components/compare/BattleSettingsPanel";
import { badOmenOutcomes } from "./compareConfig";
import { getViewCombatLog, getViewCutoffTime, buildStatusSnapshot, buildStatusIntervals, getDamageDealtUntil, getViewMetrics, getViewEhp, getViewDetails, type CompareResultViewMode, type CompareDpsSettings } from "../components/compare/compareResultView";
import { useComparePageController } from "./useComparePageController";
import "./compareBeta.css";

export type ComparePageBetaProps = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  creatureNames: string[];
  developerMode: boolean;
  trueDeveloperMode: boolean;
  trueRoundingMode: boolean;
  combatEventOrder: CombatEventPhase[];
  importedMatchMode: boolean;
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onBuildAChange: (value: BuildOptions) => void;
  onBuildBChange: (value: BuildOptions) => void;
};

// A combat event surfaced on the chart as a clickable "key moment" marker.
type HpEvent = { t: number; side: "A" | "B"; death: boolean; damage: number; heal: number; desc: string; marker: boolean };
// preT < 0 is a short synthetic lead-in BEFORE the first events: both sides
// at full HP, nothing active. Without it the playhead could never land on a
// pre-fight moment - the first bites at t=0 were already applied at the
// earliest reachable position. Display times clamp to 0 (the lead-in reads
// as "before the bell", not as negative seconds).
type HpSeries = { pts: { t: number; a: number; b: number }[]; preT: number; endT: number; events: HpEvent[] };

function eventDesc(e: { description?: string; type?: string }): string {
  return e.description ?? (e.type ? e.type : "event");
}

function prettyStatus(statusId: string): string {
  return statusId.replace(/_Status$/i, "").replace(/_/g, " ");
}

// The shared ability `detail` repeats the ability name for resist / on-hit
// abilities - "Block Bleed" -> "Block Bleed 60%", "Bleed Attack" -> "Attack
// Bleed +2" - which reads as noise next to the name. Drop the tokens already
// shown by the name (and the generic "Value" label) so the chip shows just the
// meaningful figure: "60%", "+2", "0.2". Empty result -> no value segment (e.g.
// "Unbreakable (80)" whose value is already in the name). Full text stays in
// the tooltip.
function compactAbilityDetail(name: string, detail: string): string {
  const nameTokens = new Set(name.toLowerCase().match(/[a-z0-9.]+/g) ?? []);
  return detail
    .split("; ")
    .map((part) =>
      part
        .split(/\s+/)
        .filter((word) => {
          const lower = word.toLowerCase();
          if (lower === "value") return false; // generic label
          const alpha = lower.replace(/[^a-z]/g, "");
          if (alpha && nameTokens.has(alpha)) return false; // word already in the name
          const numeric = lower.replace(/[^a-z0-9.]/g, "");
          if (numeric && nameTokens.has(numeric)) return false; // figure already in the name
          return true;
        })
        .join(" "),
    )
    .filter((part) => part.length > 0)
    .join(" · ");
}

type LiveSide = { effects: { name: string; stacks: number }[]; abilities: string[]; dealt: number };

// "Active over time" lane: status intervals, ability windows, and
// instantaneous ability-trigger points, on one side.
type ActivityLane = { key: string; label: string; kind: "status" | "ability"; side: "A" | "B"; segments: { from: number; to: number }[]; accentSegments?: { from: number; to: number }[]; points: number[] };

// Abilities with a sustained active STATE (a window), vs instantaneous casts.
// A lone "X activated" with no logged close means the window was still open at
// sim end (e.g. Hunker kept on until death) - for these it's a window to the
// cutoff, NOT a momentary point. Mirrors the engine's windowed/conditional
// abilities (the 9 timed windows + conditional passives + Hunker). Anything
// not here that logs "activated" is treated as an instantaneous cast (point).
const SUSTAINED_ABILITIES = new Set<string>([
  "Life Leech", "Hunker", "Harden", "Reflect", "Adrenaline", "Hunters Curse",
  "Unbridled Rage", "Frost Nova", "Totem", "Fortify", "Berserk", "First Strike",
  "Warden's Resistance", "Warden's Rage", "Warden's Rage (manual)",
]);

// Ability activity for one side, event-driven:
//  - "X activated" + later "X deactivated" -> a window [activated, deactivated]
//  - "X active" passive ticks               -> a window spanning each tick run
//  - lone "X activated" -> window to cutoff if X is sustained, else a point
// Pairing scans the FULL log (a window can close AFTER the view cutoff - e.g.
// Life Leech's 12s window in a fight that ends at 2s); windows are then clamped
// to [0, endT] for display.
function buildAbilityActivity(summary: SimulationSummary, side: "A" | "B", endT: number): { windows: { label: string; segments: { from: number; to: number }[] }[]; points: { label: string; t: number }[] } {
  const entries = (summary.combatLog ?? []).filter((e) => e.attacker === side && e.type === "ability").slice().sort((l, r) => l.time - r.time);
  const openAct = new Map<string, number>();
  const win = new Map<string, { from: number; to: number }[]>();
  const ticks = new Map<string, number[]>();
  const rawPoints: { label: string; t: number }[] = [];
  const pushWin = (n: string, seg: { from: number; to: number }) => {
    if (seg.to <= seg.from) return;
    const arr = win.get(n);
    if (arr) arr.push(seg);
    else win.set(n, [seg]);
  };
  for (const e of entries) {
    const d = e.description ?? "";
    if (d.endsWith(" activated")) openAct.set(d.slice(0, -" activated".length), e.time);
    else if (d.endsWith(" deactivated")) {
      const n = d.slice(0, -" deactivated".length);
      const from = openAct.get(n);
      if (from != null) { pushWin(n, { from, to: e.time }); openAct.delete(n); }
    } else if (d.endsWith(" active")) {
      const n = d.slice(0, -" active".length);
      const arr = ticks.get(n);
      if (arr) arr.push(e.time);
      else ticks.set(n, [e.time]);
    }
  }
  // Lone "activated" (window still open at sim end): sustained ability -> window
  // to the cutoff; otherwise an instantaneous cast -> point.
  for (const [n, from] of openAct) {
    if (SUSTAINED_ABILITIES.has(n)) pushWin(n, { from, to: endT });
    else rawPoints.push({ label: n, t: from });
  }
  // Passive tick runs -> windows; a single isolated tick -> a point.
  const GAP = 1.2;
  for (const [n, ts] of ticks) {
    ts.sort((a, b) => a - b);
    let start = ts[0];
    let prev = ts[0];
    const flush = () => { if (prev > start) pushWin(n, { from: start, to: prev }); else rawPoints.push({ label: n, t: start }); };
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - prev > GAP) { flush(); start = ts[i]; }
      prev = ts[i];
    }
    flush();
  }
  // Clamp windows to [0, endT]; drop anything that starts after the cutoff.
  const windows: { label: string; segments: { from: number; to: number }[] }[] = [];
  for (const [label, segs] of win) {
    const clamped = segs
      .map((s) => ({ from: s.from, to: Math.min(s.to, endT) }))
      .filter((s) => s.from <= endT + 1e-9 && s.to > s.from);
    if (clamped.length) windows.push({ label, segments: clamped });
  }
  const points = rawPoints.filter((p) => p.t <= endT + 1e-9);
  return { windows, points };
}

// Combined per-side activity lanes (statuses + abilities) for the chart.
function buildActivityLanes(summary: SimulationSummary | null, mode: CompareResultViewMode, endT: number): ActivityLane[] {
  if (!summary || endT <= 0) return [];
  const lanes: ActivityLane[] = [];
  for (const side of ["A", "B"] as const) {
    for (const s of buildStatusIntervals(summary, side, endT)) {
      lanes.push({ key: `${side}|status|${s.label}`, label: s.label, kind: "status", side, segments: s.segments, points: [] });
    }
    const ab = buildAbilityActivity(summary, side, endT);
    const byName = new Map<string, ActivityLane>();
    for (const w of ab.windows) byName.set(w.label, { key: `${side}|ability|${w.label}`, label: w.label, kind: "ability", side, segments: w.segments, points: [] });
    for (const p of ab.points) {
      const lane = byName.get(p.label);
      if (lane) lane.points.push(p.t);
      else byName.set(p.label, { key: `${side}|ability|${p.label}`, label: p.label, kind: "ability", side, segments: [], points: [p.t] });
    }
    // Fold "X (manual)" into the base "X" lane as an accent overlay so a toggle
    // like Warden's Rage reads as ONE window (the active state) with its
    // deliberate manual-held span styled distinctly from the passive background.
    for (const [label, lane] of [...byName]) {
      const m = label.match(/^(.*) \(manual\)$/);
      if (m) {
        const base = byName.get(m[1]);
        if (base) { base.accentSegments = lane.segments; byName.delete(label); }
      }
    }
    for (const lane of byName.values()) lanes.push(lane);
  }
  void mode;
  return lanes;
}

// Abilities active at time t = ability windows (not instantaneous points)
// whose segment covers t.
function abilitiesActiveAt(lanes: ActivityLane[], side: "A" | "B", t: number): string[] {
  return lanes
    .filter((l) => l.side === side && l.kind === "ability" && l.segments.some((s) => t >= s.from && t <= s.to))
    .map((l) => l.label)
    .sort((a, b) => a.localeCompare(b));
}

// Live fight-state for one side at the playhead: active status effects (with
// stacks), active abilities (windowed only), and cumulative damage dealt.
function liveSideAt(summary: SimulationSummary | null, lanes: ActivityLane[], side: "A" | "B", t: number): LiveSide {
  if (!summary) return { effects: [], abilities: [], dealt: 0 };
  const effects = Object.entries(buildStatusSnapshot(summary, side, t))
    .map(([statusId, stacks]) => ({ name: prettyStatus(statusId), stacks }))
    .sort((l, r) => r.stacks - l.stacks || l.name.localeCompare(r.name));
  return { effects, abilities: abilitiesActiveAt(lanes, side, t), dealt: getDamageDealtUntil(summary, side, t) };
}

// Derive a synchronized HP%-over-time series for both sides from the real
// combat log (HP is a STEP function: it holds constant between events, then
// jumps at an event - so the chart is rendered step-after and HP-at-time is a
// hold of the last value, never a linear ramp). Also collects the "key
// moment" events (hits, ability activations, deaths) for chart markers.
// Returns null until a sim has run.
function buildHpSeries(summary: SimulationSummary | null, mode: CompareResultViewMode): HpSeries | null {
  if (!summary || !summary.combatLog || summary.combatLog.length === 0) return null;
  const maxA = summary.maxHpA || 1;
  const maxB = summary.maxHpB || 1;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  // Use the cutoff-filtered view log (matches the default Timeline + adds
  // synthetic death markers); endT is the real battle end (first death /
  // actual end), NOT maxTimeSec (the simulation cap).
  const log = getViewCombatLog(summary, mode);
  let hpA = maxA;
  let hpB = maxB;
  const pts: HpSeries["pts"] = [{ t: 0, a: 100, b: 100 }];
  const events: HpEvent[] = [];
  for (const e of log) {
    if (e.hpSide === "A") hpA = e.hpAfter;
    else if (e.hpSide === "B") hpB = e.hpAfter;
    pts.push({ t: e.time, a: clamp((hpA / maxA) * 100), b: clamp((hpB / maxB) * 100) });
    const death = e.timelineKindOverride === "death";
    const side: "A" | "B" = e.hpSide === "A" || e.hpSide === "B" ? e.hpSide : e.attacker;
    const activated = typeof e.description === "string" && e.description.endsWith("activated");
    // Markers = the meaningful beats only (hits, ability activations, deaths) -
    // not every DoT/breath tick, which would clutter the axis.
    const marker = death || e.type === "bite" || activated;
    events.push({ t: e.time, side, death, damage: e.damage, heal: e.healing ?? 0, desc: death ? "defeated" : eventDesc(e), marker });
  }
  const lastEventT = log.length ? log[log.length - 1].time : 0;
  const endT = Math.max(getViewCutoffTime(summary, mode), lastEventT, 0.1);
  const last = pts[pts.length - 1];
  if (last.t < endT) pts.push({ t: endT, a: last.a, b: last.b });
  // Lead-in: ~4% of the fight (at least 0.4s) of flat 100/100 before t=0.
  const preT = -Math.max(0.4, Math.round(endT * 0.04 * 10) / 10);
  pts.unshift({ t: preT, a: 100, b: 100 });
  return { pts, preT, endT, events };
}

// HP% at time t = the value held since the most recent event at/before t
// (step semantics, matching the step-after chart - HP does not ramp between
// events). Returns the PRECISE percentage (not rounded): the scoreboard derives
// the dead state, the bar fill, and the absolute-HP readout from this, so
// rounding here would collapse a barely-alive side (e.g. a winner surviving on
// 0.49% / 62 HP) to 0% -> 0 HP -> "dead", contradicting the timeline/metrics
// that read the real HP. Round only at the integer-% readout via `fmtHpPct`.
function hpPctAt(series: HpSeries, t: number, key: "a" | "b"): number {
  const { pts } = series;
  // Binary search for the last point with pt.t <= t (step-hold). O(log n) so
  // 60fps playback stays cheap even on long fights with many events.
  let lo = 0;
  let hi = pts.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) { idx = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return pts[idx][key];
}

// Integer-% readout for the legend/tooltip. A side with any HP left never reads
// 0% (it floors to 1%), so a living creature can't masquerade as dead in the
// readout; 0% is shown only when the side is actually at zero HP.
function fmtHpPct(pct: number): number {
  return pct <= 0 ? 0 : Math.max(1, Math.round(pct));
}

// Nearest "key moment" event within a small time window of t (for the hover
// tooltip / playhead context line).
function nearestEvent(series: HpSeries, t: number, window = 0.35): HpEvent | null {
  let best: HpEvent | null = null;
  let bestDist = window;
  for (const e of series.events) {
    if (!e.marker) continue;
    const d = Math.abs(e.t - t);
    if (d <= bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

const SPEEDS = [0.5, 1, 2, 4];

// memo: during playback the page re-renders every rAF frame (setT @60fps), but
// the fighter scoreboard only needs to change when HP crosses a combat event
// (hpPct is a step value) or the bucketed `live` state ticks (~5/s). Memoizing
// + a stable `onPick` skips the per-frame re-render (and the abilities/effects
// .map) entirely between those points.
const Fighter = memo(function Fighter({ side, name, tierType, iconUrl, hpPct, maxHp, live, won, onPick }: { side: "a" | "b"; name: string; tierType: string; iconUrl: string | null; hpPct: number; maxHp: number; live: LiveSide; won?: boolean; onPick: () => void; }) {
  const dead = hpPct <= 0;
  return (
    <div className={`cb-fighter cb-fighter--${side} ${dead ? "is-dead" : ""}`}>
      <div className="cb-fighter__glow" />
      <div className="cb-fighter__id">
        {/* Clickable creature identity - opens Setup on this side's tab so you
            can swap the creature straight from the scoreboard (same affordance
            as the action-bar matchup glyph). */}
        <button
          type="button"
          className="cb-fighter__pick"
          onClick={onPick}
          title={`Change Side ${side.toUpperCase()} creature`}
          aria-label={`Change Side ${side.toUpperCase()} creature (currently ${name || "—"})`}
        >
          <IconImg src={iconUrl} alt={name} size={44} />
          <span className="cb-fighter__idtext"><span className="cb-fighter__name">{name || "—"}</span><span className="cb-fighter__sub">{tierType}</span></span>
        </button>
        {/* The single winner plaque on the page - the scoreboard declares the
            match verdict (the action-bar chip + the Outcome banner were removed
            as duplicates). Inline so it never overlaps; row-reverse on side B
            floats it to that card's outer edge, mirroring A. */}
        {won ? <span className="cb-fighter__win">WINS</span> : null}
      </div>
      <div className="cb-bar">
        <span className="cb-bar__cap">HP</span>
        <div className="cb-bar__track">
          <i className="cb-bar__trail" style={{ transform: `scaleX(${Math.max(0, Math.min(100, hpPct)) / 100})` }} />
          <i className={`cb-bar__fill cb-bar__fill--${dead ? "dead" : side}`} style={{ transform: `scaleX(${Math.max(0, Math.min(100, hpPct)) / 100})` }} />
        </div>
        <span className="cb-bar__val">{Math.round((hpPct / 100) * maxHp)}<em> / {Math.round(maxHp)}</em></span>
      </div>
      <div className="cb-fighter__state">
        <span className="cb-fighter__dealt">Damage dealt <b>{Math.round(live.dealt)}</b></span>
        <div className="cb-fighter__fx">
          {live.abilities.length === 0 && live.effects.length === 0 ? (
            <span className="cb-fighter__fx-none">Nothing active</span>
          ) : (
            <>
              {live.abilities.map((a) => (
                <span key={`ab-${a}`} className="cb-chip cb-chip--ability" title={`Ability / passive active: ${a}`}>{a}</span>
              ))}
              {live.effects.map((e) => (
                <span key={`fx-${e.name}`} className="cb-chip" title={`${e.name}${e.stacks > 1 ? ` · ${Math.round(e.stacks * 100) / 100} stacks` : ""}`}>
                  {e.name}{e.stacks >= 1.5 ? <em> ×{Math.round(e.stacks)}</em> : null}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

function FightChart({ series, t, onSeek, onScrub, vStart, vEnd, onView, nameA, nameB }: { series: HpSeries; t: number; onSeek: (t: number) => void; onScrub: (active: boolean) => void; vStart: number; vEnd: number; onView: (v: { start: number; end: number } | null) => void; nameA: string; nameB: string; }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // Plot rect cached for the duration of a drag-scrub: reading
  // getBoundingClientRect() on every pointermove forces a synchronous layout
  // each touch sample. The plot can't move mid-drag (pointer is captured), so
  // one read at pointerdown is enough.
  const plotRectRef = useRef<DOMRect | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  // Visible time window [vStart, vEnd] (zoom). xP maps a time into 0-100% of
  // the visible window, so the whole overlay (line, markers, playhead, axis)
  // rescales when zoomed.
  const span = Math.max(1e-6, vEnd - vStart);
  const xP = (tt: number) => ((tt - vStart) / span) * 100;
  const yP = (hp: number) => 100 - hp;
  const inView = (tt: number) => tt >= vStart - 1e-6 && tt <= vEnd + 1e-6;

  // Static chart geometry (gridlines + step-after area/lines) memoized on the
  // series. Step-after = hold the previous value to the event's x, then drop
  // vertically - all segments axis-aligned, so `preserveAspectRatio="none"`
  // can't distort them. Memoizing means playback never rebuilds the (long)
  // polyline strings or re-renders the SVG; only the playhead overlay moves.
  const staticSvg = useMemo(() => {
    const xv = (tt: number) => ((tt - vStart) / Math.max(1e-6, vEnd - vStart)) * 100;
    const yv = (hp: number) => 100 - hp;
    const stepLine = (key: "a" | "b") => {
      const out: string[] = [];
      for (let i = 0; i < series.pts.length; i++) {
        const p = series.pts[i];
        if (i > 0) out.push(`${xv(p.t)},${yv(series.pts[i - 1][key])}`);
        out.push(`${xv(p.t)},${yv(p[key])}`);
      }
      return out.join(" ");
    };
    const la = stepLine("a");
    const lb = stepLine("b");
    return (
      <svg className="cb-chart__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="cbA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity="0.34" /><stop offset="100%" stopColor="var(--primary)" stopOpacity="0" /></linearGradient>
          <linearGradient id="cbB" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--ok)" stopOpacity="0.30" /><stop offset="100%" stopColor="var(--ok)" stopOpacity="0" /></linearGradient>
        </defs>
        {[25, 50, 75].map((g) => <line key={`h${g}`} x1="0" x2="100" y1={yv(g)} y2={yv(g)} className="cb-chart__grid" />)}
        {[25, 50, 75].map((g) => <line key={`v${g}`} x1={g} x2={g} y1="0" y2="100" className="cb-chart__grid" />)}
        <polygon points={`0,100 ${lb} 100,100`} fill="url(#cbB)" /><polygon points={`0,100 ${la} 100,100`} fill="url(#cbA)" />
        <polyline points={lb} className="cb-chart__line cb-chart__line--b" /><polyline points={la} className="cb-chart__line cb-chart__line--a" />
      </svg>
    );
  }, [series, vStart, vEnd]);

  const timeFromClientX = (clientX: number): number => {
    const el = plotRef.current;
    if (!el) return t;
    const r = (draggingRef.current && plotRectRef.current) || el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return +(vStart + f * span).toFixed(2);
  };

  // Wheel-to-zoom (around the cursor) + Shift-wheel to pan. Attached as a
  // non-passive listener so it can preventDefault the page scroll.
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    // The zoomable domain is [preT, endT] - the lead-in is part of the chart.
    const t0 = series.preT;
    const full = series.endT - t0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const cur = vEnd - vStart;
      if (e.shiftKey) {
        const dir = e.deltaY > 0 ? 1 : -1;
        const ns = Math.max(t0, Math.min(series.endT - cur, vStart + dir * cur * 0.18));
        onView(cur >= full - 1e-6 ? null : { start: ns, end: ns + cur });
        return;
      }
      const minSpan = Math.max(full / 60, 0.2);
      const newSpan = Math.min(full, Math.max(minSpan, cur * (e.deltaY < 0 ? 0.8 : 1.25)));
      const cursorT = vStart + f * cur;
      let ns = cursorT - f * newSpan;
      ns = Math.max(t0, Math.min(series.endT - newSpan, ns));
      onView(newSpan >= full - 1e-6 ? null : { start: ns, end: ns + newSpan });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [vStart, vEnd, series.preT, series.endT, onView]);

  const markers = useMemo(() => series.events.filter((e) => e.marker), [series]);
  const hovered = hoverT != null ? nearestEvent(series, hoverT) : null;

  return (
    <div className="cb-chart">
      <div className="cb-chart__y">{[100, 75, 50, 25, 0].map((g) => <span key={g}>{g}</span>)}</div>
      <div
        className="cb-chart__plot"
        ref={plotRef}
        role="slider"
        aria-label="Fight playback position"
        aria-valuemin={Math.round(series.preT * 10) / 10}
        aria-valuemax={Math.round(series.endT * 10) / 10}
        aria-valuenow={Math.round(t * 10) / 10}
        tabIndex={0}
        onPointerDown={(e) => {
          draggingRef.current = true;
          plotRectRef.current = plotRef.current?.getBoundingClientRect() ?? null;
          onScrub(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(timeFromClientX(e.clientX));
        }}
        onPointerMove={(e) => {
          const tt = timeFromClientX(e.clientX);
          setHoverT(tt);
          if (draggingRef.current) onSeek(tt);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          plotRectRef.current = null;
          onScrub(false);
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* no capture */ }
        }}
        onPointerLeave={() => { setHoverT(null); if (draggingRef.current) { draggingRef.current = false; plotRectRef.current = null; onScrub(false); } }}
        onKeyDown={(e) => {
          const step = (series.endT - series.preT) / 50;
          if (e.key === "ArrowLeft") { onSeek(Math.max(series.preT, t - step)); e.preventDefault(); }
          else if (e.key === "ArrowRight") { onSeek(Math.min(series.endT, t + step)); e.preventDefault(); }
        }}
      >
        <div className="cb-chart__danger" />
        {/* Lead-in shading: the pre-fight stretch before t=0. */}
        {vStart < 0 && xP(0) > 0 ? <div className="cb-chart__preroll" style={{ width: `${Math.min(100, xP(0))}%` }} /> : null}
        {staticSvg}

        {/* Key-moment markers - clickable to jump the playhead there. Only the
            ones inside the visible (zoomed) window are drawn. */}
        {markers.filter((e) => inView(e.t)).map((e, i) => (
          <button
            key={`${e.t}-${i}`}
            type="button"
            className={`cb-mark cb-mark--${e.side === "A" ? "a" : "b"}${e.death ? " is-death" : ""}`}
            style={{ left: `${xP(e.t)}%` }}
            title={`${e.t.toFixed(1)}s · ${e.desc}${e.damage > 0 ? ` (${Math.round(e.damage)} dmg)` : ""}`}
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => { ev.stopPropagation(); onSeek(e.t); }}
          />
        ))}

        {hoverT != null && inView(hoverT) ? <span className="cb-chart__hover" style={{ left: `${xP(hoverT)}%` }} /> : null}
        {inView(t) ? <span className="cb-chart__cursor" style={{ left: `${xP(t)}%` }} /> : null}
        {inView(t) ? <span className="cb-chart__pt cb-chart__pt--a" style={{ left: `${xP(t)}%`, top: `${yP(hpPctAt(series, t, "a"))}%` }} /> : null}
        {inView(t) ? <span className="cb-chart__pt cb-chart__pt--b" style={{ left: `${xP(t)}%`, top: `${yP(hpPctAt(series, t, "b"))}%` }} /> : null}

        {hoverT != null && inView(hoverT) ? (
          <div className={`cb-tip ${xP(hoverT) > 60 ? "cb-tip--left" : ""}`} style={{ left: `${xP(hoverT)}%` }}>
            <div className="cb-tip__t">{Math.max(0, hoverT).toFixed(1)}s</div>
            <div className="cb-tip__row"><i className="cb-dot cb-dot--a" /><span>{nameA || "A"}</span><b>{fmtHpPct(hpPctAt(series, hoverT, "a"))}%</b></div>
            <div className="cb-tip__row"><i className="cb-dot cb-dot--b" /><span>{nameB || "B"}</span><b>{fmtHpPct(hpPctAt(series, hoverT, "b"))}%</b></div>
            {hovered ? <div className="cb-tip__ev">{hovered.side === "A" ? nameA : nameB}: {hovered.desc}{hovered.damage > 0 ? ` · ${Math.round(hovered.damage)} dmg` : ""}</div> : null}
          </div>
        ) : null}
      </div>
      <div className="cb-chart__x">
        {[0, 0.25, 0.5, 0.75, 1].map((f, i, arr) => (
          <span key={f} className={`cb-chart__tick${i === 0 ? " is-start" : i === arr.length - 1 ? " is-end" : ""}`} style={{ left: `${f * 100}%` }}>
            {Math.max(0, vStart + f * span).toFixed(1)}s
          </span>
        ))}
      </div>
    </div>
  );
}

// Activity lanes under the chart: per side, when each status/ability was
// active over the fight, on the same 0->endT time scale as the HP chart.
// Bars = active windows, diamonds = instantaneous triggers (procs).
function Lanes({ lanes, t, vStart, vEnd, nameA, nameB }: { lanes: ActivityLane[]; t: number; vStart: number; vEnd: number; nameA: string; nameB: string; }) {
  const span = Math.max(1e-6, vEnd - vStart);
  // Memoize the lane rows so playback (which only moves the cursor via --f)
  // doesn't rebuild every segment/point on every frame. Maps + clamps to the
  // visible (zoomed) window so it stays aligned with the chart above.
  const body = useMemo(() => {
    const xP = (tt: number) => ((tt - vStart) / span) * 100;
    const renderSide = (side: "A" | "B", name: string) => {
      const arr = lanes.filter((l) => l.side === side);
      if (arr.length === 0) return null;
      return (
        <div className="cb-lanes__side">
          <div className={`cb-lanes__side-name cb-lanes__side-name--${side === "A" ? "a" : "b"}`}>{name || side}</div>
          {arr.map((l) => (
            <div className="cb-lane" key={l.key}>
              <div className="cb-lane__label" title={`${l.label}${l.kind === "ability" ? " — ability" : " — status"}`}>{l.label}</div>
              <div className="cb-lane__track">
                {l.segments.map((s, i) => {
                  const l0 = xP(s.from);
                  const r0 = xP(s.to);
                  if (r0 <= 0 || l0 >= 100) return null;
                  const left = Math.max(0, l0);
                  const width = Math.max(0.6, Math.min(100, r0) - left);
                  return (
                    <span
                      key={`s${i}`}
                      className={`cb-lane__seg cb-lane__seg--${side === "A" ? "a" : "b"}${l.kind === "ability" ? " is-ability" : ""}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${l.label}: ${s.from.toFixed(1)}–${s.to.toFixed(1)}s`}
                    />
                  );
                })}
                {(l.accentSegments ?? []).map((s, i) => {
                  const l0 = xP(s.from);
                  const r0 = xP(s.to);
                  if (r0 <= 0 || l0 >= 100) return null;
                  const left = Math.max(0, l0);
                  const width = Math.max(0.6, Math.min(100, r0) - left);
                  return (
                    <span
                      key={`acc${i}`}
                      className={`cb-lane__seg cb-lane__seg--${side === "A" ? "a" : "b"} is-ability is-manual`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${l.label} (manually held): ${s.from.toFixed(1)}–${s.to.toFixed(1)}s`}
                    />
                  );
                })}
                {l.points.map((pt, i) => {
                  const x = xP(pt);
                  if (x < 0 || x > 100) return null;
                  return (
                    <span
                      key={`p${i}`}
                      className={`cb-lane__pt cb-lane__pt--${side === "A" ? "a" : "b"}`}
                      style={{ left: `${x}%` }}
                      title={`${l.label} triggered at ${pt.toFixed(1)}s`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      );
    };
    return (<>{renderSide("A", nameA)}{renderSide("B", nameB)}</>);
  }, [lanes, vStart, span, nameA, nameB]);

  if (lanes.length === 0 || vEnd <= vStart) return null;
  const f = (t - vStart) / span;
  return (
    <div className="cb-lanes">
      <div className="cb-lanes__head">
        <span className="cb-stage__title">Effects &amp; abilities over time</span>
        <span className="cb-lanes__legend">bar = active window · ◆ = trigger · dashed = ability</span>
      </div>
      <div className="cb-lanes__body" style={{ "--f": Math.max(0, Math.min(1, f)) } as CSSProperties}>
        {body}
        {f >= 0 && f <= 1 ? <span className="cb-lanes__cursor" /> : null}
      </div>
    </div>
  );
}

// Bold A-vs-B stat comparison: mirrored columns with the stat label centered,
// the better side highlighted, and a proportional bar per side. Replaces the
// two separate default StatCards as the lead of the breakdown (the cards stay
// available, collapsed, for the full per-creature detail). Reuses the same
// FinalStats the StatCards render, so nothing is lost.
function StatVersus({ a, b, nameA, nameB }: { a: FinalStats | null; b: FinalStats | null; nameA: string; nameB: string }) {
  if (!a || !b) return null;
  const n = (v: number | undefined | null): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const numeric: { label: string; a: number | null; b: number | null; betterHigh?: boolean; suffix?: string }[] = [
    { label: "HP", a: n(a.health), b: n(b.health), betterHigh: true },
    { label: "Damage", a: n(a.damage), b: n(b.damage), betterHigh: true },
    { label: "Weight", a: n(a.weight), b: n(b.weight) },
    { label: "Bite cooldown", a: n(a.biteCooldown), b: n(b.biteCooldown), betterHigh: false, suffix: "s" },
    { label: "HP regen", a: n(a.healthRegen), b: n(b.healthRegen), betterHigh: true },
  ];
  const text: { label: string; a: string; b: string }[] = [
    { label: "Tier", a: a.tier != null ? String(a.tier) : "—", b: b.tier != null ? String(b.tier) : "—" },
    { label: "Type", a: a.type ?? "—", b: b.type ?? "—" },
    { label: "Breath", a: a.hasBreath ? (a.breathType ?? "Yes") : "None", b: b.hasBreath ? (b.breathType ?? "Yes") : "None" },
    { label: "Elder", a: a.elder ?? "None", b: b.elder ?? "None" },
  ];
  const fmt = (v: number | null, suffix?: string) => (v == null ? "—" : `${Math.round(v * 100) / 100}${suffix ?? ""}`);
  // -1 = A better, 1 = B better, 0 = tie/n-a.
  const winner = (r: { a: number | null; b: number | null; betterHigh?: boolean }): number => {
    if (r.a == null || r.b == null || r.betterHigh == null || r.a === r.b) return 0;
    const aWins = r.betterHigh ? r.a > r.b : r.a < r.b;
    return aWins ? -1 : 1;
  };
  const barPct = (r: { a: number | null; b: number | null }, side: "a" | "b"): number => {
    const v = side === "a" ? r.a : r.b;
    if (v == null) return 0;
    const max = Math.max(Math.abs(r.a ?? 0), Math.abs(r.b ?? 0), 1e-6);
    return Math.max(0, Math.min(100, (Math.abs(v) / max) * 100));
  };
  return (
    <div className="cb-cmp">
      <div className="cb-cmp__head">
        <span className="cb-cmp__hname cb-cmp__hname--a">{nameA || "A"}</span>
        <span className="cb-cmp__htitle">vs</span>
        <span className="cb-cmp__hname cb-cmp__hname--b">{nameB || "B"}</span>
      </div>
      {numeric.map((r) => {
        const w = winner(r);
        return (
          <div className="cb-cmp__row" key={r.label}>
            <div className={`cb-cmp__cell cb-cmp__cell--a${w === -1 ? " is-better" : w === 1 ? " is-worse" : ""}`}>
              <b>{fmt(r.a, r.suffix)}</b>
              <i className="cb-cmp__bar cb-cmp__bar--a" style={{ width: `${barPct(r, "a")}%` }} />
            </div>
            <div className="cb-cmp__label">{r.label}</div>
            <div className={`cb-cmp__cell cb-cmp__cell--b${w === 1 ? " is-better" : w === -1 ? " is-worse" : ""}`}>
              <b>{fmt(r.b, r.suffix)}</b>
              <i className="cb-cmp__bar cb-cmp__bar--b" style={{ width: `${barPct(r, "b")}%` }} />
            </div>
          </div>
        );
      })}
      {text.map((r) => (
        <div className="cb-cmp__row cb-cmp__row--text" key={r.label}>
          <div className="cb-cmp__cell cb-cmp__cell--a"><b>{r.a}</b></div>
          <div className="cb-cmp__label">{r.label}</div>
          <div className="cb-cmp__cell cb-cmp__cell--b"><b>{r.b}</b></div>
        </div>
      ))}
    </div>
  );
}

type AbilityCoverageEntry = { name: string; status: string; detail?: string };

function fmtStat(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

// Beta-native per-creature sheet: side-accented identity header, stat tiles,
// and the full ability list as coverage-colored chips. Replaces the default
// StatCard inside the beta breakdown (the default page keeps StatCard); same
// data - final stats, air-rule cooldown override, temp-buff regen boost, and
// the lazy-loaded ability coverage - so nothing from the default is lost.
function CreatureSheet({ side, stats, getIcon, airRuleCooldownSec, activeTempBuffIds, onPick }: {
  side: "a" | "b";
  stats: FinalStats | null;
  getIcon: (name: string) => string | null;
  /** Effective bite cooldown when this side is on a fixed cadence, else null. */
  airRuleCooldownSec: number | null;
  activeTempBuffIds: readonly string[];
  onPick: () => void;
}) {
  const [coverage, setCoverage] = useState<AbilityCoverageEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!stats) {
      setCoverage([]);
      return;
    }
    void import("../optimizer/abilityCoverage")
      .then((module) => {
        if (cancelled) return;
        setCoverage(module.getAbilityCoverage(stats.name) as AbilityCoverageEntry[]);
      })
      .catch(() => {
        if (cancelled) return;
        setCoverage([]);
      });
    return () => {
      cancelled = true;
    };
  }, [stats]);
  if (!stats) return <div className="cb-sheet cb-sheet--empty">Select a creature.</div>;
  const airRule = typeof airRuleCooldownSec === "number";
  const tiles: { label: string; value: string; note?: string }[] = [
    { label: "HP", value: fmtStat(stats.health) },
    { label: "Damage", value: fmtStat(stats.damage) },
    { label: "Weight", value: fmtStat(stats.weight) },
    {
      label: "Bite cooldown",
      value: airRule ? `${fmtStat(airRuleCooldownSec)}s` : `${fmtStat(stats.biteCooldown)}s`,
      note: airRule ? `Air PvP rule — base ${fmtStat(stats.biteCooldown)}s ignored` : undefined,
    },
    {
      label: "HP regen",
      value: activeTempBuffIds.length > 0
        ? formatTempBuffHpRegen(stats.healthRegen, activeTempBuffIds)
        : fmtStat(stats.healthRegen),
    },
    { label: "Stam regen", value: fmtStat(stats.stamRegen) },
    { label: "Breath", value: stats.hasBreath ? (stats.breathType ?? "Yes") : "None" },
    { label: "Elder", value: stats.elder ?? "None" },
  ];
  return (
    <div className={`cb-sheet cb-sheet--${side}`}>
      <div className="cb-sheet__id">
        {/* Clickable creature identity - opens Setup on this side's tab, same
            as the scoreboard fighter + the action-bar matchup glyph. */}
        <button
          type="button"
          className="cb-sheet__pick"
          onClick={onPick}
          title={`Change Side ${side.toUpperCase()} creature`}
          aria-label={`Change Side ${side.toUpperCase()} creature (currently ${stats.name})`}
        >
          <IconImg src={getIcon(stats.name)} alt={stats.name} size={44} />
          <span className="cb-sheet__idtext">
            <span className="cb-sheet__name">{stats.name}</span>
            <span className="cb-sheet__sub">Tier {stats.tier}{stats.type ? ` · ${stats.type}` : ""}</span>
          </span>
        </button>
      </div>
      <div className="cb-sheet__stats">
        {tiles.map((t) => (
          <div className="cb-sheet__tile" key={t.label}>
            <span>{t.label}</span>
            <b>{t.value}</b>
            {t.note ? <small>{t.note}</small> : null}
          </div>
        ))}
      </div>
      {coverage.length > 0 ? (
        <div className="cb-sheet__abil">
          <div className="cb-sheet__abil-head">
            <span>Abilities</span>
            <span className="cb-sheet__abil-legend">
              <i className="cb-abil-dot cb-abil-dot--modeled" /> modeled
              <i className="cb-abil-dot cb-abil-dot--partial" /> partial
              <i className="cb-abil-dot cb-abil-dot--off" /> not modeled
            </span>
          </div>
          <div className="cb-sheet__abil-chips">
            {coverage.map((a) => {
              const val = a.detail ? compactAbilityDetail(a.name, a.detail) : "";
              return (
                <span
                  key={a.name}
                  className={`cb-abil cb-abil--${a.status}${val ? " cb-abil--has-val" : ""}`}
                  title={a.detail ? `${a.name} — ${a.status} · ${a.detail}` : `${a.name} — ${a.status}`}
                >
                  <span className="cb-abil__name">{a.name}</span>
                  {val ? <span className="cb-abil__val">{val}</span> : null}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Identity hero at the top of each creature Setup tab: big icon, the name
// input as the centerpiece, and live chips from the resolved final stats.
function SetupHero({ side, name, creatureNames, onNameChange, getIcon, final }: {
  side: "a" | "b";
  name: string;
  creatureNames: string[];
  onNameChange: (value: string) => void;
  getIcon: (name: string) => string | null;
  final: FinalStats | null;
}) {
  return (
    <div className={`cb-setup-hero cb-setup-hero--${side}`}>
      <div className="cb-setup-hero__icon"><IconImg src={getIcon(name)} alt={name} size={56} /></div>
      <div className="cb-setup-hero__main">
        <CreatureNameInput
          value={name}
          onChange={onNameChange}
          creatureNames={creatureNames}
          placeholder="Search creature…"
          ariaLabel={`Creature ${side.toUpperCase()} name`}
          className="cb-setup-hero__input"
        />
        <div className="cb-setup-hero__chips">
          {final ? (
            <>
              <span className="cb-chip">Tier {final.tier}</span>
              {final.type ? <span className="cb-chip">{final.type}</span> : null}
              <span className="cb-chip">{final.hasBreath ? (final.breathType ?? "Breath") : "No breath"}</span>
              {final.elder && final.elder !== "None" ? <span className="cb-chip cb-chip--elder" data-elder={final.elder}>Elder · {final.elder}</span> : null}
            </>
          ) : (
            <span className="cb-setup-hero__hint">Pick a creature to load its stats</span>
          )}
        </div>
      </div>
    </div>
  );
}

// One side of the always-visible quick-setup rail. Carries the CORE build
// fields (creature, veneration, ascension, elder, traits, plushies) for fast
// entry without opening the Setup overlay - the "classic was faster" path,
// restored. Deeper config (abilities, AI policy, starting state, buffs, timing,
// battle settings) is unchanged and still lives in the Setup modal, reached via
// the Advanced button. Reuses the exact same Build* selectors as the modal /
// classic card, so behavior is identical - only the placement is new.
function QuickRailSide({ side, label, name, build, creatureNames, getIcon, onNameChange, onBuildChange, onAdvanced }: {
  side: "a" | "b";
  label: string;
  name: string;
  build: BuildOptions;
  creatureNames: string[];
  getIcon: (name: string) => string | null;
  onNameChange: (value: string) => void;
  onBuildChange: (value: BuildOptions) => void;
  onAdvanced: () => void;
}) {
  return (
    <div className={`cb-qr__side cb-qr__side--${side}`}>
      <div className="cb-qr__id">
        <button
          type="button"
          className="cb-qr__icon"
          onClick={onAdvanced}
          aria-label={`Open full setup for ${label}`}
          title="Open full setup"
        >
          <IconImg src={getIcon(name)} alt={name} size={36} />
        </button>
        <CreatureNameInput
          value={name}
          onChange={onNameChange}
          creatureNames={creatureNames}
          placeholder="Search creature…"
          ariaLabel={`${label} name`}
          className="cb-qr__name"
        />
      </div>
      <div className="cb-qr__fields">
        <div className="cb-qr__field cb-qr__field--ven">
          <span className="cb-qr__fl">Veneration</span>
          <select
            aria-label={`${label} veneration stage`}
            value={build.venerationStage}
            onChange={(e) => onBuildChange({ ...build, venerationStage: Number(e.target.value) })}
          >
            {Array.from({ length: veneration.stages + 1 }, (_, i) => i).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div className="cb-qr__field cb-qr__field--asc">
          <span className="cb-qr__fl">Ascension</span>
          <AscensionSelectors build={build} onBuildChange={onBuildChange} />
        </div>
        <div className="cb-qr__field cb-qr__field--traits">
          <span className="cb-qr__fl">Traits</span>
          <TraitSelectors build={build} onBuildChange={onBuildChange} />
        </div>
        <div className="cb-qr__field cb-qr__field--plush">
          <span className="cb-qr__fl">Plushies</span>
          <PlushiePickerBeta build={build} onBuildChange={onBuildChange} />
        </div>
        <div className="cb-qr__field cb-qr__field--elder">
          <span className="cb-qr__fl">Elder</span>
          <ElderSelector build={build} onBuildChange={onBuildChange} showDeltaChips />
        </div>
      </div>
    </div>
  );
}

// A segmented two-way control (First death / Full fight). Reused, beta-native;
// replaces the legacy `compare-outcome-mode-switch` so the control isn't a
// re-skinned tab strip that sat crooked.
function ViewModeSeg({ mode, onChange }: { mode: CompareResultViewMode; onChange: (m: CompareResultViewMode) => void }) {
  const opts: { id: CompareResultViewMode; label: string }[] = [
    { id: "firstDeath", label: "First death" },
    { id: "fullFight", label: "Full fight" },
  ];
  return (
    <div className="cb-seg" role="tablist" aria-label="Result view">
      {opts.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={mode === o.id} className={`cb-seg__opt${mode === o.id ? " is-active" : ""}`} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

// Beta-native "Fight metrics": the rate stats that are naturally A->B vs B->A
// pairs (output, durability, time-to-kill), rendered as a mirrored A|label|B
// table with the stronger side highlighted + a proportional bar. Replaces the
// default SummaryCard's flat "Label: value" list. Reads the same getViewMetrics
// + summary fields the SummaryCard does, so the numbers are identical.
function FightMetrics({ summary, nameA, nameB, mode, onModeChange, dpsSettings }: {
  summary: SimulationSummary;
  nameA: string;
  nameB: string;
  mode: CompareResultViewMode;
  onModeChange: (m: CompareResultViewMode) => void;
  dpsSettings: CompareDpsSettings;
}) {
  const [copied, setCopied] = useState(false);
  const m = getViewMetrics(summary, mode, dpsSettings);
  const ehpAView = getViewEhp(summary, mode, "A");
  const ehpBView = getViewEhp(summary, mode, "B");
  const dpsLabel = dpsSettings?.denominator === "perBite" ? "Dmg / bite" : "DPS";
  const r1 = (v: number) => Math.round(v * 10) / 10;
  // TTK: time for the attacker to kill the defender; null death = no kill.
  const ttk = (val: number, death: number | null): string => (death == null ? "no kill" : `${r1(val)}s`);
  const ttkAlive = (death: number | null) => death == null;
  // Verdict header: the actual outcome the comparison table doesn't state -
  // who survives, with how much HP, and when the loser fell. Restores the old
  // Outcome panel's Winner / Winner Remaining HP / Loser Death Time metrics.
  const isWin = summary.winner === "A" || summary.winner === "B";
  const winName = summary.winner === "A" ? (nameA || "A") : (nameB || "B");
  const winSide = summary.winner === "A" ? "a" : "b";
  const winHp = summary.winner === "A" ? summary.hpAAtBDeath : summary.hpBAtADeath;
  const winMax = summary.winner === "A" ? summary.maxHpA : summary.maxHpB;
  const winPct = winMax > 0 ? Math.max(0, Math.min(100, (winHp / winMax) * 100)) : 0;
  const loserDeath = summary.winner === "A" ? summary.deathTimeB : summary.winner === "B" ? summary.deathTimeA : null;
  type Row = { label: string; a: number; b: number; betterHigh: boolean; fa: string; fb: string; aAlive?: boolean; bAlive?: boolean };
  const rows: Row[] = [
    { label: dpsLabel, a: m.dpsAtoB, b: m.dpsBtoA, betterHigh: true, fa: String(r1(m.dpsAtoB)), fb: String(r1(m.dpsBtoA)) },
    { label: "Damage dealt", a: m.damageDealtA, b: m.damageDealtB, betterHigh: true, fa: String(Math.round(m.damageDealtA)), fb: String(Math.round(m.damageDealtB)) },
    { label: "Effective HP", a: ehpAView, b: ehpBView, betterHigh: true, fa: String(Math.round(ehpAView)), fb: String(Math.round(ehpBView)) },
    {
      label: "Time to kill", a: summary.ttkAtoB, b: summary.ttkBtoA, betterHigh: false,
      fa: ttk(summary.ttkAtoB, summary.deathTimeB), fb: ttk(summary.ttkBtoA, summary.deathTimeA),
      aAlive: ttkAlive(summary.deathTimeB), bAlive: ttkAlive(summary.deathTimeA),
    },
  ];
  // -1 = A better, 1 = B, 0 = tie. A "no kill" TTK can never be the better one.
  const winner = (r: Row): number => {
    if (r.label === "Time to kill") {
      if (r.aAlive && r.bAlive) return 0;
      if (r.aAlive) return 1;
      if (r.bAlive) return -1;
    }
    if (r.a === r.b) return 0;
    const aWins = r.betterHigh ? r.a > r.b : r.a < r.b;
    return aWins ? -1 : 1;
  };
  const copy = () => {
    const lines = [
      `${nameA || "A"} vs ${nameB || "B"} — ${mode === "firstDeath" ? "First death" : "Full fight"}`,
      `${dpsLabel}: ${r1(m.dpsAtoB)} vs ${r1(m.dpsBtoA)}`,
      `Damage dealt: ${Math.round(m.damageDealtA)} vs ${Math.round(m.damageDealtB)}`,
      `Effective HP: ${Math.round(ehpAView)} vs ${Math.round(ehpBView)}`,
      `Time to kill: ${ttk(summary.ttkAtoB, summary.deathTimeB)} vs ${ttk(summary.ttkBtoA, summary.deathTimeA)}`,
      `Winner: ${summary.winner}`,
      `Winner HP left: ${isWin ? `${Math.round(winHp)} / ${Math.round(winMax)} (${Math.round(winPct)}%)` : "N/A"}`,
      `Loser death: ${loserDeath != null ? `${r1(loserDeath)}s` : "N/A"}`,
    ];
    void navigator.clipboard?.writeText(lines.join("\n"));
    // Optimistic feedback so the click always has a visible reaction, even if
    // the clipboard API is unavailable or silently rejects.
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="cb-fm">
      <div className="cb-fm__bar">
        <div className="cb-fm__title">Fight metrics</div>
        <div className="cb-fm__actions">
          <ViewModeSeg mode={mode} onChange={onModeChange} />
          <button type="button" className={`cb-fm__copy${copied ? " is-copied" : ""}`} onClick={copy} title="Copy metrics to clipboard">{copied ? "Copied!" : "Copy"}</button>
        </div>
      </div>
      {isWin ? (
        <div className={`cb-fm__verdict cb-fm__verdict--${winSide}`}>
          <div className="cb-fm__verdict-line">
            <span className="cb-fm__verdict-name">{winName}</span>
            <span className="cb-fm__verdict-sub">wins · {Math.round(winPct)}% HP left</span>
          </div>
          <div className="cb-fm__hpbar"><i style={{ width: `${winPct}%` }} /></div>
          <div className="cb-fm__verdict-meta">
            <span>{Math.round(winHp)} / {Math.round(winMax)} HP</span>
            {loserDeath != null ? <span>loser fell at {r1(loserDeath)}s</span> : null}
          </div>
        </div>
      ) : (
        <div className="cb-fm__verdict cb-fm__verdict--draw">
          <div className="cb-fm__verdict-line">
            <span className="cb-fm__verdict-name">Draw</span>
            <span className="cb-fm__verdict-sub">neither falls in time</span>
          </div>
        </div>
      )}
      <div className="cb-fm__table">
        <div className="cb-fm__trow cb-fm__trow--head">
          <span className="cb-fm__tlabel" />
          <span className="cb-fm__th cb-fm__th--a">{nameA || "A"}</span>
          <span className="cb-fm__th cb-fm__th--b">{nameB || "B"}</span>
        </div>
        {rows.map((r) => {
          const w = winner(r);
          return (
            <div className="cb-fm__trow" key={r.label}>
              <span className="cb-fm__tlabel">{r.label}</span>
              <span className="cb-fm__tval cb-fm__tval--a"><b className={w === -1 ? "is-better" : ""}>{r.fa}</b></span>
              <span className="cb-fm__tval cb-fm__tval--b"><b className={w === 1 ? "is-better" : ""}>{r.fb}</b></span>
            </div>
          );
        })}
      </div>
      <div className="cb-fm__note">{dpsLabel}: {describeDpsSettings(dpsSettings)}</div>
    </div>
  );
}

// Beta-native per-side combat breakdown (bites, breath, abilities used,
// effects at end, ailment damage). Replaces the default SideDetailsCard inside
// the beta page; reads the same getViewDetails so the figures match.
function CombatDetails({ summary, side, name, icon, mode }: {
  summary: SimulationSummary;
  side: "a" | "b";
  name: string;
  icon: string | null;
  mode: CompareResultViewMode;
}) {
  const d = getViewDetails(summary, mode, side === "a" ? "A" : "B");
  const abilities = (d.abilities ?? []).filter((e) => e.name !== "Breath");
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return (
    <div className={`cb-sheet cb-sheet--${side}`}>
      <div className="cb-sheet__id">
        <IconImg src={icon} alt={name} size={36} />
        <div className="cb-sheet__name">{name || (side === "a" ? "A" : "B")}</div>
      </div>
      <div className="cb-cd__top">
        <div className="cb-cd__metric">
          <span>Bites</span>
          <b>{d.biteCount}</b>
          {d.secondaryBiteCount > 0 ? <small>{d.primaryBiteCount} primary · {d.secondaryBiteCount} secondary</small> : null}
        </div>
        <div className="cb-cd__metric">
          <span>Breath time</span>
          <b>{r2(d.breathTimeSec)}s</b>
        </div>
      </div>
      <CombatDetailGroup title="Abilities used" empty="No active abilities used.">
        {abilities.map((e) => <span key={e.name} className="cb-cd__chip"><span>{e.name}</span><em>{e.count}</em></span>)}
      </CombatDetailGroup>
      <CombatDetailGroup title="Effects at end" empty="No effects active at end.">
        {d.finalEffects.map((e) => <span key={e.name} className="cb-cd__chip"><span>{e.name}</span><em>{r2(e.stacks)}</em></span>)}
      </CombatDetailGroup>
      <CombatDetailGroup title="Ailment damage taken" empty="No ailment damage taken.">
        {d.dotDamageBreakdown.map((e) => <span key={e.name} className="cb-cd__chip cb-cd__chip--dmg"><span>{e.name}</span><em>{Math.round(e.damage)}</em></span>)}
      </CombatDetailGroup>
    </div>
  );
}

function CombatDetailGroup({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;
  return (
    <div className="cb-cd__group">
      <div className="cb-cd__group-title">{title}</div>
      {isEmpty ? <div className="cb-cd__empty">{empty}</div> : <div className="cb-cd__chips">{items}</div>}
    </div>
  );
}

export default function ComparePageBeta(props: ComparePageBetaProps) {
  const {
    nameA, nameB, buildA, buildB, creatureA, creatureB, creatureNames,
    developerMode, getCreatureIcon,
    onNameAChange, onNameBChange, onBuildAChange, onBuildBChange,
  } = props;
  const c = useComparePageController(props);

  const series = useMemo(() => buildHpSeries(c.summary, c.resultViewMode), [c.summary, c.resultViewMode]);
  const lanes = useMemo(() => buildActivityLanes(c.summary, c.resultViewMode, series?.endT ?? 0), [c.summary, c.resultViewMode, series]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<"a" | "b" | "battle">("a");
  // Stable handlers so memoized children (Fighter) don't re-render every
  // playback frame just because an inline arrow prop changed identity.
  const openSetupA = useCallback(() => { setSetupTab("a"); setSetupOpen(true); }, []);
  const openSetupB = useCallback(() => { setSetupTab("b"); setSetupOpen(true); }, []);
  // True while the user is dragging the chart or the scrubber. Used to switch
  // the playhead/bars to instant tracking (no CSS easing) so manual scrubbing
  // follows the cursor exactly instead of floating behind it.
  const [scrubbing, setScrubbing] = useState(false);
  // Chart zoom window (null = full fight). Wheel zooms around the cursor,
  // Shift+wheel pans; the chart, playhead, markers, axis and lanes all rescale.
  const [view, setView] = useState<{ start: number; end: number } | null>(null);

  // Reset the playhead + zoom to the start (the pre-fight lead-in) whenever a
  // new simulation (or view mode) lands.
  useEffect(() => { setT(series?.preT ?? 0); setPlaying(false); setView(null); }, [series]);
  // Playback driven by requestAnimationFrame, advancing the playhead by the
  // real elapsed time x speed - so motion is buttery 60fps instead of the
  // chunky ~16fps fixed-step interval it used to be.
  useEffect(() => {
    if (!playing || !series) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (last === 0) last = now;
      const dt = (now - last) / 1000;
      last = now;
      setT((v) => {
        const n = v + dt * speed;
        return n >= series.endT ? series.endT : n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, series]);
  useEffect(() => { if (series && t >= series.endT && playing) setPlaying(false); }, [t, playing, series]);

  const endT = series?.endT ?? 0;
  const startT = series?.preT ?? 0;
  const vStart = view ? view.start : startT;
  const vEnd = view ? view.end : endT;
  const hpA = series ? hpPctAt(series, t, "a") : 100;
  const hpB = series ? hpPctAt(series, t, "b") : 100;
  // Live fight-state at the playhead, bucketed to 0.2s so playback doesn't
  // recompute the O(n) snapshot on every animation frame.
  const tBucket = Math.round(t * 5) / 5;
  const liveA = useMemo(() => liveSideAt(c.summary, lanes, "A", tBucket), [c.summary, lanes, tBucket]);
  const liveB = useMemo(() => liveSideAt(c.summary, lanes, "B", tBucket), [c.summary, lanes, tBucket]);
  const tierTypeA = c.finalA ? `Tier ${c.finalA.tier}${c.finalA.type ? ` · ${c.finalA.type}` : ""}` : creatureA?.stats ? `Tier ${creatureA.stats.tier}` : "—";
  const tierTypeB = c.finalB ? `Tier ${c.finalB.tier}${c.finalB.type ? ` · ${c.finalB.type}` : ""}` : creatureB?.stats ? `Tier ${creatureB.stats.tier}` : "—";


  // Single seek entry point: always pauses playback and clamps to the fight
  // (including the pre-fight lead-in).
  const seek = (tt: number) => {
    setPlaying(false);
    setT(series ? Math.max(series.preT, Math.min(series.endT, +tt.toFixed(2))) : 0);
  };
  // Jump the playhead to the previous / next key-moment marker.
  const jumpEvent = (dir: 1 | -1) => {
    if (!series) return;
    const times = series.events.filter((e) => e.marker).map((e) => e.t);
    const target = dir > 0 ? times.find((x) => x > t + 1e-3) : [...times].reverse().find((x) => x < t - 1e-3);
    if (target != null) seek(target);
  };
  // Custom scrubber (replaces the native range input, whose thumb can't reach
  // the track ends): map a pointer x to a fight time.
  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubDragRef = useRef(false);
  // Cached for the drag (see plotRectRef): avoids a getBoundingClientRect()
  // forced layout on every pointermove of the full-width scrubber.
  const scrubRectRef = useRef<DOMRect | null>(null);
  const seekFromScrub = (clientX: number) => {
    const el = scrubRef.current;
    if (!el || !series) return;
    const r = (scrubDragRef.current && scrubRectRef.current) || el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    seek(series.preT + f * (series.endT - series.preT));
  };

  // The whole detailed breakdown (stats, summary, and especially the large
  // CompareBattleDetails timeline) is memoized on its real data deps - NOT on
  // the playhead `t`. So scrubbing/playing never re-renders this heavy subtree;
  // only the playhead-bound chart/HUD/scrubber update each frame.
  const breakdown = useMemo(() => (
    <div className="cb-results">
      <div className="cb-results__head">
        <span className="cb-results__title">Detailed breakdown</span>
        <span className="cb-results__hint">Full stats, summary &amp; timeline.</span>
      </div>
      <StatVersus a={c.finalA} b={c.finalB} nameA={nameA} nameB={nameB} />
      {c.summary ? (
        <FightMetrics
          summary={c.summary}
          nameA={nameA}
          nameB={nameB}
          mode={c.resultViewMode}
          onModeChange={c.setResultViewMode}
          dpsSettings={c.compareDpsSettings}
        />
      ) : null}
      <details className="cb-rawcards" open>
        <summary>Per-creature build &amp; abilities</summary>
        <div className="cb-sheets">
          <CreatureSheet
            side="a"
            stats={c.finalA}
            getIcon={getCreatureIcon}
            airRuleCooldownSec={fixedCadenceFor(c.compareAirRuleEnabled, c.compareAirRuleCooldownSec)}
            activeTempBuffIds={[c.compareBuffsA.muddy ? "Muddy_Status" : null, c.compareBuffsA.cleanWater ? "Clean_Water_Status" : null, c.compareBuffsA.refreshed ? "Refreshed_Status" : null].filter((id): id is string => id != null)}
            onPick={() => { setSetupTab("a"); setSetupOpen(true); }}
          />
          <CreatureSheet
            side="b"
            stats={c.finalB}
            getIcon={getCreatureIcon}
            airRuleCooldownSec={fixedCadenceFor(
              c.compareAirRuleEnabled,
              c.compareAirRuleCooldownLinked ? c.compareAirRuleCooldownSec : c.compareAirRuleCooldownSecB,
            )}
            activeTempBuffIds={[c.compareBuffsB.muddy ? "Muddy_Status" : null, c.compareBuffsB.cleanWater ? "Clean_Water_Status" : null, c.compareBuffsB.refreshed ? "Refreshed_Status" : null].filter((id): id is string => id != null)}
            onPick={() => { setSetupTab("b"); setSetupOpen(true); }}
          />
        </div>
      </details>
      {c.summary ? (
        <div className="cb-cd-wrap">
          <div className="cb-cd-head">Combat breakdown</div>
          <div className="cb-sheets">
            <CombatDetails summary={c.summary} side="a" name={nameA} icon={getCreatureIcon(nameA)} mode={c.resultViewMode} />
            <CombatDetails summary={c.summary} side="b" name={nameB} icon={getCreatureIcon(nameB)} mode={c.resultViewMode} />
          </div>
        </div>
      ) : null}
      <CompareBattleDetails summary={c.summary} nameA={nameA} nameB={nameB} needsCalc={c.needsCalc} resultViewMode={c.resultViewMode} hideSideDetails />
    </div>
  ), [
    c.summary, c.finalA, c.finalB, c.needsCalc, c.resultViewMode, c.setResultViewMode,
    c.compareDpsSettings, c.compareAirRuleEnabled, c.compareAirRuleCooldownSec, c.compareBuffsA, c.compareBuffsB,
    nameA, nameB, getCreatureIcon, setSetupTab, setSetupOpen,
  ]);

  return (
    <section className={`cb${playing ? " is-playing" : ""}${scrubbing ? " is-scrubbing" : ""}`}>
      {/* Quick-setup rail - the always-visible fast path: a top header carries
          the matchup identity + actions (Setup / Battle / Run), and the two
          creature columns sit below as separate bordered panels (a divider, not
          a fused table - user-chosen). Restores the classic "fill in under a
          minute, both creatures visible" UX on top of the beta look; the Setup
          modal is unchanged and still owns the deep config. */}
      <div className="cb-qr">
        <div className="cb-qr__head">
          <button type="button" className="cb-qr__glyph" onClick={() => { setSetupTab("a"); setSetupOpen(true); }} title="Edit the matchup">
            <span className="cb-qr__tick" aria-hidden="true" />
            <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={26} />
            <span className="cb-qr__glyph-name">{nameA || "Creature A"}</span>
            <span className="cb-qr__glyph-vs">vs</span>
            <span className="cb-qr__glyph-name">{nameB || "Creature B"}</span>
            <IconImg src={getCreatureIcon(nameB)} alt={nameB} size={26} />
          </button>
          <span className="cb-qr__head-sep" />
          <button type="button" className="cb-ghostbtn cb-qr__hbtn" onClick={() => { setSetupTab("battle"); setSetupOpen(true); }}>
            <Settings2 size={14} strokeWidth={2} aria-hidden="true" /> Battle settings
          </button>
          <button className="cb-runbtn" onClick={() => void c.calculate()} disabled={c.isCalculating}>
            {c.isCalculating ? `Running… ${(c.calcElapsedMs / 1000).toFixed(1)}s` : "Run fight"}
          </button>
        </div>
        <div className="cb-qr__cols">
          <QuickRailSide
            side="a"
            label="Creature A"
            name={nameA}
            build={buildA}
            creatureNames={creatureNames}
            getIcon={getCreatureIcon}
            onNameChange={onNameAChange}
            onBuildChange={onBuildAChange}
            onAdvanced={() => { setSetupTab("a"); setSetupOpen(true); }}
          />
          <QuickRailSide
            side="b"
            label="Creature B"
            name={nameB}
            build={buildB}
            creatureNames={creatureNames}
            getIcon={getCreatureIcon}
            onNameChange={onNameBChange}
            onBuildChange={onBuildBChange}
            onAdvanced={() => { setSetupTab("b"); setSetupOpen(true); }}
          />
        </div>
      </div>

      {series ? (
        <>
          <div className="cb-hud">
            <Fighter side="a" name={nameA} tierType={tierTypeA} iconUrl={getCreatureIcon(nameA)} hpPct={hpA} maxHp={c.summary?.maxHpA ?? c.finalA?.health ?? 0} live={liveA} won={c.summary?.winner === "A"} onPick={openSetupA} />
            <div className="cb-hud__center"><div className="cb-hud__t">{Math.max(0, t).toFixed(1)}<em>s</em></div><div className="cb-hud__lead">{t < 0 ? "ready to fight" : `${hpA >= hpB ? nameA : nameB} ahead`}</div></div>
            <Fighter side="b" name={nameB} tierType={tierTypeB} iconUrl={getCreatureIcon(nameB)} hpPct={hpB} maxHp={c.summary?.maxHpB ?? c.finalB?.health ?? 0} live={liveB} won={c.summary?.winner === "B"} onPick={openSetupB} />
          </div>

          <div className="cb-stage">
            <div className="cb-stage__head">
              <span className="cb-stage__title">Health over time</span>
              <div className="cb-stage__head-right">
                <div className="cb-legend"><span><i className="cb-dot cb-dot--a" /> {nameA}</span><span><i className="cb-dot cb-dot--b" /> {nameB}</span></div>
                {view ? (
                  <button className="cb-zoom-reset" type="button" onClick={() => setView(null)} title="Reset zoom">Reset zoom</button>
                ) : (
                  <span className="cb-zoom-hint">scroll to zoom</span>
                )}
              </div>
            </div>
            <FightChart series={series} t={t} onSeek={seek} onScrub={setScrubbing} vStart={vStart} vEnd={vEnd} onView={setView} nameA={nameA} nameB={nameB} />
            <div className="cb-transport">
              <button className="cb-icon" title="Restart" aria-label="Restart" onClick={() => seek(startT)}><SkipBack size={16} strokeWidth={2} /></button>
              <button className="cb-icon" title="Previous event" aria-label="Previous event" onClick={() => jumpEvent(-1)}><ChevronLeft size={18} strokeWidth={2} /></button>
              <button className="cb-play" title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"} onClick={() => { if (t >= endT) setT(startT); setPlaying((p) => !p); }}>{playing ? <Pause size={18} strokeWidth={2.2} /> : <Play size={18} strokeWidth={2.2} />}</button>
              <button className="cb-icon" title="Next event" aria-label="Next event" onClick={() => jumpEvent(1)}><ChevronRight size={18} strokeWidth={2} /></button>
              <span className="cb-time">{Math.max(0, t).toFixed(1)}<em> / {endT.toFixed(1)}s</em></span>
              <div
                className="cb-scrub"
                ref={scrubRef}
                role="slider"
                aria-label="Playback position"
                aria-valuemin={Math.round(startT * 10) / 10}
                aria-valuemax={Math.round(endT * 10) / 10}
                aria-valuenow={Math.round(t * 10) / 10}
                tabIndex={0}
                onPointerDown={(e) => { scrubDragRef.current = true; scrubRectRef.current = scrubRef.current?.getBoundingClientRect() ?? null; setScrubbing(true); e.currentTarget.setPointerCapture(e.pointerId); seekFromScrub(e.clientX); }}
                onPointerMove={(e) => { if (scrubDragRef.current) seekFromScrub(e.clientX); }}
                onPointerUp={(e) => { scrubDragRef.current = false; scrubRectRef.current = null; setScrubbing(false); try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* no capture */ } }}
                onKeyDown={(e) => { const step = (endT - startT) / 50; if (e.key === "ArrowLeft") { seek(Math.max(startT, t - step)); e.preventDefault(); } else if (e.key === "ArrowRight") { seek(Math.min(endT, t + step)); e.preventDefault(); } }}
              >
                <div className="cb-scrub__fill" style={{ width: `${endT > startT ? ((t - startT) / (endT - startT)) * 100 : 0}%` }} />
                <div className="cb-scrub__thumb" style={{ left: `${endT > startT ? ((t - startT) / (endT - startT)) * 100 : 0}%` }} />
              </div>
              <div className="cb-speed" role="group" aria-label="Playback speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" className={`cb-speed__opt${speed === s ? " is-active" : ""}`} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>
                ))}
              </div>
            </div>
          </div>

          <Lanes lanes={lanes} t={t} vStart={vStart} vEnd={vEnd} nameA={nameA} nameB={nameB} />
        </>
      ) : (
        <div className="cb-empty">{c.isCalculating ? `Running simulation… ${(c.calcElapsedMs / 1000).toFixed(1)}s` : "Press “Run fight” to simulate the matchup and watch it play out."}</div>
      )}

      {/* Full breakdown - memoized (see `breakdown` above) so playback never
          re-renders the heavy stats/summary/timeline subtree. */}
      {breakdown}

      {/* Setup overlay - portaled to <body> so position:fixed is viewport-
          relative regardless of ancestor transforms/animations (the page's
          entrance animation otherwise creates a containing block). */}
      {setupOpen ? createPortal(
        <div className="beta-portal">
          <div className="cb-scrim" onClick={() => setSetupOpen(false)} />
          <aside className="cb-modal" role="dialog" aria-label="Setup" aria-modal="true">
            <div className="cb-modal__head">
              <h3>Setup</h3>
              <div className="cb-modal__head-actions">
                <button className="cb-runbtn" onClick={() => { void c.calculate(); setSetupOpen(false); }} disabled={c.isCalculating}>{c.isCalculating ? `Running… ${(c.calcElapsedMs / 1000).toFixed(1)}s` : "Run fight"}</button>
                <button className="cb-icon" aria-label="Close setup" onClick={() => setSetupOpen(false)}><X size={16} strokeWidth={2} /></button>
              </div>
            </div>
            <div className="cb-modal__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={setupTab === "a"} className={`cb-modal__tab cb-modal__tab--a${setupTab === "a" ? " is-active" : ""}`} onClick={() => setSetupTab("a")}>
                <IconImg src={getCreatureIcon(nameA)} alt="" size={20} />
                <span>{nameA || "Creature A"}</span>
              </button>
              <button type="button" role="tab" aria-selected={setupTab === "b"} className={`cb-modal__tab cb-modal__tab--b${setupTab === "b" ? " is-active" : ""}`} onClick={() => setSetupTab("b")}>
                <IconImg src={getCreatureIcon(nameB)} alt="" size={20} />
                <span>{nameB || "Creature B"}</span>
              </button>
              <button type="button" role="tab" aria-selected={setupTab === "battle"} className={`cb-modal__tab${setupTab === "battle" ? " is-active" : ""}`} onClick={() => setSetupTab("battle")}>
                <Settings2 size={15} strokeWidth={2} aria-hidden="true" />
                <span>Battle settings</span>
              </button>
            </div>
            <div className="cb-modal__body">
              <div className="cb-tabpane cb-tabpane--creature cb-tabpane--a" hidden={setupTab !== "a"}>
              <SetupHero side="a" name={nameA} creatureNames={creatureNames} onNameChange={onNameAChange} getIcon={getCreatureIcon} final={c.finalA} />
              <CreatureSelectorCard
                label="Creature A" name={nameA} creatureNames={creatureNames} creature={creatureA} getIcon={getCreatureIcon}
                onNameChange={onNameAChange} build={buildA} onBuildChange={onBuildAChange} hideIdentity elderDeltaChips betaPlushiePicker
                specialAbilities={c.specialAbilitiesA} onSpecialAbilitiesChange={c.setSpecialAbilitiesA}
                compareBiteVariantMode={c.compareBiteVariantModeA} onCompareBiteVariantModeChange={c.setCompareBiteVariantModeA}
                userAbilityLevels={c.compareUserAbilityLevelsA} onUserAbilityLevelsChange={c.setCompareUserAbilityLevelsA}
                posturePolicy={c.comparePosturePolicyA} onPosturePolicyChange={c.setComparePosturePolicyA}
                breathPolicy={c.compareBreathPolicyA} onBreathPolicyChange={c.setCompareBreathPolicyA}
              />
              </div>
              <div className="cb-tabpane cb-tabpane--creature cb-tabpane--b" hidden={setupTab !== "b"}>
              <SetupHero side="b" name={nameB} creatureNames={creatureNames} onNameChange={onNameBChange} getIcon={getCreatureIcon} final={c.finalB} />
              <CreatureSelectorCard
                label="Creature B" name={nameB} creatureNames={creatureNames} creature={creatureB} getIcon={getCreatureIcon}
                onNameChange={onNameBChange} build={buildB} onBuildChange={onBuildBChange} hideIdentity elderDeltaChips betaPlushiePicker
                specialAbilities={c.specialAbilitiesB} onSpecialAbilitiesChange={c.setSpecialAbilitiesB}
                compareBiteVariantMode={c.compareBiteVariantModeB} onCompareBiteVariantModeChange={c.setCompareBiteVariantModeB}
                userAbilityLevels={c.compareUserAbilityLevelsB} onUserAbilityLevelsChange={c.setCompareUserAbilityLevelsB}
                posturePolicy={c.comparePosturePolicyB} onPosturePolicyChange={c.setComparePosturePolicyB}
                breathPolicy={c.compareBreathPolicyB} onBreathPolicyChange={c.setCompareBreathPolicyB}
              />
              </div>
              <div className="cb-tabpane cb-tabpane--battle" hidden={setupTab !== "battle"}>
              <BattleSettingsPanel
                creatureA={creatureA} creatureB={creatureB}
                activesOn={c.activesOn} breathOn={c.breathOn} debugMode={c.debugMode} developerMode={developerMode}
                compareAbilityPolicy={c.compareAbilityPolicy}
                compareAbilityPolicyOverridesA={c.compareAbilityPolicyOverridesA} compareAbilityPolicyOverridesB={c.compareAbilityPolicyOverridesB}
                compareUserAbilityOverridesA={c.compareUserAbilityOverridesA} compareUserAbilityOverridesB={c.compareUserAbilityOverridesB}
                badOmenChoice={c.badOmenChoice} badOmenOutcomes={badOmenOutcomes}
                finalA={c.finalA} finalB={c.finalB}
                disabledAbilitiesA={c.disabledAbilitiesA} disabledAbilitiesB={c.disabledAbilitiesB}
                compareBuffsA={c.compareBuffsA} compareBuffsB={c.compareBuffsB}
                compareDayNight={c.compareDayNight} compareMoon={c.compareMoon} compareSeason={c.compareSeason} onCompareSeasonChange={c.setCompareSeason} compareWeather={c.compareWeather}
                compareOxygenMoistureMode={c.compareOxygenMoistureMode}
                compareDpsSettings={c.compareDpsSettings}
                compareAirRuleEnabled={c.compareAirRuleEnabled} compareAirRuleCooldownSec={c.compareAirRuleCooldownSec}
                compareAirRuleCooldownSecB={c.compareAirRuleCooldownSecB} compareAirRuleCooldownLinked={c.compareAirRuleCooldownLinked}
                compareAerialDodgeEnabled={c.compareAerialDodgeEnabled} compareAerialDodgeHitChancePctA={c.compareAerialDodgeHitChancePctA} compareAerialDodgeHitChancePctB={c.compareAerialDodgeHitChancePctB} compareAerialDodgeRollStyle={c.compareAerialDodgeRollStyle}
                compareNoMoveFacetank={c.compareNoMoveFacetank}
                compareFirstTickMode={c.compareFirstTickMode} compareFirstTickDelaySec={c.compareFirstTickDelaySec}
                needsCalc={c.needsCalc}
                onActivesOnChange={c.setActivesOn} onBreathOnChange={c.setBreathOn} onDebugModeChange={c.setDebugMode}
                onCompareAbilityPolicyChange={c.setCompareAbilityPolicy}
                onCompareAbilityPolicyOverridesAChange={c.setCompareAbilityPolicyOverridesA}
                onCompareAbilityPolicyOverridesBChange={c.setCompareAbilityPolicyOverridesB}
                onCompareUserAbilityOverridesAChange={c.setCompareUserAbilityOverridesA}
                onCompareUserAbilityOverridesBChange={c.setCompareUserAbilityOverridesB}
                onBadOmenChoiceChange={c.setBadOmenChoice}
                onDisabledAbilitiesAChange={c.setDisabledAbilitiesA} onDisabledAbilitiesBChange={c.setDisabledAbilitiesB}
                onCompareBuffsAChange={c.setCompareBuffsA} onCompareBuffsBChange={c.setCompareBuffsB}
                onCompareDayNightChange={c.setCompareDayNight} onCompareMoonChange={c.setCompareMoon} onCompareWeatherChange={c.setCompareWeather}
                onCompareOxygenMoistureModeChange={c.setCompareOxygenMoistureMode}
                onCompareDpsSettingsChange={c.setCompareDpsSettings}
                onCompareAirRuleEnabledChange={c.setCompareAirRuleEnabled} onCompareAirRuleCooldownSecChange={c.setCompareAirRuleCooldownSec}
                onCompareAirRuleCooldownSecBChange={c.setCompareAirRuleCooldownSecB} onCompareAirRuleCooldownLinkedChange={c.setCompareAirRuleCooldownLinked}
                onCompareAerialDodgeEnabledChange={c.setCompareAerialDodgeEnabled} onCompareAerialDodgeHitChancePctAChange={c.setCompareAerialDodgeHitChancePctA} onCompareAerialDodgeHitChancePctBChange={c.setCompareAerialDodgeHitChancePctB} onCompareAerialDodgeRollStyleChange={c.setCompareAerialDodgeRollStyle}
                onCompareNoMoveFacetankChange={c.setCompareNoMoveFacetank}
                onCompareFirstTickModeChange={c.setCompareFirstTickMode} onCompareFirstTickDelaySecChange={c.setCompareFirstTickDelaySec}
                onCalculate={() => void c.calculate()}
                isCalculating={c.isCalculating} calcElapsedMs={c.calcElapsedMs}
              />
              </div>
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
