/**
 * dashboard/widgets/types — contract tests for the dashboard widget-registry
 * and saved-dashboard type surface.
 *
 * This module is *mostly type-only*: all but two exports are `interface`s /
 * a union that are erased at runtime. Following the repo convention for type
 * modules (see features/charging/components/charging-curve/types.test.ts and
 * features/automations/components/stepInputTypes.test.ts) the suite enforces
 * the contracts on two levels:
 *
 *   • Runtime (`expect`)      — the *behaviour + shape contract* of the two
 *     runtime exports: `DEFAULT_DASHBOARD_SETTINGS` (its exact values +
 *     immutability) and `mergeDashboardSettings` (its null-safe merge across
 *     the missing / explicit-`undefined` / `null` / partial branches — the
 *     latter being the persisted-JSON crash this helper exists to prevent).
 *   • Compile-time (`expectTypeOf`) — the *type identities*: every exported
 *     interface / union equals its documented shape, optional and `| null`
 *     slots are preserved, and the runtime helpers return the right types.
 *     These are runtime no-ops; an IDE / `vitest --typecheck` enforces them.
 *
 * No network, no DOM — pure structural assertions, so no MSW / QueryClient
 * harness is required.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { LucideIcon } from 'lucide-react';
import type { LazyExoticComponent, ComponentType } from 'react';

import { DEFAULT_DASHBOARD_SETTINGS, mergeDashboardSettings } from './types';
import type {
  DashboardSettings,
  LegacyDashboardLayout,
  RGLLayout,
  RGLLayouts,
  SavedDashboard,
  WidgetCategory,
  WidgetConfig,
  WidgetDef,
  WidgetHelp,
  WidgetInstance,
  WidgetProps,
  WidgetSize,
} from './types';

// ── DEFAULT_DASHBOARD_SETTINGS — the canonical, frozen defaults ───────────────

describe('DEFAULT_DASHBOARD_SETTINGS', () => {
  it('pins the exact default values', () => {
    expect(DEFAULT_DASHBOARD_SETTINGS).toEqual({
      refreshInterval: 0,
      showWidgetBorders: false,
      compactMode: false,
    });
  });

  it('omits vehicleId so the default scope is "all vehicles"', () => {
    // A present-but-undefined key would still narrow nothing, but keeping the
    // key absent is what lets `settings.vehicleId?.toString() ?? ''` read blank.
    expect('vehicleId' in DEFAULT_DASHBOARD_SETTINGS).toBe(false);
    expect(Object.keys(DEFAULT_DASHBOARD_SETTINGS).sort()).toEqual([
      'compactMode',
      'refreshInterval',
      'showWidgetBorders',
    ]);
  });

  it('is frozen so the shared module-level object cannot be mutated', () => {
    expect(Object.isFrozen(DEFAULT_DASHBOARD_SETTINGS)).toBe(true);

    // ES-module strict mode turns a write to a frozen property into a throw
    // rather than a silent no-op — proving a careless consumer cannot corrupt
    // the defaults for every other dashboard.
    expect(() => {
      (DEFAULT_DASHBOARD_SETTINGS as { refreshInterval: number }).refreshInterval = 30;
    }).toThrow(TypeError);
    expect(DEFAULT_DASHBOARD_SETTINGS.refreshInterval).toBe(0);
  });

  it('conforms to the DashboardSettings type', () => {
    expectTypeOf(DEFAULT_DASHBOARD_SETTINGS).toEqualTypeOf<Readonly<DashboardSettings>>();
  });
});

// ── mergeDashboardSettings — the null-safe defaults merge ─────────────────────

describe('mergeDashboardSettings', () => {
  const FULL_DEFAULTS: DashboardSettings = {
    refreshInterval: 0,
    showWidgetBorders: false,
    compactMode: false,
  };

  it('returns a complete settings object for undefined / null / empty input', () => {
    expect(mergeDashboardSettings()).toEqual(FULL_DEFAULTS);
    expect(mergeDashboardSettings(undefined)).toEqual(FULL_DEFAULTS);
    expect(mergeDashboardSettings(null)).toEqual(FULL_DEFAULTS);
    expect(mergeDashboardSettings({})).toEqual(FULL_DEFAULTS);
  });

  it('overlays only the provided fields onto the defaults', () => {
    expect(mergeDashboardSettings({ refreshInterval: 30 })).toEqual({
      refreshInterval: 30,
      showWidgetBorders: false,
      compactMode: false,
    });
    expect(mergeDashboardSettings({ showWidgetBorders: true, compactMode: true })).toEqual({
      refreshInterval: 0,
      showWidgetBorders: true,
      compactMode: true,
    });
  });

  it('falls back to defaults when a required field is explicitly undefined', () => {
    // This is the persisted/legacy crash a plain spread cannot fix: a spread
    // copies the explicit `undefined` over the default, then a later
    // `settings.refreshInterval.toString()` throws.
    const legacy = {
      refreshInterval: undefined,
      showWidgetBorders: undefined,
      compactMode: undefined,
    } as Partial<DashboardSettings>;

    const merged = mergeDashboardSettings(legacy);

    expect(merged).toEqual(FULL_DEFAULTS);
    expect(merged.refreshInterval).toBe(0);
    // The exact operation the modal performs on the merged result must not throw.
    expect(() => merged.refreshInterval.toString()).not.toThrow();
    expect(merged.refreshInterval.toString()).toBe('0');
  });

  it('falls back to defaults when a required field is null (JSON round-trip)', () => {
    // JSON has no `undefined`; a cleared numeric/boolean can persist as `null`.
    const persisted = {
      refreshInterval: null,
      showWidgetBorders: null,
      compactMode: null,
    } as unknown as Partial<DashboardSettings>;

    expect(mergeDashboardSettings(persisted)).toEqual(FULL_DEFAULTS);
  });

  it('preserves a deliberate falsy value rather than treating it as missing', () => {
    // `??` (not `||`) keeps an intentional refreshInterval: 0 ("per-widget
    // default") and a `false` toggle instead of snapping back to the default.
    const merged = mergeDashboardSettings({
      refreshInterval: 0,
      showWidgetBorders: false,
      compactMode: false,
    });
    expect(merged.refreshInterval).toBe(0);
    expect(merged.showWidgetBorders).toBe(false);
    expect(merged.compactMode).toBe(false);
  });

  it('carries vehicleId through only when a real id is present', () => {
    const scoped = mergeDashboardSettings({ vehicleId: 7 });
    expect(scoped.vehicleId).toBe(7);
    expect(scoped).toEqual({
      refreshInterval: 0,
      showWidgetBorders: false,
      compactMode: false,
      vehicleId: 7,
    });

    // Absent / undefined vehicleId means "all vehicles" — the key is dropped.
    expect('vehicleId' in mergeDashboardSettings({})).toBe(false);
    expect('vehicleId' in mergeDashboardSettings({ vehicleId: undefined })).toBe(false);
  });

  it('returns a fresh, mutable object each call and never leaks the frozen default', () => {
    const a = mergeDashboardSettings();
    const b = mergeDashboardSettings();
    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULT_DASHBOARD_SETTINGS);

    // The result is intended for React state updates, so it must be writable.
    a.refreshInterval = 99;
    expect(a.refreshInterval).toBe(99);
    // Mutating the result must not have disturbed the shared default.
    expect(DEFAULT_DASHBOARD_SETTINGS.refreshInterval).toBe(0);
  });

  it('does not mutate the caller-supplied partial', () => {
    const input: Partial<DashboardSettings> = { refreshInterval: 15 };
    const before = { ...input };
    mergeDashboardSettings(input);
    expect(input).toEqual(before);
  });

  it('has a DashboardSettings return type', () => {
    expectTypeOf(mergeDashboardSettings({})).toEqualTypeOf<DashboardSettings>();
    expectTypeOf(mergeDashboardSettings()).toEqualTypeOf<DashboardSettings>();
  });
});

// ── DashboardSettings — the type contract ─────────────────────────────────────

describe('DashboardSettings type', () => {
  it('requires the cadence + display fields and keeps vehicleId optional', () => {
    const settings: DashboardSettings = {
      refreshInterval: 5,
      showWidgetBorders: true,
      compactMode: false,
      vehicleId: 3,
    };
    expect(settings.vehicleId).toBe(3);

    expectTypeOf<DashboardSettings['refreshInterval']>().toEqualTypeOf<number>();
    expectTypeOf<DashboardSettings['showWidgetBorders']>().toEqualTypeOf<boolean>();
    expectTypeOf<DashboardSettings['compactMode']>().toEqualTypeOf<boolean>();
    expectTypeOf<DashboardSettings['vehicleId']>().toEqualTypeOf<number | undefined>();
  });
});

// ── WidgetSize / WidgetConfig / WidgetProps ───────────────────────────────────

describe('WidgetSize / WidgetConfig / WidgetProps', () => {
  it('WidgetSize is a numeric cols/rows pair', () => {
    const size: WidgetSize = { cols: 2, rows: 4 };
    expect(size).toEqual({ cols: 2, rows: 4 });
    expectTypeOf<WidgetSize>().toEqualTypeOf<{ cols: number; rows: number }>();
  });

  it('WidgetConfig types its known keys and allows arbitrary extras via its index signature', () => {
    const config: WidgetConfig = {
      vehicleId: 1,
      refreshRate: 30,
      chartType: 'line',
      showTitle: true,
      timeRange: '7d',
      customFlag: 'anything',
    };
    expect(config.chartType).toBe('line');
    expect(config.customFlag).toBe('anything');

    expectTypeOf<WidgetConfig['vehicleId']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<WidgetConfig['chartType']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<WidgetConfig['showTitle']>().toEqualTypeOf<boolean | undefined>();
    // The open-ended index signature resolves to `unknown`.
    expectTypeOf<WidgetConfig[string]>().toEqualTypeOf<unknown>();
  });

  it('WidgetProps requires a size and keeps vehicleId + config optional', () => {
    const minimal: WidgetProps = { size: { cols: 1, rows: 1 } };
    const full: WidgetProps = { vehicleId: 2, size: { cols: 2, rows: 3 }, config: { chartType: 'bar' } };
    expect(minimal.size).toEqual({ cols: 1, rows: 1 });
    expect(full.config?.chartType).toBe('bar');

    expectTypeOf<WidgetProps['size']>().toEqualTypeOf<WidgetSize>();
    expectTypeOf<WidgetProps['config']>().toEqualTypeOf<WidgetConfig | undefined>();
  });
});

// ── WidgetHelp / WidgetInstance / WidgetDef ───────────────────────────────────

describe('WidgetHelp / WidgetInstance / WidgetDef', () => {
  it('WidgetHelp supports i18n, static text, and a learn-more link', () => {
    const help: WidgetHelp = {
      i18nKey: 'widget.help.battery',
      defaultValue: 'Battery health over time',
      learnMore: { url: 'https://example.com/docs', label: 'Learn more' },
    };
    expect(help.learnMore?.url).toBe('https://example.com/docs');

    expectTypeOf<WidgetHelp>().toEqualTypeOf<{
      text?: string;
      i18nKey?: string;
      defaultValue?: string;
      learnMore?: { url: string; label?: string };
    }>();
  });

  it('WidgetInstance references a widget by id with optional config', () => {
    const instance: WidgetInstance = { id: 'inst-1', widgetId: 'battery-gauge', config: { vehicleId: 1 } };
    expect(instance.widgetId).toBe('battery-gauge');

    expectTypeOf<WidgetInstance['id']>().toEqualTypeOf<string>();
    expectTypeOf<WidgetInstance['config']>().toEqualTypeOf<WidgetConfig | undefined>();
  });

  it('WidgetDef ties registry metadata to a lucide icon, a lazy body, and a category', () => {
    // WidgetDef needs a real LucideIcon + React.lazy component, so pin the
    // field identities at the type level rather than constructing a fixture.
    expectTypeOf<WidgetDef['id']>().toEqualTypeOf<string>();
    expectTypeOf<WidgetDef['name']>().toEqualTypeOf<string>();
    expectTypeOf<WidgetDef['description']>().toEqualTypeOf<string>();
    expectTypeOf<WidgetDef['icon']>().toEqualTypeOf<LucideIcon>();
    expectTypeOf<WidgetDef['category']>().toEqualTypeOf<WidgetCategory>();
    expectTypeOf<WidgetDef['defaultSize']>().toEqualTypeOf<WidgetSize>();
    expectTypeOf<WidgetDef['minSize']>().toEqualTypeOf<WidgetSize>();
    expectTypeOf<WidgetDef['maxSize']>().toEqualTypeOf<WidgetSize>();
    expectTypeOf<WidgetDef['help']>().toEqualTypeOf<WidgetHelp | undefined>();
    expectTypeOf<WidgetDef['component']>().toEqualTypeOf<
      LazyExoticComponent<ComponentType<WidgetProps>>
    >();
  });
});

// ── WidgetCategory — the closed union ─────────────────────────────────────────

describe('WidgetCategory union', () => {
  const ALL_CATEGORIES: WidgetCategory[] = [
    'vehicle',
    'battery',
    'energy',
    'driving',
    'charging',
    'climate',
    'tires',
    'security',
    'commands',
    'media',
    'telemetry',
    'analytics',
    'alerts',
    'automations',
    'system',
    'maps',
  ];

  it('enumerates exactly sixteen unique categories', () => {
    expect(ALL_CATEGORIES).toHaveLength(16);
    expect(new Set(ALL_CATEGORIES).size).toBe(16);
    expect(ALL_CATEGORIES).toContain('battery');
    expect(ALL_CATEGORIES).toContain('maps');
  });

  it('accepts each member and matches the registry-slice categories', () => {
    expectTypeOf<'battery'>().toMatchTypeOf<WidgetCategory>();
    expectTypeOf<'analytics'>().toMatchTypeOf<WidgetCategory>();
    // A non-member literal must NOT be assignable to the union.
    expectTypeOf<'battery'>().not.toEqualTypeOf<WidgetCategory>();
  });
});

// ── RGLLayout / RGLLayouts — react-grid-layout shapes ─────────────────────────

describe('RGLLayout / RGLLayouts', () => {
  it('RGLLayout requires i/x/y/w/h and keeps the constraint + flag fields optional', () => {
    const minimal: RGLLayout = { i: 'w1', x: 0, y: 0, w: 2, h: 4 };
    const constrained: RGLLayout = {
      i: 'w2',
      x: 2,
      y: 0,
      w: 2,
      h: 4,
      minW: 1,
      minH: 2,
      maxW: 4,
      maxH: 8,
      static: false,
      isDraggable: true,
      isResizable: true,
      moved: false,
    };
    expect(minimal.i).toBe('w1');
    expect(constrained.maxW).toBe(4);

    expectTypeOf<RGLLayout['i']>().toEqualTypeOf<string>();
    expectTypeOf<RGLLayout['x']>().toEqualTypeOf<number>();
    expectTypeOf<RGLLayout['static']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<RGLLayout['maxW']>().toEqualTypeOf<number | undefined>();
  });

  it('RGLLayouts maps a breakpoint string to an array of layout items', () => {
    const layouts: RGLLayouts = {
      lg: [{ i: 'w1', x: 0, y: 0, w: 2, h: 4 }],
      md: [],
    };
    expect(layouts.lg).toHaveLength(1);
    expect(layouts.md).toEqual([]);

    expectTypeOf<RGLLayouts[string]>().toEqualTypeOf<RGLLayout[]>();
  });
});

// ── SavedDashboard / LegacyDashboardLayout ────────────────────────────────────

describe('SavedDashboard / LegacyDashboardLayout', () => {
  function makeSaved(overrides: Partial<SavedDashboard> = {}): SavedDashboard {
    return {
      id: 'dash-1',
      name: 'Main',
      widgets: [],
      layouts: {},
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      ...overrides,
    };
  }

  it('SavedDashboard carries widgets, layouts, timestamps, and optional scope/settings', () => {
    const dash = makeSaved({
      icon: '🔋',
      vehicleId: 5,
      isDefault: true,
      widgets: [{ id: 'i1', widgetId: 'battery-gauge' }],
      layouts: { lg: [{ i: 'i1', x: 0, y: 0, w: 2, h: 2 }] },
      settings: mergeDashboardSettings({ refreshInterval: 30 }),
    });

    expect(dash.widgets).toHaveLength(1);
    expect(dash.layouts.lg?.[0]?.i).toBe('i1');
    expect(dash.settings?.refreshInterval).toBe(30);
    expect(dash.vehicleId).toBe(5);
  });

  it('SavedDashboard.vehicleId is a nullable-or-absent number (global vs pinned scope)', () => {
    const global = makeSaved({ vehicleId: null });
    const pinned = makeSaved({ vehicleId: 2 });
    expect(global.vehicleId).toBeNull();
    expect(pinned.vehicleId).toBe(2);

    expectTypeOf<SavedDashboard['vehicleId']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<SavedDashboard['widgets']>().toEqualTypeOf<WidgetInstance[]>();
    expectTypeOf<SavedDashboard['layouts']>().toEqualTypeOf<RGLLayouts>();
    expectTypeOf<SavedDashboard['settings']>().toEqualTypeOf<DashboardSettings | undefined>();
  });

  it('LegacyDashboardLayout preserves the pre-migration positional widget shape', () => {
    const legacy: LegacyDashboardLayout = {
      id: 'legacy-1',
      name: 'Old Layout',
      widgets: [
        { id: 'w1', widgetId: 'battery-gauge', position: 0, size: { cols: 2, rows: 2 } },
        { id: 'w2', widgetId: 'range-bar', position: 1, size: { cols: 2, rows: 1 }, config: { foo: 'bar' } },
      ],
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-06-01T00:00:00Z',
    };

    expect(legacy.widgets.map((w) => w.position)).toEqual([0, 1]);
    expect(legacy.widgets[1]?.config).toEqual({ foo: 'bar' });

    expectTypeOf<LegacyDashboardLayout['widgets'][number]['position']>().toEqualTypeOf<number>();
    expectTypeOf<LegacyDashboardLayout['widgets'][number]['size']>().toEqualTypeOf<WidgetSize>();
    expectTypeOf<
      LegacyDashboardLayout['widgets'][number]['config']
    >().toEqualTypeOf<Record<string, unknown> | undefined>();
  });
});
