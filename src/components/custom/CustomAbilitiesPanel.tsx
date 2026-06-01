import { useEffect, useState, type ReactNode } from "react";
import { AbilityEditor, makeBlankAbilitySpec } from "./AbilityEditor";
import {
  listCustomAbilityRecords,
  subscribeCustomAbilityRegistry,
  unregisterCustomAbilityRecord,
  type CustomAbilityRecord,
} from "../../shared/customAbilities";
import type { UserAbilitySpec } from "../../shared/customAbilityTypes";

type EditorState =
  | { mode: "list" }
  | { mode: "create"; initialSpec: UserAbilitySpec }
  | { mode: "edit"; initialSpec: UserAbilitySpec };

export default function CustomAbilitiesPanel(): ReactNode {
  const [records, setRecords] = useState<CustomAbilityRecord[]>(() =>
    listCustomAbilityRecords(),
  );
  const [editor, setEditor] = useState<EditorState>({ mode: "list" });

  useEffect(() => {
    const unsubscribe = subscribeCustomAbilityRegistry(() => {
      setRecords(listCustomAbilityRecords());
    });
    return unsubscribe;
  }, []);

  if (editor.mode !== "list") {
    return (
      <div className="custom-abilities-panel">
        <AbilityEditor
          initialSpec={editor.initialSpec}
          mode={editor.mode}
          onSaved={() => setEditor({ mode: "list" })}
          onCancel={() => setEditor({ mode: "list" })}
        />
      </div>
    );
  }

  return (
    <div className="custom-abilities-panel">
      <section className="panel custom-hero">
        <div className="custom-hero-text">
          <h2 className="custom-hero-title">Custom Abilities</h2>
          <p className="custom-hero-desc muted">
            Define new combat abilities — decision logic (when to fire) and
            effects (what happens when it fires) — and attach them to your
            custom creatures. Every registered ability flows through the same
            Rust dispatch path as built-in Fortify / Adrenaline / Life Leech.
          </p>
        </div>
        <div className="custom-hero-actions">
          <button
            type="button"
            className="primary"
            onClick={() =>
              setEditor({ mode: "create", initialSpec: makeBlankAbilitySpec() })
            }
          >
            + New ability
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-block">
          <strong>Registered ({records.length})</strong>
        </div>
        {records.length === 0 ? (
          <div className="panel-block muted">
            No custom abilities yet. Click <em>+ New ability</em> above, or
            import a bundle from another user via the page header.
          </div>
        ) : (
          <div className="panel-block">
            <table className="aggregate-compare-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Display name</th>
                  <th style={{ width: "35%" }}>Id</th>
                  <th style={{ width: "20%" }}>Updated</th>
                  <th style={{ width: "15%" }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.spec.id}>
                    <td>{record.spec.display_name}</td>
                    <td>
                      <code style={{ fontSize: 12 }}>{record.spec.id}</code>
                    </td>
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
                          setEditor({
                            mode: "edit",
                            initialSpec: record.spec,
                          })
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
                              `Delete custom ability "${record.spec.display_name}"? This cannot be undone.`,
                            )
                          ) {
                            void unregisterCustomAbilityRecord(record.spec.id);
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
