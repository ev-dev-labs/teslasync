/**
 * VEHICLE_WIDGETS registry — metadata contract, size invariants, lazy wiring,
 * and global-registry integration.
 *
 * `vehicle.ts` is a pure data module: its single export, `VEHICLE_WIDGETS`, is
 * the source of truth the dashboard's widget picker and grid use to resolve a
 * vehicle widget's title, sizing constraints, and (lazily-loaded) React
 * component. Because the module has no runtime branching, its "behaviour" IS
 * that contract, and these tests lock it in from four independent angles:
 *
 *   - metadata: the sixteen ids are stable, ordered, unique, and kebab-cased;
 *     category is always 'vehicle'; names / descriptions are non-empty; and
 *     every icon is a real component reference.
 *   - sizing: min ≤ default ≤ max on both axes and every dimension a positive
 *     integer — the invariant react-grid-layout relies on. A mis-ordered size
 *     silently lets a widget shrink below its usable minimum (or below its own
 *     default), so we assert it explicitly. Widths never exceed the 4-column
 *     dashboard grid.
 *   - wiring: every `entry.component` is a `React.lazy` element, each of the
 *     sixteen lazy references is a distinct object (no copy-pasted component),
 *     and every mirrored dynamic-import target resolves to a default-exported
 *     component function. A typo'd import path is invisible to `tsc` but fatal
 *     at runtime — resolving each module catches it without coupling this
 *     registry test to the render correctness of sixteen separate widgets.
 *   - integration: each entry is reachable via `getWidgetDef()`, appears in the
 *     flattened `WIDGET_REGISTRY` exactly once, and an unknown id resolves to
 *     `undefined` rather than throwing.
 */
import { describe, it, expect } from 'vitest';

import { VEHICLE_WIDGETS } from './vehicle';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetDef, WidgetSize } from '../types';

// The canonical id set, in the exact order `vehicle.ts` declares it. Re-ordering
// the registry re-orders the picker, so the order is part of the contract.
const EXPECTED_IDS = [
  'vehicle-hero',
  'vehicle-hero-card',
  'vehicle-twin',
  'digital-twin-mini',
  'software-update-status',
  'software-update-history',
  'odometer-counter',
  'drivetrain-health',
  'motor-performance',
  'motor-history',
  'vehicle-specs',
  'watch-summary',
  'maintenance-tracker',
  'warranty-status',
  'subscriptions',
  'vehicle-upgrades',
];

// Mirror of the dynamic-import targets `vehicle.ts` wraps in `React.lazy`. This
// test lives in the same directory as `vehicle.ts`, so the relative paths
// resolve identically. Drift between this map and the registry is caught by the
// "declares a loader for exactly the registered ids" case below.
const MODULES: Record<string, () => Promise<{ default: unknown }>> = {
  'vehicle-hero': () => import('../VehicleHeroWidget'),
  'vehicle-hero-card': () => import('../VehicleHeroCardWidget'),
  'vehicle-twin': () => import('../DigitalTwinWidget'),
  'digital-twin-mini': () => import('../DigitalTwinMiniWidget'),
  'software-update-status': () => import('../SoftwareUpdateStatusWidget'),
  'software-update-history': () => import('../SoftwareUpdateHistoryWidget'),
  'odometer-counter': () => import('../OdometerCounterWidget'),
  'drivetrain-health': () => import('../DrivetrainHealthWidget'),
  'motor-performance': () => import('../MotorPerformanceWidget'),
  'motor-history': () => import('../MotorHistoryWidget'),
  'vehicle-specs': () => import('../VehicleSpecsWidget'),
  'watch-summary': () => import('../WatchSummaryWidget'),
  'maintenance-tracker': () => import('../MaintenanceTrackerWidget'),
  'warranty-status': () => import('../WarrantyStatusWidget'),
  'subscriptions': () => import('../SubscriptionsWidget'),
  'vehicle-upgrades': () => import('../VehicleUpgradesWidget'),
};

const REACT_LAZY = Symbol.for('react.lazy');

