// One side of the two Fight Rules that are set per creature. Both panels - the
// Compare one and the shared Best Builds / Optimizer / Sandbox one - render
// these, with their own numeric input passed as children.
//
// Neither pair of buttons stores a mode. `Own cooldown` writes 0 and `Always
// hit` writes 100, both of which the engine already reads as the state the
// button names, so the buttons are derived from the number and the two can
// never disagree.

import type { ReactNode } from "react";

import {
  DEFAULT_AERIAL_DODGE_HIT_CHANCE_PCT,
  DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC,
  hitChanceAsFraction,
} from "../engine/compareAirRule";

function sideClass(quiet: boolean, isB: boolean): string {
  return `compare-air-side${quiet ? " is-off" : ""}${isB ? " compare-air-side--b" : ""}`;
}

export function CadenceSideField({
  name,
  value,
  onChange,
  isB,
  children,
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
  isB: boolean;
  children: ReactNode;
}) {
  const own = !(value > 0);
  return (
    <div className={sideClass(own, isB)}>
      <div className="compare-air-side-name">{name}</div>
      <div className="compare-air-seg" role="group" aria-label={`${name} bite cadence`}>
        <button
          type="button"
          className={own ? "" : "is-active"}
          aria-pressed={!own}
          onClick={() => onChange(DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC)}
        >
          Fixed
        </button>
        <button
          type="button"
          className={own ? "is-active" : ""}
          aria-pressed={own}
          onClick={() => onChange(0)}
        >
          Own cooldown
        </button>
      </div>
      {own ? (
        <div className="compare-air-readout">Keeps its own bite cooldown.</div>
      ) : (
        <>
          {children}
          <div className="compare-air-readout">
            Bites every <b>{value} seconds</b>. Nothing changes it.
          </div>
        </>
      )}
    </div>
  );
}

export function DodgeSideField({
  name,
  value,
  onChange,
  isB,
  children,
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
  isB: boolean;
  children: ReactNode;
}) {
  const alwaysHit = value >= 100;
  const fraction = hitChanceAsFraction(value);
  return (
    <div className={sideClass(alwaysHit, isB)}>
      <div className="compare-air-side-name">{name}</div>
      <div className="compare-air-seg" role="group" aria-label={`${name} dodge`}>
        <button
          type="button"
          className={alwaysHit ? "" : "is-active"}
          aria-pressed={!alwaysHit}
          onClick={() => onChange(DEFAULT_AERIAL_DODGE_HIT_CHANCE_PCT)}
        >
          Dodges
        </button>
        <button
          type="button"
          className={alwaysHit ? "is-active" : ""}
          aria-pressed={alwaysHit}
          onClick={() => onChange(100)}
        >
          Always hit
        </button>
      </div>
      {alwaysHit ? (
        <div className="compare-air-readout">Every bite and breath tick on this side lands.</div>
      ) : (
        <>
          {children}
          <div className="compare-air-readout">
            <b>{value}%</b> of attacks land{fraction ? ` — ${fraction}` : ""}.
          </div>
        </>
      )}
    </div>
  );
}
