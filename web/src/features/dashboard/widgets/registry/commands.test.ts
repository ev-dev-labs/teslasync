/**
 * Command widget registry (`COMMAND_WIDGETS`) — contract, invariants & wiring.
 *
 * `commands.ts` is a pure data module: it declares the two "commands"-category
 * dashboard widgets (Quick Actions, Command History) as `WidgetDef` records
 * whose `component` is a `React.lazy(() => import(...))` reference. Nothing in it
 * renders, so the meaningful surface to lock is the *contract other code relies
 * on* — driven here across every facet of the single `COMMAND_WIDGETS` export:
 *
 *   - WidgetPicker groups/filters by `category` and searches name/description,
 *     so those fields must be present and correctly categorised.
 *   - `getWidgetDef(id)` (over WIDGET_REGISTRY) resolves the ids referenced by
 *     the dashboard presets + default layout — the `security_monitor` preset and
 *     `useDashboardLayout` both mount `command-quick-actions` purely by id, so a
 *     silent id drift would strand those layouts on a missing widget.
 *   - react-grid-layout clamps each widget to [minSize, maxSize] around
 *     `defaultSize`, so the size triplet must be internally ordered and positive.
 *   - the dashboard mounts each widget through Suspense, so every `component`
 *     must be a genuine React.lazy element whose import target actually resolves
 *     to a default-exported component.
 *
 * Real assertions only, no network. The widgets' own render behaviour is covered
 * by their sibling `*.test.tsx` suites — here we only assert that the registry's
 * lazy targets resolve, not how they render.
 */
import { describe, it, expect } from 'vitest';
import { lazy } from 'react';
import { Command, Terminal } from 'lucide-react';
import { COMMAND_WIDGETS } from './commands';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetDef, WidgetSize } from '../types';

// Derive React's lazy brand from React itself (rather than hardcoding
// Symbol.for('react.lazy')) so this stays correct across React versions.
const REACT_LAZY_BRAND = (
  lazy(() => Promise.resolve({ default: () => null })) as unknown as {
    $$typeof: symbol;
  }
).$$typeof;

/** Reference-equality accessor for a lazy element's brand symbol. */
function lazyBrand(def: WidgetDef): symbol | undefined {
  return (def.component as unknown as { $$typeof?: symbol }).$$typeof;
}

const ids = (defs: readonly WidgetDef[]): string[] => defs.map((d) => d.id);
const sizeIsPositive = (s: WidgetSize): boolean => s.cols > 0 && s.rows > 0;
const sizeLE = (a: WidgetSize, b: WidgetSize): boolean =>
  a.cols <= b.cols && a.rows <= b.rows;

describe('COMMAND_WIDGETS export shape', () => {
  it('exports exactly the two commands-category widgets in a stable order', () => {
    expect(Array.isArray(COMMAND_WIDGETS)).toBe(true);
    expect(COMMAND_WIDGETS).toHaveLength(2);
    expect(ids(COMMAND_WIDGETS)).toEqual([
      'command-quick-actions',
      'command-history',
    ]);
  });

  it('tags every entry with the "commands" category', () => {
    for (const def of COMMAND_WIDGETS) {
      expect(def.category).toBe('commands');
    }
  });
});

describe('COMMAND_WIDGETS metadata contract', () => {
  it('gives every widget a non-empty id / name / description and an icon', () => {
    for (const def of COMMAND_WIDGETS) {
      expect(def.id.trim().length).toBeGreaterThan(0);
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(def.icon).toBeDefined();
    }
  });

  it('keeps ids unique within the category slice', () => {
    const seen = ids(COMMAND_WIDGETS);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('COMMAND_WIDGETS size invariants', () => {
  it('keeps every dimension a positive integer', () => {
    for (const def of COMMAND_WIDGETS) {
      for (const size of [def.minSize, def.defaultSize, def.maxSize]) {
        expect(sizeIsPositive(size)).toBe(true);
        expect(Number.isInteger(size.cols)).toBe(true);
        expect(Number.isInteger(size.rows)).toBe(true);
      }
    }
  });

  it('orders minSize <= defaultSize <= maxSize on both axes', () => {
    for (const def of COMMAND_WIDGETS) {
      expect(sizeLE(def.minSize, def.defaultSize)).toBe(true);
      expect(sizeLE(def.defaultSize, def.maxSize)).toBe(true);
    }
  });
});

describe('COMMAND_WIDGETS specific definitions', () => {
  it('locks the Quick Actions widget configuration', () => {
    const def = getWidgetDef('command-quick-actions');
    expect(def).toBeDefined();
    expect(def?.name).toBe('Quick Actions');
    expect(def?.icon).toBe(Command);
    expect(def?.category).toBe('commands');
    expect(def?.defaultSize).toEqual({ cols: 2, rows: 2 });
    expect(def?.minSize).toEqual({ cols: 1, rows: 2 });
    expect(def?.maxSize).toEqual({ cols: 4, rows: 40 });
  });

  it('locks the Command History widget configuration', () => {
    const def = getWidgetDef('command-history');
    expect(def).toBeDefined();
    expect(def?.name).toBe('Command History');
    expect(def?.icon).toBe(Terminal);
    expect(def?.category).toBe('commands');
    expect(def?.defaultSize).toEqual({ cols: 2, rows: 4 });
  });
});

describe('COMMAND_WIDGETS lazy components', () => {
  it('exposes every component as a React.lazy element', () => {
    for (const def of COMMAND_WIDGETS) {
      expect(lazyBrand(def)).toBe(REACT_LAZY_BRAND);
    }
  });

  it('resolves the Quick Actions lazy import to a default-exported component', async () => {
    const mod = await import('../CommandQuickActionsWidget');
    expect(typeof mod.default).toBe('function');
  });

  it('resolves the Command History lazy import to a default-exported component', async () => {
    const mod = await import('../CommandHistoryWidget');
    expect(typeof mod.default).toBe('function');
  });
});

describe('COMMAND_WIDGETS registry integration', () => {
  it('registers each command widget in WIDGET_REGISTRY by reference', () => {
    for (const def of COMMAND_WIDGETS) {
      expect(WIDGET_REGISTRY).toContain(def);
    }
  });

  it('resolves each command id back to the same def via getWidgetDef', () => {
    for (const def of COMMAND_WIDGETS) {
      expect(getWidgetDef(def.id)).toBe(def);
    }
  });

  it('keeps every command id globally unique across the registry', () => {
    for (const def of COMMAND_WIDGETS) {
      const matches = WIDGET_REGISTRY.filter((w) => w.id === def.id);
      expect(matches).toHaveLength(1);
    }
  });

  it('returns undefined for an unknown widget id', () => {
    expect(getWidgetDef('command-does-not-exist')).toBeUndefined();
  });
});
