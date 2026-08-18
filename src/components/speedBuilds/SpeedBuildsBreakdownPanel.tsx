import type { SpeedBuildsController } from "../../pages/useSpeedBuildsPageController";
import { contributionRows } from "../../pages/speedBuildsShared";

export function SpeedBuildsBreakdownPanel({ controller }: { controller: SpeedBuildsController }) {
  const { creature, base, subject, heldIds } = controller;
  const rows = contributionRows(subject?.contributions ?? [], base, subject?.build ?? null, heldIds);

  return (
    <div className="panel-block">
      <h3>Breakdown</h3>
      {!creature ? <div className="muted">Pick a creature to see the breakdown.</div> : null}
      {creature && rows.length === 0 ? (
        <div className="muted">No effects - these are the bare stats.</div>
      ) : null}
      {rows.length > 0 ? (
        <div className="aggregate-compare-table-wrap">
          <table className="aggregate-compare-table">
            <thead>
              <tr>
                <th>Effect</th>
                <th>Source</th>
                <th>Up when</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ contribution, source, change, held, note }) => (
                <tr key={contribution.effect.id}>
                  <td>
                    {contribution.effect.label}
                    {contribution.stacks > 1 ? ` x${contribution.stacks}` : ""}
                    {note ? <div className="note">{note}</div> : null}
                  </td>
                  <td>{source}</td>
                  <td>{held ? "Held" : "Always"}</td>
                  <td>{change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
