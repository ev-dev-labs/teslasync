/**
 * Behaviour + hardening coverage for useDashboardLayout.ts — the dashboard
 * layout engine behind the fleet Command Center.
 *
 * Every export is exercised:
 *   - GRID_BREAKPOINTS / GRID_COLS / ROW_HEIGHT / GRID_MARGIN — the grid contract.
 *   - DASHBOARD_PRESETS — preset library integrity (default-first, valid widgets,
 *     every breakpoint present, unique ids).
 *   - reconcileLayouts — the pure reconciliation/compaction primitive: size
 *     preservation, registry min/max clamping (breakpoint-aware), stale-item
 *     removal, missing-item synthesis, and vertical gap compaction.
 *   - useDashboardLayout — the full hook surface: widget + dashboard CRUD,
 *     layout actions, undo/redo, import/export, per-vehicle pinning/visibility,
 *     debounced backend sync + dirty flag, first-load backend hydration,
 *     cross-tab reload, legacy migration, and corrupt-storage salvage.
 *
 * The two collaborators that reach the network / other tabs are mocked at the
 * module boundary (repo convention): `@/api/hooks/useSettings` (TanStack Query
 * read + save) and `@/lib/broadcast` (BroadcastChannel bus). Everything else —
 * the widget registry, react-grid-layout compactor, undo/redo — runs for real,
 * and localStorage is the jsdom implementation cleared between tests. Fake
 * timers make the 2s debounce deterministic and keep pending writes from
 * leaking across tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type { BroadcastMessage } from '@/lib/broadcast';
import type {
  WidgetInstance,
  WidgetConfig,
  RGLLayouts,
  SavedDashboard,
  DashboardSettings,
} from '../widgets/types';
import { WIDGET_REGISTRY } from '../widgets/registry';

// ── Hoisted mock state ──────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const saveMutate = vi.fn(
    (_payload: unknown, opts?: { onSuccess?: () => void }) => {
      // Mirror TanStack Query's mutate(payload, { onSuccess }) contract so the
      // hook's dirty flag clears exactly as it would in production.
      opts?.onSuccess?.();
    },
  );
  return {
    saveMutate,
    saveMutation: { mutate: saveMutate },
    backend: { data: undefined as unknown },
    broadcastFn: vi.fn(),
    subscribers: [] as Array<(m: BroadcastMessage) => void>,
  };
});

vi.mock('@/api/hooks/useSettings', () => ({
  useDashboardLayouts: () => ({ data: h.backend.data }),
  useSaveDashboardLayouts: () => h.saveMutation,
}));

vi.mock('@/lib/broadcast', () => ({
  broadcast: (m: BroadcastMessage) => {
    h.broadcastFn(m);
  },
  subscribe: (cb: (m: BroadcastMessage) => void) => {
    h.subscribers.push(cb);
    return () => {
      const i = h.subscribers.indexOf(cb);
      if (i >= 0) h.subscribers.splice(i, 1);
    };
  },
}));

import {
  useDashboardLayout,
  reconcileLayouts,
  GRID_BREAKPOINTS,
  GRID_COLS,
  ROW_HEIGHT,
  GRID_MARGIN,
  DASHBOARD_PRESETS,
} from './useDashboardLayout';

// ── Storage keys (kept in sync with the module under test) ──────────────────
const DASHBOARDS_KEY = 'teslasync-dashboards';
const ACTIVE_KEY = 'teslasync-active-dashboard';
const LEGACY_KEY = 'teslasync-dashboard-layout';
const ROW_VERSION_KEY = 'teslasync-row-height-version';

const BREAKPOINTS = ['lg', 'md', 'sm', 'xs'];

// ── Helpers ─────────────────────────────────────────────────────────────────
function widget(id: string, widgetId: string, config?: WidgetConfig): WidgetInstance {
  return { id, widgetId, config };
}

function savedDashboard(over: Partial<SavedDashboard> = {}): SavedDashboard {
  return {
    id: 'srv',
    name: 'Server Dash',
    widgets: [widget('s1', 'battery-gauge')],
    layouts: { lg: [{ i: 's1', x: 0, y: 0, w: 1, h: 2 }] },
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2020-01-01T00:00:00Z',
    ...over,
  };
}

function lsDashboards(): SavedDashboard[] {
  return JSON.parse(localStorage.getItem(DASHBOARDS_KEY) ?? '[]') as SavedDashboard[];
}

/** Advance the fake clock a little without tripping the 2s debounce — also
 * makes back-to-back `Date.now()`-derived ids unique. */
