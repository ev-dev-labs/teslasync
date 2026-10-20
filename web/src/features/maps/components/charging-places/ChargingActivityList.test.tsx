/**
 * ChargingActivityList — paginated session-level activity feed for one
 * place (any pricing state, not just already-priced rows).
 *
 * Coverage:
 *   1. Loading skeleton, error → QueryError + retry, empty state (offset 0
 *      only).
 *   2. Renders started/ended, energy, cost, and a cost_source badge per
 *      row — including the "—" fallbacks for null ended_at/energy/cost and
 *      an Unknown badge for unpriced (`cost_source: null`) rows.
 *   3. Pagination: Previous disabled at offset 0; Next disabled once a page
 *      comes back shorter than the page size (last page); clicking Next/
 *      Previous advances/retreats the offset passed to the hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) => (name in o ? String(o[name]) : `{{${name}}}`));
          }
          return fallbackOrOpts;
        }
        return key;
      },
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

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatEnergy: (wh: number) => `${(wh / 1000).toFixed(1)} kWh` }),
}));

vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value }: { value: unknown }) => <span data-testid="ts">{String(value)}</span>,
}));

vi.mock('@/api/hooks/useLocations', () => ({
  useGeofenceChargingActivity: vi.fn(),
}));

import { useGeofenceChargingActivity } from '@/api/hooks/useLocations';
import { ChargingActivityList } from './ChargingActivityList';
import type { GeofenceChargingActivity } from '@/api/types';

const mockedActivity = useGeofenceChargingActivity as unknown as ReturnType<typeof vi.fn>;
let refetch: ReturnType<typeof vi.fn>;

type ActivityQuery = UseQueryResult<GeofenceChargingActivity[], Error> & { isFetching: boolean };

function makeRow(overrides: Partial<GeofenceChargingActivity> = {}): GeofenceChargingActivity {
  return {
    session_id: 1,
    vehicle_id: 1,
    started_at: '2026-09-01T12:00:00Z',
    ended_at: '2026-09-01T13:00:00Z',
    energy_wh: 10_000,
    cost_decimal: 1.2,
    cost_currency: 'USD',
    cost_source: 'geofence_tariff',
    rate_id: 5,
    ...overrides,
  };
}

function makeQuery(overrides: Partial<ActivityQuery> = {}): ActivityQuery {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch,
    ...overrides,
  } as unknown as ActivityQuery;
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
  vi.clearAllMocks();
  refetch = vi.fn();
  mockedActivity.mockReturnValue(makeQuery());
});

afterEach(() => vi.unstubAllGlobals());

function renderList() {
  return render(
    <MemoryRouter>
      <ChargingActivityList geofenceId={7} />
    </MemoryRouter>,
  );
}

describe('ChargingActivityList — loading/error/empty', () => {
  it('shows a loading skeleton', () => {
    mockedActivity.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    const { container } = renderList();
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
  });

  it('surfaces a QueryError with a working retry on failure', () => {
    mockedActivity.mockReturnValue(makeQuery({ data: undefined, isError: true, error: new Error('boom') }));
    renderList();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty message when there are no sessions at offset 0', () => {
    mockedActivity.mockReturnValue(makeQuery({ data: [] }));
    renderList();
    expect(screen.getByText('No charging sessions recorded at this place yet.')).toBeInTheDocument();
  });
});

describe('ChargingActivityList — rows', () => {
  it('retains source-aligned sessions and zero energy/cost when refresh fails', () => {
    mockedActivity.mockReturnValue(makeQuery({
      data: [makeRow({ energy_wh: 0, cost_decimal: 0 })],
      isError: true, error: new Error('refresh'),
    }));
    renderList();
    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('geofence_tariff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
  it('renders started/ended, energy, cost, and the cost_source badge for a priced row', () => {
    mockedActivity.mockReturnValue(makeQuery({ data: [makeRow()] }));
    renderList();

    expect(screen.getAllByTestId('ts')).toHaveLength(2);
    expect(screen.getByText('10.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('$1.20')).toBeInTheDocument();
    expect(screen.getByText('geofence_tariff')).toBeInTheDocument();
  });

  it('falls back for null ended_at/energy/cost and labels a null cost_source as Unknown', () => {
    mockedActivity.mockReturnValue(
      makeQuery({
        data: [
          makeRow({
            ended_at: null,
            energy_wh: null,
            cost_decimal: null,
            cost_currency: null,
            cost_source: null,
            rate_id: null,
          }),
        ],
      }),
    );
    renderList();

    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});

describe('ChargingActivityList — pagination', () => {
  it('disables Previous at offset 0 and calls the hook with offset 0 / limit 25 initially', () => {
    mockedActivity.mockReturnValue(makeQuery({ data: Array.from({ length: 25 }, (_, i) => makeRow({ session_id: i })) }));
    renderList();

    expect(mockedActivity).toHaveBeenCalledWith(7, 25, 0);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('disables Next once a page comes back shorter than the page size (last page)', () => {
    mockedActivity.mockReturnValue(makeQuery({ data: [makeRow()] }));
    renderList();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('advances the offset by the page size when Next is clicked', () => {
    mockedActivity.mockReturnValue(makeQuery({ data: Array.from({ length: 25 }, (_, i) => makeRow({ session_id: i })) }));
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(mockedActivity).toHaveBeenLastCalledWith(7, 25, 25);
  });

  it('retreats the offset by the page size when Previous is clicked, never below 0', () => {
    mockedActivity.mockReturnValue(makeQuery({ data: Array.from({ length: 25 }, (_, i) => makeRow({ session_id: i })) }));
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(mockedActivity).toHaveBeenLastCalledWith(7, 25, 0);
  });

  it('disables both buttons while a page is being fetched', () => {
    mockedActivity.mockReturnValue(
      makeQuery({ data: Array.from({ length: 25 }, (_, i) => makeRow({ session_id: i })), isFetching: true }),
    );
    renderList();

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

describe('ChargingActivityList — shared mobile presentation', () => {
  it('retains end time, display energy, currency-aware cost and provenance in the summary and full details', () => {
    const row = makeRow();
    mockedActivity.mockReturnValue(makeQuery({ data: [row] }));
    const { container } = renderList();
    resizeTable(375);

    expect(container.querySelector('[data-mobile-table]')).not.toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    [row.started_at, row.ended_at!, '10.0 kWh', '$1.20', 'geofence_tariff']
      .forEach((value) => expect(screen.getByText(value)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    ['Started', 'Ended', 'Energy', 'Cost', 'Source', row.started_at, row.ended_at!, '10.0 kWh', '$1.20', 'geofence_tariff']
      .forEach((value) => expect(within(dialog).getByText(value)).toBeInTheDocument());
    expect(row.energy_wh).toBe(10_000);
    expect(mockedActivity).toHaveBeenLastCalledWith(7, 25, 0);
  });

  it.each([640, 768])('keeps every activity column reachable in the table at allocated width %s', (width) => {
    mockedActivity.mockReturnValue(makeQuery({ data: [makeRow()] }));
    const { container } = renderList();
    resizeTable(375);
    resizeTable(width);
    expect(container.querySelector('[data-mobile-table]')).toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01T13:00:00Z')).toBeInTheDocument();
    expect(screen.getByText('10.0 kWh')).toBeInTheDocument();
    expect(container.querySelector('.hidden.md\\:table-cell')).toBeNull();
  });

  it('does not substitute recorded zero for unknown end time, energy or cost in mobile details', () => {
    mockedActivity.mockReturnValue(makeQuery({
      data: [makeRow({ ended_at: null, energy_wh: null, cost_decimal: null, cost_currency: null, cost_source: null })],
    }));
    renderList();
    resizeTable(375);
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('—')).toHaveLength(3);
    expect(within(dialog).getByText('Unknown')).toBeInTheDocument();
    expect(within(dialog).queryByText('0.0 kWh')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('preserves recorded zero and source retry after a failed mobile refresh', () => {
    mockedActivity.mockReturnValue(makeQuery({
      data: [makeRow({ energy_wh: 0, cost_decimal: 0 })], isError: true, error: new Error('refresh'),
    }));
    renderList();
    resizeTable(375);
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('geofence_tariff')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves server paging and Previous recovery when a later mobile page is empty', () => {
    mockedActivity.mockReturnValue(makeQuery({
      data: Array.from({ length: 25 }, (_, session_id) => makeRow({ session_id })),
    }));
    const view = renderList();
    resizeTable(375);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(mockedActivity).toHaveBeenLastCalledWith(7, 25, 25);
    mockedActivity.mockReturnValue(makeQuery({ data: [] }));
    view.rerender(<MemoryRouter><ChargingActivityList geofenceId={7} /></MemoryRouter>);

    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByText('Showing 0–25')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(mockedActivity).toHaveBeenLastCalledWith(7, 25, 0);
  });
});
