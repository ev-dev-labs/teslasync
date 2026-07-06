import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUndoRedo } from './useUndoRedo';

interface Snapshot {
  widgets: string[];
  layouts: Record<string, number>;
}

describe('useUndoRedo — initial state', () => {
  it('exposes the initial value with empty history', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));
    expect(result.current.current).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoCount).toBe(0);
  });
});

describe('useUndoRedo — set', () => {
  it('updates current, records history, and enables undo', () => {
    const { result } = renderHook(() => useUndoRedo<number>(1));

    act(() => result.current.set(2));

    expect(result.current.current).toBe(2);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoCount).toBe(1);
  });

  it('accumulates multiple set calls in the undo stack', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));

    act(() => result.current.set(1));
    act(() => result.current.set(2));
    act(() => result.current.set(3));

    expect(result.current.current).toBe(3);
    expect(result.current.undoCount).toBe(3);
  });

  it('clears the redo stack when a new value is set after an undo', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));

    act(() => result.current.set(1));
    act(() => result.current.set(2));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    // Branching the history should discard the previously-redoable future.
    act(() => result.current.set(9));
    expect(result.current.canRedo).toBe(false);
    expect(result.current.current).toBe(9);
  });
});

describe('useUndoRedo — undo', () => {
  it('restores and returns the previous value', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));

    act(() => result.current.set(1));
    act(() => result.current.set(2));

    let returned: number | undefined;
    act(() => {
      returned = result.current.undo();
    });

    expect(returned).toBe(1);
    expect(result.current.current).toBe(1);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.undoCount).toBe(1);
  });

  it('returns undefined and is a no-op when there is nothing to undo', () => {
    const { result } = renderHook(() => useUndoRedo<number>(42));

    let returned: number | undefined = -1;
    act(() => {
      returned = result.current.undo();
    });

    expect(returned).toBeUndefined();
    expect(result.current.current).toBe(42);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});

describe('useUndoRedo — redo', () => {
  it('re-applies and returns the undone value', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));

    act(() => result.current.set(1));
    act(() => result.current.undo());

    let returned: number | undefined;
    act(() => {
      returned = result.current.redo();
    });

    expect(returned).toBe(1);
    expect(result.current.current).toBe(1);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });

  it('returns undefined and is a no-op when there is nothing to redo', () => {
    const { result } = renderHook(() => useUndoRedo<number>(7));

    let returned: number | undefined = -1;
    act(() => {
      returned = result.current.redo();
    });

    expect(returned).toBeUndefined();
    expect(result.current.current).toBe(7);
    expect(result.current.canRedo).toBe(false);
  });
});

describe('useUndoRedo — round trips', () => {
  it('supports multiple undo then redo back to the latest value', () => {
    const { result } = renderHook(() => useUndoRedo<string>('a'));

    act(() => result.current.set('b'));
    act(() => result.current.set('c'));

    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.current).toBe('a');
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.redo());
    act(() => result.current.redo());
    expect(result.current.current).toBe('c');
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoCount).toBe(2);
  });
});

describe('useUndoRedo — reset', () => {
  it('clears both stacks and installs the new value', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));

    act(() => result.current.set(1));
    act(() => result.current.set(2));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.reset(100));

    expect(result.current.current).toBe(100);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoCount).toBe(0);
  });
});

describe('useUndoRedo — history cap', () => {
  it('caps the undo stack at 50 entries, dropping the oldest', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));

    // 60 mutations: initial 0 plus values 1..60. Only the most recent 50
    // prior states may be retained.
    for (let i = 1; i <= 60; i += 1) {
      act(() => result.current.set(i));
    }

    expect(result.current.current).toBe(60);
    expect(result.current.undoCount).toBe(50);

    // The freshest history entry is intact.
    let returned: number | undefined;
    act(() => {
      returned = result.current.undo();
    });
    expect(returned).toBe(59);

    // Exhaust the remaining 49 entries; the oldest retained state is 10
    // (values 0..9 were shifted out by the cap).
    for (let i = 0; i < 49; i += 1) {
      act(() => result.current.undo());
    }
    expect(result.current.current).toBe(10);
    expect(result.current.canUndo).toBe(false);
  });
});

describe('useUndoRedo — undefined and null values', () => {
  // Regression guard: undo/redo must key off stack length, not off the
  // popped value being `undefined`. Otherwise storing `undefined` as a
  // legitimate value silently breaks history traversal.
  it('treats a stored undefined as a real, restorable state', () => {
    const { result } = renderHook(() => useUndoRedo<string | undefined>('a'));

    act(() => result.current.set(undefined));
    act(() => result.current.set('b'));

    let returned: string | undefined = 'sentinel';
    act(() => {
      returned = result.current.undo();
    });

    // The undo genuinely happened: current is now the undefined we stored,
    // and 'b' became redoable — proving it was not mistaken for an empty stack.
    expect(returned).toBeUndefined();
    expect(result.current.current).toBeUndefined();
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.current).toBe('a');
    expect(result.current.canUndo).toBe(false);
  });

  it('redoes back through an undefined state', () => {
    const { result } = renderHook(() => useUndoRedo<string | undefined>('a'));

    act(() => result.current.set(undefined));
    act(() => result.current.undo());
    expect(result.current.current).toBe('a');

    let returned: string | undefined = 'sentinel';
    act(() => {
      returned = result.current.redo();
    });
    expect(returned).toBeUndefined();
    expect(result.current.current).toBeUndefined();
  });

  it('handles null values distinctly from the empty-stack case', () => {
    const { result } = renderHook(() => useUndoRedo<string | null>(null));

    act(() => result.current.set('x'));
    act(() => result.current.undo());

    expect(result.current.current).toBeNull();
    expect(result.current.canRedo).toBe(true);
  });
});

describe('useUndoRedo — object snapshots (real usage shape)', () => {
  it('preserves object identity across undo/redo', () => {
    const a: Snapshot = { widgets: ['speed'], layouts: { speed: 1 } };
    const b: Snapshot = { widgets: ['speed', 'range'], layouts: { speed: 1, range: 2 } };

    const { result } = renderHook(() => useUndoRedo<Snapshot>(a));

    act(() => result.current.set(b));
    expect(result.current.current).toBe(b);

    let returned: Snapshot | undefined;
    act(() => {
      returned = result.current.undo();
    });
    expect(returned).toBe(a);
    expect(result.current.current).toEqual({ widgets: ['speed'], layouts: { speed: 1 } });
  });
});

describe('useUndoRedo — callback stability', () => {
  it('keeps the action callbacks referentially stable across renders', () => {
    const { result, rerender } = renderHook(() => useUndoRedo<number>(0));

    const first = {
      set: result.current.set,
      undo: result.current.undo,
      redo: result.current.redo,
      reset: result.current.reset,
    };

    act(() => result.current.set(1));
    rerender();

    expect(result.current.set).toBe(first.set);
    expect(result.current.undo).toBe(first.undo);
    expect(result.current.redo).toBe(first.redo);
    expect(result.current.reset).toBe(first.reset);
  });
});
