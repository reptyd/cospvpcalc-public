import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { UserTimingSpec, Expr } from "../../shared/customAbilityTypes";
import { parseExpr, printExpr } from "../../shared/exprDsl";
import {
  inferTimingStrategy,
  type TimingStrategy,
} from "../../shared/customTimingTemplates";

/** Module-level drag payload for palette tiles. Tiles store an
 * `apply` callback that, when invoked, mutates the spec via the
 * editor's update function. The workspace drop target invokes the
 * payload's apply on drop. */
type TimingDragPayload = { apply: () => void };
let activeTimingDrag: TimingDragPayload | null = null;
const TIMING_DRAG_MIME = "application/x-cos-timing-tile";

function setTimingDrag(e: DragEvent, payload: TimingDragPayload) {
  activeTimingDrag = payload;
  try {
    e.dataTransfer.setData(TIMING_DRAG_MIME, "1");
    e.dataTransfer.effectAllowed = "copy";
  } catch {
    // Safari edge - payload still travels via the ref.
  }
}

function clearTimingDrag() {
  activeTimingDrag = null;
}

/**
 * Visual editor for UserTimingSpec - same Scratch-style block
 * aesthetic as AbilityVisualEditor. The spec renders as a single
 * colored stack: a yellow hat labels the timing, an orange
 * strategy block picks the high-level pattern, and the rest of
 * the stack is the strategy's parameter blocks (cyan for delays /
 * horizon, purple for fire-when / skip-when conditions, gray for
 * preview).
 *
 * Source-of-truth stays in the parent text buffer; we read `spec`
 * and emit `onChange(nextSpec)`.
 */
