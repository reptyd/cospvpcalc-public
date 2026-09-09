import { useState } from "react";
import type { AbilityTimingMode, BuildOptions, SimulationSummary } from "../engine";
import { getPlushieIcon, getTraitIcon, traits } from "../engine/buildData";
import { computeAscensionCounts } from "../shared/buildEncoding";
import { formatRoundedPercent } from "../shared/displayFormat";
import { IconImg } from "./IconImg";
import { buildExplainText, resolveTraitPercentLocal } from "./buildDetailsMath";

const traitOptions = traits;

export type DummyValues = {
  health: number;
  weight: number;
  damage: number;
  biteCooldown: number;
};

export type BuildDetailsResult = {
  buildA: BuildOptions;
  buildB: BuildOptions;
  summary: SimulationSummary;
  abilityPolicy: AbilityTimingMode;
  simActivesOn: boolean;
  simBreathOn: boolean;
  simCreatureAName: string;
  simCreatureBName: string;
  simDummyValues?: DummyValues;
};

export function BuildDetails({
  label,
  side,
  build,
  result,
  mode,
  nameA,
  nameB,
  dummyValues,
  onApply,
}: {
  label: string;
  side: "A" | "B";
  build: BuildOptions;
  result: BuildDetailsResult;
  mode: "solo" | "counter";
  nameA: string;
  nameB: string;
  dummyValues: DummyValues;
  onApply: () => void;
}) {
  const plushies = build.plushies.filter(Boolean);
  const traitInfo = build.traits.map((traitId) => ({
    id: traitId,
    name: traitOptions.find((t) => t.id === traitId)?.name ?? traitId,
    percent: resolveTraitPercentLocal(traitId, build),
  }));
  const [showExplain, setShowExplain] = useState(false);
  const [explainText, setExplainText] = useState("");
  const [copiedExplain, setCopiedExplain] = useState(false);

  return (
    <div className="build-details">
      <div className="build-header">
        <strong>{label}</strong>
        <button className="apply-btn" onClick={onApply}>
          Apply build
        </button>
      </div>
      <div>Veneration stage: {build.venerationStage}</div>
      <div>Elder: {build.elder ?? "None"}</div>
      <div>
        Plushies:{" "}
        {plushies.length === 0
          ? "None"
          : plushies.map((name, idx) => (
              <span key={`${name}-${idx}`} className="inline-icon">
                <IconImg src={getPlushieIcon(name)} alt={name} size={24} /> {name}
              </span>
            ))}
      </div>
      <div>
        Traits:{" "}
        {traitInfo.length === 0
          ? "None"
          : traitInfo.map((trait) => (
              <span key={trait.id} className="inline-icon">
                <IconImg src={getTraitIcon(trait.id) ?? getTraitIcon(trait.name)} alt={trait.name} size={24} /> {trait.name}{" "}
                ({formatRoundedPercent(trait.percent)})
              </span>
            ))}
      </div>
      <div>
        Ascension counts:{" "}
        {build.traits.length === 0 && "None"}
        {build.traits.length > 0 &&
          computeAscensionCounts(build.traits, build.ascensionAssignments, build.venerationStage).map((count, idx) => (
            <span key={`${build.traits[idx]}-${idx}`} className="asc-item">
              {build.traits[idx]}: {count}
            </span>
          ))}
      </div>
      <div className="build-header">
        <button
          className="secondary"
          type="button"
          onClick={() => {
            if (!showExplain) {
              setExplainText("Analyzing...");
              void (async () => {
                const next = await buildExplainText({
                  build,
                  result,
                  mode,
                  side,
                  nameA,
                  nameB,
                  dummyValues,
                });
                setExplainText(next);
              })();
            }
            setShowExplain((prev) => !prev);
          }}
        >
          {showExplain ? "Hide Math Explain" : "Explain Math"}
        </button>
        {showExplain && explainText && (
          <button
            className="secondary"
            type="button"
            onClick={() => {
              const payload = `Explained by Sonaria Stat Lab\n\n${explainText}`;
              void navigator.clipboard?.writeText(payload);
              setCopiedExplain(true);
              window.setTimeout(() => setCopiedExplain(false), 1400);
            }}
          >
            {copiedExplain ? "Copied" : "Copy Explain"}
          </button>
        )}
      </div>
      {showExplain && explainText && (
        <div className="explain-wrap">
          <div className="explain-badge">Explained by Sonaria Stat Lab</div>
          <pre className="explain-box">{explainText}</pre>
        </div>
      )}
    </div>
  );
}

