/**
 * DashboardGrid — RGL contract pins.
 *
 * Layout data flows UNIDIRECTIONALLY (grid → RGL): RGL's `onLayoutChange`
 * emissions are unusable as a source of truth (v2.2.4 regenerates
 * non-active breakpoints as x=0 stacks and emits w1h1 key-miss rebuilds),
 * so the grid must not subscribe to them. Gesture results return via
 * callback args instead. These tests pin both halves with a stubbed RGL:
 *
 *   1. no `onLayoutChange` prop is passed to ResponsiveGridLayout, and
 *   2. `onDragStop`/`onResizeStop` persist the layout from their args while
 *      leaving other breakpoints untouched (no cross-breakpoint clobber).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { DragEvent as ReactDragEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

import { DashboardGrid } from '../DashboardGrid';
import type { SavedDashboard, RGLLayouts, RGLLayout } from '../../widgets/types';
import { WIDGET_DND_MIME } from '../../widgets/types';

interface CapturedProps {
  onLayoutChange?: unknown;
  onDragStop?: (layout: RGLLayout[], oldItem: unknown, newItem: { i: string } | null) => void;
  onResizeStop?: (layout: RGLLayout[], oldItem: unknown, newItem: { i: string } | null) => void;
  onDrop?: (layout: RGLLayout[], item: RGLLayout | undefined, e: Event) => void;
  onDropDragOver?: (e: ReactDragEvent) => { w?: number; h?: number } | false | void;
  dropConfig?: { enabled?: boolean };
  [key: string]: unknown;
}

let captured: CapturedProps | null = null;

vi.mock('react-grid-layout', () => ({
  ResponsiveGridLayout: (props: CapturedProps) => {
    captured = props;
    return null;
  },
  useContainerWidth: () => ({ containerRef: { current: null }, width: 1400 }),
  verticalCompactor: { compact: (layout: RGLLayout[]) => layout },
}));

function makeDashboard(): SavedDashboard {
  // lg intentionally differs from md: a clobbering persist would overwrite it.
  const md: RGLLayout[] = [
    { i: 'wid-1', x: 0, y: 0, w: 1, h: 2 },
    { i: 'wid-2', x: 1, y: 0, w: 1, h: 2 },
  ];
  const lg: RGLLayout[] = [
    { i: 'wid-1', x: 0, y: 0, w: 1, h: 2 },
    { i: 'wid-2', x: 2, y: 0, w: 2, h: 2 },
  ];
  return {
    id: 'test-dash',
    name: 'Test',
    widgets: [
      { id: 'wid-1', widgetId: 'vehicle-hero' },
      { id: 'wid-2', widgetId: 'vehicle-hero-card' },
    ],
    layouts: { lg, md, sm: [...md], xs: [...md] },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function renderGrid(
  onLayoutChange: (l: RGLLayouts, bp?: string) => void,
  onDropWidget?: (widgetId: string, placement: { x: number; y: number; w: number; h: number }, bp: string) => void,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardGrid
          dashboard={makeDashboard()}
          editMode
          onLayoutChange={onLayoutChange}
          onRemoveWidget={() => {}}
          onOpenSettings={() => {}}
          getWidgetSize={() => ({ cols: 2, rows: 2 })}
          onDropWidget={onDropWidget}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function dragEventWith(widgetId: string): ReactDragEvent {
  return {
    dataTransfer: {
      getData: (type: string) => (type === WIDGET_DND_MIME ? widgetId : ''),
    },
  } as unknown as ReactDragEvent;
}

beforeEach(() => {
  captured = null;
});

afterEach(() => {
  cleanup();
});

describe('DashboardGrid — RGL contract', () => {
  it('does not subscribe to RGL layout emissions', () => {
    renderGrid(() => {});
    expect(captured).not.toBeNull();
    expect(captured?.onLayoutChange).toBeUndefined();
  });

  it('persists drag results from callback args without touching other breakpoints', () => {
    const onLayoutChange = vi.fn();
    renderGrid(onLayoutChange);
    const moved: RGLLayout[] = [
      { i: 'wid-1', x: 1, y: 0, w: 1, h: 2 },
      { i: 'wid-2', x: 0, y: 0, w: 1, h: 2 },
    ];

    act(() => {
      captured?.onDragStop?.(moved, null, { i: 'wid-1' });
    });

    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    const [saved, bp] = onLayoutChange.mock.calls[0] as [RGLLayouts, string];
    expect(bp).toBe('lg'); // width 1400 → lg
    expect(saved.lg).toEqual(moved);
    // The md slot keeps its own arrangement (a wholesale echo adoption here
    // is what used to collapse untouched breakpoints into x=0 stacks).
    expect(saved.md).toEqual([
      { i: 'wid-1', x: 0, y: 0, w: 1, h: 2 },
      { i: 'wid-2', x: 1, y: 0, w: 1, h: 2 },
    ]);
  });

  it('drops no-op gestures before writing (no undo entry, no toast)', () => {
    const onLayoutChange = vi.fn();
    renderGrid(onLayoutChange);
    const unchanged: RGLLayout[] = [
      { i: 'wid-1', x: 0, y: 0, w: 1, h: 2 },
      { i: 'wid-2', x: 2, y: 0, w: 2, h: 2 },
    ];

    act(() => {
      captured?.onResizeStop?.(unchanged, null, { i: 'wid-1' });
    });

    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it('enables external drops in edit mode and forwards drop placement', () => {
    const onDropWidget = vi.fn();
    renderGrid(() => {}, onDropWidget);
    expect(captured?.dropConfig?.enabled).toBe(true);

    act(() => {
      captured?.onDrop?.(
        [],
        { i: '__dropping__', x: 1, y: 2, w: 1, h: 2 },
        dragEventWith('quick-nav') as unknown as Event,
      );
    });

    expect(onDropWidget).toHaveBeenCalledTimes(1);
    expect(onDropWidget).toHaveBeenCalledWith(
      'quick-nav',
      { x: 1, y: 2, w: 1, h: 2 },
      'lg', // mocked width 1400
    );
  });

  it('sizes the drop placeholder from the registry and rejects the rest', () => {
    renderGrid(() => {}, () => {});
    // quick-nav default is 4×2; lg has 4 columns so it previews full footprint.
    expect(captured?.onDropDragOver?.(dragEventWith('quick-nav'))).toEqual({ w: 4, h: 2 });
    // Already on the dashboard → no placeholder.
    expect(captured?.onDropDragOver?.(dragEventWith('vehicle-hero'))).toBe(false);
    // Unknown widget → no placeholder.
    expect(captured?.onDropDragOver?.(dragEventWith('no-such-widget'))).toBe(false);
    // Foreign drag (no custom MIME payload) → no placeholder.
    expect(captured?.onDropDragOver?.(dragEventWith(''))).toBe(false);
  });
});
