/**
 * DashboardGrid — auto-fit for newly added widgets.
 *
 * A new widget must show all its data, not an internal scrollbar: after an
 * add, overflowing panels (scrollHeight > clientHeight) are grown to fit,
 * bounded by maxH. Mount-loaded widgets never auto-fit (a reload must not
 * undo a deliberate shrink), and balanced panels are left alone.
 *
 * jsdom has no layout (all measurements are 0), so overflow is simulated by
 * redefining scrollHeight/clientHeight on the rendered panel. Harness mirrors
 * DashboardGrid.test.tsx (viewport + ResizeObserver shims).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

import { DashboardGrid } from '../DashboardGrid';
import { getWidgetDef } from '../../widgets/registry';
import type { SavedDashboard, RGLLayouts, WidgetInstance } from '../../widgets/types';

const W1_ID = 'vehicle-hero';
const W2_ID = 'vehicle-hero-card';

function layoutsFor(ids: string[]): RGLLayouts {
  const mk = (w: number) => ids.map((i, idx) => ({ i, x: 0, y: idx * 2, w, h: 2 }));
  return { lg: mk(2), md: mk(2), sm: mk(2), xs: mk(1) };
}

function makeDashboard(widgets: WidgetInstance[]): SavedDashboard {
  return {
    id: 'test-dash',
    name: 'Test',
    widgets,
    layouts: layoutsFor(widgets.map((w) => w.id)),
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function renderGrid(dashboard: SavedDashboard, onLayoutChange: (l: RGLLayouts) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardGrid
          dashboard={dashboard}
          editMode={false}
          onLayoutChange={onLayoutChange}
          onRemoveWidget={() => {}}
          onOpenSettings={() => {}}
          getWidgetSize={() => ({ cols: 2, rows: 2 })}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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

function mockPanelOverflow(container: HTMLElement, widgetId: string, scroll: number, client: number) {
  const panel = container.querySelector(`[data-widget-id="${widgetId}"] > .widget-panel`);
  expect(panel, `panel for ${widgetId}`).not.toBeNull();
  Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: scroll });
  Object.defineProperty(panel, 'clientHeight', { configurable: true, value: client });
}

function mockNestedOverflow(container: HTMLElement, widgetId: string, scroll: number, client: number) {
  const panel = container.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"] > .widget-panel`);
  expect(panel).not.toBeNull();
  Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 176 });
  Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 176 });
  const content = document.createElement('div');
  content.style.overflowY = 'auto';
  Object.defineProperty(content, 'scrollHeight', { configurable: true, value: scroll });
  Object.defineProperty(content, 'clientHeight', { configurable: true, value: client });
  panel!.appendChild(content);
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return window.innerWidth; },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalClientWidth) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
  } else {
    // @ts-expect-error — restore jsdom default (no descriptor)
    delete HTMLElement.prototype.clientWidth;
  }
});

describe('DashboardGrid — auto-fit', () => {
  it('grows a newly added widget when its inner content scrolls but its panel does not', async () => {
    const onLayoutChange = vi.fn();
    const first = renderGrid(makeDashboard([{ id: 'wid-1', widgetId: W1_ID }]), onLayoutChange);
    first.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DashboardGrid
            dashboard={makeDashboard([
              { id: 'wid-1', widgetId: W1_ID },
              { id: 'wid-2', widgetId: W2_ID },
            ])}
            editMode={false}
            onLayoutChange={onLayoutChange}
            onRemoveWidget={() => {}}
            onOpenSettings={() => {}}
            getWidgetSize={() => ({ cols: 2, rows: 2 })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    mockNestedOverflow(first.container as HTMLElement, 'wid-2', 500, 100);

    await waitFor(() => expect(onLayoutChange).toHaveBeenCalled());
    const grown = onLayoutChange.mock.calls[0][0] as RGLLayouts;
    const maxH = getWidgetDef(W2_ID)?.maxSize.rows ?? 20;
    expect(grown.lg.find((l) => l.i === 'wid-2')?.h).toBe(Math.min(7, maxH));
  });

  it('grows a newly added widget to fit overflowing content', async () => {
    const onLayoutChange = vi.fn();
    const first = renderGrid(makeDashboard([{ id: 'wid-1', widgetId: W1_ID }]), onLayoutChange);

    // Add wid-2 -> eligible; its panel overflows (500px of content in 176px).
    first.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DashboardGrid
            dashboard={makeDashboard([
              { id: 'wid-1', widgetId: W1_ID },
              { id: 'wid-2', widgetId: W2_ID },
            ])}
            editMode={false}
            onLayoutChange={onLayoutChange}
            onRemoveWidget={() => {}}
            onOpenSettings={() => {}}
            getWidgetSize={() => ({ cols: 2, rows: 2 })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    mockPanelOverflow(first.container as unknown as HTMLElement, 'wid-2', 500, 176);

    await waitFor(() => expect(onLayoutChange).toHaveBeenCalled());
    const grown = onLayoutChange.mock.calls[0][0] as RGLLayouts;
    // rowsForHeight(500, 80, 16) = ceil(516/96) = 6, bounded by maxH.
    const maxH = getWidgetDef(W2_ID)?.maxSize.rows ?? 20;
    const item = grown.lg.find((l) => l.i === 'wid-2');
    expect(item?.h).toBe(Math.min(6, maxH));
    // The untouched widget keeps its size.
    expect(grown.lg.find((l) => l.i === 'wid-1')?.h).toBe(2);
  });

  it('clamps growth to the widget maxH', async () => {
    const onLayoutChange = vi.fn();
    const first = renderGrid(makeDashboard([{ id: 'wid-1', widgetId: W1_ID }]), onLayoutChange);
    first.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DashboardGrid
            dashboard={makeDashboard([
              { id: 'wid-1', widgetId: W1_ID },
              { id: 'wid-2', widgetId: W2_ID },
            ])}
            editMode={false}
            onLayoutChange={onLayoutChange}
            onRemoveWidget={() => {}}
            onOpenSettings={() => {}}
            getWidgetSize={() => ({ cols: 2, rows: 2 })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    mockPanelOverflow(first.container as unknown as HTMLElement, 'wid-2', 5000, 176);

    await waitFor(() => expect(onLayoutChange).toHaveBeenCalled());
    const grown = onLayoutChange.mock.calls[0][0] as RGLLayouts;
    const maxH = getWidgetDef(W2_ID)?.maxSize.rows ?? 20;
    expect(grown.lg.find((l) => l.i === 'wid-2')?.h).toBe(maxH);
  });

  it('leaves balanced panels alone', async () => {
    const onLayoutChange = vi.fn();
    const first = renderGrid(makeDashboard([{ id: 'wid-1', widgetId: W1_ID }]), onLayoutChange);
    first.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DashboardGrid
            dashboard={makeDashboard([
              { id: 'wid-1', widgetId: W1_ID },
              { id: 'wid-2', widgetId: W2_ID },
            ])}
            editMode={false}
            onLayoutChange={onLayoutChange}
            onRemoveWidget={() => {}}
            onOpenSettings={() => {}}
            getWidgetSize={() => ({ cols: 2, rows: 2 })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // jsdom measurements are 0/0 (no overflow) — no settle pass may write.
    // (act-wrapped so lazy widget chunks landing mid-wait stay quiet.)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it('never auto-fits mount-loaded widgets (reload safety)', async () => {
    const onLayoutChange = vi.fn();
    const first = renderGrid(
      makeDashboard([
        { id: 'wid-1', widgetId: W1_ID },
        { id: 'wid-2', widgetId: W2_ID },
      ]),
      onLayoutChange,
    );
    // Even with overflowing content, loaded widgets are the user's truth.
    mockPanelOverflow(first.container as unknown as HTMLElement, 'wid-2', 500, 176);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it('does not treat widgets on a switched dashboard as newly added', async () => {
    const onLayoutChange = vi.fn();
    const first = renderGrid(makeDashboard([{ id: 'wid-1', widgetId: W1_ID }]), onLayoutChange);
    first.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DashboardGrid
            dashboard={{ ...makeDashboard([{ id: 'wid-2', widgetId: W2_ID }]), id: 'other-dash' }}
            editMode={false}
            onLayoutChange={onLayoutChange}
            onRemoveWidget={() => {}}
            onOpenSettings={() => {}}
            getWidgetSize={() => ({ cols: 2, rows: 2 })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    mockPanelOverflow(first.container as HTMLElement, 'wid-2', 500, 176);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(onLayoutChange).not.toHaveBeenCalled();
  });
});