export function TimingVisualEditor({
  spec,
  onChange,
}: {
  spec: UserTimingSpec;
  onChange: (next: UserTimingSpec) => void;
}): ReactNode {
  const inferred = inferTimingStrategy(spec);
  const [localStrategy, setLocalStrategy] = useState<TimingStrategy | null>(null);
  const strategy: TimingStrategy = localStrategy ?? inferred;

  const update = (patch: Partial<UserTimingSpec>) => onChange({ ...spec, ...patch });

  const switchStrategy = (next: TimingStrategy) => {
    setLocalStrategy(next);
    if (next === "always-ready") {
      onChange({
        ...spec,
        candidates: [0],
        horizon_sec: spec.horizon_sec || 1,
        threshold: 0,
        force_fire: { kind: "const", value: 1 },
        force_skip: undefined,
      });
    } else if (next === "conditional") {
      onChange({
        ...spec,
        candidates: [0],
        horizon_sec: spec.horizon_sec || 2,
        threshold: 0,
        force_fire: spec.force_fire ?? {
          kind: "bin",
          op: "lt",
          left: { kind: "var", path: "self.hp_ratio" },
          right: { kind: "const", value: 0.3 },
        },
        force_skip: undefined,
      });
    } else if (next === "future-look") {
      onChange({
        ...spec,
        candidates:
          spec.candidates.length > 1 ? spec.candidates : [0, 0.5, 1, 2, 5],
        horizon_sec: spec.horizon_sec || 15,
        threshold: spec.threshold ?? 0.001,
        force_fire: undefined,
        force_skip: undefined,
      });
    } else if (next === "hybrid") {
      onChange({
        ...spec,
        candidates:
          spec.candidates.length > 1 ? spec.candidates : [0, 0.5, 1, 2, 5],
        horizon_sec: spec.horizon_sec || 12,
        threshold: spec.threshold ?? 0.001,
        force_fire: spec.force_fire,
        force_skip: spec.force_skip,
      });
    }
  };

  return (
    <div className="scratch">
      <div className="scratch-strip">
        <div className="scratch-strip-row">
          <SmallField label="ID">
            <input
              className="scratch-input"
              value={spec.id}
              onChange={(e) => update({ id: e.target.value })}
              placeholder="user.my_timing"
            />
          </SmallField>
          <SmallField label="Display name">
            <input
              className="scratch-input"
              value={spec.display_name}
              onChange={(e) => update({ display_name: e.target.value })}
              placeholder="My Timing"
            />
          </SmallField>
        </div>
      </div>

      <div className="scratch-main">
        <div className="scratch-palette">
          <PaletteSection title="Strategies - pick one" className="cat-trigger">
            {STRATEGY_PRESETS.map((s) => (
              <DraggablePaletteTile
                key={s.id}
                className={`scratch-palette-block scratch-palette-hat cat-trigger ${strategy === s.id ? "is-current" : ""}`}
                title={s.blurb}
                apply={() => switchStrategy(s.id)}
              >
                {s.title}
              </DraggablePaletteTile>
            ))}
          </PaletteSection>

          <PaletteSection title="Candidate-set presets" className="cat-cooldown">
            {CANDIDATE_SET_PRESETS.map((preset) => (
              <DraggablePaletteTile
                key={preset.label}
                className="scratch-palette-block cat-cooldown"
                title={preset.description}
                apply={() => update({ candidates: [...preset.values] })}
              >
                {preset.label}
              </DraggablePaletteTile>
            ))}
          </PaletteSection>

          <PaletteSection title="Horizon presets" className="cat-cooldown">
            {HORIZON_PRESETS.map((preset) => (
              <DraggablePaletteTile
                key={preset.value}
                className="scratch-palette-block cat-cooldown"
                title={preset.description}
                apply={() => update({ horizon_sec: preset.value })}
              >
                {preset.label}
              </DraggablePaletteTile>
            ))}
          </PaletteSection>

          <PaletteSection title="Threshold presets" className="cat-cooldown">
            {THRESHOLD_PRESETS.map((preset) => (
              <DraggablePaletteTile
                key={preset.label}
                className="scratch-palette-block cat-cooldown"
                title={preset.description}
                apply={() => update({ threshold: preset.value })}
              >
                {preset.label}
              </DraggablePaletteTile>
            ))}
          </PaletteSection>

          <PaletteSection title="Conditions: HP" className="cat-status">
            {HP_CONDITION_TEMPLATES.map((tpl) => (
              <DraggablePaletteTile
                key={tpl.label}
                className="scratch-palette-block cat-status"
                title="Click or drag onto the stack to set 'fire only when'"
                apply={() => update({ force_fire: tpl.build() })}
              >
                {tpl.label}
              </DraggablePaletteTile>
            ))}
          </PaletteSection>

          <PaletteSection title="Conditions: combat state" className="cat-status">
            {COMBAT_CONDITION_TEMPLATES.map((tpl) => (
              <DraggablePaletteTile
                key={tpl.label}
                className="scratch-palette-block cat-status"
                title="Click or drag onto the stack to set 'fire only when'"
                apply={() => update({ force_fire: tpl.build() })}
              >
                {tpl.label}
              </DraggablePaletteTile>
            ))}
          </PaletteSection>

          <PaletteSection title="Conditions: time / phase" className="cat-status">
            {TIME_CONDITION_TEMPLATES.map((tpl) => (
              <DraggablePaletteTile
                key={tpl.label}
                className="scratch-palette-block cat-status"
                title="Click or drag onto the stack to set 'fire only when'"
                apply={() => update({ force_fire: tpl.build() })}
              >
                {tpl.label}
              </DraggablePaletteTile>
            ))}
          </PaletteSection>

          <PaletteSection title="Skip-when patterns" className="cat-state">
            {SKIP_CONDITION_TEMPLATES.map((tpl) => (
              <DraggablePaletteTile
                key={tpl.label}
                className="scratch-palette-block cat-state"
                title="Click or drag onto the stack to set 'skip when'"
                apply={() => update({ force_skip: tpl.build() })}
              >
                {tpl.label}
              </DraggablePaletteTile>
            ))}
          </PaletteSection>
        </div>

        <TimingWorkspace>
          <div className="scratch-stack is-focused">
            <div className="scratch-block scratch-block-hat cat-trigger">
              <span className="scratch-block-text">
                this timing controls the ability
              </span>
            </div>

            <div className="scratch-block scratch-block-stack cat-state">
              <span className="scratch-block-chunk">
                <Lbl>strategy:</Lbl>
                <select
                  className="scratch-slot scratch-slot-select"
                  value={strategy}
                  onChange={(e) => switchStrategy(e.target.value as TimingStrategy)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {STRATEGY_PRESETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </span>
            </div>

            {/* Strategy-specific parameter blocks */}
            {strategy === "always-ready" ? (
              <AlwaysReadyBlocks spec={spec} update={update} />
            ) : null}
            {strategy === "conditional" ? (
              <ConditionalBlocks spec={spec} update={update} />
            ) : null}
            {strategy === "future-look" ? (
              <FutureLookBlocks spec={spec} update={update} />
            ) : null}
            {strategy === "hybrid" ? (
              <HybridBlocks spec={spec} update={update} />
            ) : null}
            {strategy === "custom" ? (
              <CustomBlocks spec={spec} update={update} />
            ) : null}

            <PreviewBlock spec={spec} strategy={strategy} />
          </div>
        </TimingWorkspace>
      </div>
    </div>
  );
}

/** Workspace drop target for timing palette tiles. The whole
 * workspace catches drops and invokes the dragged tile's apply()
 * - exact position inside the workspace doesn't matter since
 * timing parameters are positional, not list-ordered. We add a
 * visible glow on dragover so the user gets feedback during the
 * drag (before this fix, dragover gave no visual cue). */
function TimingWorkspace({ children }: { children: ReactNode }): ReactNode {
  const [hovering, setHovering] = useState(false);
  return (
    <div
      className={`scratch-workspace ${hovering ? "is-dragover" : ""}`}
      onDragOver={(e) => {
        if (!activeTimingDrag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!hovering) setHovering(true);
      }}
      onDragLeave={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !(e.currentTarget as Node).contains(next)) {
          setHovering(false);
        }
      }}
      onDrop={(e) => {
        if (!activeTimingDrag) return;
        e.preventDefault();
        activeTimingDrag.apply();
        clearTimingDrag();
        setHovering(false);
      }}
    >
      {children}
    </div>
  );
}

