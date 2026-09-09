import type { SpeedBuildsController } from "../../pages/useSpeedBuildsPageController";
import { channelRows, formatChannelValue, formatDelta } from "../../pages/speedBuildsShared";

export function SpeedBuildsChannelPanel({ controller }: { controller: SpeedBuildsController }) {
  const { creature, base, subject, mode, target } = controller;
  const rows = base && subject ? channelRows(base, subject.sustained, subject.peak) : [];

  return (
    <div className="panel-block">
      <h3>Every channel</h3>
      {!creature ? <div className="muted">Pick a creature to see its movement stats.</div> : null}
      {creature && rows.length === 0 ? <div className="muted">This creature has no movement stats.</div> : null}
      {rows.length > 0 ? (
        <>
          <div className="note">
            {mode === "optimize" ? "The winning build above, on every channel." : "The loadout you assembled, on every channel."}{" "}
            Sustained is the build alone; peak adds what you hold.
          </div>
          <div className="aggregate-compare-table-wrap">
            <table className="aggregate-compare-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Stat</th>
                  <th>Sustained</th>
                  <th>Peak</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.channel} className={row.channel === target ? "speed-row--target" : undefined}>
                    <td>{row.label}</td>
                    <td className="muted">{formatChannelValue(row.raw)}</td>
                    <td>
                      <strong>{formatChannelValue(row.sustained)}</strong>
                    </td>
                    <td>
                      <strong>{formatChannelValue(row.peak)}</strong>
                    </td>
                    <td>
                      <span className={`speed-delta speed-delta--${row.tone}`}>{formatDelta(row.deltaPct)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
