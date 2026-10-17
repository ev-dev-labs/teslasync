import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTranslation } from 'react-i18next';

import { MockResizeObserver } from '@/test/setup';
import { analyzeSleepEfficiency } from '../../lib/sleepEfficiencyAnalysis';
import { DataAvailabilityMatrix } from './DataAvailabilityMatrix';
import {
  availabilityKeyLabel,
  availabilityReasonLabel,
  availabilityStatusLabel,
} from './labels';
import type { SleepEfficiencyQueryState } from './types';

const analysis = analyzeSleepEfficiency({
  state_distribution: [{ state: 'asleep', count: 3, total_minutes: 0 }],
  sentry_comparison: [{ sentry_mode: true, count: 1, avg_drain_rate: 0 }],
}, Date.parse('2026-08-08T12:00:00Z'), '2026-07-10', '2026-08-08');
const state: SleepEfficiencyQueryState = {
  vehicleSelected: true, isLoading: false, isResolved: true,
  error: null, refreshError: null, onRetry: vi.fn(),
};

function Fixture() {
  const { t } = useTranslation();
  return <>
    <DataAvailabilityMatrix analysis={analysis} state={state} />
    <div data-testid="expected-labels">
      {analysis.availability.map(row => (
        <div key={row.key} data-key={row.key}>
          <span>{availabilityKeyLabel(t, row.key)}</span>
          <span>{availabilityStatusLabel(t, row.status)}</span>
          <span>{availabilityReasonLabel(t, row.reason)}</span>
        </div>
      ))}
    </div>
  </>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark', 'light-mode');
});

describe('DataAvailabilityMatrix responsive evidence access', () => {
  it.each(['light', 'dark'])('preserves rule identity/order and keyboard full details in %s mode', async mode => {
    document.documentElement.classList.add(mode === 'dark' ? 'dark' : 'light-mode');
    const observers: MockResizeObserver[] = [];
    class Observer extends MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        observers.push(this);
      }
    }
    vi.stubGlobal('ResizeObserver', Observer);
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><Fixture /></QueryClientProvider></MemoryRouter>);
    const matrix = screen.getByTestId('sleep-efficiency-availability-matrix');
    const expected = Array.from(screen.getByTestId('expected-labels').children).map(element => ({
      key: element.getAttribute('data-key'),
      source: element.children[0]!.textContent!,
      status: element.children[1]!.textContent!,
      reason: element.children[2]!.textContent!,
    }));
    const resize = (width: number) => act(() => {
      for (const observer of observers) {
        for (const target of observer.observed) {
          vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
            width, height: 700, x: 0, y: 0, top: 0, left: 0,
            right: width, bottom: 700, toJSON: () => ({}),
          });
          observer.trigger(target);
        }
      }
    });
    resize(375);
    const cards = Array.from(matrix.querySelectorAll<HTMLElement>('[data-row-key]'));
    expect(cards.map(card => card.dataset.rowKey)).toEqual(expected.map(row => row.key));
    for (const [index, card] of cards.entries()) {
      const row = expected[index]!;
      expect(card).toHaveAccessibleName(row.source);
      expect(within(card).getByText(row.status, { exact: true })).toBeInTheDocument();
      expect(within(card).getByText(row.reason, { exact: true })).toBeInTheDocument();
      expect(card.querySelector('[data-field-key="reason"]')).not.toBeNull();
      card.focus();
      await user.keyboard(index % 2 === 0 ? '{Enter}' : ' ');
      const dialog = screen.getByRole('dialog', { name: 'Data-availability matrix' });
      for (const value of [row.source, row.status, row.reason]) {
        expect(within(dialog).getByText(value, { exact: true })).toBeInTheDocument();
      }
      for (const label of ['Evidence source', 'Status', 'Evidence rule']) {
        expect(within(dialog).getByText(label, { exact: true })).toBeInTheDocument();
      }
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(card).toHaveFocus();
    }
    await user.click(within(matrix).getAllByRole('button', { name: 'Quick view' })[0]!);
    expect(within(screen.getByRole('dialog')).getByText(expected[0]!.reason)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    resize(1280);
    expect(matrix.querySelector('[data-mobile-table]')).toBeNull();
    const table = within(matrix).getByRole('table');
    const tableRows = within(table).getAllByRole('row').slice(1);
    expect(tableRows).toHaveLength(expected.length);
    for (const [index, tableRow] of tableRows.entries()) {
      expect(within(tableRow).getAllByRole('cell').map(cell => cell.textContent))
        .toEqual([expected[index]!.source, expected[index]!.status, expected[index]!.reason]);
    }
    expect(analysis.availability.map(row => row.key)).toEqual(expected.map(row => row.key));
    client.clear();
  });
});