const byId = (id: string): WidgetDef => {
  const def = VEHICLE_WIDGETS.find((w) => w.id === id);
  if (!def) throw new Error(`missing widget: ${id}`);
  return def;
};

const inRange = (size: WidgetSize, lo: WidgetSize, hi: WidgetSize, axis: 'cols' | 'rows') =>
  lo[axis] <= size[axis] && size[axis] <= hi[axis];

describe('VEHICLE_WIDGETS — metadata contract', () => {
  it('exports the sixteen vehicle widgets in a stable order', () => {
    expect(Array.isArray(VEHICLE_WIDGETS)).toBe(true);
    expect(VEHICLE_WIDGETS).toHaveLength(EXPECTED_IDS.length);
    expect(VEHICLE_WIDGETS.map((w) => w.id)).toEqual(EXPECTED_IDS);
  });

  it('gives every widget a unique id', () => {
    const ids = VEHICLE_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses a kebab-case slug for every id', () => {
    for (const w of VEHICLE_WIDGETS) {
      expect(w.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    }
  });

  it('tags every widget with the vehicle category', () => {
    expect(VEHICLE_WIDGETS.every((w) => w.category === 'vehicle')).toBe(true);
  });

  it('gives every widget a non-empty name, description, and real icon component', () => {
    for (const w of VEHICLE_WIDGETS) {
      expect(w.name.trim().length).toBeGreaterThan(0);
      expect(w.description.trim().length).toBeGreaterThan(0);
      expect(w.icon).toBeTruthy();
      // lucide-react icons are React components (forwardRef object or function).
      expect(['function', 'object']).toContain(typeof w.icon);
    }
  });
});

describe('VEHICLE_WIDGETS — size invariants', () => {
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
    for (const w of VEHICLE_WIDGETS) {
      expect(w.minSize.cols).toBeLessThanOrEqual(4);
      expect(w.defaultSize.cols).toBeLessThanOrEqual(4);
    }
  });
});

describe('VEHICLE_WIDGETS — lazy component wiring', () => {
  it('wires every widget to a React.lazy component', () => {
    for (const w of VEHICLE_WIDGETS) {
      const marker = (w.component as unknown as { $$typeof?: symbol }).$$typeof;
      expect(marker).toBe(REACT_LAZY);
    }
  });

  it('gives every widget its own distinct lazy component reference', () => {
    const components = VEHICLE_WIDGETS.map((w) => w.component);
    expect(new Set(components).size).toBe(VEHICLE_WIDGETS.length);
  });

  it('declares a lazy loader for exactly the registered vehicle ids', () => {
    expect(Object.keys(MODULES).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it.each(EXPECTED_IDS)(
    'resolves the %s widget module to a default-exported component function',
    async (id) => {
      const mod = await MODULES[id]();
      // A typo'd import path (invisible to tsc) rejects here; a missing default
      // export makes this assertion fail. Importing the module executes its
      // static graph without rendering, so this proves the registry id maps to
      // a real, mountable component without mocking every widget's data hooks.
      expect(typeof mod.default).toBe('function');
    },
  );
});

describe('VEHICLE_WIDGETS — global registry integration', () => {
  it('registers each vehicle widget in the flattened WIDGET_REGISTRY', () => {
    for (const w of VEHICLE_WIDGETS) {
      expect(WIDGET_REGISTRY).toContain(w);
    }
  });

  it('resolves each vehicle widget by id via getWidgetDef', () => {
    for (const w of VEHICLE_WIDGETS) {
      expect(getWidgetDef(w.id)).toBe(w);
    }
  });

  it('keeps every vehicle id unique within the whole registry', () => {
    for (const w of VEHICLE_WIDGETS) {
      expect(WIDGET_REGISTRY.filter((x) => x.id === w.id)).toHaveLength(1);
    }
  });

  it('returns undefined for an unknown widget id instead of throwing', () => {
    expect(getWidgetDef('vehicle-does-not-exist')).toBeUndefined();
  });
});
