// Shared loadout strip for the beta BuildCards (Optimizer + Best Builds). The
// optimizer output is a BUILD, so it deserves a structured, icon-bearing
// readout - grouped Elder | Traits | Plushies | Flags with thin dividers - not
// a flat undifferentiated pill row. Traits carry their icon + ascension-point
// badge; the elder is tinted by archetype (Powerful red / Gentle green /
// Devious purple); Actives/Breath read as on/off dots.

import type { BuildOptions } from "../../engine";
import { getPlushieIcon, getTraitIcon } from "../../engine/buildData";
import { computeAscensionCounts } from "../../shared/buildEncoding";
import { IconImg } from "../IconImg";
import "./buildLoadout.css";

export function BuildLoadout({
  build,
  activesOn,
  breathOn,
}: {
  build: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
}) {
  const asc = computeAscensionCounts(build.traits, build.ascensionAssignments, build.venerationStage);
  const hasElder = Boolean(build.elder && build.elder !== "None");
  return (
    <div className="bl">
      <div className="bl__grp">
        <span className="bl__cap">Elder</span>
        {hasElder ? (
          <span className="bl__elder" data-elder={build.elder}>{build.elder}</span>
        ) : (
          <span className="bl__none">None</span>
        )}
      </div>

      <span className="bl__sep" aria-hidden="true" />

      <div className="bl__grp">
        <span className="bl__cap">Traits</span>
        {build.traits.length ? (
          build.traits.map((t, i) => (
            <span className="bl__item" key={`t${i}`}>
              <IconImg src={getTraitIcon(t)} alt="" size={18} />
              <span className="bl__name">{t}</span>
              <span className="bl__pts" title={`${asc[i] ?? 0} ascension points`}>{asc[i] ?? 0}</span>
            </span>
          ))
        ) : (
          <span className="bl__none">Auto</span>
        )}
      </div>

      <span className="bl__sep" aria-hidden="true" />

      <div className="bl__grp">
        <span className="bl__cap">Plushies</span>
        {build.plushies.length ? (
          build.plushies.map((p, i) => (
            <span className="bl__item bl__item--plush" key={`p${i}`}>
              <IconImg src={getPlushieIcon(p)} alt="" size={18} />
              <span className="bl__name">{p}</span>
            </span>
          ))
        ) : (
          <span className="bl__none">None</span>
        )}
      </div>

      <span className="bl__sep" aria-hidden="true" />

      <div className="bl__grp bl__grp--flags">
        <span className={`bl__flag${activesOn ? " is-on" : ""}`}>Actives</span>
        <span className={`bl__flag${breathOn ? " is-on" : ""}`}>Breath</span>
      </div>
    </div>
  );
}
