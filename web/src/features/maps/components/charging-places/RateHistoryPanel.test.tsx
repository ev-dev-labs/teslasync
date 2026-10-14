/**
 * RateHistoryPanel — every time-versioned rate row for one place, newest
 * `effective_from` first (the single normalized, effective-dated source of
 * truth — no separate "current rate" column anywhere).
 *
 * Coverage:
 *   1. Loading skeleton, error → QueryError + retry, empty state.
 *   2. Renders effective-from/to, rate/kWh, currency badge per row; the
 *      interval containing now shows "Current", while a future open-ended
 *      row shows "Scheduled".
 *   3. Preview sessions remains an action for selected/unselected rows,
 *      highlights the selected row, and calls `onSelectRate`.
 *   4. Only future schedules can be cancelled, gated behind confirmation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ locale: 'en-US' }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime: (value: string | null | undefined) => value ?? '—' }),
}));

vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value }: { value: unknown }) => <span data-testid="ts">{String(value)}</span>,
}));

import { RateHistoryPanel } from './RateHistoryPanel';
import type { GeofenceRate } from '@/api/types';

function makeRate(overrides: Partial<GeofenceRate> = {}): GeofenceRate {
  return {
    id: 1,
    geofence_id: 7,
    rate_per_wh: 0.0001,
    currency: 'USD',
    effective_from: '2020-01-01T00:00:00Z',
    effective_to: '2021-01-01T00:00:00Z',
    created_at: '2020-01-01T00:00:00Z',
    ...overrides,
  };
}

function futureIso(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function pastIso(hours = 24): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function renderPanel(props: Partial<Parameters<typeof RateHistoryPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <RateHistoryPanel isLoading={false} onSelectRate={vi.fn()} onDelete={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];

function resizeTable(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver,
  )));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('RateHistoryPanel — loading/error/empty', () => {
  it('shows a loading skeleton when loading with no rows yet', () => {
    const { container } = renderPanel({ isLoading: true });
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
  });

  it('surfaces a QueryError with a working retry on failure', () => {
    const onRetry = vi.fn();
    renderPanel({ error: new Error('boom'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty-history message when there are no rates yet', () => {
    renderPanel({ rates: [] });
    expect(
      screen.getByText(
        'No rate configured yet — use the form above to start pricing sessions at this place.',
      ),
    ).toBeInTheDocument();
  });
});

describe('RateHistoryPanel — rows', () => {
  it('retains future/current interval meanings, selected rate identity and zero rate after refresh failure', () => {
    const current = makeRate({ id: 42, rate_per_wh: 0, effective_from: pastIso(), effective_to: null });
    const scheduled = makeRate({ id: 9, effective_from: futureIso(), effective_to: null });
    const onSelectRate = vi.fn();
    const onDelete = vi.fn();
    renderPanel({ rates: [current, scheduled], error: new Error('refresh'), selectedRateId: 42, onSelectRate, onDelete });
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('$0.000')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview sessions' })[1]);
    expect(onSelectRate).toHaveBeenCalledWith(current);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Cancel scheduled rate' })).toHaveLength(1);
  });
  it('renders rate/kWh and currency for a closed historical row', () => {
    renderPanel({ rates: [makeRate({ rate_per_wh: 0.0001, currency: 'USD' })] });

    expect(screen.getByText('$0.100')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getAllByTestId('ts').length).toBeGreaterThan(0);
  });

  it('shows a "Current" badge for the interval containing now', () => {
    renderPanel({
      rates: [makeRate({ effective_from: pastIso(), effective_to: futureIso() })],
    });
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('labels a future open-ended rate as scheduled rather than current', () => {
    renderPanel({
      rates: [makeRate({ effective_from: futureIso(), effective_to: null })],
    });
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
  });

  it('does not expose cancellation for current or historical rates', () => {
    renderPanel({
      rates: [
        makeRate({ id: 1 }),
        makeRate({ id: 2, effective_from: pastIso(), effective_to: futureIso() }),
      ],
    });
    expect(
      screen.queryByRole('button', { name: 'Cancel scheduled rate' }),
    ).not.toBeInTheDocument();
  });

  it('keeps Preview sessions actionable while highlighting the selected row', () => {
    const rate = makeRate({ id: 5 });
    renderPanel({ rates: [rate], selectedRateId: 5 });

    const btn = screen.getByRole('button', { name: 'Preview sessions' });
    // Button component maps variant to a class; "primary" is the
    // selected-row highlight this panel switches to (see component source).
    expect(btn.className).toMatch(/primary|bg-/);
  });

  it('invokes onSelectRate with the exact rate when Preview sessions is clicked', () => {
    const onSelectRate = vi.fn();
    const rate = makeRate({ id: 9 });
    renderPanel({ rates: [rate], onSelectRate });

    fireEvent.click(screen.getByRole('button', { name: 'Preview sessions' }));
    expect(onSelectRate).toHaveBeenCalledWith(rate);
  });

  it('explains that previewing does not apply any changes', () => {
    renderPanel({ rates: [makeRate()] });

    expect(
      screen.getByText(
        'Preview sessions shows which historical charges match a rate and what would change before anything is applied.',
      ),
    ).toBeInTheDocument();
  });
});

describe('RateHistoryPanel — delete flow', () => {
  it('requires confirmation before calling onDelete, and calls it with the exact rate on confirm', async () => {
    const onDelete = vi.fn();
    const rate = makeRate({ id: 3, effective_from: futureIso(), effective_to: null });
    renderPanel({ rates: [rate], onDelete });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled rate' }));
    await waitFor(() =>
      expect(screen.getByText('Cancel this scheduled rate?')).toBeInTheDocument(),
    );
    expect(onDelete).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel rate' }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith(rate);
  });

  it('does not call onDelete when the confirmation is cancelled', async () => {
    const onDelete = vi.fn();
    renderPanel({
      rates: [makeRate({ effective_from: futureIso(), effective_to: null })],
      onDelete,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled rate' }));
    await waitFor(() =>
      expect(screen.getByText('Cancel this scheduled rate?')).toBeInTheDocument(),
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByText('Cancel this scheduled rate?')).not.toBeInTheDocument(),
    );
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('disables the delete button while a delete mutation is pending', () => {
    renderPanel({
      rates: [makeRate({ effective_from: futureIso(), effective_to: null })],
      deletePending: true,
    });
    expect(screen.getByRole('button', { name: 'Cancel scheduled rate' })).toBeDisabled();
  });
});

describe('RateHistoryPanel — shared mobile presentation', () => {
  it('retains currency, interval meaning, selection and future-only cancellation in mobile rows', () => {
    const historical = makeRate({ id: 1 });
    const current = makeRate({ id: 2, effective_from: pastIso(), effective_to: null, rate_per_wh: 0 });
    const scheduled = makeRate({ id: 3, effective_from: futureIso(), effective_to: null, currency: 'EUR' });
    const onSelectRate = vi.fn();
    const onDelete = vi.fn();
    const { container } = renderPanel({
      rates: [historical, current, scheduled], selectedRateId: current.id, onSelectRate, onDelete,
    });
    resizeTable(375);

    expect(container.querySelector('[data-mobile-table]')).not.toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByText('USD')).toHaveLength(2);
    expect(screen.getByText('EUR')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('$0.000')).toBeInTheDocument();
    const previews = screen.getAllByRole('button', { name: 'Preview sessions' });
    expect(previews).toHaveLength(3);
    [scheduled, current, historical].forEach((rate, index) => {
      fireEvent.click(previews[index]);
      expect(onSelectRate).toHaveBeenLastCalledWith(rate);
    });
    expect(previews[1].className).toMatch(/primary|bg-/);
    expect(screen.getAllByRole('button', { name: 'Cancel scheduled rate' })).toHaveLength(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows every historical field and the original preview action in Quick view and restores its trigger', async () => {
    const rate = makeRate();
    const onSelectRate = vi.fn();
    const { container } = renderPanel({ rates: [rate], onSelectRate });
    resizeTable(375);
    const trigger = screen.getByRole('button', { name: 'Quick view' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    ['Effective from', 'Rate / kWh', 'Currency', 'Effective to', rate.effective_from, rate.effective_to!, '$0.100', 'USD']
      .forEach((value) => expect(within(dialog).getByText(value)).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview sessions' }));
    expect(onSelectRate).toHaveBeenCalledWith(rate);
    const footer = dialog.querySelector('[data-modal-footer]') as HTMLElement;
    fireEvent.click(within(footer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());

    resizeTable(640);
    expect(container.querySelector('[data-mobile-table]')).toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview sessions' })).toBeInTheDocument();
    expect(container.querySelector('.hidden.md\\:table-cell')).toBeNull();
  });

  it('requires confirmation for the same scheduled rate from its mobile action', async () => {
    const rate = makeRate({ effective_from: futureIso(), effective_to: null });
    const onDelete = vi.fn();
    renderPanel({ rates: [rate], onDelete });
    resizeTable(375);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled rate' }));

    const dialog = await screen.findByRole('dialog');
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel rate' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(rate));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('retains rows, currency and source-specific retry after a failed refresh on mobile', () => {
    const onRetry = vi.fn();
    renderPanel({ rates: [makeRate()], error: new Error('refresh'), onRetry });
    resizeTable(375);

    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview sessions' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps pending cancellation disabled in the inline action and full details', () => {
    renderPanel({ rates: [makeRate({ effective_from: futureIso(), effective_to: null })], deletePending: true });
    resizeTable(375);
    expect(screen.getByRole('button', { name: 'Cancel scheduled rate' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel scheduled rate' })).toBeDisabled();
  });
});
