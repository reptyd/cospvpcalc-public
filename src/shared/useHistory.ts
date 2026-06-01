import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState-shaped hook with an undo/redo history stack underneath.
 * Returns the same `[value, setter]` tuple as `useState`, plus
 * `{ undo, redo, canUndo, canRedo }` controls.
 *
 * Each non-equal commit through `setter` pushes the previous value
 * onto the undo stack; calling `undo()` pops it back into present
 * (and pushes the previous present onto redo). A new commit clears
 * redo (typical undo-redo semantics — branches are dropped).
 *
 * History caps at 100 entries to avoid unbounded memory growth on
 * long editing sessions; oldest entries fall off.
 *
 * `equalsFn` defaults to `Object.is`. For complex object state
 * (where edits return new objects on every keystroke even if
 * structurally identical), pass a deep-equality / JSON-stringify
 * comparator.
 */
export type UseHistoryReturn<T> = readonly [
  T,
  Dispatch<SetStateAction<T>>,
  {
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    reset: (newInitial: T) => void;
  },
];

const MAX_HISTORY = 100;

export function useHistory<T>(
  initial: T,
  equalsFn: (a: T, b: T) => boolean = Object.is,
): UseHistoryReturn<T> {
  const [present, setPresent] = useState<T>(initial);
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  // Force a re-render when history depth changes so canUndo / canRedo
  // flip correctly without callers polling.
  const [, bumpRev] = useState(0);
  const tick = useCallback(() => bumpRev((x) => x + 1), []);

  const setter = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setPresent((prev) => {
        const value =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (equalsFn(prev, value)) return prev;
        undoStack.current.push(prev);
        if (undoStack.current.length > MAX_HISTORY) {
          undoStack.current.shift();
        }
        redoStack.current = [];
        tick();
        return value;
      });
    },
    [equalsFn, tick],
  );

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    setPresent((prev) => {
      const last = undoStack.current.pop()!;
      redoStack.current.push(prev);
      if (redoStack.current.length > MAX_HISTORY) {
        redoStack.current.shift();
      }
      tick();
      return last;
    });
  }, [tick]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    setPresent((prev) => {
      const next = redoStack.current.pop()!;
      undoStack.current.push(prev);
      if (undoStack.current.length > MAX_HISTORY) {
        undoStack.current.shift();
      }
      tick();
      return next;
    });
  }, [tick]);

  const reset = useCallback(
    (newInitial: T) => {
      undoStack.current = [];
      redoStack.current = [];
      setPresent(newInitial);
      tick();
    },
    [tick],
  );

  // Reading ref `.current` during render is intentional here — the
  // `tick()` callback above bumps the `bumpRev` counter every time
  // either stack mutates, so the next render reads fresh lengths.
  // eslint-plugin-react-hooks v7 flags this as a "refs during render"
  // violation but the bumpRev forcing-rerender pattern makes the read
  // consistent with how state would behave. Disable per-line with a
  // pointer to the mechanism so future readers don't undo it.
  return [
    present,
    setter,
    {
      undo,
      redo,
      // eslint-disable-next-line react-hooks/refs -- bumpRev triggers re-render on mutation
      canUndo: undoStack.current.length > 0,
      // eslint-disable-next-line react-hooks/refs -- bumpRev triggers re-render on mutation
      canRedo: redoStack.current.length > 0,
      reset,
    },
  ] as const;
}