// ── Strategy presets ─────────────────────────────────────────────

const STRATEGY_PRESETS: Array<{
  id: TimingStrategy;
  title: string;
  blurb: string;
}> = [
  {
    id: "always-ready",
    title: "always when ready",
    blurb: "Fire as soon as the ability is available.",
  },
  {
    id: "conditional",
    title: "conditional",
    blurb: "Fire only when a specific condition is met.",
  },
  {
    id: "future-look",
    title: "future-look",
    blurb: "Score future delays and pick the best moment.",
  },
  {
    id: "hybrid",
    title: "hybrid",
    blurb: "Future-look + force-fire/skip overrides.",
  },
  {
    id: "custom",
    title: "custom",
    blurb: "Tweak every field by hand.",
  },
];

// ── Strategy-specific block groups ───────────────────────────────

function AlwaysReadyBlocks({
  spec,
  update,
}: {
  spec: UserTimingSpec;
  update: (patch: Partial<UserTimingSpec>) => void;
}): ReactNode {
  return (
    <div className="scratch-block scratch-block-stack cat-heal">
      <span className="scratch-block-chunk">
        <Lbl>fire as soon as the ability is available</Lbl>
      </span>
      {spec.force_fire && !(spec.force_fire.kind === "const" && spec.force_fire.value === 1) ? (
        <span className="scratch-block-chunk">
          <Lbl>(override gate:</Lbl>
          <ExprSlot
            value={spec.force_fire}
            onChange={(v) => update({ force_fire: v })}
          />
          <Lbl>)</Lbl>
        </span>
      ) : null}
    </div>
  );
}

function ConditionalBlocks({
  spec,
  update,
}: {
  spec: UserTimingSpec;
  update: (patch: Partial<UserTimingSpec>) => void;
}): ReactNode {
  return (
    <>
      <div className="scratch-block scratch-block-stack cat-status">
        <span className="scratch-block-chunk">
          <Lbl>fire only when</Lbl>
          <ExprSlot
            value={spec.force_fire ?? { kind: "const", value: 0 }}
            onChange={(v) => update({ force_fire: v })}
          />
        </span>
      </div>
      <div className="scratch-block scratch-block-stack cat-status">
        <span className="scratch-block-chunk">
          <Lbl>skip when</Lbl>
          <ExprSlot
            value={spec.force_skip}
            onChange={(v) => update({ force_skip: v })}
            optional
            placeholder="(no skip)"
          />
        </span>
      </div>
    </>
  );
}

function FutureLookBlocks({
  spec,
  update,
}: {
  spec: UserTimingSpec;
  update: (patch: Partial<UserTimingSpec>) => void;
}): ReactNode {
  return (
    <>
      <div className="scratch-block scratch-block-stack cat-cooldown">
        <span className="scratch-block-chunk">
          <Lbl>score delays</Lbl>
        </span>
        <CandidatesChipRow
          candidates={spec.candidates}
          onChange={(c) => update({ candidates: c })}
        />
      </div>
      <div className="scratch-block scratch-block-stack cat-cooldown">
        <span className="scratch-block-chunk">
          <Lbl>over horizon</Lbl>
          <NumberSlot
            value={spec.horizon_sec}
            onChange={(v) => update({ horizon_sec: Math.max(1, v) })}
            step={1}
            min={1}
          />
          <Lbl>seconds</Lbl>
        </span>
      </div>
      <div className="scratch-block scratch-block-stack cat-cooldown">
        <span className="scratch-block-chunk">
          <Lbl>fire if utility &gt;</Lbl>
          <NumberSlot
            value={spec.threshold ?? 0.001}
            onChange={(v) => update({ threshold: Math.max(0, v) })}
            step={0.001}
            min={0}
          />
        </span>
      </div>
    </>
  );
}

