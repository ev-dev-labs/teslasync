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
 *   3. Selecting a row for preview highlights it (primary variant) and
 *      calls `onSelectRate`.
 *   4. Only future schedules can be cancelled, gated behind confirmation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
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

beforeEach(() => {
  cleanup();
});

describe('RateHistoryPanel — loading/error/empty', () => {
  it('shows a loading skeleton when loading with no rows yet', () => {
    const { container } = renderPanel({ isLoading: true });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
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

  it('highlights the selected row and labels its impact as shown', () => {
    const rate = makeRate({ id: 5 });
    renderPanel({ rates: [rate], selectedRateId: 5 });

    const btn = screen.getByRole('button', { name: 'Impact shown' });
    // Button component maps variant to a class; "primary" is the
    // selected-row highlight this panel switches to (see component source).
    expect(btn.className).toMatch(/primary|bg-/);
  });

  it('invokes onSelectRate with the exact rate when Review impact is clicked', () => {
    const onSelectRate = vi.fn();
    const rate = makeRate({ id: 9 });
    renderPanel({ rates: [rate], onSelectRate });

    fireEvent.click(screen.getByRole('button', { name: 'Review impact' }));
    expect(onSelectRate).toHaveBeenCalledWith(rate);
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel Rate' }));

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
