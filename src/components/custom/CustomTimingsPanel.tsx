import { useEffect, useState, type ReactNode } from "react";
import { TimingEditor, makeBlankTimingSpec } from "./TimingEditor";
import {
  listCustomTimingRecords,
  subscribeCustomTimingRegistry,
  unregisterCustomTimingRecord,
  type CustomTimingRecord,
} from "../../shared/customTimings";
import type { UserTimingSpec } from "../../shared/customAbilityTypes";

type EditorState =
  | { mode: "list" }
  | { mode: "create"; initialSpec: UserTimingSpec }
  | { mode: "edit"; initialSpec: UserTimingSpec };

export default function CustomTimingsPanel(): ReactNode {
  const [records, setRecords] = useState<CustomTimingRecord[]>(() =>
    listCustomTimingRecords(),
  );
  const [editor, setEditor] = useState<EditorState>({ mode: "list" });

  useEffect(() => {
    const unsubscribe = subscribeCustomTimingRegistry(() => {
      setRecords(listCustomTimingRecords());
    });
    return unsubscribe;
  }, []);

  if (editor.mode !== "list") {
    return (
      <div className="custom-timings-panel">
        <TimingEditor
          initialSpec={editor.initialSpec}
          mode={editor.mode}
          onSaved={() => setEditor({ mode: "list" })}
          onCancel={() => setEditor({ mode: "list" })}
        />
      </div>
    );
  }

  return (
    <div className="custom-timings-panel">
      <section className="panel custom-hero">
        <div className="custom-hero-text">
          <h2 className="custom-hero-title">Custom Timings</h2>
          <p className="custom-hero-desc muted">
            Define new timing-policy modes — alternative candidate-delay
            schedules + horizons + thresholds. Once registered, a custom
            timing becomes available as a 6th+ option in any ability's{" "}
            <code>timing_user_override</code> dropdown, alongside the
            built-in ReallyFast / Fast / SemiIdeal / Ideal / Extreme modes.
          </p>
        </div>
        <div className="custom-hero-actions">
          <button
            type="button"
            className="primary"
            onClick={() =>
              setEditor({ mode: "create", initialSpec: makeBlankTimingSpec() })
            }
          >
            + New timing
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-block">
          <strong>Registered ({records.length})</strong>
        </div>
        {records.length === 0 ? (
          <div className="panel-block muted">
            No custom timings yet. Click <em>+ New timing</em> above, or
            import a bundle from another user via the page header.
          </div>
        ) : (
          <div className="panel-block">
            <table className="aggregate-compare-table">
              <thead>
                <tr>
                  <th style={{ width: "25%" }}>Display name</th>
                  <th style={{ width: "30%" }}>Id</th>
                  <th style={{ width: "12%" }}>Candidates</th>
                  <th style={{ width: "10%" }}>Horizon (s)</th>
                  <th style={{ width: "10%" }}>Updated</th>
                  <th style={{ width: "13%" }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.spec.id}>
                    <td>{record.spec.display_name}</td>
                    <td>
                      <code style={{ fontSize: 12 }}>{record.spec.id}</code>
                    </td>
                    <td>{record.spec.candidates.length}</td>
                    <td>{record.spec.horizon_sec}</td>
                    <td>
                      {new Date(record.updatedAt).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Edit ${record.spec.display_name}`}
                        onClick={() =>
                          setEditor({ mode: "edit", initialSpec: record.spec })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${record.spec.display_name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete custom timing "${record.spec.display_name}"? This cannot be undone.`,
                            )
                          ) {
                            void unregisterCustomTimingRecord(record.spec.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
