import { useEffect, useState, type ReactNode } from "react";
import { StatusEditor, makeBlankStatusSpec } from "./StatusEditor";
import {
  listCustomStatusRecords,
  subscribeCustomStatusRegistry,
  unregisterCustomStatusRecord,
  type CustomStatusRecord,
} from "../../shared/customStatuses";
import type { UserStatusSpec } from "../../shared/customAbilityTypes";

type EditorState =
  | { mode: "list" }
  | { mode: "create"; initialSpec: UserStatusSpec }
  | { mode: "edit"; initialSpec: UserStatusSpec };

function tickSummary(spec: UserStatusSpec): string {
  if (!spec.tick_kind || spec.tick_kind === "none") return "—";
  const base = spec.tick_base ?? 0;
  const per = spec.tick_per_stack ?? 0;
  const interval = spec.tick_interval_sec ?? 0;
  return `${spec.tick_kind} ${base}+${per}/stk @${interval}s`;
}

export default function CustomStatusesPanel(): ReactNode {
  const [records, setRecords] = useState<CustomStatusRecord[]>(() =>
    listCustomStatusRecords(),
  );
  const [editor, setEditor] = useState<EditorState>({ mode: "list" });

  useEffect(() => {
    const unsubscribe = subscribeCustomStatusRegistry(() => {
      setRecords(listCustomStatusRecords());
    });
    return unsubscribe;
  }, []);

  if (editor.mode !== "list") {
    return (
      <div className="custom-statuses-panel">
        <StatusEditor
          initialSpec={editor.initialSpec}
          mode={editor.mode}
          onSaved={() => setEditor({ mode: "list" })}
          onCancel={() => setEditor({ mode: "list" })}
        />
      </div>
    );
  }

  return (
    <div className="custom-statuses-panel">
      <section className="panel custom-hero">
        <div className="custom-hero-text">
          <h2 className="custom-hero-title">Custom Statuses</h2>
          <p className="custom-hero-desc muted">
            Define new parametric statuses — damage / heal over time, regen and
            damage / cooldown modifiers, stacking and decay. Once registered, a
            custom status (id <code>user.&lt;name&gt;</code>) can be applied by
            any custom ability's <code>apply_status</code> effects, on-hit
            statuses, or starting statuses, and behaves like a built-in ailment.
          </p>
        </div>
        <div className="custom-hero-actions">
          <button
            type="button"
            className="primary"
            onClick={() =>
              setEditor({ mode: "create", initialSpec: makeBlankStatusSpec() })
            }
          >
            + New status
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-block">
          <strong>Registered ({records.length})</strong>
        </div>
        {records.length === 0 ? (
          <div className="panel-block muted">
            No custom statuses yet. Click <em>+ New status</em> above to define
            one.
          </div>
        ) : (
          <div className="panel-block">
            <table className="aggregate-compare-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Display name</th>
                  <th style={{ width: "26%" }}>Id</th>
                  <th style={{ width: "10%" }}>Polarity</th>
                  <th style={{ width: "20%" }}>Tick</th>
                  <th style={{ width: "10%" }}>Updated</th>
                  <th style={{ width: "12%" }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.spec.id}>
                    <td>{record.spec.display_name}</td>
                    <td>
                      <code style={{ fontSize: 12 }}>{record.spec.id}</code>
                    </td>
                    <td>{record.spec.polarity ?? "negative"}</td>
                    <td>{tickSummary(record.spec)}</td>
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
                              `Delete custom status "${record.spec.display_name}"? This cannot be undone.`,
                            )
                          ) {
                            void unregisterCustomStatusRecord(record.spec.id);
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
