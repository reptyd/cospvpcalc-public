import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildOptions } from "../engine";
import { elderProfiles, getPlushieIcon, getTraitIcon, plushieByName, plushies, traits } from "../engine/buildData";
import { formatPlushieEffectSummary } from "../engine/plushieEffectSummary";
import { computeAscensionCounts } from "../shared/buildEncoding";
import { IconImg } from "./IconImg";

const traitOptions = traits;
const plushieOptions = [...plushies].sort((a, b) => a.name.localeCompare(b.name));

export function PlushieSelectors({ build, onBuildChange }: { build: BuildOptions; onBuildChange: (value: BuildOptions) => void }) {
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

  const slot1Effect = slot1 ? formatPlushieEffectSummary(slot1) : "";
  const slot2Effect = slot2 ? formatPlushieEffectSummary(slot2) : "";

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
        {plushieOptions.map((plushie, idx) => (
          <option
            key={`${plushie.name}-${idx}`}
            value={plushie.name}
            label={formatPlushieEffectSummary(plushie.name)}
          />
        ))}
      </datalist>
      {warning && <div className="note">{warning}</div>}
    </div>
  );
}

export function TraitSelectors({ build, onBuildChange }: { build: BuildOptions; onBuildChange: (value: BuildOptions) => void }) {
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

  return (
    <div className="trait-grid">
      <div className="icon-input">
        <IconImg src={getTraitIcon(slot1) ?? getTraitIcon(slot1.replace(/_/g, " "))} alt={slot1} size={30} />
        <select
          aria-label="Trait slot 1"
          value={slot1}
          onChange={(e) => onSlot1Change(e.target.value)}
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
      <div className="icon-input">
        <IconImg src={getTraitIcon(slot2) ?? getTraitIcon(slot2.replace(/_/g, " "))} alt={slot2} size={30} />
        <select
          aria-label="Trait slot 2"
          value={slot2}
          onChange={(e) => onSlot2Change(e.target.value)}
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
      {warning && <div className="note">{warning}</div>}
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
    if (!trait1 || !trait2) return;
    const safeCount1 = Math.min(build.venerationStage, Math.max(0, nextCount1));
    const safeCount2 = build.venerationStage - safeCount1;
    const assignments = ["", "", "", "", ""];
    for (let i = 0; i < safeCount1; i += 1) assignments[i] = trait1;
    for (let i = safeCount1; i < safeCount1 + safeCount2; i += 1) assignments[i] = trait2;
    onBuildChange({ ...build, ascensionAssignments: assignments });
  }, [trait1, trait2, build, onBuildChange]);

  useEffect(() => {
    setCount1Text(String(count1));
    setCount2Text(String(count2));
  }, [count1, count2, trait1, trait2, build.venerationStage]);

  const totalAssigned = (counts[0] ?? 0) + (counts[1] ?? 0);
  const ascensionKey = build.ascensionAssignments.join("|");
  useEffect(() => {
    if (!hasStage || !hasTraits || !trait1) return;

    if (!trait2) {
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
    return (
      <div className="note">
        Ascension counts: {labels[trait1] ?? trait1} = {build.venerationStage}
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

export function ElderSelector({ build, onBuildChange }: { build: BuildOptions; onBuildChange: (value: BuildOptions) => void }) {
  return (
    <div className="elder-selector-grid">
      <button
        type="button"
        className={`elder-choice${build.elder === "None" ? " active" : ""}`}
        onClick={() => onBuildChange({ ...build, elder: "None" })}
      >
        <strong>None</strong>
        <span>Base creature</span>
      </button>
      {elderProfiles.map((elder) => (
        <button
          key={elder.id}
          type="button"
          className={`elder-choice${build.elder === elder.id ? " active" : ""}`}
          onClick={() => onBuildChange({ ...build, elder: elder.id })}
        >
          <strong>{elder.name}</strong>
          <span>{elder.summary}</span>
        </button>
      ))}
    </div>
  );
}