function HybridBlocks({
  spec,
  update,
}: {
  spec: UserTimingSpec;
  update: (patch: Partial<UserTimingSpec>) => void;
}): ReactNode {
  return (
    <>
      <div className="scratch-block scratch-block-stack cat-status">
        <span className="scratch-block-chunk">
          <Lbl>force-fire when</Lbl>
          <ExprSlot
            value={spec.force_fire}
            onChange={(v) => update({ force_fire: v })}
            optional
            placeholder="(none)"
          />
        </span>
      </div>
      <div className="scratch-block scratch-block-stack cat-status">
        <span className="scratch-block-chunk">
          <Lbl>force-skip when</Lbl>
          <ExprSlot
            value={spec.force_skip}
            onChange={(v) => update({ force_skip: v })}
            optional
            placeholder="(none)"
          />
        </span>
      </div>
      <div className="scratch-block scratch-block-stack cat-cooldown">
        <span className="scratch-block-chunk">
          <Lbl>otherwise score delays</Lbl>
        </span>
        <CandidatesChipRow
          candidates={spec.candidates}
          onChange={(c) => update({ candidates: c })}
        />
      </div>
      <div className="scratch-block scratch-block-stack cat-cooldown">
        <span className="scratch-block-chunk">
          <Lbl>over horizon</Lbl>
          <NumberSlot
            value={spec.horizon_sec}
            onChange={(v) => update({ horizon_sec: Math.max(1, v) })}
            step={1}
            min={1}
          />
          <Lbl>seconds</Lbl>
        </span>
      </div>
    </>
  );
}

function CustomBlocks({
  spec,
  update,
}: {
  spec: UserTimingSpec;
  update: (patch: Partial<UserTimingSpec>) => void;
}): ReactNode {
  return (
    <>
      <div className="scratch-block scratch-block-stack cat-cooldown">
        <span className="scratch-block-chunk">
          <Lbl>candidate delays</Lbl>
        </span>
        <CandidatesChipRow
          candidates={spec.candidates}
          onChange={(c) => update({ candidates: c })}
        />
      </div>
      <div className="scratch-block scratch-block-stack cat-cooldown">
        <span className="scratch-block-chunk">
          <Lbl>horizon</Lbl>
          <NumberSlot
            value={spec.horizon_sec}
            onChange={(v) => update({ horizon_sec: Math.max(1, v) })}
            step={1}
            min={1}
          />
          <Lbl>s</Lbl>
        </span>
      </div>
      <div className="scratch-block scratch-block-stack cat-cooldown">
        <span className="scratch-block-chunk">
          <Lbl>threshold</Lbl>
          <NumberSlot
            value={spec.threshold ?? 0}
            onChange={(v) => update({ threshold: Math.max(0, v) })}
            step={0.001}
            min={0}
          />
        </span>
      </div>
      <div className="scratch-block scratch-block-stack cat-status">
        <span className="scratch-block-chunk">
          <Lbl>force-fire</Lbl>
          <ExprSlot
            value={spec.force_fire}
            onChange={(v) => update({ force_fire: v })}
            optional
            placeholder="(none)"
          />
        </span>
      </div>
      <div className="scratch-block scratch-block-stack cat-status">
        <span className="scratch-block-chunk">
          <Lbl>force-skip</Lbl>
          <ExprSlot
            value={spec.force_skip}
            onChange={(v) => update({ force_skip: v })}
            optional
            placeholder="(none)"
          />
        </span>
      </div>
    </>
  );
}

// ── Preview block ─────────────────────────────────────────────────