function tick(ms = 5): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function render() {
  return renderHook(() => useDashboardLayout());
}

beforeEach(() => {
  localStorage.clear();
  h.backend.data = undefined;
  h.subscribers.length = 0;
  h.saveMutate.mockClear();
  h.broadcastFn.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ════════════════════════════════════════════════════════════════════════════
// Grid constants
// ════════════════════════════════════════════════════════════════════════════
describe('grid constants', () => {
  it('exposes the documented breakpoint pixel widths', () => {
    expect(GRID_BREAKPOINTS).toEqual({ lg: 1200, md: 996, sm: 768, xs: 480 });
  });

  it('maps each breakpoint to a descending column count', () => {
    expect(GRID_COLS).toEqual({ lg: 4, md: 3, sm: 2, xs: 1 });
    expect(Object.keys(GRID_COLS)).toEqual(Object.keys(GRID_BREAKPOINTS));
    const cols = Object.values(GRID_COLS);
    const descending = [...cols].sort((a, b) => b - a);
    expect(cols).toEqual(descending);
  });

  it('pins the row height + margin used by the grid renderer', () => {
    expect(ROW_HEIGHT).toBe(80);
    expect(GRID_MARGIN).toEqual([16, 16]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Preset library
// ════════════════════════════════════════════════════════════════════════════
describe('DASHBOARD_PRESETS', () => {
  it('leads with the default preset and gives it every seeded widget', () => {
    expect(DASHBOARD_PRESETS[0].id).toBe('default');
    expect(DASHBOARD_PRESETS[0].isDefault).toBe(true);
    expect(DASHBOARD_PRESETS[0].widgets[0].widgetId).toBe('onboarding-checklist');
    expect(DASHBOARD_PRESETS[0].widgets).toHaveLength(8);
  });

  it('uses unique ids across the library', () => {
    const ids = DASHBOARD_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references only real registry widgets and lays out every breakpoint', () => {
    const registryIds = new Set(WIDGET_REGISTRY.map((w) => w.id));
    for (const preset of DASHBOARD_PRESETS) {
      expect(preset.widgets.length).toBeGreaterThan(0);
      for (const w of preset.widgets) {
        expect(registryIds.has(w.widgetId)).toBe(true);
      }
      expect(Object.keys(preset.layouts).sort()).toEqual([...BREAKPOINTS].sort());
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// reconcileLayouts (pure)
// ════════════════════════════════════════════════════════════════════════════
describe('reconcileLayouts', () => {
  it('always returns a layout for every breakpoint, empty for no widgets', () => {
    const out = reconcileLayouts({}, []);
    expect(Object.keys(out).sort()).toEqual([...BREAKPOINTS].sort());
    expect(out.lg).toEqual([]);
    expect(out.xs).toEqual([]);
  });

  it('preserves x, clamps w/h to registry min/max, and compacts y', () => {
    // vehicle-hero: min {cols:2, rows:4}, max {cols:4, rows:40}.
    const out = reconcileLayouts(
      { lg: [{ i: 'w1', x: 1, y: 9, w: 1, h: 100 }] },
      [widget('w1', 'vehicle-hero')],
    );
    const item = out.lg[0];
    expect(item.w).toBe(2); // clamped up to minW
    expect(item.h).toBe(40); // clamped down to maxH
    expect(item.x).toBe(1); // horizontal position preserved
    expect(item.y).toBe(0); // vertical gap compacted away
  });

  it('clamps widths down to the column count at narrow breakpoints', () => {
    // vehicle-hero minSize.cols is 2, but the xs breakpoint only has 1 column.
    const out = reconcileLayouts({}, [widget('w1', 'vehicle-hero')]);
    expect(out.xs[0].w).toBe(1);
    expect(out.lg[0].w).toBeGreaterThanOrEqual(2);
  });

  it('drops layout items whose widget no longer exists', () => {
    const out = reconcileLayouts(
      {
        lg: [
          { i: 'ghost', x: 0, y: 0, w: 1, h: 1 },
          { i: 'w1', x: 0, y: 0, w: 2, h: 5 },
        ],
      },
      [widget('w1', 'vehicle-hero')],
    );
    expect(out.lg.find((l) => l.i === 'ghost')).toBeUndefined();
    expect(out.lg.find((l) => l.i === 'w1')).toBeDefined();
  });

  it('synthesises a layout item for a widget missing from the input', () => {
    const out = reconcileLayouts({ lg: [] }, [widget('w1', 'battery-gauge')]);
    expect(out.lg).toHaveLength(1);
    expect(out.lg[0].i).toBe('w1');
    expect(Number.isFinite(out.lg[0].y)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — initial state
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — initial state', () => {
  it('seeds the default dashboard when storage is empty', () => {
    const { result } = render();
    expect(result.current.dashboards).toHaveLength(1);
    expect(result.current.activeId).toBe('default');
    expect(result.current.activeDashboard.id).toBe('default');
    expect(result.current.editMode).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoCount).toBe(0);
  });

  it('toggles edit mode', () => {
    const { result } = render();
    act(() => result.current.setEditMode(true));
    expect(result.current.editMode).toBe(true);
    act(() => result.current.setEditMode(false));
    expect(result.current.editMode).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — widget CRUD
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — widget CRUD', () => {
  it('adds a new widget, persists it, records undo history, and broadcasts', () => {
    const { result } = render();
    const before = result.current.activeDashboard.widgets.length;

    act(() => result.current.addWidget('location-map'));

    expect(result.current.activeDashboard.widgets).toHaveLength(before + 1);
    expect(
      result.current.activeDashboard.widgets.some((w) => w.widgetId === 'location-map'),
    ).toBe(true);
    expect(result.current.canUndo).toBe(true);
    expect(lsDashboards()[0].widgets.some((w) => w.widgetId === 'location-map')).toBe(true);
    expect(h.broadcastFn).toHaveBeenCalledWith({ type: 'dashboard.layout' });
  });

  it('ignores a duplicate widget type and unknown widget ids', () => {
    const { result } = render();
    act(() => result.current.addWidget('battery-gauge')); // already in the default
    const afterDup = result.current.activeDashboard.widgets.length;
    act(() => result.current.addWidget('not-a-real-widget'));
    const afterUnknown = result.current.activeDashboard.widgets.length;

    // default already contains battery-gauge, so neither call adds anything.
    expect(afterDup).toBe(8);
    expect(afterUnknown).toBe(8);
  });

  it('adds several widgets at once and de-duplicates within the batch', () => {
    const { result } = render();
    act(() => result.current.addWidgets(['location-map', 'location-map', 'fleet-stats']));
    const ids = result.current.activeDashboard.widgets.map((w) => w.widgetId);
    expect(ids.filter((id) => id === 'location-map')).toHaveLength(1);
    expect(ids).toContain('fleet-stats');
  });

  it('removes a widget by instance id', () => {
    const { result } = render();
    const target = result.current.activeDashboard.widgets[0].id;
    act(() => result.current.removeWidget(target));
    expect(result.current.activeDashboard.widgets.some((w) => w.id === target)).toBe(false);
    expect(result.current.activeDashboard.widgets).toHaveLength(7);
  });

  it('updates a widget instance config', () => {
    const { result } = render();
    const target = result.current.activeDashboard.widgets[1].id;
    act(() => result.current.updateWidgetConfig(target, { refreshRate: 99 }));
    const updated = result.current.activeDashboard.widgets.find((w) => w.id === target);
    expect(updated?.config).toEqual({ refreshRate: 99 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — layout actions
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — layout actions', () => {
  it('replaces layouts verbatim via updateLayouts and records undo history', () => {
    const { result } = render();
    const custom: RGLLayouts = {
      lg: [{ i: 'default-2', x: 0, y: 0, w: 3, h: 5 }],
      md: [],
      sm: [],
      xs: [],
    };
    act(() => result.current.updateLayouts(custom));
    expect(result.current.activeDashboard.layouts).toEqual(custom);
    expect(result.current.canUndo).toBe(true);
  });

  it('rebuilds every breakpoint via autoArrange', () => {
    const { result } = render();
    act(() => result.current.autoArrange());
    expect(Object.keys(result.current.activeDashboard.layouts).sort()).toEqual(
      [...BREAKPOINTS].sort(),
    );
    expect(result.current.canUndo).toBe(true);
  });

  it('reports widget size from the lg layout and falls back for unknown ids', () => {
    const { result } = render();
    const lgItem = result.current.activeDashboard.layouts.lg.find((l) => l.i === 'default-2');
    if (!lgItem) throw new Error('expected a lg layout item for default-2');
    expect(result.current.getWidgetSize('default-2')).toEqual({
      cols: lgItem.w,
      rows: lgItem.h,
    });
    expect(result.current.getWidgetSize('does-not-exist')).toEqual({ cols: 1, rows: 1 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — dashboard CRUD
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — dashboard CRUD', () => {
  it('creates a dashboard, activates it, and can switch back', () => {
    const { result } = render();
    let newId = '';
    act(() => {
      newId = result.current.createDashboard('My Dash');
    });
    expect(result.current.dashboards.some((d) => d.id === newId)).toBe(true);
    expect(result.current.dashboards.find((d) => d.id === newId)?.name).toBe('My Dash');
    expect(result.current.activeId).toBe(newId);

    act(() => result.current.switchDashboard('default'));
    expect(result.current.activeId).toBe('default');
  });

  it('renames a dashboard', () => {
    const { result } = render();
    act(() => result.current.renameDashboard('default', 'Renamed'));
    expect(result.current.dashboards.find((d) => d.id === 'default')?.name).toBe('Renamed');
  });

  it('deletes a non-default dashboard and reassigns the active id', () => {
    const { result } = render();
    let cid = '';
    act(() => {
      cid = result.current.createDashboard('Temp');
    });
    expect(result.current.activeId).toBe(cid);

    act(() => result.current.deleteDashboard(cid));
    expect(result.current.dashboards.some((d) => d.id === cid)).toBe(false);
    expect(result.current.activeId).toBe('default');
  });

  it('refuses to delete the protected default dashboard', () => {
    const { result } = render();
    const before = result.current.dashboards.length;
    act(() => result.current.deleteDashboard('default'));
    expect(result.current.dashboards).toHaveLength(before);
    expect(result.current.dashboards.some((d) => d.id === 'default')).toBe(true);
  });

  it('duplicates a dashboard with a fresh id, "(Copy)" name, and remapped widgets', () => {
    const { result } = render();
    const sourceWidgetIds = new Set(
      result.current.dashboards.find((d) => d.id === 'default')?.widgets.map((w) => w.id),
    );

    act(() => result.current.duplicateDashboard('default'));

    const copy = result.current.dashboards.find((d) => d.name === 'Default (Copy)');
    expect(copy).toBeDefined();
    expect(copy?.isDefault).toBe(false);
    for (const w of copy?.widgets ?? []) {
      expect(sourceWidgetIds.has(w.id)).toBe(false);
    }
  });

  it('applies a named preset as a new dashboard', () => {
    const { result } = render();
    let id: string | undefined;
    act(() => {
      id = result.current.applyPreset('commuter');
    });
    expect(id).toBeDefined();
    expect(result.current.activeId).toBe(id);
    expect(result.current.dashboards.find((d) => d.id === id)?.name).toBe('Daily Commuter');
  });

  it('persists per-dashboard settings and icon', () => {
    const { result } = render();
    const settings: DashboardSettings = {
      refreshInterval: 30,
      showWidgetBorders: true,
      compactMode: false,
    };
    act(() => result.current.updateDashboardSettings('default', settings));
    act(() => result.current.updateDashboardIcon('default', 'Zap'));

    const dash = result.current.dashboards.find((d) => d.id === 'default');
    expect(dash?.settings).toEqual(settings);
    expect(dash?.icon).toBe('Zap');
  });

  it('resets everything back to a single default dashboard', () => {
    const { result } = render();
    act(() => {
      result.current.createDashboard('Extra');
    });
    expect(result.current.dashboards.length).toBeGreaterThan(1);

    act(() => result.current.resetToDefault());
    expect(result.current.dashboards).toHaveLength(1);
    expect(result.current.dashboards[0].id).toBe('default');
    expect(result.current.activeId).toBe('default');
  });

  it('reorders dashboards and treats out-of-range indices as a no-op', () => {
    const { result } = render();
    let idA = '';
    let idB = '';
    act(() => {
      idA = result.current.createDashboard('A');
    });
    tick();
    act(() => {
      idB = result.current.createDashboard('B');
    });
    expect(result.current.dashboards.map((d) => d.id)).toEqual(['default', idA, idB]);

    h.broadcastFn.mockClear();
    act(() => result.current.reorderDashboards(0, 2));
    expect(result.current.dashboards.map((d) => d.id)).toEqual([idA, idB, 'default']);
    expect(h.broadcastFn).toHaveBeenCalledWith({ type: 'dashboard.layout' });

    // Out-of-range fromIndex must not corrupt the list with an `undefined` slot.
    act(() => result.current.reorderDashboards(99, 0));
    expect(result.current.dashboards).toHaveLength(3);
    expect(result.current.dashboards.every((d) => d != null)).toBe(true);
    expect(result.current.dashboards.map((d) => d.id)).toEqual([idA, idB, 'default']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — per-vehicle pinning / visibility
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — pinning + visibility', () => {
  it('shows unscoped dashboards for any vehicle', () => {
    const { result } = render();
    expect(result.current.visibleFor(5).some((d) => d.id === 'default')).toBe(true);
    expect(result.current.visibleFor(null).some((d) => d.id === 'default')).toBe(true);
  });

  it('hides a pinned dashboard from other vehicles and from the global view', () => {
    const { result } = render();
    act(() => result.current.pinToVehicle('default', 7));

    expect(result.current.dashboards.find((d) => d.id === 'default')?.vehicleId).toBe(7);
    expect(result.current.visibleFor(7).some((d) => d.id === 'default')).toBe(true);
    expect(result.current.visibleFor(5).some((d) => d.id === 'default')).toBe(false);
    expect(result.current.visibleFor(null).some((d) => d.id === 'default')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — undo / redo
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — undo/redo', () => {
  it('undoes and redoes a widget addition', () => {
    const { result } = render();
    const base = result.current.activeDashboard.widgets.length;

    act(() => result.current.addWidget('location-map'));
    expect(result.current.activeDashboard.widgets).toHaveLength(base + 1);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.activeDashboard.widgets).toHaveLength(base);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.activeDashboard.widgets).toHaveLength(base + 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — import / export
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — import/export', () => {
  it('exports the active dashboard as a downloadable JSON blob', () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });

    // `click` is inherited from HTMLElement.prototype; capture `this` so we can
    // assert the generated download filename without touching createElement.
    const clicked: HTMLAnchorElement[] = [];
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, 'click')
      .mockImplementation(function (this: HTMLElement) {
        clicked.push(this as HTMLAnchorElement);
      });

    const { result } = render();
    act(() => result.current.exportDashboard('default'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toContain('teslasync-dashboard-');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');

    clickSpy.mockRestore();
  });

  it('imports a valid dashboard file and rejects a malformed one', async () => {
    const { result } = render();

    const valid = {
      id: 'ignored-on-import',
      name: 'Imported',
      widgets: [widget('iw1', 'battery-gauge')],
      layouts: { lg: [{ i: 'iw1', x: 0, y: 0, w: 1, h: 2 }] },
      createdAt: '2020',
      updatedAt: '2020',
    };
    const validFile = { text: async () => JSON.stringify(valid) } as unknown as File;
    await act(async () => {
      await result.current.importDashboard(validFile);
    });
    const imported = result.current.dashboards.find((d) => d.name === 'Imported');
    expect(imported).toBeDefined();
    expect(imported?.isDefault).toBe(false);
    expect(Object.keys(imported?.layouts ?? {}).sort()).toEqual([...BREAKPOINTS].sort());

    const badFile = { text: async () => JSON.stringify({ nope: true }) } as unknown as File;
    await expect(
      act(async () => {
        await result.current.importDashboard(badFile);
      }),
    ).rejects.toThrow('Invalid layout file');
  });

  it('imports pre-validated dashboard data directly', () => {
    const { result } = render();
    const data = savedDashboard({ id: 'fromdata', name: 'FromData', isDefault: true });
    act(() => result.current.importDashboardFromData(data));

    const added = result.current.dashboards.find((d) => d.id === 'fromdata');
    expect(added).toBeDefined();
    expect(added?.isDefault).toBe(false); // forced off on import
    expect(Object.keys(added?.layouts ?? {}).sort()).toEqual([...BREAKPOINTS].sort());
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — debounced backend sync
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — backend sync', () => {
  it('marks dirty on mutation, then flushes to the backend and clears dirty', () => {
    const { result } = render();

    act(() => result.current.addWidget('location-map'));
    expect(result.current.dirty).toBe(true);
    expect(h.saveMutate).not.toHaveBeenCalled(); // still debounced

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(h.saveMutate).toHaveBeenCalledTimes(1);
    const payload = h.saveMutate.mock.calls[0][0] as {
      dashboards: unknown[];
      active_id: string;
    };
    expect(payload.active_id).toBe('default');
    expect(Array.isArray(payload.dashboards)).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it('debounces bursts of edits into a single write', () => {
    const { result } = render();
    act(() => result.current.addWidget('location-map'));
    tick(500);
    act(() => result.current.addWidget('fleet-stats'));
    tick(500);
    act(() => result.current.addWidget('drive-score'));

    expect(h.saveMutate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(h.saveMutate).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — backend hydration on first load
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — hydration', () => {
  it('hydrates from the backend when local storage holds no custom data', () => {
    h.backend.data = {
      dashboards: [savedDashboard({ id: 'srv', name: 'Server Dash' })],
      active_id: 'srv',
    };
    const { result } = render();

    expect(result.current.dashboards.some((d) => d.id === 'srv')).toBe(true);
    expect(result.current.activeId).toBe('srv');
    expect(lsDashboards().some((d) => d.id === 'srv')).toBe(true);
  });

  it('does NOT overwrite existing local custom dashboards', () => {
    localStorage.setItem(
      DASHBOARDS_KEY,
      JSON.stringify([savedDashboard({ id: 'mine', name: 'Mine' })]),
    );
    h.backend.data = {
      dashboards: [savedDashboard({ id: 'srv', name: 'Server Dash' })],
      active_id: 'srv',
    };
    const { result } = render();

    expect(result.current.dashboards.some((d) => d.id === 'mine')).toBe(true);
    expect(result.current.dashboards.some((d) => d.id === 'srv')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — cross-tab reload
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — cross-tab sync', () => {
  it('reloads state when a peer tab broadcasts a layout change', () => {
    const { result } = render();
    expect(h.subscribers).toHaveLength(1);

    localStorage.setItem(
      DASHBOARDS_KEY,
      JSON.stringify([savedDashboard({ id: 'peer', name: 'Peer' })]),
    );
    localStorage.setItem(ACTIVE_KEY, 'peer');

    act(() => {
      h.subscribers.forEach((cb) => cb({ type: 'dashboard.layout' }));
    });

    expect(result.current.dashboards.some((d) => d.id === 'peer')).toBe(true);
    expect(result.current.activeId).toBe('peer');
  });

  it('ignores unrelated broadcast messages', () => {
    const { result } = render();

    act(() => {
      h.subscribers.forEach((cb) =>
        cb({ type: 'theme.changed', themeId: 'x', modeId: 'dark' }),
      );
    });

    expect(result.current.activeId).toBe('default');
    expect(result.current.dashboards[0].id).toBe('default');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// useDashboardLayout — storage migration + corrupt-data salvage
// ════════════════════════════════════════════════════════════════════════════
describe('useDashboardLayout — migration + resilience', () => {
  it('migrates a legacy single-layout blob into the new multi-dashboard shape', () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        id: 'legacy1',
        name: 'Legacy Dash',
        widgets: [
          { id: 'lw1', widgetId: 'battery-gauge', position: 0, size: { cols: 1, rows: 2 } },
        ],
        createdAt: '2020',
        updatedAt: '2020',
      }),
    );

    const { result } = render();

    expect(result.current.dashboards.some((d) => d.name === 'Legacy Dash')).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull(); // consumed
    expect(localStorage.getItem(DASHBOARDS_KEY)).not.toBeNull(); // rewritten
  });

  it('salvages a corrupt dashboard entry instead of discarding the whole list', () => {
    localStorage.setItem(ROW_VERSION_KEY, '2'); // skip row-height migration
    localStorage.setItem(
      DASHBOARDS_KEY,
      JSON.stringify([
        savedDashboard({ id: 'good', name: 'Good' }),
        // `widgets` intentionally missing — a truncated/partial write.
        { id: 'corrupt', name: 'Corrupt', layouts: {}, createdAt: '', updatedAt: '' },
      ]),
    );

    const { result } = render();

    // Both survive: the corrupt entry is repaired to an empty widget set rather
    // than throwing and nuking every saved dashboard back to the default.
    expect(result.current.dashboards.some((d) => d.id === 'good')).toBe(true);
    expect(result.current.dashboards.some((d) => d.id === 'corrupt')).toBe(true);
    expect(result.current.dashboards.find((d) => d.id === 'corrupt')?.widgets).toEqual([]);
  });

  it('scales pre-v2 row heights up by 2.25× and stamps the current version', () => {
    // localStorage was cleared in beforeEach, so the row-height version key is
    // absent → treated as v1 → the 180px→80px migration runs on first load.
    localStorage.setItem(
      DASHBOARDS_KEY,
      JSON.stringify([
        savedDashboard({
          id: 'legacy-heights',
          layouts: { lg: [{ i: 's1', x: 1, y: 4, w: 2, h: 3, minH: 2, maxH: 6 }] },
        }),
      ]),
    );

    render();

    // The version is stamped forward so the (one-way) migration runs exactly once.
    expect(localStorage.getItem(ROW_VERSION_KEY)).toBe('2');

    // migrateRowHeight rewrites DASHBOARDS_KEY with h/y/minH/maxH scaled ×2.25
    // (h & minH floored at 2), before reconcile — so the persisted snapshot
    // carries the rescaled vertical geometry while widths are left untouched.
    const persisted = lsDashboards()[0].layouts.lg[0];
    expect(persisted.h).toBe(7); // round(3 × 2.25) = 7
    expect(persisted.y).toBe(9); // round(4 × 2.25) = 9
    expect(persisted.minH).toBe(5); // round(2 × 2.25) = 5
    expect(persisted.maxH).toBe(14); // round(6 × 2.25) = 14
    expect(persisted.w).toBe(2); // width is not a row-height concern
  });

  it('leaves already-migrated (v2) layouts untouched', () => {
    localStorage.setItem(ROW_VERSION_KEY, '2'); // already on the current row height
    localStorage.setItem(
      DASHBOARDS_KEY,
      JSON.stringify([
        savedDashboard({
          id: 'v2-heights',
          layouts: { lg: [{ i: 's1', x: 0, y: 0, w: 1, h: 3, minH: 2, maxH: 6 }] },
        }),
      ]),
    );

    render();

    // Version already current → early return: no rescale and no rewrite, so the
    // persisted geometry is byte-for-byte what we seeded.
    expect(localStorage.getItem(ROW_VERSION_KEY)).toBe('2');
    const persisted = lsDashboards()[0].layouts.lg[0];
    expect(persisted.h).toBe(3);
    expect(persisted.maxH).toBe(6);
  });
});
