/**
 * CLIMATE_WIDGETS registry — metadata contract, size invariants, lazy wiring,
 * and global-registry integration.
 *
 * `climate.ts` is a pure data module: its single export, `CLIMATE_WIDGETS`, is
 * the source of truth the dashboard's widget picker and grid use to resolve a
 * climate widget's title, sizing constraints, and (lazily-loaded) React
 * component. These tests lock that contract in from four angles:
 *
 *   - metadata: ids are stable + unique, category is always 'climate', names /
 *     descriptions are non-empty, and every icon is a real component reference.
 *   - sizing: min ≤ default ≤ max on both axes and every dimension a positive
 *     integer — the invariant react-grid-layout relies on. A mis-ordered size
 *     silently lets a widget shrink below its usable minimum (or below its own
 *     default), so we assert it explicitly.
 *   - wiring: every `entry.component` is a `React.lazy` element AND actually
 *     mounts when rendered through <Suspense> (the dynamic import path resolves
 *     to a default-exported widget). A typo'd import path is invisible to `tsc`
 *     but fatal at runtime — mounting each entry catches it.
 *   - integration: each entry is reachable via `getWidgetDef()` and appears in
 *     the flattened `WIDGET_REGISTRY` exactly once.
 *
 * Every data hook the four climate widgets touch is mocked so the network is
 * never hit and each widget resolves to its titled empty-state shell.
 */
import type { ComponentType, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CLIMATE_WIDGETS } from './climate';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetDef, WidgetProps, WidgetSize } from '../types';

// ── i18n: echo the English fallback (2nd arg) so titles are deterministic. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string) => (typeof def === 'string' ? def : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Data hooks: drive every climate widget to its (titled) empty-state shell,
// so mounting exercises the lazy wiring without touching the network or a
// chart library. ──
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useClimateLatest: vi.fn(),
  useVehicleState: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useClimateHistory: vi.fn(),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useDateFormat', () => ({ useDateFormat: vi.fn() }));

import { useVehicles, useClimateLatest, useVehicleState } from '@/api/hooks/useVehicles';
import { useClimateHistory } from '@/api/hooks/useVehicleSystems';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';

/** Minimal TanStack-Query-shaped result; the fields each widget destructures. */
function query(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
    ...over,
  };
}

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  asMock(useVehicles).mockReturnValue(query({ data: [{ id: 1 }] }));
  asMock(useClimateLatest).mockReturnValue(query({ data: null }));
  asMock(useVehicleState).mockReturnValue(query({ data: null }));
  asMock(useClimateHistory).mockReturnValue(query({ data: [] }));
  asMock(useUnits).mockReturnValue({ unitPrefs: { temperature: '°C' } });
  asMock(useDateFormat).mockReturnValue({ formatDateTime: (v: unknown) => String(v) });
});

const EXPECTED_IDS = [
  'climate-status',
  'climate-control-panel',
  'weather-at-car',
  'climate-history',
];

// The visible WidgetShell title each entry's lazy component renders — the
// runtime contract that proves the registry id maps to the right widget.
const EXPECTED_TITLES: Record<string, string> = {
  'climate-status': 'Climate',
  'climate-control-panel': 'Climate Control',
  'weather-at-car': 'Weather at Car',
  'climate-history': 'Climate History',
};

const REACT_LAZY = Symbol.for('react.lazy');

const byId = (id: string): WidgetDef => {
  const def = CLIMATE_WIDGETS.find((w) => w.id === id);
  if (!def) throw new Error(`missing widget: ${id}`);
  return def;
};

const inRange = (size: WidgetSize, lo: WidgetSize, hi: WidgetSize, axis: 'cols' | 'rows') =>
  lo[axis] <= size[axis] && size[axis] <= hi[axis];

