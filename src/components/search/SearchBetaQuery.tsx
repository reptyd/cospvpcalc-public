// Beta-native query builder for the Search page - the "smart tree": the same
// AND / OR predicate-tree model and mutators as the shared QueryGroup, but
// rebuilt for pleasant composition. Native <select>s are replaced by the
// themed BetaSelect (searchable for the long field / ability / status lists),
// has/lacks and is/is-not become segmented toggles, there's a single clear
// "+ Condition" flow (no parallel "Add typed..."), and nested groups read with a
// left spine + connector chips. Logic-identical to the classic builder.
//
// Conditions (not groups) can be dragged by their grip to a new spot: drop into
// any slot to reorder within a group, move into another group, or pull out of
// one. Drag state is shared via QueryDragContext so a drop can land in a group
// other than where the drag started; the insertion line + group ring show where
// it will go. moveNode performs the relocation.

import { type DragEvent as ReactDragEvent, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, GripVertical, Plus, X } from "lucide-react";
import { BetaSelect, type BetaSelectGroup, type BetaSelectOption } from "../beta/BetaSelect";
import {
  ABILITY_KIND_LABELS,
  ABILITY_NAMES_BY_KIND,
  CATEGORICAL_STAT_LABELS,
  CATEGORICAL_VALUE_OPTIONS,
  COMPARATOR_LABELS,
  NUMERIC_STAT_CATEGORIES,
  NUMERIC_STAT_LABELS,
  STATUS_OPTIONS_BY_SLOT,
  STATUS_SLOT_LABELS,
  appendChild,
  createDefaultPredicate,
  createDefaultPredicateNode,
  createSubGroup,
  groupCombinatorAt,
  moveNode,
  removeNode,
  setGroupCombinatorAt,
  updateNode,
  type AbilityKind,
  type CategoricalStatField,
  type EqualityComparator,
  type NumericComparator,
  type NumericStatField,
  type Predicate,
  type QueryGroup as QueryGroupModel,
  type QueryNode,
  type StatusSlot,
} from "../../engine/creatureSearch";

const NUMERIC_OPS: NumericComparator[] = ["eq", "neq", "gt", "lt", "gte", "lte"];

const KIND_OPTIONS: BetaSelectOption[] = [
  { value: "stat-num", label: "Numeric stat" },
  { value: "stat-cat", label: "Categorical" },
  { value: "ability", label: "Ability" },
  { value: "status", label: "Status" },
];
const NUMERIC_FIELD_GROUPS: BetaSelectGroup[] = NUMERIC_STAT_CATEGORIES.map((category) => ({
  label: category.label,
  options: category.fields.map((field) => ({ value: field, label: NUMERIC_STAT_LABELS[field] })),
}));
const CATEGORICAL_FIELD_OPTIONS: BetaSelectOption[] = (Object.keys(CATEGORICAL_STAT_LABELS) as CategoricalStatField[]).map(
  (field) => ({ value: field, label: CATEGORICAL_STAT_LABELS[field] }),
);
const ABILITY_KIND_OPTIONS: BetaSelectOption[] = (Object.keys(ABILITY_KIND_LABELS) as AbilityKind[]).map((kind) => ({
  value: kind,
  label: ABILITY_KIND_LABELS[kind],
}));
const STATUS_SLOT_OPTIONS: BetaSelectOption[] = (Object.keys(STATUS_SLOT_LABELS) as StatusSlot[]).map((slot) => ({
  value: slot,
  label: STATUS_SLOT_LABELS[slot],
}));
const NUMERIC_OP_OPTIONS: BetaSelectOption[] = NUMERIC_OPS.map((op) => ({ value: op, label: COMPARATOR_LABELS[op] }));

