import { useEffect, useState, type ReactNode } from "react";
import { TimingEditor, makeBlankTimingSpec } from "./TimingEditor";
import { CustomRegisteredList } from "./CustomRegisteredList";
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
        <div className="cc-back-bar">
          <button type="button" className="cc-editor__back" onClick={() => setEditor({ mode: "list" })}>
            ← Back to timings
          </button>
        </div>
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
            Define new timing-policy modes - alternative candidate-delay
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

      <CustomRegisteredList
        noun="timing"
        nounPlural="timings"
        items={records.map((record) => ({
          id: record.spec.id,
          displayName: record.spec.display_name,
          updatedAt: record.updatedAt,
          meta: (
            <>
              <span className="creg-chip">{record.spec.candidates.length} candidates</span>
              <span className="creg-chip">{record.spec.horizon_sec}s horizon</span>
            </>
          ),
        }))}
        emptyHint={
          <>
            Click <em>New timing</em> to define one, or import a bundle from another user via the Library
            menu in the page header.
          </>
        }
        onNew={() => setEditor({ mode: "create", initialSpec: makeBlankTimingSpec() })}
        onEdit={(id) => {
          const record = records.find((r) => r.spec.id === id);
          if (record) setEditor({ mode: "edit", initialSpec: record.spec });
        }}
        onDelete={(item) => {
          if (window.confirm(`Delete custom timing "${item.displayName}"? This cannot be undone.`)) {
            void unregisterCustomTimingRecord(item.id);
          }
        }}
      />
    </div>
  );
}