function PreviewBlock({
  spec,
  strategy,
}: {
  spec: UserTimingSpec;
  strategy: TimingStrategy;
}): ReactNode {
  const lines: string[] = [];
  if (strategy === "always-ready") {
    lines.push("Fires the ability the moment it becomes available.");
  } else if (strategy === "conditional") {
    lines.push(
      `Fires only when "${spec.force_fire ? printExpr(spec.force_fire) : "-"}" is true.`,
    );
    if (spec.force_skip) {
      lines.push(`Forced to skip when "${printExpr(spec.force_skip)}".`);
    }
  } else if (strategy === "future-look") {
    lines.push(
      `Scores ${spec.candidates.length} delays (${spec.candidates.join(", ")}s) over ${spec.horizon_sec}s.`,
    );
  } else if (strategy === "hybrid") {
    lines.push(
      `Future-look across ${spec.candidates.length} delays, horizon ${spec.horizon_sec}s.`,
    );
    if (spec.force_fire) lines.push(`Force-fire: ${printExpr(spec.force_fire)}.`);
    if (spec.force_skip) lines.push(`Force-skip: ${printExpr(spec.force_skip)}.`);
  } else {
    lines.push(`Custom: ${spec.candidates.length} candidate(s), horizon ${spec.horizon_sec}s.`);
  }
  return (
    <div className="scratch-block scratch-block-stack cat-snapshot scratch-block-preview">
      <span className="scratch-block-chunk">
        <Lbl>preview:</Lbl>
      </span>
      <div className="scratch-block-preview-lines">
        {lines.map((line, i) => (
          <div key={i} className="scratch-block-preview-line">{line}</div>
        ))}
      </div>
    </div>
  );
}

// ── Candidates chip row (inside a block) ─────────────────────────

function CandidatesChipRow({
  candidates,
  onChange,
}: {
  candidates: number[];
  onChange: (next: number[]) => void;
}): ReactNode {
  const [draft, setDraft] = useState("");
  const remove = (i: number) => onChange(candidates.filter((_, j) => j !== i));
  const addDraft = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 0 && !candidates.includes(n)) {
      onChange([...candidates, n].sort((a, b) => a - b));
      setDraft("");
    }
  };
  return (
    <span className="scratch-chip-row">
      {candidates.map((c, i) => (
        <span key={i} className="scratch-chip">
          {c}s
          <button
            type="button"
            className="scratch-chip-remove"
            onClick={(e) => {
              e.stopPropagation();
              remove(i);
            }}
            title="Remove"
            aria-label={`Remove ${c}s candidate`}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        type="number"
        className="scratch-chip-input"
        placeholder="+ add"
        min={0}
        step={0.1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addDraft();
          }
        }}
        onBlur={addDraft}
        onClick={(e) => e.stopPropagation()}
      />
    </span>
  );
}

// ── Palette content ─────────────────────────────────────────────
// Compact, named groups so the palette has the same level of
// "click anything, drop it into the stack" richness as the ability
// editor. Every constant is a list of named tiles; the JSX wires
// them via the same PaletteSection component.

type PresetCandidates = {
  label: string;
  description: string;
  values: number[];
};

const CANDIDATE_SET_PRESETS: PresetCandidates[] = [
  { label: "Now-only [0]", values: [0], description: "Single candidate at t=0. Fastest evaluation." },
  { label: "Fast [0, 0.1, 0.5]", values: [0, 0.1, 0.5], description: "Built-in Fast: very small horizon." },
  { label: "Burst [0, 0.1, 0.25, 0.5, 1]", values: [0, 0.1, 0.25, 0.5, 1], description: "Tight reactive window - useful for combo timing." },
  { label: "SemiIdeal [0, 0.5, 1, 2, 5]", values: [0, 0.5, 1, 2, 5], description: "Built-in SemiIdeal: balanced default." },
  { label: "Ideal [0, 0.5, 1, 2, 5, 10, 15, 30]", values: [0, 0.5, 1, 2, 5, 10, 15, 30], description: "Built-in Ideal: deep horizon." },
  { label: "Patient [0, 5, 15, 30, 60]", values: [0, 5, 15, 30, 60], description: "Long-horizon strategy: fire late if value is highest." },
];

type PresetNumber = { label: string; description: string; value: number };

const HORIZON_PRESETS: PresetNumber[] = [
  { label: "1s - instant", value: 1, description: "Tight horizon - for now-or-never decisions." },
  { label: "5s - short", value: 5, description: "Short look-ahead, light cost." },
  { label: "10s - medium", value: 10, description: "Balanced for medium-term plays." },
  { label: "15s - default", value: 15, description: "Built-in Ideal default." },
  { label: "30s - long", value: 30, description: "Long horizon for strategic plays." },
  { label: "60s - full fight", value: 60, description: "Score the entire fight when picking." },
];

