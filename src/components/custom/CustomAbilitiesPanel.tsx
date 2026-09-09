import { useEffect, useState, type ReactNode } from "react";
import { AbilityEditor, makeBlankAbilitySpec } from "./AbilityEditor";
import { CustomRegisteredList } from "./CustomRegisteredList";
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
        <div className="cc-back-bar">
          <button type="button" className="cc-editor__back" onClick={() => setEditor({ mode: "list" })}>
            ← Back to abilities
          </button>
        </div>
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
            Define new combat abilities - decision logic (when to fire) and
            effects (what happens when it fires) - and attach them to your
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

      <CustomRegisteredList
        noun="ability"
        nounPlural="abilities"
        items={records.map((record) => ({
          id: record.spec.id,
          displayName: record.spec.display_name,
          updatedAt: record.updatedAt,
        }))}
        emptyHint={
          <>
            Click <em>New ability</em> to define one, or import a bundle from another user via the Library
            menu in the page header.
          </>
        }
        onNew={() => setEditor({ mode: "create", initialSpec: makeBlankAbilitySpec() })}
        onEdit={(id) => {
          const record = records.find((r) => r.spec.id === id);
          if (record) setEditor({ mode: "edit", initialSpec: record.spec });
        }}
        onDelete={(item) => {
          if (window.confirm(`Delete custom ability "${item.displayName}"? This cannot be undone.`)) {
            void unregisterCustomAbilityRecord(item.id);
          }
        }}
      />
    </div>
  );
}
