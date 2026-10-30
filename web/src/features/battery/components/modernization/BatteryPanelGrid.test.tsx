import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMetricPreferences } from '@/components/data-display';
import { useCardPlacement } from '@/components/layout';
import * as settingsBridge from '@/hooks/useSettings';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { BatteryPanelGrid } from './BatteryPanelGrid';

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function PlacementProbe({ id }: { id: string }) {
  const placement = useCardPlacement();
  return (
    <output data-testid={`${id}-placement`}>
      {placement ? `${placement.size}:${placement.span}:${placement.width}` : 'outside-provider'}
    </output>
  );
}

describe('battery public category hook contracts', () => {
  it('re-exports the original concrete hook functions without wrappers or duplicate engines', async () => {
    const metricLeaf = await vi.importActual<
      typeof import('@/components/data-display/stat-reference/useMetricPreferences')
    >('@/components/data-display/stat-reference/useMetricPreferences');
    const placementLeaf = await vi.importActual<
      typeof import('@/components/layout/layout-reference/CardPlacementContext')
    >('@/components/layout/layout-reference/CardPlacementContext');

    expect(useMetricPreferences).toBe(metricLeaf.useMetricPreferences);
    expect(useCardPlacement).toBe(placementLeaf.useCardPlacement);
  });

  it('keeps the real metric bridge reactive to settings and the existing precision fallback store', () => {
    const defaults = settingsBridge.useSettings();
    const bridge = vi.spyOn(settingsBridge, 'useSettings').mockReturnValue(defaults);
    const { result, rerender } = renderHook(useMetricPreferences);

    expect(result.current).toEqual({
      units: {
        distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
        energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
      },
      currency: { kind: 'symbol', value: '$' },
    });

    bridge.mockReturnValue({
      ...defaults,
      settings: {
        ...defaults.settings,
        unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'psi',
        locale: 'de-DE', decimal_precision: 3, currency_symbol: '€',
      },
    });
    rerender();
    expect(result.current.units).toEqual({
      distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'de-DE', precision: 3,
    });
    expect(result.current.currency).toEqual({ kind: 'symbol', value: '€' });

    bridge.mockReturnValue({
      ...defaults,
      settings: { ...defaults.settings, decimal_precision: Number.NaN },
    });
    act(() => {
      setGlobalPrecision(4);
      rerender();
    });
    expect(result.current.units.precision).toBe(4);
    act(() => setGlobalPrecision(1));
    expect(result.current.units.precision).toBe(1);
    expect(defaults.settings.decimal_precision).toBe(2);
    expect(defaults.settings.unit_of_length).toBe('km');
    expect(defaults.settings.currency_symbol).toBe('$');
  });

  it('reads the original placement context and retains the outside-provider null contract', async () => {
    const { CardPlacementContext } = await vi.importActual<
      typeof import('@/components/layout/layout-reference/CardPlacementContext')
    >('@/components/layout/layout-reference/CardPlacementContext');
    const outside = renderHook(useCardPlacement);
    expect(outside.result.current).toBeNull();
    outside.unmount();

    const placement = { size: 'third', span: 4, width: 1280 } as const;
    const inside = renderHook(useCardPlacement, {
      wrapper: ({ children }) => (
        <CardPlacementContext.Provider value={placement}>{children}</CardPlacementContext.Provider>
      ),
    });
    expect(inside.result.current).toEqual({ ...placement, className: 'col-span-4' });
  });
});

describe('BatteryPanelGrid original CardGrid provider integration', () => {
  it('uses one original host observer and per-card providers for explicit sizes across container bands', async () => {
    const { CardPlacementContext } = await vi.importActual<
      typeof import('@/components/layout/layout-reference/CardPlacementContext')
    >('@/components/layout/layout-reference/CardPlacementContext');
    const callbacks: ResizeObserverCallback[] = [];
    const observed: Element[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
      observe(target: Element) { observed.push(target); }
      disconnect() { disconnect(); }
    });
    const { container, unmount } = render(
      <CardPlacementContext.Provider value={{ size: 'quarter', span: 3, width: 9999 }}>
        <BatteryPanelGrid label="Battery evidence" ids={['trend', 'thermal', 'details']}
          sizes={['half', 'quarter', 'full']}>
          <PlacementProbe id="trend" />
          <PlacementProbe id="thermal" />
          <PlacementProbe id="details" />
        </BatteryPanelGrid>
      </CardPlacementContext.Provider>,
    );
    const host = screen.getByRole('group', { name: 'Battery evidence' });
    const panels = Array.from(container.querySelectorAll('[data-battery-panel]'));
    expect(callbacks).toHaveLength(1);
    expect(observed).toEqual([host]);
    expect(screen.getByRole('region', { name: 'Battery evidence' })).toContainElement(host);
    expect(panels.map(panel => panel.getAttribute('data-card-size')))
      .toEqual(['half', 'quarter', 'full']);

    for (const [width, band, spans] of [
      [320, 'phone', [1, 1, 1]],
      [768, 'tablet', [6, 6, 6]],
      [1280, 'desktop', [8, 4, 12]],
      [2560, 'wide', [8, 4, 12]],
    ] as const) {
      act(() => callbacks[0]([
        { target: host, contentRect: { width } } as ResizeObserverEntry,
      ], {} as ResizeObserver));
      expect(host).toHaveAttribute('data-container-band', band);
      expect(panels.map(panel => panel.getAttribute('data-card-resolved-span')))
        .toEqual(spans.map(String));
      for (const [index, id] of ['trend', 'thermal', 'details'].entries()) {
        expect(panels[index]).toHaveClass(`col-span-${spans[index]}`);
        expect(screen.getByTestId(`${id}-placement`)).toHaveTextContent(
          `${['half', 'quarter', 'full'][index]}:${spans[index]}:${width}`,
        );
      }
      expect(Array.from(host.querySelectorAll('[data-battery-panel]'))).toEqual(panels);
      expect(panels.map(panel => panel.getAttribute('data-battery-panel')))
        .toEqual(['trend', 'thermal', 'details']);
      const styledGrids = Array.from(host.querySelectorAll<HTMLElement>('[style]'));
      expect(styledGrids).toHaveLength(1);
      for (const grid of styledGrids) {
        expect(grid).toHaveAttribute('data-card-layout', 'grid');
        expect(Array.from(grid.style)).toEqual(['--card-layout-gutter']);
      }
    }
    expect(callbacks).toHaveLength(1);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
