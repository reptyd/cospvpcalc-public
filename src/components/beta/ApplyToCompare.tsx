// Shared "Apply to Compare" split control for the beta BuildCards (Optimizer +
// Best Builds). A result is a build for ONE creature, but the user may want to
// drop it onto EITHER Compare side - so instead of a lone "Apply to Compare A"
// (and a missing B), this is one labeled unit with two side targets: A accented
// blue, B accented green, mirroring the Compare HUD's side colors. Each target
// loads the build (and, for the cross-side case, the creature) onto that side.

import "./applyToCompare.css";

export function ApplyToCompare({
  onApplyA,
  onApplyB,
}: {
  onApplyA: () => void;
  onApplyB: () => void;
}) {
  return (
    <div className="atc" role="group" aria-label="Apply this build to a Compare side">
      <span className="atc__label">Apply to Compare</span>
      <span className="atc__sides">
        <button
          type="button"
          className="atc__side atc__side--a"
          onClick={onApplyA}
          title="Load this build on Compare side A"
        >
          A
        </button>
        <button
          type="button"
          className="atc__side atc__side--b"
          onClick={onApplyB}
          title="Load this build on Compare side B"
        >
          B
        </button>
      </span>
    </div>
  );
}
