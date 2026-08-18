import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildOptions } from "../engine";
import { elderProfiles, getPlushieIcon, getTraitIcon, plushieByName, plushies, traits } from "../engine/buildData";
import { formatPlushieEffectSummary } from "../engine/plushieEffectSummary";
import { computeAscensionCounts } from "../shared/buildEncoding";
import { IconImg } from "./IconImg";

const traitOptions = traits;
const plushieOptions = [...plushies].sort((a, b) => a.name.localeCompare(b.name));

/** How a slotted plushie is captioned under the field. Pages whose subject is
 * narrower than combat can substitute their own - Speed Builds knows what the
 * ten movement plushies do that the plushie data leaves blank. */
export type PlushieDescriber = (name: string) => string;

export function PlushieSelectors({
  build,
  onBuildChange,
  describe = formatPlushieEffectSummary,
  only,
}: {
  build: BuildOptions;
  onBuildChange: (value: BuildOptions) => void;
  describe?: PlushieDescriber;
  /** See PlushiePickerBeta. */
  only?: readonly string[];
}) {
  const buildPlushie1 = build.plushies[0] ?? "";
  const buildPlushie2 = build.plushies[1] ?? "";
  const [slot1, setSlot1] = useState(buildPlushie1);
  const [slot2, setSlot2] = useState(buildPlushie2);
  const [warning, setWarning] = useState("");
  const internalUpdateRef = useRef(false);

  useEffect(() => {
    if (internalUpdateRef.current) {
      internalUpdateRef.current = false;
      return;
    }
    setSlot1(buildPlushie1);
    setSlot2(buildPlushie2);
  }, [buildPlushie1, buildPlushie2]);

  const isStackable = (name: string) => plushieByName[name]?.stackRule === "stackable";

  const commit = (next1: string, next2: string) => {
    internalUpdateRef.current = true;
    const next = [next1, next2];
    onBuildChange({ ...build, plushies: next });
  };

  const onSlot1Change = (value: string) => {
    if (value && value === slot2 && !isStackable(value)) {
      setWarning(`${value} is unique. Duplicate removed from slot 2.`);
      setSlot2("");
      setSlot1(value);
      commit(value, "");
      return;
    }
    setWarning("");
    setSlot1(value);
    commit(value, slot2);
  };

  const onSlot2Change = (value: string) => {
    if (value && value === slot1 && !isStackable(value)) {
      setWarning(`${value} is unique. Duplicate not allowed.`);
      setSlot2("");
      commit(slot1, "");
      return;
    }
    setWarning("");
    setSlot2(value);
    commit(slot1, value);
  };

  const slot1Effect = slot1 ? describe(slot1) : "";
  const slot2Effect = slot2 ? describe(slot2) : "";

  return (
    <div className="trait-grid">
      <div className="icon-input">
        <IconImg src={getPlushieIcon(slot1)} alt={slot1} size={30} />
        <input
          aria-label="Plushie slot 1"
          list="plushie-list"
          value={slot1}
          onChange={(e) => onSlot1Change(e.target.value)}
          // Read the live DOM value, not React state: iOS QuickType /
          // autofill can insert a datalist option without firing a
          // React-visible change event, leaving `slot1` stale. Routing
          // the actual field value back through the validating handler
          // on blur captures those selections too.
          onBlur={(e) => onSlot1Change(e.target.value)}
        />
      </div>
      {slot1Effect && <div className="note plushie-effect-note">{slot1Effect}</div>}
      <div className="icon-input">
        <IconImg src={getPlushieIcon(slot2)} alt={slot2} size={30} />
        <input
          aria-label="Plushie slot 2"
          list="plushie-list"
          value={slot2}
          onChange={(e) => onSlot2Change(e.target.value)}
          // See slot1: capture iOS QuickType / autofill insertions that
          // skip React's change event by re-validating the live value.
          onBlur={(e) => onSlot2Change(e.target.value)}
        />
      </div>
      {slot2Effect && <div className="note plushie-effect-note">{slot2Effect}</div>}
      <datalist id="plushie-list">
        {(only ? plushieOptions.filter((p) => only.includes(p.name)) : plushieOptions).map((plushie, idx) => (
          <option
            key={`${plushie.name}-${idx}`}
            value={plushie.name}
            label={describe(plushie.name)}
          />
        ))}
      </datalist>
      {warning && <div className="note">{warning}</div>}
    </div>
  );
}