const THRESHOLD_PRESETS: PresetNumber[] = [
  { label: "0 - always fire", value: 0, description: "Any positive utility wins. Permissive." },
  { label: "1e-6 - default", value: 0.000001, description: "Engine default. Practically any positive utility wins." },
  { label: "0.001 - small", value: 0.001, description: "Reject near-zero utility picks." },
  { label: "0.01 - moderate", value: 0.01, description: "Only fire when utility is clearly positive." },
  { label: "0.1 - strict", value: 0.1, description: "Only fire on high-value picks." },
];

const HP_CONDITION_TEMPLATES: Array<{ label: string; build: () => Expr }> = [
  { label: "self HP < 25%", build: () => mkLt("self.hp_ratio", 0.25) },
  { label: "self HP < 30%", build: () => mkLt("self.hp_ratio", 0.3) },
  { label: "self HP < 50%", build: () => mkLt("self.hp_ratio", 0.5) },
  { label: "self HP < 75%", build: () => mkLt("self.hp_ratio", 0.75) },
  { label: "opp HP < 25% (execute)", build: () => mkLt("opp.hp_ratio", 0.25) },
  { label: "opp HP < 50%", build: () => mkLt("opp.hp_ratio", 0.5) },
  { label: "opp HP > 75% (early)", build: () => mkGt("opp.hp_ratio", 0.75) },
];

const COMBAT_CONDITION_TEMPLATES: Array<{ label: string; build: () => Expr }> = [
  { label: "opp.bite_dps > 100", build: () => mkGt("opp.bite_dps", 100) },
  { label: "opp.bite_dps > 250", build: () => mkGt("opp.bite_dps", 250) },
  { label: "self has any status", build: () => mkGt("self.statuses_count", 0) },
  { label: "opp has any status", build: () => mkGt("opp.statuses_count", 0) },
  { label: "opp Burn_Status stacked", build: () => mkGt("opp.status.Burn_Status.stacks", 0) },
  { label: "opp.statuses_total_stacks > 5", build: () => mkGt("opp.statuses_total_stacks", 5) },
];

const TIME_CONDITION_TEMPLATES: Array<{ label: string; build: () => Expr }> = [
  { label: "always (1)", build: () => ({ kind: "const", value: 1 }) },
  { label: "after 1 second", build: () => mkGt("time", 1) },
  { label: "after 5 seconds", build: () => mkGt("time", 5) },
  { label: "after 15 seconds", build: () => mkGt("time", 15) },
  { label: "after 30 seconds", build: () => mkGt("time", 30) },
];

const SKIP_CONDITION_TEMPLATES: Array<{ label: string; build: () => Expr }> = [
  { label: "self HP > 70% (no need)", build: () => mkGt("self.hp_ratio", 0.7) },
  { label: "self HP > 90% (full HP)", build: () => mkGt("self.hp_ratio", 0.9) },
  { label: "opp HP > 80% (early)", build: () => mkGt("opp.hp_ratio", 0.8) },
  { label: "before 5 seconds", build: () => mkLt("time", 5) },
  { label: "before 10 seconds", build: () => mkLt("time", 10) },
];

function mkLt(path: string, threshold: number): Expr {
  return {
    kind: "bin",
    op: "lt",
    left: { kind: "var", path },
    right: { kind: "const", value: threshold },
  };
}

function mkGt(path: string, threshold: number): Expr {
  return {
    kind: "bin",
    op: "gt",
    left: { kind: "var", path },
    right: { kind: "const", value: threshold },
  };
}

// ── Primitives ───────────────────────────────────────────────────

function SmallField({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="scratch-field">
      <span className="scratch-field-label">{label}</span>
      {children}
    </label>
  );
}

function PaletteSection({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="scratch-palette-section">
      <div className={`scratch-palette-section-label ${className}`}>{title}</div>
      <div className="scratch-palette-section-blocks">{children}</div>
    </div>
  );
}

function Lbl({ children }: { children: ReactNode }): ReactNode {
  return <span className="scratch-block-text">{children}</span>;
}

