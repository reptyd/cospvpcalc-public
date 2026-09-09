import { useId } from "react";
import { SmartNumericInput } from "../SmartNumericInput";
import { ToggleSwitch } from "../ToggleSwitch";
import type { SpeedBuildsController } from "../../pages/useSpeedBuildsPageController";
import { effectCaption } from "../../pages/speedBuildsShared";
import { SEA_SCHOOL_CAP } from "../../speed/speedEffects";

export function SpeedBuildsBuffControls({ controller }: { controller: SpeedBuildsController }) {
  const fillId = useId();
  const packmatesId = useId();
  const {
    creature,
    mode,
    offered,
    heldIds,
    toggleEffect,
    fillPct,
    setFillPct,
    appetiteMatters,
    packmates,
    setPackmates,
    packmatesMatter,
    captionContext,
  } = controller;

  return (
    <>
      <p className="muted">
        {mode === "optimize"
          ? "Held by every build in the ranking. Turning one on can change which build wins."
          : "Held on top of the loadout - the difference between sustained and peak."}
      </p>
      {!creature ? <div className="muted">Pick a creature first.</div> : null}
      {creature && offered.length === 0 ? <div className="muted">This creature has nothing to hold.</div> : null}
      {offered.length > 0 ? (
        <div className="toggle-group">
          {offered.map((effect) => (
            <ToggleSwitch
              key={effect.id}
              checked={heldIds.includes(effect.id)}
              onChange={() => toggleEffect(effect.id)}
              label={effect.label}
              description={effectCaption(effect, captionContext)}
            />
          ))}
        </div>
      ) : null}
      {appetiteMatters ? (
        <div className="field speed-appetite">
          <label htmlFor={fillId}>Appetite fill (%)</label>
          <SmartNumericInput
            id={fillId}
            value={fillPct}
            clamp={(raw) => Math.max(100, Math.min(125, Math.round(raw)))}
            onCommit={setFillPct}
          />
          <div className="note">Gourmandizer ramps from 100 (no penalty) to 125 (fully overfed).</div>
        </div>
      ) : null}
      {packmatesMatter ? (
        <div className="field speed-appetite">
          <label htmlFor={packmatesId}>Nearby packmates (0-{SEA_SCHOOL_CAP})</label>
          <SmartNumericInput
            id={packmatesId}
            value={packmates}
            clamp={(raw) => Math.max(0, Math.min(SEA_SCHOOL_CAP, Math.round(raw)))}
            onCommit={setPackmates}
          />
          <div className="note">Each tier 1-2 packmate within range adds 5%, up to six.</div>
        </div>
      ) : null}
    </>
  );
}
