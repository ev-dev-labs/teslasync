import {
  WIDGET_REGISTRY,
  getWidgetDef,
  nativeWidgetRegistryCapabilities,
  NATIVE_WIDGET_REGISTRY_PENDING_REASON,
  type WidgetDef,
} from '../src/web-parity/features/dashboard/widgets/registry';

/**
 * Native parity contract for the dashboard widget registry barrel.
 *
 * Web web/src/features/dashboard/widgets/registry.ts re-exports WIDGET_REGISTRY
 * and getWidgetDef from the split ./registry/index. That subtree (16 category
 * sub-registries, the ../types WidgetDef definitions, ~60 React.lazy widget
 * components, and lucide-react icons) is not yet ported, so the native port
 * keeps the two-symbol public surface with the exact find-by-id lookup logic,
 * backs it with a native-safe empty registry, and documents the deferred
 * categories in a capability record. These tests assert that contract.
 */

describe('dashboard widget registry (native parity)', () => {
  it('exposes WIDGET_REGISTRY as an array', () => {
    expect(Array.isArray(WIDGET_REGISTRY)).toBe(true);
  });

  it('is a native-safe empty registry until the split subtree is ported', () => {
    expect(WIDGET_REGISTRY).toHaveLength(0);
  });

  it('getWidgetDef returns undefined for any id while the registry is empty', () => {
    expect(getWidgetDef('vehicle-hero')).toBeUndefined();
    expect(getWidgetDef('analytics-summary')).toBeUndefined();
    expect(getWidgetDef('')).toBeUndefined();
  });

  it('getWidgetDef preserves the web find-by-id lookup logic', () => {
    const probe: WidgetDef = {
      id: 'probe-widget',
      name: 'Probe',
      description: 'Temporary lookup probe',
      category: 'system',
      defaultSize: { cols: 1, rows: 1 },
      minSize: { cols: 1, rows: 1 },
      maxSize: { cols: 2, rows: 2 },
    };
    const other: WidgetDef = { ...probe, id: 'other-widget', name: 'Other' };

    WIDGET_REGISTRY.push(probe, other);
    try {
      expect(getWidgetDef('probe-widget')).toBe(probe);
      expect(getWidgetDef('other-widget')).toBe(other);
      expect(getWidgetDef('missing-widget')).toBeUndefined();
    } finally {
      WIDGET_REGISTRY.length = 0;
    }

    expect(WIDGET_REGISTRY).toHaveLength(0);
  });

  it('documents the deferred split-registry subtree in the capability record', () => {
    expect(nativeWidgetRegistryCapabilities.available).toEqual([
      'WIDGET_REGISTRY',
      'getWidgetDef',
    ]);
    expect(nativeWidgetRegistryCapabilities.pending.source).toBe(
      './registry/index',
    );
    expect(nativeWidgetRegistryCapabilities.pending.reason).toBe(
      NATIVE_WIDGET_REGISTRY_PENDING_REASON,
    );
    expect(nativeWidgetRegistryCapabilities.pending.categories).toEqual([
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
    ]);
  });
});
