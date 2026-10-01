import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import {
  useDashboardLayout,
  compactLayouts,
  DASHBOARD_PRESETS,
} from '../useDashboardLayout';
import { layoutsEqual } from '../../components/dashboardLayoutActions';
import type { SavedDashboard } from '../../widgets/types';

// Storage keys are module-private; mirror the literals (see useDashboardLayout).
const DASHBOARDS_KEY = 'teslasync-dashboards';
const ACTIVE_KEY = 'teslasync-active-dashboard';
const ROW_VERSION_KEY = 'teslasync-row-height-version';

vi.mock('@/api/hooks/useSettings', () => ({
  useDashboardLayouts: () => ({ data: undefined }),
  useSaveDashboardLayouts: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/broadcast', () => ({
  broadcast: vi.fn(),
  subscribe: () => () => undefined,
}));

function seedDashboard(dash: SavedDashboard, rowVersion?: string) {
  window.localStorage.setItem(DASHBOARDS_KEY, JSON.stringify([dash]));
  window.localStorage.setItem(ACTIVE_KEY, dash.id);
  if (rowVersion !== undefined) {
    window.localStorage.setItem(ROW_VERSION_KEY, rowVersion);
  }
}

function craftedDashboard(): SavedDashboard {
  // 5 widgets whose md flow leaves a hole WITH an item below it: E must rise
  // to y2. D sits at (1,2) so visual order flows D before E (E lands x1y4,
  // below B's row-2 edge), and compaction then pulls E up into rows 2-4.
  const widgets = [
    { id: 'w-a', widgetId: 'battery-gauge' },
    { id: 'w-b', widgetId: 'range-estimate' },
    { id: 'w-c', widgetId: 'charge-status' },
    { id: 'w-d', widgetId: 'climate-status' },
    { id: 'w-e', widgetId: 'security-status' },
  ];
  return {
    id: 'craft',
    name: 'Craft',
    widgets,
    layouts: {
      md: [
        { i: 'w-a', x: 0, y: 0, w: 1, h: 4 },
        { i: 'w-b', x: 1, y: 0, w: 1, h: 2 },
        { i: 'w-c', x: 2, y: 0, w: 1, h: 2 },
        { i: 'w-d', x: 1, y: 2, w: 1, h: 2 },
        { i: 'w-e', x: 0, y: 4, w: 1, h: 2 },
      ],
    },
  } as SavedDashboard;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('useDashboardLayout — row-height migration stamp', () => {
  it('stamps the current version on a fresh load (no stored dashboards)', () => {
    renderHook(() => useDashboardLayout());
    expect(window.localStorage.getItem(ROW_VERSION_KEY)).toBe('2');
  });

  it('does NOT migrate v2-native stored data on reload (h stable)', () => {
    seedDashboard(craftedDashboard(), '2');
    const { result } = renderHook(() => useDashboardLayout());
    const md = result.current.activeDashboard.layouts.md;
    // w-a keeps its h4 (a ×2.25 re-migration would make it h9).
    expect(md.find((l) => l.i === 'w-a')?.h).toBe(4);
    expect(md.find((l) => l.i === 'w-b')?.h).toBe(2);
  });

  it('still migrates genuinely old (unstamped) stored data one time', () => {
    seedDashboard(craftedDashboard());
    const { result } = renderHook(() => useDashboardLayout());
    const md = result.current.activeDashboard.layouts.md;
    // 180px rows → 80px rows: h × 2.25 (h2→h5, h4→h9), then stamped.
    expect(md.find((l) => l.i === 'w-b')?.h).toBe(5);
    expect(md.find((l) => l.i === 'w-a')?.h).toBe(9);
    expect(window.localStorage.getItem(ROW_VERSION_KEY)).toBe('2');
  });
});

describe('useDashboardLayout — autoArrange compacts after flowing', () => {
  it('pulls items below a flow hole upward (E rises to y2)', () => {
    seedDashboard(craftedDashboard(), '2');
    const { result } = renderHook(() => useDashboardLayout());

    act(() => {
      result.current.autoArrange();
    });

    const md = result.current.activeDashboard.layouts.md;
    // Column 1 rows 2-4 are empty (B ends at y2); E must rise into them.
    // Without compact-after-flow E stays at y4 and the reload visibly shifts.
    expect(md.find((l) => l.i === 'w-e')).toMatchObject({ x: 1, y: 2 });
  });
});

describe('useDashboardLayout — addWidgetAt (toolbox drops)', () => {
  it('lands the widget at the drop cell on the source breakpoint', () => {
    seedDashboard(craftedDashboard(), '2');
    const { result } = renderHook(() => useDashboardLayout());

    act(() => {
      // quick-nav min is 2 cols; cols 1-2 rows 4-6 are free: lands exactly.
      result.current.addWidgetAt('quick-nav', { x: 1, y: 4, w: 2, h: 2 }, 'md');
    });

    const { widgets, layouts } = result.current.activeDashboard;
    expect(widgets).toHaveLength(6);
    const added = widgets.find((w) => w.widgetId === 'quick-nav')!;
    const item = layouts.md.find((l) => l.i === added.id)!;
    // Lands exactly; other breakpoints bottom-place.
    expect(item).toMatchObject({ x: 1, y: 4, w: 2, h: 2 });
    expect(layouts.lg.find((l) => l.i === added.id)).toBeDefined();
    expect(layouts.xs.find((l) => l.i === added.id)).toBeDefined();
  });

  it('pushes colliding drops down (matching the placeholder preview)', () => {
    seedDashboard(craftedDashboard(), '2');
    const { result } = renderHook(() => useDashboardLayout());

    act(() => {
      // (0,0) is occupied by w-a (h4): the drop must resolve below it.
      result.current.addWidgetAt('quick-nav', { x: 0, y: 0, w: 1, h: 2 }, 'md');
    });

    const { widgets, layouts } = result.current.activeDashboard;
    const added = widgets.find((w) => w.widgetId === 'quick-nav')!;
    const item = layouts.md.find((l) => l.i === added.id)!;
    expect(item.x).toBe(0);
    expect(item.y).toBeGreaterThanOrEqual(4);
    expect(item.x + item.w).toBeLessThanOrEqual(3);
  });

  it('clamps out-of-bounds placements to the grid', () => {
    seedDashboard(craftedDashboard(), '2');
    const { result } = renderHook(() => useDashboardLayout());

    act(() => {
      result.current.addWidgetAt('quick-nav', { x: 99, y: -5, w: 9, h: 99 }, 'md');
    });

    const { widgets, layouts } = result.current.activeDashboard;
    const added = widgets.find((w) => w.widgetId === 'quick-nav')!;
    const item = layouts.md.find((l) => l.i === added.id)!;
    expect(item.x + item.w).toBeLessThanOrEqual(3);
    expect(item.y).toBeGreaterThanOrEqual(0);
    // quick-nav min is 2 cols: w clamps up to minW, h clamps down to maxH.
    expect(item.w).toBeGreaterThanOrEqual(2);
    expect(item.h).toBeLessThanOrEqual(40);
  });

  it('ignores duplicates and unknown widgets', () => {
    seedDashboard(craftedDashboard(), '2');
    const { result } = renderHook(() => useDashboardLayout());

    act(() => {
      result.current.addWidgetAt('battery-gauge', { x: 0, y: 0, w: 1, h: 2 }, 'md');
      result.current.addWidgetAt('no-such-widget', { x: 0, y: 0, w: 1, h: 2 }, 'md');
    });

    expect(result.current.activeDashboard.widgets).toHaveLength(5);
  });
});

describe('useDashboardLayout — hint drop', () => {
  it('adds and arranges in one persisted update, supports undo, and rejects duplicate drops', () => {
    seedDashboard(craftedDashboard(), '2');
    const { result } = renderHook(() => useDashboardLayout());
    const original = result.current.activeDashboard;

    act(() => result.current.addWidgetAndArrange('quick-nav'));

    const saved = JSON.parse(localStorage.getItem(DASHBOARDS_KEY) ?? '[]') as SavedDashboard[];
    const next = result.current.activeDashboard;
    expect(next.widgets).toHaveLength(original.widgets.length + 1);
    expect(saved[0].widgets).toEqual(next.widgets);
    expect(saved[0].layouts).toEqual(next.layouts);
    expect(result.current.canUndo).toBe(true);
    for (const items of Object.values(next.layouts)) {
      for (const [index, a] of items.entries()) {
        for (const b of items.slice(index + 1)) {
          expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
        }
      }
    }
    act(() => {
      result.current.addWidgetAndArrange('quick-nav');
      result.current.addWidgetAndArrange('not-a-widget');
    });
    expect(result.current.activeDashboard.widgets).toHaveLength(original.widgets.length + 1);
    act(() => result.current.undo());
    expect(result.current.activeDashboard.widgets).toEqual(original.widgets);
  });
});

describe('dashboard presets — pre-compacted', () => {
  it.each(DASHBOARD_PRESETS.map((p) => [p.id]))(
    'preset %s is already compact (no floaters)',
    (id) => {
      const preset = DASHBOARD_PRESETS.find((p) => p.id === id)!;
      // Idempotence ⟺ already compact: compaction must be a no-op.
      expect(layoutsEqual(compactLayouts(preset.layouts), preset.layouts)).toBe(true);
    },
  );
});