function NumberSlot({
  value,
  onChange,
  step,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}): ReactNode {
  return (
    <input
      type="number"
      className="scratch-slot scratch-slot-num"
      value={value}
      step={step ?? "any"}
      min={min}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Hybrid Expr slot: when the Expr is a simple binary comparison
 * `var <op> const`, render as a structured row of dropdowns (path,
 * op, value). Otherwise - and on demand via the toggle - fall back
 * to raw text input. Keeps power-user freedom while turning the
 * 90% case into a no-typing-required form.
 *
 * Recognised paths: side-state fields (self.X / opp.X), engine
 * globals (time, combat.iteration_count). Status-stack and
 * timer-family paths still need raw text - they don't fit the
 * compact row.
 */
function ExprSlot({
  value,
  onChange,
  optional,
  placeholder,
}: {
  value: Expr | undefined;
  onChange: (v: Expr | undefined) => void;
  optional?: boolean;
  placeholder?: string;
}): ReactNode {
  const decoded = decodeSimpleComparison(value);
  const [forceRaw, setForceRaw] = useState(false);
  const useBuilder = !forceRaw && (decoded !== null || value === undefined);

  if (useBuilder) {
    return (
      <ExprBuilderRow
        value={decoded}
        onChange={(next) => onChange(next)}
        optional={optional}
        onSwitchToRaw={() => setForceRaw(true)}
      />
    );
  }
  return (
    <ExprRawInput
      value={value}
      onChange={onChange}
      optional={optional}
      placeholder={placeholder}
      onSwitchToBuilder={
        decodeSimpleComparison(value) !== null
          ? () => setForceRaw(false)
          : undefined
      }
    />
  );
}

/** Pattern-match an Expr against the simple-comparison shape:
 *   var <op> const   (op ∈ lt/lte/gt/gte/eq/ne).
 * Returns null if the shape doesn't match - caller falls back to
 * raw text. Also returns null for `kind: "const"` (always-fire /
 * always-skip) so the builder can show a dedicated "always" toggle. */
type SimpleComparison = {
  path: string;
  op: "lt" | "lte" | "gt" | "gte" | "eq" | "ne";
  value: number;
};
const COMPARABLE_OPS: ReadonlyArray<SimpleComparison["op"]> = [
  "lt",
  "lte",
  "gt",
  "gte",
  "eq",
  "ne",
];
function decodeSimpleComparison(expr: Expr | undefined): SimpleComparison | null {
  if (expr === undefined) return null;
  if (expr.kind !== "bin") return null;
  if (!COMPARABLE_OPS.includes(expr.op as SimpleComparison["op"])) return null;
  if (expr.left.kind !== "var") return null;
  if (expr.right.kind !== "const") return null;
  return {
    path: expr.left.path,
    op: expr.op as SimpleComparison["op"],
    value: expr.right.value,
  };
}

const COMMON_PATHS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "self.hp_ratio", label: "self.hp_ratio (0..1)" },
  { value: "opp.hp_ratio", label: "opp.hp_ratio (0..1)" },
  { value: "self.hp", label: "self.hp" },
  { value: "opp.hp", label: "opp.hp" },
  { value: "self.bite_dps", label: "self.bite_dps" },
  { value: "opp.bite_dps", label: "opp.bite_dps" },
  { value: "self.breath_capacity", label: "self.breath_capacity" },
  { value: "opp.breath_capacity", label: "opp.breath_capacity" },
  { value: "self.statuses_count", label: "self.statuses_count" },
  { value: "opp.statuses_count", label: "opp.statuses_count" },
  { value: "self.statuses_total_stacks", label: "self.statuses_total_stacks" },
  { value: "opp.statuses_total_stacks", label: "opp.statuses_total_stacks" },
  { value: "time", label: "time (sim seconds)" },
  { value: "combat.iteration_count", label: "combat.iteration_count" },
];

const OP_LABELS: Record<SimpleComparison["op"], string> = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  eq: "==",
  ne: "≠",
};

