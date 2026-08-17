import { type ReactNode } from "react";
import { Inbox, Pencil, Plus, Trash2 } from "lucide-react";

// Shared presentation for the "registered" list on the Custom Abilities /
// Timings / Statuses landing pages. Replaces the old dense 4-6 column table
// with a card grid (reads far better for a short list with long ids), plus a
// proper designed empty state instead of a line of muted text. Per-kind
// metadata (timing candidates, status polarity/tick, ...) is passed as `meta`.

export type RegisteredItem = {
  id: string;
  displayName: string;
  updatedAt: number;
  meta?: ReactNode;
};

export function CustomRegisteredList({
  items,
  noun,
  nounPlural,
  emptyHint,
  onNew,
  onEdit,
  onDelete,
}: {
  items: RegisteredItem[];
  noun: string;
  nounPlural: string;
  emptyHint: ReactNode;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (item: RegisteredItem) => void;
}): ReactNode {
  if (items.length === 0) {
    return (
      <div className="creg-empty">
        <span className="creg-empty__icon">
          <Inbox size={26} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <div className="creg-empty__title">No custom {nounPlural} yet</div>
        <p className="creg-empty__hint">{emptyHint}</p>
        <button type="button" className="primary creg-empty__cta" onClick={onNew}>
          <Plus size={15} strokeWidth={2.4} aria-hidden="true" /> New {noun}
        </button>
      </div>
    );
  }
  return (
    <div className="creg">
      <div className="creg-count">
        {items.length} {items.length === 1 ? noun : nounPlural} registered
      </div>
      <div className="creg-grid">
        {items.map((item) => (
          <article key={item.id} className="creg-card">
            <div className="creg-card__head">
              <h4 className="creg-card__name">{item.displayName}</h4>
              <code className="creg-card__id">{item.id}</code>
            </div>
            {item.meta ? <div className="creg-card__meta">{item.meta}</div> : null}
            <div className="creg-card__foot">
              <span className="creg-card__updated">
                {new Date(item.updatedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
              </span>
              <div className="creg-card__actions">
                <button
                  type="button"
                  className="creg-card__btn"
                  aria-label={`Edit ${item.displayName}`}
                  onClick={() => onEdit(item.id)}
                >
                  <Pencil size={13} strokeWidth={2} aria-hidden="true" /> Edit
                </button>
                <button
                  type="button"
                  className="creg-card__btn creg-card__btn--danger"
                  aria-label={`Delete ${item.displayName}`}
                  onClick={() => onDelete(item)}
                >
                  <Trash2 size={13} strokeWidth={2} aria-hidden="true" /> Delete
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