export function TraitSelectors({
  build,
  onBuildChange,
}: {
  build: BuildOptions;
  onBuildChange: (value: BuildOptions) => void;
}) {
  const buildTrait1 = build.traits[0] ?? "";
  const buildTrait2 = build.traits[1] ?? "";
  const [slot1, setSlot1] = useState(buildTrait1);
  const [slot2, setSlot2] = useState(buildTrait2);
  const [warning, setWarning] = useState("");

  useEffect(() => {
    setSlot1(buildTrait1);
    setSlot2(buildTrait2);
  }, [buildTrait1, buildTrait2]);

  const commit = (next1: string, next2: string) => {
    const nextTraits = [next1, next2].filter(Boolean);
    const nextAssignments = build.ascensionAssignments.map((value) => (nextTraits.includes(value) ? value : ""));
    onBuildChange({ ...build, traits: nextTraits, ascensionAssignments: nextAssignments });
  };

  const onSlot1Change = (value: string) => {
    if (value && value === slot2) {
      setWarning("Traits must be different. Cleared slot 2.");
      setSlot2("");
      setSlot1(value);
      commit(value, "");
      return;
    }
    setWarning("");
    setSlot1(value);
    commit(value, slot2);
  };

  const onSlot2Change = (value: string) => {
    if (value && value === slot1) {
      setWarning("Traits must be different. Cleared slot 2.");
      setSlot2("");
      commit(slot1, "");
      return;
    }
    setWarning("");
    setSlot2(value);
    commit(slot1, value);
  };

  const slotField = (slot: 1 | 2, value: string, onValueChange: (next: string) => void) => (
    <div className="icon-input">
      <IconImg src={getTraitIcon(value) ?? getTraitIcon(value.replace(/_/g, " "))} alt={value} size={30} />
      <select
        aria-label={`Trait slot ${slot}`}
        value={value}
        className={value ? "is-set" : undefined}
        onChange={(e) => onValueChange(e.target.value)}
        onBlur={() => commit(slot1, slot2)}
      >
        <option value="">None</option>
        {traitOptions.map((trait) => (
          <option key={trait.id} value={trait.id}>
            {trait.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="trait-grid">
      {slotField(1, slot1, onSlot1Change)}
      {slotField(2, slot2, onSlot2Change)}
      {warning && <div className="note">{warning}</div>}
    </div>
  );
}

// Beta-native plushie picker: replaces the two native datalist inputs (whose
// browser popup is an unstyleable, full-height list - "giant and ugly") with a
// compact searchable dropdown per slot: a styled, capped-height, scrollable
// list of icon + name + effect. Same commit + uniqueness contract as
// PlushieSelectors (a non-stackable plushie can't occupy both slots), so the
// engine path is unchanged. The menu renders inline (pushes content) rather
// than absolutely, so it is never clipped by the rail side / modal overflow.
export function PlushiePickerBeta({
  build,
  onBuildChange,
  describe = formatPlushieEffectSummary,
  only,
}: {
  build: BuildOptions;
  onBuildChange: (value: BuildOptions) => void;
  describe?: PlushieDescriber;
  /** Narrow the list to plushies the caller can actually use. Speed Builds
   * passes the ones that move a movement channel; the other 69 would be
   * offered only to produce an empty ranking. */
  only?: readonly string[];
}) {
  const slot1 = build.plushies[0] ?? "";
  const slot2 = build.plushies[1] ?? "";
  const [openSlot, setOpenSlot] = useState<0 | 1 | null>(null);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpenSlot(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const isStackable = (name: string) => plushieByName[name]?.stackRule === "stackable";

  const choose = (slot: 0 | 1, value: string) => {
    let next1 = slot1;
    let next2 = slot2;
    if (slot === 0) {
      if (value && value === next2 && !isStackable(value)) next2 = "";
      next1 = value;
    } else {
      // A unique plushie can't sit in both slots - ignore a duplicate pick.
      const duplicate = !!value && value === next1 && !isStackable(value);
      next2 = duplicate ? "" : value;
    }
    onBuildChange({ ...build, plushies: [next1, next2] });
    setOpenSlot(null);
    setQuery("");
  };

  const offered = useMemo(
    () => (only ? plushieOptions.filter((p) => only.includes(p.name)) : plushieOptions),
    [only],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? offered.filter((p) => p.name.toLowerCase().includes(q)) : offered;
  }, [offered, query]);

  const renderSlot = (slot: 0 | 1, value: string) => {
    const open = openSlot === slot;
    return (
      <div className="plush-pick__slot">
        <button
          type="button"
          className={`plush-pick__field${open ? " is-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Plushie slot ${slot + 1}`}
          onClick={() => {
            setOpenSlot(open ? null : slot);
            setQuery("");
          }}
        >
          <span className="plush-pick__ico"><IconImg src={getPlushieIcon(value)} alt="" size={22} /></span>
          <span className={`plush-pick__name${value ? "" : " is-empty"}`}>{value || "Empty slot"}</span>
          <span className="plush-pick__dd" aria-hidden="true" />
        </button>
        {value && !open ? <div className="note plushie-effect-note">{describe(value)}</div> : null}
        {open ? (
          <div className="plush-pick__menu" role="listbox">
            <input
              className="plush-pick__search"
              autoFocus
              value={query}
              placeholder="Search plushie…"
              aria-label="Search plushies"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="plush-pick__list">
              <button type="button" className="plush-pick__opt" onClick={() => choose(slot, "")}>
                <span className="plush-pick__oico" />
                <span className="plush-pick__oname is-empty">None</span>
              </button>
              {filtered.map((plushie) => (
                <button
                  key={plushie.name}
                  type="button"
                  className={`plush-pick__opt${plushie.name === value ? " is-sel" : ""}`}
                  onClick={() => choose(slot, plushie.name)}
                >
                  <span className="plush-pick__oico"><IconImg src={getPlushieIcon(plushie.name)} alt="" size={18} /></span>
                  <span className="plush-pick__oname">{plushie.name}</span>
                  <span className="plush-pick__oeff">{describe(plushie.name)}</span>
                </button>
              ))}
              {filtered.length === 0 ? <div className="plush-pick__none">No match</div> : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="plush-pick" ref={wrapRef}>
      {renderSlot(0, slot1)}
      {renderSlot(1, slot2)}
    </div>
  );
}

export function AscensionSelectors({ build, onBuildChange }: { build: BuildOptions; onBuildChange: (value: BuildOptions) => void }) {
  const traitIds = build.traits;
  const [trait1, trait2] = traitIds;
  const labels: Record<string, string> = Object.fromEntries(traitOptions.map((t) => [t.id, t.name]));
  const hasStage = build.venerationStage > 0;
  const hasTraits = traitIds.length > 0;
  const counts = useMemo(
    () => (hasTraits ? computeAscensionCounts(build.traits, build.ascensionAssignments, build.venerationStage) : [0, 0]),
    [hasTraits, build.traits, build.ascensionAssignments, build.venerationStage],
  );
  const count1 = counts[0] ?? 0;
  const count2 = hasStage ? build.venerationStage - count1 : 0;
  const [count1Text, setCount1Text] = useState(String(count1));
  const [count2Text, setCount2Text] = useState(String(count2));

  const setCounts = useCallback((nextCount1: number) => {
    if (!trait1) return;
    const safeCount1 = Math.min(build.venerationStage, Math.max(0, nextCount1));
    const assignments = ["", "", "", "", ""];
    for (let i = 0; i < safeCount1; i += 1) assignments[i] = trait1;
    if (trait2) {
      // Two traits: the rest of the stage budget always goes to trait 2.
      const safeCount2 = build.venerationStage - safeCount1;
      for (let i = safeCount1; i < safeCount1 + safeCount2; i += 1) assignments[i] = trait2;
    }
    // Single trait: the rest stays unassigned (no bonus), so a partial
    // allocation is expressible.
    onBuildChange({ ...build, ascensionAssignments: assignments });
  }, [trait1, trait2, build, onBuildChange]);

  useEffect(() => {
    setCount1Text(String(count1));
    setCount2Text(String(count2));
  }, [count1, count2, trait1, trait2, build.venerationStage]);

  const totalAssigned = (counts[0] ?? 0) + (counts[1] ?? 0);
  const ascensionKey = build.ascensionAssignments.join("|");
  // Default allocation runs only when the SELECTION (traits / stage) changes:
  // a fresh pick defaults to a full allocation on the single trait, but a
  // user-made partial allocation is left alone afterwards. (It used to be
  // force-refilled on every render, which made single-trait ascension
  // uneditable.)
  const prevSelectionRef = useRef("");
  useEffect(() => {
    const selectionKey = `${trait1 ?? ""}|${trait2 ?? ""}|${build.venerationStage}`;
    const selectionChanged = prevSelectionRef.current !== selectionKey;
    prevSelectionRef.current = selectionKey;
    if (!hasStage || !hasTraits || !trait1) return;

    if (!trait2) {
      if (!selectionChanged) return;
      const assignments = ["", "", "", "", ""];
      for (let i = 0; i < build.venerationStage; i += 1) assignments[i] = trait1;
      if (ascensionKey !== assignments.join("|")) {
        onBuildChange({ ...build, ascensionAssignments: assignments });
      }
      return;
    }

    if (totalAssigned !== build.venerationStage) {
      setCounts(count1);
    }
  }, [hasStage, hasTraits, trait1, trait2, build, ascensionKey, onBuildChange, totalAssigned, count1, setCounts]);

  if (!hasStage) return <div className="note">No ascension at stage 0.</div>;
  if (!hasTraits) return <div className="note">Select traits to allocate ascension counts.</div>;

  if (!trait2) {
    // Single trait: the count is editable (0..stage); leftover points stay
    // unassigned and grant no bonus.
    const unassigned = build.venerationStage - count1;
    return (
      <div className="ascension-grid">
        <div className="ascension-row">
          <span>{labels[trait1] ?? trait1}</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={count1Text}
            onChange={(e) => setCount1Text(e.target.value)}
            onBlur={() => {
              const parsed = Number(count1Text);
              setCounts(Number.isFinite(parsed) ? parsed : count1);
            }}
          />
        </div>
        {unassigned > 0 ? (
          <div className="note">Unassigned: {unassigned} (no bonus)</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ascension-grid">
      <div className="ascension-row">
        <span>{labels[trait1] ?? trait1}</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={count1Text}
          onChange={(e) => setCount1Text(e.target.value)}
          onBlur={() => {
            const parsed = Number(count1Text);
            setCounts(Number.isFinite(parsed) ? parsed : count1);
          }}
        />
      </div>
      <div className="ascension-row">
        <span>{labels[trait2] ?? trait2}</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={count2Text}
          onChange={(e) => setCount2Text(e.target.value)}
          onBlur={() => {
            const parsed = Number(count2Text);
            const safeCount2 = Number.isFinite(parsed) ? parsed : count2;
            setCounts(build.venerationStage - safeCount2);
          }}
        />
      </div>
    </div>
  );
}

// Each elder modifier key -> display label + which direction is a BUFF.
// "up" = higher value is better (damage, regen...), "down" = lower is better
// (cooldowns), "flat" = neutral (weight - situational, not graded).
const ELDER_MOD_META: Record<string, { label: string; dir: "up" | "down" | "flat" }> = {
  weightPct: { label: "Weight", dir: "flat" },
  damagePct: { label: "Damage", dir: "up" },
  biteCooldownPct: { label: "Bite CD", dir: "down" },
  activeCooldownPct: { label: "Ability CD", dir: "down" },
  healthRegenPct: { label: "HP Regen", dir: "up" },
  staminaPct: { label: "Stamina", dir: "up" },
  stamRegenPct: { label: "Stam Regen", dir: "up" },
  speedPct: { label: "Speed", dir: "up" },
  ailmentBlockPct: { label: "Ailment Block", dir: "up" },
};
const ELDER_MOD_ORDER = Object.keys(ELDER_MOD_META);

// One archetype tagline per elder - the "personality" the colors lean on.
const ELDER_ARCHETYPE: Record<string, string> = {
  Devious: "Fast & evasive",
  Gentle: "Sustain & support",
  Powerful: "Heavy bruiser",
};

type ElderDelta = { key: string; label: string; value: number; tone: "good" | "bad" | "flat" };

function elderDeltas(modifiers: Record<string, number | undefined>, keys: readonly string[]): ElderDelta[] {
  const out: ElderDelta[] = [];
  for (const key of keys) {
    const value = modifiers[key];
    if (typeof value !== "number" || value === 0) continue;
    const meta = ELDER_MOD_META[key];
    const tone: ElderDelta["tone"] =
      meta.dir === "flat" ? "flat" : (value > 0) === (meta.dir === "up") ? "good" : "bad";
    out.push({ key, label: meta.label, value, tone });
  }
  // Buffs first, then penalties, then neutral - reads as "what you gain / lose".
  const rank = { good: 0, bad: 1, flat: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

export function ElderSelector({
  build,
  onBuildChange,
  showDeltaChips = false,
  modifierKeys = ELDER_MOD_ORDER,
}: {
  build: BuildOptions;
  onBuildChange: (value: BuildOptions) => void;
  /** Render each elder's modifiers as color-coded +/- chips instead of the
   * plain summary string. Used by the beta Setup; default page keeps the
   * legacy text so its look is untouched. */
  showDeltaChips?: boolean;
  /** Which modifiers earn a chip. A page whose subject is narrower than combat
   * passes the ones it actually reads - Speed Builds computes nothing from an
   * elder but its speed, so chipping its damage would be a promise the page
   * does not keep. */
  modifierKeys?: readonly string[];
}) {
  return (
    <div className="elder-selector-grid">
      <button
        type="button"
        className={`elder-choice${build.elder === "None" ? " active" : ""}`}
        data-elder="None"
        onClick={() => onBuildChange({ ...build, elder: "None" })}
      >
        <strong>None</strong>
        <span>Base creature — no elder bonuses or penalties.</span>
      </button>
      {elderProfiles.map((elder) => (
        <button
          key={elder.id}
          type="button"
          className={`elder-choice${build.elder === elder.id ? " active" : ""}`}
          data-elder={elder.id}
          onClick={() => onBuildChange({ ...build, elder: elder.id })}
        >
          {showDeltaChips ? (
            <>
              <span className="elder-choice-head">
                <strong>{elder.name}</strong>
                {ELDER_ARCHETYPE[elder.id] ? <em className="elder-choice-tag">{ELDER_ARCHETYPE[elder.id]}</em> : null}
              </span>
              <span className="elder-delta-row">
                {elderDeltas(elder.modifiers, modifierKeys).map((d) => (
                  <span key={d.key} className={`elder-delta elder-delta--${d.tone}`}>
                    {d.value > 0 ? "+" : ""}{d.value}% {d.label}
                  </span>
                ))}
              </span>
            </>
          ) : (
            <>
              <strong>{elder.name}</strong>
              <span>{elder.summary}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

