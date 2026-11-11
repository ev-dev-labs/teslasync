import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { MockResizeObserver } from '@/test/setup';
import PreviewChart from './PreviewChart';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

it('isolates real legend toggles between previews and removes only their temporary URL keys on close', async () => {
  // Supply jsdom layout only; the real chart, legend, URL hook and router remain mounted.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 800, 260));
  const observers: MockResizeObserver[] = [];
  class MeasuredResizeObserver extends MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      observers.push(this);
    }
  }
  const measure = () => act(() => {
    for (const observer of [...observers]) {
      for (const target of observer.observed) observer.trigger(target);
    }
  });
  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  window.history.replaceState(null, '', '/settings?from=2025-03-01&to=2025-03-07&hidden_user-chart=reference#preview');
  const originalUrl = window.location.href;
  const originalHistoryLength = window.history.length;
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Preview must not fetch'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (first = true, second = true) => (
    <QueryClientProvider client={client}><BrowserRouter>
      {first && <PreviewChart key="first" />}
      {second && <PreviewChart key="second" />}
    </BrowserRouter></QueryClientProvider>
  );
  const view = render(content());
  measure();
  const charts = () => [...view.container.querySelectorAll<HTMLElement>('[data-preview-section="chart"]')];
  const key = (chart: HTMLElement) => `hidden_${chart.querySelector('[data-chart-key]')!.getAttribute('data-chart-key')}`;
  const firstKey = key(charts()[0]);
  const secondKey = key(charts()[1]);
  expect(firstKey).not.toBe(secondKey);
  const firstReference = await within(charts()[0]).findByRole('button', { name: 'Sample reference (%)', exact: true });
  fireEvent.click(firstReference);
  await waitFor(() => expect(firstReference).toHaveAttribute('aria-pressed', 'true'));
  expect(within(charts()[1]).getByRole('button', { name: 'Sample reference (%)', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(charts()[0].querySelectorAll('.recharts-line-curve')).toHaveLength(1);
  expect(charts()[1].querySelectorAll('.recharts-line-curve')).toHaveLength(2);
  expect(new URLSearchParams(window.location.search).get(firstKey)).toBe('reference');
  expect(window.location.hash).toBe('#preview');
  fireEvent.click(within(charts()[1]).getByRole('button', { name: 'Sample reference (%)', exact: true }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get(secondKey)).toBe('reference'));
  expect(window.location.hash).toBe('#preview');

  view.rerender(content(false, true));
  await waitFor(() => expect(new URLSearchParams(window.location.search).has(firstKey)).toBe(false));
  expect(new URLSearchParams(window.location.search).get(secondKey)).toBe('reference');
  expect(window.location.hash).toBe('#preview');
  expect(within(charts()[0]).getByRole('button', { name: 'Sample reference (%)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  view.rerender(content());
  measure();
  const nextFirstKey = key(charts()[0]);
  expect(nextFirstKey).not.toBe(firstKey);
  const nextReference = await within(charts()[0]).findByRole('button', { name: 'Sample reference (%)', exact: true });
  expect(nextReference).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(nextReference);
  await waitFor(() => expect(new URLSearchParams(window.location.search).get(nextFirstKey)).toBe('reference'));
  expect(window.location.hash).toBe('#preview');
  view.unmount();
  expect(window.location.href).toBe(originalUrl);
  expect(window.history.length).toBe(originalHistoryLength);
  expect(writes).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it('does not restore the preview route or its hash after navigation elsewhere', () => {
  window.history.replaceState(null, '', '/settings?vehicle_id=42#preview');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><BrowserRouter><PreviewChart /></BrowserRouter></QueryClientProvider>);
  window.history.replaceState(null, '', '/drives?vehicle_id=42');
  const destination = window.location.href;
  view.unmount();
  expect(window.location.href).toBe(destination);
});

it('does not restore a same-route fragment that was independently cleared', () => {
  window.history.replaceState(null, '', '/settings?vehicle_id=42#appearance');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><BrowserRouter><PreviewChart /></BrowserRouter></QueryClientProvider>);
  window.history.replaceState(null, '', '/settings?vehicle_id=42');
  const destination = window.location.href;
  view.unmount();
  expect(window.location.href).toBe(destination);
});
