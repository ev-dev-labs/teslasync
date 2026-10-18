/**
 * DashboardGrid — ticker isolation.
 *
 * The dashboard used to re-render the entire grid every 60s from a page-level
 * `setTick`. Age labels now subscribe to the shared ticker individually while
 * the memoised grid and widget bodies stand still. This test proves, over
 * three ticks with fake timers:
 *   - exactly one 30s ticker interval exists no matter how many labels mount;
 *   - widget bodies render exactly once (no tick-driven cascade);
 *   - subscribed age labels re-render and show advancing time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('../../widgets/registry', async () => {
  const React = await import('react');
  const { useTicker } = await import('@/hooks/useTicker');
  const counts = { heavy: 0, shell: 0, label: 0 };
  (globalThis as Record<string, unknown>).__tickerCounts = counts;

  function HeavyWidget() {
    counts.heavy += 1;
    return React.createElement('div', { 'data-testid': 'tick-heavy' }, 'heavy body');
  }
  function AgeLabel() {
    useTicker();
    counts.label += 1;
    return React.createElement('span', { 'data-testid': 'tick-age' }, `epoch ${Math.floor(Date.now() / 1000)}`);
  }
  function ShellWidget() {
    counts.shell += 1;
    return React.createElement(
      'div', { 'data-testid': 'tick-shell' }, 'shell body ', React.createElement(AgeLabel),
    );
  }
  const def = (id: string, name: string, component: () => React.JSX.Element) => ({
    id, name, description: '', category: 'vehicle', defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 1 }, maxSize: { cols: 4, rows: 4 }, component,
  });
  return {
    WIDGET_REGISTRY: [],
    getWidgetDef: (id: string) =>
      (id === 'heavy' ? def('heavy', 'Heavy', HeavyWidget)
        : id === 'shell' ? def('shell', 'Shell', ShellWidget)
          : undefined),
  };
});

import { DashboardGrid } from '../DashboardGrid';
import type { SavedDashboard, RGLLayouts, WidgetInstance } from '../../widgets/types';

function counts(): { heavy: number; shell: number; label: number } {
  return (globalThis as Record<string, unknown>).__tickerCounts as { heavy: number; shell: number; label: number };
}

function layoutsFor(ids: string[]): RGLLayouts {
  const mk = (w: number) => ids.map((i, idx) => ({ i, x: 0, y: idx * 2, w, h: 2 }));
  return { lg: mk(2), md: mk(2), sm: mk(2), xs: mk(1) };
}

const WIDGETS: WidgetInstance[] = [
  { id: 'w1', widgetId: 'heavy', config: {} },
  { id: 'w2', widgetId: 'shell', config: {} },
];

const DASHBOARD: SavedDashboard = {
  id: 'test-dash',
  name: 'Test',
  widgets: WIDGETS,
  layouts: layoutsFor(WIDGETS.map((w) => w.id)),
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.callback = cb; }
  observe() {
    queueMicrotask(() => {
      this.callback(
        [{ contentRect: { width: window.innerWidth, height: 600 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    });
  }
  unobserve() {}
  disconnect() {}
}

let originalClientWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return window.innerWidth; },
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DashboardGrid ticker isolation', () => {
  it('renders widget bodies once across ticks while subscribed age labels update on one shared timer', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    counts().heavy = 0;
    counts().shell = 0;
    counts().label = 0;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardGrid
            dashboard={DASHBOARD}
            editMode={false}
            onLayoutChange={() => {}}
            onRemoveWidget={() => {}}
            onOpenSettings={() => {}}
            getWidgetSize={() => ({ cols: 2, rows: 2 })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('dashboard-mobile-stack')).toBeInTheDocument();
    expect(screen.getByTestId('tick-heavy')).toBeInTheDocument();
    const firstAge = screen.getByTestId('tick-age').textContent;
    expect(counts().heavy).toBe(1);
    expect(counts().shell).toBe(1);
    expect(counts().label).toBe(1);

    // Exactly one 30s ticker interval, shared by every subscriber.
    const tickerTimers = setIntervalSpy.mock.calls.filter((call) => call[1] === 30_000);
    expect(tickerTimers).toHaveLength(1);

    act(() => { vi.advanceTimersByTime(30_000); });
    act(() => { vi.advanceTimersByTime(30_000); });
    act(() => { vi.advanceTimersByTime(30_000); });

    // Widget bodies never re-rendered; the subscribed label did, showing time advance.
    expect(counts().heavy).toBe(1);
    expect(counts().shell).toBe(1);
    expect(counts().label).toBe(1 + 3);
    expect(screen.getByTestId('tick-age').textContent).not.toBe(firstAge);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips the whole grid subtree when the parent re-renders with identical props', () => {
    vi.useFakeTimers();
    counts().heavy = 0;
    counts().shell = 0;
    counts().label = 0;

    const gridProps = {
      dashboard: DASHBOARD,
      editMode: false as const,
      onLayoutChange: () => {},
      onRemoveWidget: () => {},
      onOpenSettings: () => {},
      getWidgetSize: () => ({ cols: 2, rows: 2 }),
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardGrid {...gridProps} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('dashboard-mobile-stack')).toBeInTheDocument();
    expect(counts().heavy).toBe(1);
    expect(counts().shell).toBe(1);

    // Same references in, no render out: the memoised grid (and every widget
    // body beneath it) stands still on parent churn.
    view.rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardGrid {...gridProps} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(counts().heavy).toBe(1);
    expect(counts().shell).toBe(1);

    // Control: a new dashboard identity still re-renders.
    view.rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardGrid {...gridProps} dashboard={{ ...DASHBOARD }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(counts().heavy).toBe(2);
    expect(counts().shell).toBe(2);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