function ExprBuilderRow({
  value,
  onChange,
  optional,
  onSwitchToRaw,
}: {
  value: SimpleComparison | null;
  onChange: (next: Expr | undefined) => void;
  optional?: boolean;
  onSwitchToRaw: () => void;
}): ReactNode {
  // Defaults when the slot is empty: self.hp_ratio < 0.3.
  const path = value?.path ?? "self.hp_ratio";
  const op = value?.op ?? "lt";
  const num = value?.value ?? 0.3;

  const emit = (next: SimpleComparison) => {
    onChange({
      kind: "bin",
      op: next.op,
      left: { kind: "var", path: next.path },
      right: { kind: "const", value: next.value },
    });
  };

  return (
    <span className="scratch-expr-builder">
      <select
        className="scratch-slot scratch-slot-select"
        value={path}
        onChange={(e) => emit({ path: e.target.value, op, value: num })}
        onClick={(e) => e.stopPropagation()}
      >
        {COMMON_PATHS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        {/* Allow sticking with whatever non-listed path was already
            saved (e.g. self.cooldown_remaining.user.x) without
            forcing the user to switch to raw. */}
        {!COMMON_PATHS.some((p) => p.value === path) ? (
          <option value={path}>{path}</option>
        ) : null}
      </select>
      <select
        className="scratch-slot scratch-slot-select"
        value={op}
        onChange={(e) => emit({ path, op: e.target.value as SimpleComparison["op"], value: num })}
        onClick={(e) => e.stopPropagation()}
      >
        {COMPARABLE_OPS.map((o) => (
          <option key={o} value={o}>
            {OP_LABELS[o]}
          </option>
        ))}
      </select>
      <input
        type="number"
        className="scratch-slot scratch-slot-num"
        value={num}
        step="any"
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) emit({ path, op, value: n });
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className="scratch-expr-mode-toggle"
        onClick={(e) => {
          e.stopPropagation();
          onSwitchToRaw();
        }}
        title="Switch to raw expression mode for AND/OR / functions / nested logic"
      >
        ƒx
      </button>
      {optional ? (
        <button
          type="button"
          className="scratch-expr-mode-toggle"
          onClick={(e) => {
            e.stopPropagation();
            onChange(undefined);
          }}
          title="Clear (no condition)"
        >
          ✕
        </button>
      ) : null}
    </span>
  );
}

function ExprRawInput({
  value,
  onChange,
  optional,
  placeholder,
  onSwitchToBuilder,
}: {
  value: Expr | undefined;
  onChange: (v: Expr | undefined) => void;
  optional?: boolean;
  placeholder?: string;
  onSwitchToBuilder?: () => void;
}): ReactNode {
  const printed = value === undefined ? "" : printExpr(value);
  const [text, setText] = useState(printed);
  const [error, setError] = useState<string | null>(null);
  const lastSyncedRef = useRef(printed);
  useEffect(() => {
    if (printed === lastSyncedRef.current) return;
    const localR = parseExpr(text);
    const localPrinted = localR.ok ? printExpr(localR.expr) : null;
    if (localPrinted === printed) {
      lastSyncedRef.current = printed;
      return;
    }
    setText(printed);
    setError(null);
    lastSyncedRef.current = printed;
  }, [printed, text]);

  const commit = (raw: string) => {
    if (optional && raw.trim() === "") {
      onChange(undefined);
      setError(null);
      return;
    }
    if (raw.trim() === "") {
      setError("expression required");
      return;
    }
    const r = parseExpr(raw);
    if (r.ok) {
      setError(null);
      onChange(r.expr);
    } else {
      setError(r.error);
    }
  };

  return (
    <span className="scratch-expr-wrap is-slot">
      <input
        type="text"
        className={`scratch-slot scratch-slot-expr ${error ? "is-error" : ""}`}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
        spellCheck={false}
      />
      {onSwitchToBuilder ? (
        <button
          type="button"
          className="scratch-expr-mode-toggle"
          onClick={(e) => {
            e.stopPropagation();
            onSwitchToBuilder();
          }}
          title="Switch back to the form builder"
        >
          ⇲
        </button>
      ) : null}
      {error ? <span className="scratch-expr-error" title={error}>!</span> : null}
    </span>
  );
}

/** Palette tile that's also draggable. Click and drag both apply
 * the same preset. The drop target is the entire scratch-workspace
 * div - exact position inside doesn't matter since timing
 * parameters are positional, not list-ordered. */
function DraggablePaletteTile({
  className,
  title,
  apply,
  children,
}: {
  className: string;
  title: string;
  apply: () => void;
  children: ReactNode;
}): ReactNode {
  // See PaletteHats in AbilityVisualEditor for the rationale: on mobile
  // the tile itself must not be draggable, otherwise touch can never
  // scroll the palette. The ⋮⋮ handle is the only mobile drag-source.
  const isMobile = useIsMobile();
  const startTileDrag = (e: DragEvent) => setTimingDrag(e, { apply });
  return (
    <button
      type="button"
      className={className}
      onClick={apply}
      draggable={!isMobile}
      onDragStart={startTileDrag}
      onDragEnd={clearTimingDrag}
      title={title}
    >
      <span
        className="scratch-drag-handle"
        draggable
        onDragStart={startTileDrag}
        onDragEnd={clearTimingDrag}
        onClick={(e) => e.stopPropagation()}
        aria-hidden
      >
        ⋮⋮
      </span>
      {children}
    </button>
  );
}