// Shared drag state for the whole tree (a drag can drop into a group other than
// the one it started in). `target` describes where the dragged condition would
// land: into `groupId`, immediately before `beforeId` (or at the end when null).
type DropTarget = { groupId: string; beforeId: string | null };
type QueryDragValue = {
  dragId: string | null;
  target: DropTarget | null;
  begin: (id: string) => void;
  hover: (target: DropTarget) => void;
  drop: () => void;
  cancel: () => void;
};
const QueryDragContext = createContext<QueryDragValue | null>(null);
function useQueryDrag(): QueryDragValue {
  const ctx = useContext(QueryDragContext);
  if (!ctx) throw new Error("useQueryDrag must be used within SearchQueryBuilder");
  return ctx;
}

export function SearchQueryBuilder({
  root,
  onRootChange,
}: {
  root: QueryGroupModel;
  onRootChange: (next: QueryGroupModel) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const drag = useMemo<QueryDragValue>(
    () => ({
      dragId,
      target,
      begin: (id) => {
        setDragId(id);
        setTarget(null);
      },
      hover: (next) =>
        setTarget((prev) => (prev && prev.groupId === next.groupId && prev.beforeId === next.beforeId ? prev : next)),
      drop: () => {
        if (dragId && target) onRootChange(moveNode(root, dragId, target.groupId, target.beforeId));
        setDragId(null);
        setTarget(null);
      },
      cancel: () => {
        setDragId(null);
        setTarget(null);
      },
    }),
    [dragId, target, root, onRootChange],
  );

  // Edge auto-scroll while dragging. Native HTML5 drag-and-drop doesn't scroll
  // the page, so a drop target below/above the fold is unreachable. While a drag
  // is active, listen for `dragover` on the window and scroll when the cursor
  // nears the top/bottom edge - velocity scaled by how deep into the edge band
  // it is. The rAF loop keeps scrolling even when the cursor is held still at
  // the edge (dragover stops firing once the pointer stops moving).
  useEffect(() => {
    if (dragId === null) return;
    const EDGE = 90; // px band at each viewport edge
    const MAX = 20; // px per frame at the very edge
    let velocity = 0;
    let raf = 0;
    const step = () => {
      if (velocity === 0) {
        raf = 0;
        return;
      }
      window.scrollBy(0, velocity);
      raf = requestAnimationFrame(step);
    };
    const onDragOver = (e: DragEvent) => {
      const y = e.clientY;
      const h = window.innerHeight;
      if (y < EDGE) velocity = -Math.ceil(((EDGE - y) / EDGE) * MAX);
      else if (y > h - EDGE) velocity = Math.ceil(((y - (h - EDGE)) / EDGE) * MAX);
      else velocity = 0;
      if (velocity !== 0 && raf === 0) raf = requestAnimationFrame(step);
    };
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [dragId]);

  return (
    <QueryDragContext.Provider value={drag}>
      <QueryGroupNode group={root} root={root} onRootChange={onRootChange} depth={0} />
    </QueryDragContext.Provider>
  );
}

function QueryGroupNode({
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
  const drag = useQueryDrag();
  const dragging = drag.dragId !== null;
  const target = drag.target;
  const addCondition = () => onRootChange(appendChild(root, group.id, createDefaultPredicateNode("stat-num")));
  const addSubGroup = () => onRootChange(appendChild(root, group.id, createSubGroup()));
  const toggleGap = (gapIndex: number) =>
    onRootChange(
      setGroupCombinatorAt(root, group.id, gapIndex, groupCombinatorAt(group, gapIndex) === "and" ? "or" : "and"),
    );

  // "Into this group at the end" - drop onto the group's header / actions /
  // empty body. Child rows stopPropagation, so this only fires off the rows.
  const intoThisGroup = dragging && target?.groupId === group.id && target.beforeId === null;
  const lineBefore = (childId: string) => dragging && target?.groupId === group.id && target.beforeId === childId;

  const groupDrop = dragging
    ? {
        onDragOver: (e: ReactDragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          drag.hover({ groupId: group.id, beforeId: null });
        },
        onDrop: (e: ReactDragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          drag.drop();
        },
      }
    : {};

  // A condition row is a whole-row drop target: pointer in the top half -> drop
  // before it; bottom half -> after it (before the next sibling, or group end).
  const rowDrop = (child: QueryNode, index: number) => {
    if (!dragging || child.kind !== "predicate") return {};
    const nextId = group.children[index + 1]?.id ?? null;
    return {
      onDragOver: (e: ReactDragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        drag.hover({ groupId: group.id, beforeId: before ? child.id : nextId });
      },
      onDrop: (e: ReactDragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        drag.drop();
      },
    };
  };

  return (
    <div
      className={`sr-q${depth > 0 ? " sr-q--nested" : ""}${intoThisGroup ? " is-droptarget" : ""}`}
      data-combinator={group.combinator}
      {...groupDrop}
    >
      <div className="sr-q__head">
        <span className="sr-q__glabel">{depth === 0 ? "Conditions" : "Group"}</span>
        {onRemoveSelf ? (
          <button type="button" className="sr-q__remove" onClick={onRemoveSelf} aria-label="Remove group" title="Remove group">
            <X size={14} strokeWidth={2.4} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {group.children.length === 0 ? (
        dragging ? (
          <div className="sr-q__empty sr-q__empty--drop">Drop a condition here to add it to this group</div>
        ) : (
          <div className="sr-q__empty">No conditions yet — add one below.</div>
        )
      ) : (
        <div className={`sr-q__kids${dragging ? " is-dropmode" : ""}`}>
          {group.children.map((child, index) => (
            <div
              key={child.id}
              className={`sr-q__child${drag.dragId === child.id ? " is-dragging" : ""}${lineBefore(child.id) ? " is-insert" : ""}`}
              {...rowDrop(child, index)}
            >
              {lineBefore(child.id) ? <span className="sr-q__insert" aria-hidden="true" /> : null}
              {index > 0 && !dragging ? (
                <GapOperator op={groupCombinatorAt(group, index - 1)} onToggle={() => toggleGap(index - 1)} />
              ) : null}
              <div className="sr-q__childrow">
                {child.kind === "predicate" ? (
                  <>
                    <DragGrip childId={child.id} />
                    <PredicateRowNode
                      predicate={child.predicate}
                      onChange={(next) =>
                        onRootChange(
                          updateNode(root, child.id, (node) =>
                            node.kind === "predicate" ? ({ ...node, predicate: next } as QueryNode) : node,
                          ),
                        )
                      }
                      onRemove={() => onRootChange(removeNode(root, child.id))}
                    />
                  </>
                ) : (
                  <QueryGroupNode
                    group={child}
                    root={root}
                    onRootChange={onRootChange}
                    depth={depth + 1}
                    onRemoveSelf={() => onRootChange(removeNode(root, child.id))}
                  />
                )}
              </div>
            </div>
          ))}
          {intoThisGroup ? <span className="sr-q__insert sr-q__insert--end" aria-hidden="true" /> : null}
        </div>
      )}

      <div className="sr-q__actions">
        <button type="button" className="sr-q__add" onClick={addCondition}>
          <Plus size={15} strokeWidth={2.4} aria-hidden="true" /> Condition
        </button>
        <button type="button" className="sr-q__addgroup" onClick={addSubGroup}>
          <FolderPlus size={15} strokeWidth={2} aria-hidden="true" /> Group
        </button>
      </div>
    </div>
  );
}

// Grip handle - only conditions are draggable (not groups). Sets the dragged
// row as the drag image so the cursor carries the whole condition.
function DragGrip({ childId }: { childId: string }) {
  const drag = useQueryDrag();
  return (
    <button
      type="button"
      className="sr-q__grip"
      draggable
      aria-label="Drag to move condition"
      title="Drag to move this condition"
      onDragStart={(e) => {
        drag.begin(childId);
        const row = e.currentTarget.parentElement;
        if (row) e.dataTransfer.setDragImage(row, 12, 12);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => drag.cancel()}
    >
      <GripVertical size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

// Per-gap operator between two consecutive conditions. AND renders as a compact
// inline chip (the rows read as a tight cluster); OR renders as a full-width
// divider, so OR visually separates the AND-clusters - making the AND-over-OR
// precedence legible without explicit brackets.
function GapOperator({ op, onToggle }: { op: "and" | "or"; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="sr-q__op"
      data-op={op}
      onClick={onToggle}
      aria-label={`Operator ${op.toUpperCase()} — click to toggle`}
      title="Toggle AND / OR"
    >
      <span className="sr-q__op-label">{op === "and" ? "AND" : "OR"}</span>
    </button>
  );
}

function PredicateRowNode({
  predicate,
  onChange,
  onRemove,
}: {
  predicate: Predicate;
  onChange: (next: Predicate) => void;
  onRemove: () => void;
}) {
  const setKind = (kind: string) => {
    if (kind !== predicate.kind) onChange(createDefaultPredicate(kind as Predicate["kind"]));
  };
  return (
    <div className="sr-p">
      <BetaSelect
        className="sr-p__kind"
        size="sm"
        ariaLabel="Condition type"
        value={predicate.kind}
        options={KIND_OPTIONS}
        onChange={setKind}
      />
      {predicate.kind === "stat-num" ? <NumControls predicate={predicate} onChange={onChange} /> : null}
      {predicate.kind === "stat-cat" ? <CatControls predicate={predicate} onChange={onChange} /> : null}
      {predicate.kind === "ability" ? <AbilityControls predicate={predicate} onChange={onChange} /> : null}
      {predicate.kind === "status" ? <StatusControls predicate={predicate} onChange={onChange} /> : null}
      <button type="button" className="sr-p__remove" onClick={onRemove} aria-label="Remove condition" title="Remove condition">
        <X size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}

function NumControls({
  predicate,
  onChange,
}: {
  predicate: Extract<Predicate, { kind: "stat-num" }>;
  onChange: (next: Predicate) => void;
}) {
  return (
    <>
      <BetaSelect
        className="sr-p__field"
        size="sm"
        ariaLabel="Stat field"
        value={predicate.field}
        groups={NUMERIC_FIELD_GROUPS}
        onChange={(v) => onChange({ ...predicate, field: v as NumericStatField })}
      />
      <BetaSelect
        className="sr-p__op"
        size="sm"
        searchable={false}
        ariaLabel="Comparator"
        value={predicate.op}
        options={NUMERIC_OP_OPTIONS}
        onChange={(v) => onChange({ ...predicate, op: v as NumericComparator })}
      />
      <DraftNumber value={predicate.value} onChange={(v) => onChange({ ...predicate, value: v })} ariaLabel="Value" />
    </>
  );
}

function CatControls({
  predicate,
  onChange,
}: {
  predicate: Extract<Predicate, { kind: "stat-cat" }>;
  onChange: (next: Predicate) => void;
}) {
  const valueOptions = CATEGORICAL_VALUE_OPTIONS[predicate.field].map((option) => ({ value: option, label: option }));
  return (
    <>
      <BetaSelect
        className="sr-p__field"
        size="sm"
        ariaLabel="Stat field"
        value={predicate.field}
        options={CATEGORICAL_FIELD_OPTIONS}
        onChange={(v) => {
          const nextField = v as CategoricalStatField;
          const nextOptions = CATEGORICAL_VALUE_OPTIONS[nextField];
          onChange({
            ...predicate,
            field: nextField,
            value: nextOptions.includes(predicate.value) ? predicate.value : nextOptions[0] ?? "",
          });
        }}
      />
      <Segmented
        ariaLabel="Comparator"
        value={predicate.op}
        options={[
          { value: "eq", label: "is" },
          { value: "neq", label: "is not" },
        ]}
        onChange={(v) => onChange({ ...predicate, op: v as EqualityComparator })}
      />
      <BetaSelect
        className="sr-p__value"
        size="sm"
        ariaLabel="Value"
        value={predicate.value}
        options={valueOptions}
        onChange={(v) => onChange({ ...predicate, value: v })}
      />
    </>
  );
}

function AbilityControls({
  predicate,
  onChange,
}: {
  predicate: Extract<Predicate, { kind: "ability" }>;
  onChange: (next: Predicate) => void;
}) {
  const names = ABILITY_NAMES_BY_KIND[predicate.abilityKind];
  const nameOptions = names.map((name) => ({ value: name, label: name }));
  return (
    <>
      <BetaSelect
        className="sr-p__field"
        size="sm"
        ariaLabel="Ability kind"
        value={predicate.abilityKind}
        options={ABILITY_KIND_OPTIONS}
        onChange={(v) => {
          const nextKind = v as AbilityKind;
          const nextNames = ABILITY_NAMES_BY_KIND[nextKind];
          onChange({
            ...predicate,
            abilityKind: nextKind,
            name: nextNames.includes(predicate.name) ? predicate.name : nextNames[0] ?? "",
          });
        }}
      />
      <Segmented
        ariaLabel="Has or lacks"
        value={predicate.mode}
        options={[
          { value: "has", label: "has" },
          { value: "lacks", label: "lacks" },
        ]}
        onChange={(v) => onChange({ ...predicate, mode: v as "has" | "lacks" })}
      />
      <BetaSelect
        className="sr-p__name"
        size="sm"
        searchable
        ariaLabel="Ability"
        placeholder="(none available)"
        value={predicate.name}
        options={nameOptions}
        onChange={(v) => onChange({ ...predicate, name: v })}
      />
    </>
  );
}

function StatusControls({
  predicate,
  onChange,
}: {
  predicate: Extract<Predicate, { kind: "status" }>;
  onChange: (next: Predicate) => void;
}) {
  const statusOptions = STATUS_OPTIONS_BY_SLOT[predicate.slot].map((option) => ({ value: option.id, label: option.label }));
  return (
    <>
      <BetaSelect
        className="sr-p__field"
        size="sm"
        ariaLabel="Status slot"
        value={predicate.slot}
        options={STATUS_SLOT_OPTIONS}
        onChange={(v) => {
          const nextSlot = v as StatusSlot;
          const nextOptions = STATUS_OPTIONS_BY_SLOT[nextSlot];
          const stillValid = nextOptions.some((option) => option.id === predicate.status);
          onChange({ ...predicate, slot: nextSlot, status: stillValid ? predicate.status : nextOptions[0]?.id ?? "" });
        }}
      />
      <BetaSelect
        className="sr-p__name"
        size="sm"
        searchable
        ariaLabel="Status"
        placeholder="(none)"
        value={predicate.status}
        options={statusOptions}
        onChange={(v) => onChange({ ...predicate, status: v })}
      />
      <BetaSelect
        className="sr-p__op"
        size="sm"
        searchable={false}
        ariaLabel="Comparator"
        value={predicate.op}
        options={NUMERIC_OP_OPTIONS}
        onChange={(v) => onChange({ ...predicate, op: v as NumericComparator })}
      />
      <DraftNumber
        value={predicate.value}
        onChange={(v) => onChange({ ...predicate, value: v })}
        step={predicate.slot === "resist" ? 0.05 : 1}
        ariaLabel={predicate.slot === "resist" ? "Fraction (0-1)" : "Stacks"}
      />
    </>
  );
}

function Segmented({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: BetaSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="cb-seg sr-p__seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`cb-seg__opt${value === option.value ? " is-active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Number input with a local-draft string so in-progress decimal input (`0.`,
 * `-`) survives until commit on blur / Enter. Mirrors the classic
 * PredicateRow's NumericValueInput - same reason `type="text"` + inputmode is
 * used instead of `type="number"`.
 */
function DraftNumber({
  value,
  onChange,
  step,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string>(() => (Number.isFinite(value) ? String(value) : ""));
  const committed = useRef<number>(value);
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(Number.isFinite(value) ? String(value) : "");
    }
  }, [value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === ".") {
      setDraft(String(committed.current));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(committed.current));
      return;
    }
    committed.current = parsed;
    setDraft(String(parsed));
    if (parsed !== value) onChange(parsed);
  };
  return (
    <input
      className="sr-p__num"
      type="text"
      inputMode="decimal"
      data-step={step}
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
