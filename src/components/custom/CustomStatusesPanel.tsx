import { useEffect, useState, type ReactNode } from "react";
import { StatusEditor, makeBlankStatusSpec } from "./StatusEditor";
import { CustomRegisteredList } from "./CustomRegisteredList";
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
  if (!spec.tick_kind || spec.tick_kind === "none") return "-";
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
        <div className="cc-back-bar">
          <button type="button" className="cc-editor__back" onClick={() => setEditor({ mode: "list" })}>
            ← Back to statuses
          </button>
        </div>
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
            Define new parametric statuses - damage / heal over time, regen and
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

      <CustomRegisteredList
        noun="status"
        nounPlural="statuses"
        items={records.map((record) => ({
          id: record.spec.id,
          displayName: record.spec.display_name,
          updatedAt: record.updatedAt,
          meta: (
            <>
              <span className={`creg-chip creg-chip--${record.spec.polarity ?? "negative"}`}>
                {record.spec.polarity ?? "negative"}
              </span>
              {tickSummary(record.spec) !== "-" ? <span className="creg-chip">{tickSummary(record.spec)}</span> : null}
            </>
          ),
        }))}
        emptyHint={
          <>
            Click <em>New status</em> to define a parametric ailment (damage / heal over time, regen and
            cooldown modifiers, stacking and decay).
          </>
        }
        onNew={() => setEditor({ mode: "create", initialSpec: makeBlankStatusSpec() })}
        onEdit={(id) => {
          const record = records.find((r) => r.spec.id === id);
          if (record) setEditor({ mode: "edit", initialSpec: record.spec });
        }}
        onDelete={(item) => {
          if (window.confirm(`Delete custom status "${item.displayName}"? This cannot be undone.`)) {
            void unregisterCustomStatusRecord(item.id);
          }
        }}
      />
    </div>
  );
}
