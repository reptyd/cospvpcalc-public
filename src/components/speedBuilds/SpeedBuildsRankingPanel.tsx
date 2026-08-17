import type { SpeedBuildsController } from "../../pages/useSpeedBuildsPageController";
import {
  channelLabel,
  contributionNotes,
  contributionRows,
  formatDelta,
  formatSpeedValue,
  readChannel,
} from "../../pages/speedBuildsShared";

/** Both plushie slots, always. The sweep drops any build a smaller one already
 * matches, so a single-plushie row means the other slot really is spare. */
function describeSlots(plushies: readonly string[]): string {
  return [plushies[0] ?? "", plushies[1] ?? ""].map((name) => name || "slot free").join(" + ");
}

export function SpeedBuildsRankingPanel({ controller }: { controller: SpeedBuildsController }) {
  const {
    creature,
    base,
    ranking,
    rankingRows,
    fixedChoice,
    constraints,
    target,
    rankBy,
    holding,
    heldIds,
    offered,
    subject,
  } = controller;
  const held = offered.filter((effect) => heldIds.includes(effect.id));
  // A ranking narrowed by something the reader set has to say so, or it reads
  // as the unconstrained answer to a question he did not ask.
  const limits = [
    constraints.elder !== null ? "elder locked" : "",
    constraints.traits !== null ? "traits locked" : "",
    constraints.requiredPlushies.length > 0 ? `always carrying ${constraints.requiredPlushies.join(" and ")}` : "",
    constraints.excludedPlushies.length > 0 ? `without ${constraints.excludedPlushies.join(", ")}` : "",
  ].filter(Boolean);
  // Bear buys its slot by strengthening Cower rather than by paying anything
  // itself, so the winning row has to say so or it reads as a fault.
  const winnerNotes = contributionNotes(
    contributionRows(subject?.contributions ?? [], base, subject?.build ?? null, heldIds),
  );

  return (
    <div className="panel-block">
      <h3>Fastest builds</h3>
      {!creature ? <div className="muted">Pick a creature to rank its builds.</div> : null}
      {creature && rankingRows.length === 0 ? (
        <div className="muted">This creature has no {channelLabel(target).toLowerCase()} to optimize.</div>
      ) : null}
      {rankingRows.length > 0 && ranking ? (
        <>
          {fixedChoice ? (
            <div className="note">
              Same in every build: elder{" "}
              {fixedChoice.elder && fixedChoice.elder !== "None" ? fixedChoice.elder : "none"},{" "}
              {fixedChoice.traits.length > 0 ? `${fixedChoice.traits.join(" + ")} trait` : "no trait"}, veneration{" "}
              {fixedChoice.venerationStage}
              {held.length > 0 ? `, holding ${held.map((effect) => effect.label).join(" + ")}` : ""}. Only the plushies
              differ.
              {limits.length > 0 ? ` Your constraints: ${limits.join(", ")}.` : ""}
            </div>
          ) : null}
          <div className="note">
            Ranked on {holding ? rankBy : "sustained"} {channelLabel(target).toLowerCase()} across{" "}
            {ranking.evaluated} {ranking.evaluated === 1 ? "build" : "builds"}.
          </div>
          <ul className="result-list">
            {rankingRows.map((row, index) => {
              const sustained = readChannel(row.sustained, target);
              const peak = readChannel(row.peak, target);
              const deltaPct =
                sustained === null || peak === null || sustained === 0 ? null : ((peak - sustained) / sustained) * 100;
              return (
                <li key={`${row.candidate.build.plushies.join("+")}|${row.candidate.value}`}>
                  <strong>#{index + 1}</strong> {channelLabel(target)} {formatSpeedValue(row.candidate.value)}
                  {holding && sustained !== null && peak !== null ? (
                    <span className="muted">
                      {" "}
                      {rankBy}, {formatSpeedValue(rankBy === "peak" ? sustained : peak)}{" "}
                      {rankBy === "peak" ? "sustained" : "peak"} ({formatDelta(deltaPct)})
                    </span>
                  ) : null}
                  <div className="why">{describeSlots(row.candidate.build.plushies)}</div>
                  {index === 0 && winnerNotes.length > 0 ? <div className="note">{winnerNotes.join(", ")}</div> : null}
                  <div className="row-actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => controller.openInManual(row.candidate.build)}
                    >
                      Open in Manual
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
