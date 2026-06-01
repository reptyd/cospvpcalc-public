import {
  appendChild,
  createDefaultPredicateNode,
  createSubGroup,
  removeNode,
  updateNode,
  type Predicate,
  type QueryGroup as QueryGroupModel,
  type QueryNode,
} from "../../engine/creatureSearch";
import { PredicateRow } from "./PredicateRow";

export function QueryGroup({
  group,
  root,
  onRootChange,
  depth,
  onRemoveSelf,
}: {
  group: QueryGroupModel;
  root: QueryGroupModel;
  onRootChange: (next: QueryGroupModel) => void;
  depth: number;
  onRemoveSelf?: () => void;
}) {
  const updateThis = (patch: (current: QueryGroupModel) => QueryGroupModel) => {
    onRootChange(
      updateNode(root, group.id, (node) => (node.kind === "group" ? patch(node) : node)),
    );
  };

  const addCondition = () => {
    onRootChange(appendChild(root, group.id, createDefaultPredicateNode("stat-num")));
  };
  const addSubGroup = () => {
    onRootChange(appendChild(root, group.id, createSubGroup()));
  };

  return (
    <div
      className={`search-query-group${depth > 0 ? " is-nested" : ""}`}
      data-combinator={group.combinator}
    >
      <div className="search-query-group-head">
        <div className="search-query-group-combinator" role="radiogroup" aria-label="Combine conditions with">
          <button
            type="button"
            role="radio"
            aria-checked={group.combinator === "and"}
            className={`search-combinator-pill${group.combinator === "and" ? " is-active" : ""}`}
            onClick={() => updateThis((current) => ({ ...current, combinator: "and" }))}
          >
            AND
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={group.combinator === "or"}
            className={`search-combinator-pill${group.combinator === "or" ? " is-active" : ""}`}
            onClick={() => updateThis((current) => ({ ...current, combinator: "or" }))}
          >
            OR
          </button>
        </div>
        <span className="muted search-query-group-summary">
          {group.children.length === 0
            ? "Empty — add a condition"
            : `${group.children.length} ${group.children.length === 1 ? "child" : "children"}`}
        </span>
        {onRemoveSelf ? (
          <button
            type="button"
            className="secondary search-query-group-remove"
            onClick={onRemoveSelf}
            aria-label="Remove group"
            title="Remove group"
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="search-query-group-children">
        {group.children.map((child, index) => (
          <div key={child.id} className="search-query-group-child">
            {index > 0 ? (
              <div className="search-query-group-connector">
                {group.combinator.toUpperCase()}
              </div>
            ) : null}
            {child.kind === "predicate" ? (
              <PredicateRow
                predicate={child.predicate}
                onChange={(nextPredicate) =>
                  onRootChange(
                    updateNode(root, child.id, (node) =>
                      node.kind === "predicate"
                        ? ({ ...node, predicate: nextPredicate } as QueryNode)
                        : node,
                    ),
                  )
                }
                onRemove={() => onRootChange(removeNode(root, child.id))}
              />
            ) : (
              <QueryGroup
                group={child}
                root={root}
                onRootChange={onRootChange}
                depth={depth + 1}
                onRemoveSelf={() => onRootChange(removeNode(root, child.id))}
              />
            )}
          </div>
        ))}
      </div>

      <div className="search-query-group-actions">
        <button type="button" className="secondary" onClick={addCondition}>
          + Condition
        </button>
        <button type="button" className="secondary" onClick={addSubGroup}>
          + Group ( )
        </button>
        <PredicateQuickAdd
          onAdd={(kind) =>
            onRootChange(appendChild(root, group.id, createDefaultPredicateNode(kind)))
          }
        />
      </div>
    </div>
  );
}

function PredicateQuickAdd({ onAdd }: { onAdd: (kind: Predicate["kind"]) => void }) {
  return (
    <select
      className="search-quick-add"
      value=""
      onChange={(e) => {
        if (!e.target.value) return;
        onAdd(e.target.value as Predicate["kind"]);
        e.target.value = "";
      }}
      aria-label="Quick add typed condition"
    >
      <option value="">Add typed…</option>
      <option value="stat-num">Numeric stat</option>
      <option value="stat-cat">Categorical stat</option>
      <option value="ability">Ability</option>
      <option value="status">Status</option>
    </select>
  );
}
