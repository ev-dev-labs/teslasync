/**
 * DashboardGrid — behavioural coverage for the customizable widget bento.
 *
 * Exercises the multiple render paths and interactions the component owns:
 *   - desktop react-grid-layout (RGL) path vs mobile flex-stack path
 *   - edit-mode chrome (Settings / Remove) with accessible labels + callbacks
 *   - view-mode fullscreen overlay open/close
 *   - unknown-widget resilience (registry miss renders nothing, no crash)
 *   - the hardened empty + null-safety states (undefined widgets/layouts)
 *
 * Network is never touched: widget bodies are lazy + Suspense-gated, so the
 * skeleton fallback renders and the real (data-fetching) widget never mounts
 * synchronously. Assertions only target the chrome DashboardGrid renders
 * itself. Breakpoint is driven by window.innerWidth + an offsetWidth/
 * ResizeObserver shim, mirroring DashboardGrid.mobile.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import {
  __resetAnnouncerForTests,
  subscribeAnnouncer,
} from '@/hooks/useAnnouncer';

import { DashboardGrid } from '../DashboardGrid';
import { getWidgetDef } from '../../widgets/registry';
import type { SavedDashboard, RGLLayouts, WidgetInstance } from '../../widgets/types';

// Two real registry widgets — their bodies are lazy, so only the def
// metadata (name, defaultSize) is used synchronously in these tests.
const W1_ID = 'vehicle-hero';
const W2_ID = 'vehicle-hero-card';
const W1_NAME = getWidgetDef(W1_ID)?.name ?? W1_ID;
const W2_NAME = getWidgetDef(W2_ID)?.name ?? W2_ID;

function layoutsFor(ids: string[]): RGLLayouts {
  const mk = (w: number) => ids.map((i, idx) => ({ i, x: 0, y: idx * 2, w, h: 2 }));
  return { lg: mk(2), md: mk(2), sm: mk(2), xs: mk(1) };
}

function makeDashboard(
  widgets: WidgetInstance[],
  layouts: RGLLayouts = layoutsFor(widgets.map((w) => w.id)),
): SavedDashboard {
  return {
    id: 'test-dash',
    name: 'Test',
    widgets,
    layouts,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

interface RenderOpts {
  dashboard: SavedDashboard;
  editMode?: boolean;
  onLayoutChange?: (layouts: RGLLayouts) => void;
  onRemoveWidget?: (id: string) => void;
  onOpenSettings?: (id: string) => void;
}

function renderGrid(opts: RenderOpts) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardGrid
          dashboard={opts.dashboard}
          editMode={opts.editMode ?? false}
          onLayoutChange={opts.onLayoutChange ?? (() => {})}
          onRemoveWidget={opts.onRemoveWidget ?? (() => {})}
          onOpenSettings={opts.onOpenSettings ?? (() => {})}
          getWidgetSize={() => ({ cols: 2, rows: 2 })}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// jsdom has no real layout: offsetWidth is always 0 and ResizeObserver never
// fires. Mirror window.innerWidth so react-grid-layout's useContainerWidth
// reports the viewport each test configures and picks the right breakpoint.
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

let originalOffsetWidth: PropertyDescriptor | undefined;
const announcementListener = vi.fn();

function setViewport(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

beforeEach(() => {
  __resetAnnouncerForTests();
  announcementListener.mockReset();
  subscribeAnnouncer(announcementListener);
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() { return window.innerWidth; },
  });
});

afterEach(() => {
  cleanup();
  __resetAnnouncerForTests();
  vi.unstubAllGlobals();
  if (originalOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
  } else {
    // @ts-expect-error — restore jsdom default (no descriptor)
    delete HTMLElement.prototype.offsetWidth;
  }
});

describe('DashboardGrid — render paths', () => {
  it('renders the desktop RGL grid (not the mobile stack) on a wide viewport', () => {
    setViewport(1440);
    const { container } = renderGrid({ dashboard: makeDashboard([
      { id: 'wid-1', widgetId: W1_ID },
      { id: 'wid-2', widgetId: W2_ID },
    ]) });

    expect(container.querySelector('.react-grid-layout')).not.toBeNull();
    expect(screen.queryByTestId('dashboard-mobile-stack')).toBeNull();
    // One fullscreen "Expand" affordance per widget in view mode, each
    // labelled with its own widget name.
    expect(screen.getAllByRole('button', { name: /^Expand /i })).toHaveLength(2);
    expect(screen.getByRole('button', { name: `Expand ${W1_NAME}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Expand ${W2_NAME}` })).toBeInTheDocument();
  });

  it('renders the mobile flex stack (not RGL) on a narrow viewport', () => {
    setViewport(375);
    const { container } = renderGrid({ dashboard: makeDashboard([
      { id: 'wid-1', widgetId: W1_ID },
      { id: 'wid-2', widgetId: W2_ID },
    ]) });

    const stack = screen.getByTestId('dashboard-mobile-stack');
    expect(stack).toBeInTheDocument();
    expect(container.querySelector('.react-grid-layout')).toBeNull();
    expect(stack.querySelectorAll(':scope > .widget-container')).toHaveLength(2);
  });
});

describe('DashboardGrid — edit-mode chrome', () => {
  it('exposes accessible Settings/Remove controls and wires them to the widget id', () => {
    setViewport(1440);
    const onOpenSettings = vi.fn();
    const onRemoveWidget = vi.fn();
    renderGrid({
      dashboard: makeDashboard([{ id: 'wid-1', widgetId: W1_ID }]),
      editMode: true,
      onOpenSettings,
      onRemoveWidget,
    });

    const settings = screen.getByRole('button', { name: `Settings for ${W1_NAME}` });
    const remove = screen.getByRole('button', { name: `Remove ${W1_NAME}` });
    expect(settings).toBeInTheDocument();
    expect(remove).toBeInTheDocument();
    // Fullscreen affordance is view-mode only — absent while editing.
    expect(screen.queryByRole('button', { name: /^Expand /i })).toBeNull();

    fireEvent.click(settings);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith('wid-1');

    fireEvent.click(remove);
    expect(onRemoveWidget).toHaveBeenCalledWith('wid-1');
  });

  it('does not persist a layout on mount (only on drag/resize)', () => {
    setViewport(1440);
    const onLayoutChange = vi.fn();
    renderGrid({
      dashboard: makeDashboard([{ id: 'wid-1', widgetId: W1_ID }]),
      onLayoutChange,
    });
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it('provides one-click move and resize alternatives to dragging', async () => {
    setViewport(1440);
    const onLayoutChange = vi.fn();
    renderGrid({
      dashboard: makeDashboard([
        { id: 'wid-1', widgetId: W1_ID },
        { id: 'wid-2', widgetId: W2_ID },
      ]),
      editMode: true,
      onLayoutChange,
    });

    fireEvent.click(screen.getByRole('button', { name: `Arrange ${W1_NAME}` }));
    expect(screen.getByRole('dialog', { name: `Arrange ${W1_NAME}` })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move down' })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Move down' }));
    const movedLayouts = onLayoutChange.mock.lastCall?.[0] as RGLLayouts;
    const first = movedLayouts.lg.find((item) => item.i === 'wid-1');
    const second = movedLayouts.lg.find((item) => item.i === 'wid-2');
    expect(first?.y).toBeGreaterThan(second?.y ?? Number.MAX_SAFE_INTEGER);
    expect(announcementListener.mock.lastCall?.[0]).toContain(`${W1_NAME} moved down`);

    fireEvent.click(screen.getByRole('button', { name: `Arrange ${W1_NAME}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Taller' }));
    const resizedLayouts = onLayoutChange.mock.lastCall?.[0] as RGLLayouts;
    expect(resizedLayouts.lg.find((item) => item.i === 'wid-1')?.h).toBe(4);
    expect(announcementListener.mock.lastCall?.[0]).toContain(`${W1_NAME} made taller`);
  });
});

describe('DashboardGrid — fullscreen overlay', () => {
  it('opens the fullscreen overlay on expand and closes it on exit', () => {
    setViewport(1440);
    renderGrid({ dashboard: makeDashboard([{ id: 'wid-1', widgetId: W1_ID }]) });

    // Overlay heading is absent until the user expands.
    expect(screen.queryByRole('heading', { name: W1_NAME })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: `Expand ${W1_NAME}` }));

    expect(screen.getByRole('heading', { name: W1_NAME })).toBeInTheDocument();
    const exit = screen.getByRole('button', { name: /exit fullscreen/i });
    expect(exit).toBeInTheDocument();

    fireEvent.click(exit);
    expect(screen.queryByRole('heading', { name: W1_NAME })).toBeNull();
  });
});

describe('DashboardGrid — resilience', () => {
  it('skips widgets whose id is not in the registry without crashing', () => {
    setViewport(1440);
    const { container } = renderGrid({ dashboard: makeDashboard([
      { id: 'wid-1', widgetId: W1_ID },
      { id: 'wid-unknown', widgetId: 'does-not-exist' },
    ]) });

    // Only the valid widget produces a container; the unknown one renders null.
    expect(container.querySelectorAll('.widget-container')).toHaveLength(1);
    expect(screen.getByRole('button', { name: `Expand ${W1_NAME}` })).toBeInTheDocument();
  });

  it('shows an empty state (no grid, no stack) when there are no widgets', () => {
    setViewport(1440);
    const { container } = renderGrid({ dashboard: makeDashboard([], {}) });

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent(/add widgets/i);
    expect(container.querySelector('.react-grid-layout')).toBeNull();
    expect(screen.queryByTestId('dashboard-mobile-stack')).toBeNull();
  });

  it('renders the empty state instead of throwing when widgets/layouts are undefined', () => {
    setViewport(1440);
    const malformed = {
      id: 'broken',
      name: 'Broken',
      widgets: undefined,
      layouts: undefined,
      createdAt: '',
      updatedAt: '',
    } as unknown as SavedDashboard;

    expect(() => renderGrid({ dashboard: malformed })).not.toThrow();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
