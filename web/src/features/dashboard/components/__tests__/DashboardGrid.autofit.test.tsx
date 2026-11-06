import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { DashboardGrid } from '../DashboardGrid';
import { normalizeDashboard } from '../../lib/orderedLayout';
import type { SavedDashboard, WidgetInstance } from '../../widgets/types';

const observers: MockResizeObserver[] = [];
class MockResizeObserver {
  targets = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect = vi.fn(() => this.targets.clear());
}

function dashboard(widgets: WidgetInstance[], id = 'test'): SavedDashboard {
  return normalizeDashboard({
    id, name: id, widgets, layoutVersion: 1, layouts: {}, createdAt: '', updatedAt: '',
  });
}

function renderGrid(saved: SavedDashboard) {
  const onLayoutChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (value: SavedDashboard) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardGrid dashboard={value} editMode={false} onLayoutChange={onLayoutChange}
          onRemoveWidget={() => {}} onOpenSettings={() => {}} getWidgetSize={() => ({ cols: 1, rows: 2 })} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(content(saved));
  return { ...view, onLayoutChange, setDashboard: (value: SavedDashboard) => view.rerender(content(value)) };
}

function measure(container: HTMLElement, id: string, height: number) {
  const panel = container.querySelector<HTMLElement>(`[data-widget-id="${id}"] > .widget-panel`)!;
  expect(panel).not.toBeNull();
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: height });
  act(() => {
    for (const observer of observers.filter(candidate => candidate.targets.has(panel))) {
      observer.callback([{ target: panel } as ResizeObserverEntry], observer as unknown as ResizeObserver);
    }
  });
  return panel;
}

function cardHeight(container: HTMLElement, id: string) {
  return container.querySelector<HTMLElement>(`[data-widget-id="${id}"]`)?.style.height;
}

let originalClientWidth: PropertyDescriptor | undefined;
beforeEach(() => {
  observers.length = 0;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1440 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
  else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
});

describe('DashboardGrid content measurement', () => {
  it('grows and shrinks an already-loaded card without persisting measurements or changing transitions', async () => {
    const view = renderGrid(dashboard([{ id: 'a', widgetId: 'battery-gauge', sizeClass: 'small' }]));
    const panel = measure(view.container, 'a', 150);
    panel.style.transitionProperty = 'opacity';
    await waitFor(() => expect(cardHeight(view.container, 'a')).toBe('150px'));
    measure(view.container, 'a', 500);
    await waitFor(() => expect(cardHeight(view.container, 'a')).toBe('500px'));
    measure(view.container, 'a', 120);
    await waitFor(() => expect(cardHeight(view.container, 'a')).toBe('120px'));
    expect(panel.style.transitionProperty).toBe('opacity');
    expect(panel.style.height).toBe('');
    expect(view.onLayoutChange).not.toHaveBeenCalled();
  });

  it('observes newly added cards while retaining existing measured heights', async () => {
    const first = { id: 'a', widgetId: 'battery-gauge', sizeClass: 'small' as const };
    const view = renderGrid(dashboard([first]));
    measure(view.container, 'a', 150);
    await waitFor(() => expect(cardHeight(view.container, 'a')).toBe('150px'));
    view.setDashboard(dashboard([first, { id: 'b', widgetId: 'charge-status', sizeClass: 'small' }]));
    measure(view.container, 'b', 350);
    await waitFor(() => expect(cardHeight(view.container, 'b')).toBe('350px'));
    expect(cardHeight(view.container, 'a')).toBe('150px');
    expect(view.onLayoutChange).not.toHaveBeenCalled();
  });

  it('bounds growth by registry limits and keeps small content small after an explicit resize', async () => {
    const view = renderGrid(dashboard([{ id: 'a', widgetId: 'battery-gauge', sizeClass: 'small' }]));
    measure(view.container, 'a', 5000);
    await waitFor(() => expect(cardHeight(view.container, 'a')).toBe('900px'));
    view.setDashboard(dashboard([{ id: 'a', widgetId: 'battery-gauge', sizeClass: 'small', heightRows: 2 }]));
    measure(view.container, 'a', 500);
    await waitFor(() => expect(cardHeight(view.container, 'a')).toBe('176px'));
    measure(view.container, 'a', 100);
    await waitFor(() => expect(cardHeight(view.container, 'a')).toBe('100px'));
    expect(view.onLayoutChange).not.toHaveBeenCalled();
  });

  it('disconnects old panels after dashboard switches and on unmount', async () => {
    const view = renderGrid(dashboard([{ id: 'a', widgetId: 'battery-gauge' }]));
    const old = measure(view.container, 'a', 250);
    await waitFor(() => expect(cardHeight(view.container, 'a')).toBe('250px'));
    const observer = observers.find(candidate => candidate.targets.has(old))!;
    view.setDashboard(dashboard([{ id: 'b', widgetId: 'charge-status' }], 'other'));
    expect(observer.disconnect).toHaveBeenCalled();
    measure(view.container, 'b', 200);
    await waitFor(() => expect(cardHeight(view.container, 'b')).toBe('200px'));
    expect(view.container.querySelector('[data-widget-id="a"]')).toBeNull();
    view.unmount();
    expect(observers.every(candidate => candidate.targets.size === 0)).toBe(true);
    expect(view.onLayoutChange).not.toHaveBeenCalled();
  });
});