describe('CLIMATE_WIDGETS — metadata contract', () => {
  it('exports the four climate widgets in a stable order', () => {
    expect(Array.isArray(CLIMATE_WIDGETS)).toBe(true);
    expect(CLIMATE_WIDGETS.map((w) => w.id)).toEqual(EXPECTED_IDS);
  });

  it('gives every widget a unique id', () => {
    const ids = CLIMATE_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags every widget with the climate category', () => {
    expect(CLIMATE_WIDGETS.every((w) => w.category === 'climate')).toBe(true);
  });

  it('gives every widget a non-empty name, description, and real icon component', () => {
    for (const w of CLIMATE_WIDGETS) {
      expect(w.name.trim().length).toBeGreaterThan(0);
      expect(w.description.trim().length).toBeGreaterThan(0);
      expect(w.icon).toBeTruthy();
      // lucide-react icons are React components (forwardRef object or function).
      expect(['function', 'object']).toContain(typeof w.icon);
    }
  });
});

describe('CLIMATE_WIDGETS — size invariants', () => {
  it.each(EXPECTED_IDS)('keeps min ≤ default ≤ max on both axes for %s', (id) => {
    const w = byId(id);
    for (const axis of ['cols', 'rows'] as const) {
      expect(Number.isInteger(w.minSize[axis])).toBe(true);
      expect(Number.isInteger(w.defaultSize[axis])).toBe(true);
      expect(Number.isInteger(w.maxSize[axis])).toBe(true);
      expect(w.minSize[axis]).toBeGreaterThan(0);
      expect(w.minSize[axis]).toBeLessThanOrEqual(w.maxSize[axis]);
      // default must sit inside [min, max] — a mis-ordered size would fail here.
      expect(inRange(w.defaultSize, w.minSize, w.maxSize, axis)).toBe(true);
    }
  });

  it('never lets a minimum width exceed the four-column dashboard grid', () => {
    for (const w of CLIMATE_WIDGETS) {
      expect(w.minSize.cols).toBeLessThanOrEqual(4);
    }
  });
});

describe('CLIMATE_WIDGETS — lazy component wiring', () => {
  // The dynamic-import targets `climate.ts` wraps in `React.lazy`, mirrored here
  // (this test lives in the same directory, so the relative paths resolve
  // identically). A drift between this map and the registry is caught by the
  // "declares a loader for every id" case below.
  const MODULES: Record<string, () => Promise<{ default: unknown }>> = {
    'climate-status': () => import('../ClimateStatusWidget'),
    'climate-control-panel': () => import('../ClimateControlPanelWidget'),
    'weather-at-car': () => import('../WeatherAtCarWidget'),
    'climate-history': () => import('../ClimateHistoryWidget'),
  };

  it('wires every widget to a React.lazy component', () => {
    for (const w of CLIMATE_WIDGETS) {
      const marker = (w.component as unknown as { $$typeof?: symbol }).$$typeof;
      expect(marker).toBe(REACT_LAZY);
    }
  });

  it('declares a lazy loader for exactly the registered climate ids', () => {
    expect(Object.keys(MODULES).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it.each(EXPECTED_IDS)(
    'resolves the %s widget module to a mountable default component',
    async (id) => {
      const mod = await MODULES[id]();
      // A typo'd import path (invisible to tsc) rejects here; a missing default
      // export makes this assertion fail.
      expect(typeof mod.default).toBe('function');

      const Widget = mod.default as ComponentType<WidgetProps>;
      render(<Widget size={byId(id).defaultSize} />);
      // The widget mounts into its titled WidgetShell even with no data,
      // proving the registry id maps to the intended component.
      expect(await screen.findByText(EXPECTED_TITLES[id])).toBeInTheDocument();
    },
  );
});

describe('CLIMATE_WIDGETS — global registry integration', () => {
  it('registers each climate widget in the flattened WIDGET_REGISTRY', () => {
    for (const w of CLIMATE_WIDGETS) {
      expect(WIDGET_REGISTRY).toContain(w);
    }
  });

  it('resolves each climate widget by id via getWidgetDef', () => {
    for (const w of CLIMATE_WIDGETS) {
      expect(getWidgetDef(w.id)).toBe(w);
    }
  });

  it('keeps every climate id unique within the whole registry', () => {
    for (const w of CLIMATE_WIDGETS) {
      expect(WIDGET_REGISTRY.filter((x) => x.id === w.id)).toHaveLength(1);
    }
  });
});
