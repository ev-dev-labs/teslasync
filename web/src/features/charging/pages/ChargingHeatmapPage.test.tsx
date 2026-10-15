/**
 * ChargingHeatmapPage — KPI-band state branches.
 *
 * The KPI band derives its figures from the paginated sessions query. It must
 * show skeletons while loading and a retryable error when the query fails —
 * never fabricated zeros that read as a healthy-but-empty history. (Genuinely
 * empty data on a *successful* query still renders honest zeros.)
 *
 * Only the query + environment hooks are mocked; the KPI band, charts, and
 * error surfaces render for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ChargingSession } from '@/api/types';
import { setGlobalLocale } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import { deriveDataState } from '@/api/dataState';
import summarySource from '../components/charging-heatmap-modernization/ChargingHeatmapSummary.tsx?raw';

// jsdom lacks matchMedia; chart containers read it on mount.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

vi.mock('react-i18next', () => {
  const t = (key: string, second?: unknown): string =>
    typeof second === 'string' ? second : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/api/hooks/useAnnotations', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useAnnotations')>('@/api/hooks/useAnnotations'),
  useChartAnnotations: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false, isError: false, error: null }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: vi.fn() }));
vi.mock('@/api/hooks/useCharging', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useCharging')>(
    '@/api/hooks/useCharging',
  );
  return { ...actual, useChargingSessionsPaginated: vi.fn() };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import ChargingHeatmapPage from './ChargingHeatmapPage';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockRange = useRangeState as unknown as ReturnType<typeof vi.fn>;
const mockSessions = useChargingSessionsPaginated as unknown as ReturnType<typeof vi.fn>;

function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    status: 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ChargingHeatmapPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function kpiRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Charging summary' });
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalLocale('en-GB');
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockRange.mockReturnValue({
    start: '2026-01-01',
    end: '2026-03-01',
    startInstant: '2026-01-01T08:00:00.000Z',
    endInstantExclusive: '2026-03-02T08:00:00.000Z',
    setRange: vi.fn(),
  });
  mockSessions.mockReturnValue(makeQuery({ data: [] }));
});

describe('ChargingHeatmapPage — KPI band branches', () => {
  it('uses the public data-display type export without a runtime or internal sub-barrel import', () => {
    expect(summarySource).toMatch(/import type \{ StatMetric \} from '@\/components\/data-display';/);
    expect(summarySource).not.toMatch(/from ['"]@\/components\/data-display\//);
  });

  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('blocks history actions for unresolved or invalid vehicle %s', (vehicleId) => {
    const query = makeQuery({ data: [], isError: true, error: new Error('old scope failed') });
    mockSelected.mockReturnValue({
      vehicleId,
      vehiclesState: deriveDataState({ data: [] }),
    });
    mockSessions.mockReturnValue(query);
    renderPage();

    expect(mockSessions).toHaveBeenCalledWith(null, expect.objectContaining({ limit: 2000 }));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(within(kpiRegion()).getByText('Total Sessions').closest('[data-operational-metric]'))
      .toHaveAttribute('data-value-state', 'missing');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(query.refetch).not.toHaveBeenCalled();
  });

  it('keeps fleet retry independent while history refresh is disabled', () => {
    const fleetRetry = vi.fn();
    const query = makeQuery();
    mockSelected.mockReturnValue({
      vehicleId: null,
      vehiclesState: deriveDataState({ error: new Error('fleet down'), refetch: fleetRetry }),
    });
    mockSessions.mockReturnValue(query);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fleetRetry).toHaveBeenCalledTimes(1);
    expect(query.refetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it.each([
    ['rolling', '2026-10-13T17:45:50.694Z', '2026-10-14T17:45:50.694Z'],
    ['custom across DST', '2026-03-08T08:00:00.000Z', '2026-03-10T07:00:00.000Z'],
  ])('forwards the exact %s shared instants rather than calendar labels', (_name, startInstant, endInstantExclusive) => {
    mockRange.mockReturnValue({
      start: '2026-03-08',
      end: '2026-03-09',
      startInstant,
      endInstantExclusive,
      setRange: vi.fn(),
    });
    renderPage();

    expect(mockSessions).toHaveBeenCalledWith(7, {
      limit: 2000, start: startInstant, end: endInstantExclusive,
    });
  });

  it('shows skeletons (not cards) while the sessions query is in flight', () => {
    mockSessions.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    renderPage();

    expect(kpiRegion()).toBeInTheDocument();
    expect(kpiRegion().querySelector('[data-operational-brief][aria-busy="true"] [data-operational-metric] [aria-hidden="true"][class*="bg-[var(--surface-3)]"]')).not.toBeNull();
    expect(kpiRegion().querySelector('[data-operational-value]')).not.toBeInTheDocument();
  });

  type HeatmapSession = Pick<ChargingSession,
    'id' | 'vehicle_id' | 'started_at' | 'ended_at' | 'cost_decimal' | 'start_place'
  > & { total_energy_added_wh: number | null };

  function session(id: number, hour: number, energyWh: number | null): HeatmapSession {
    return {
      id,
      vehicle_id: 7,
      started_at: `2026-01-05T${String(hour).padStart(2, '0')}:15:00`,
      ended_at: `2026-01-05T${String(hour + 1).padStart(2, '0')}:15:00`,
      total_energy_added_wh: energyWh,
      cost_decimal: id === 1 ? 1.25 : null,
      start_place: 'Home',
    };
  }

  describe('ChargingHeatmapPage — complete returned-session alternatives', () => {
    it('renders function-valued insight colors as solid fills, including measured-zero bars', () => {
      mockSessions.mockReturnValue(makeQuery({ data: [session(1, 8, 1000), session(2, 8, null)] }));
      renderPage();

      for (const [label, series, value] of [
        ['Busiest Day', 5, 2],
        ['Busiest Hour', 1, 2],
        ['Weekdays', 0, 2],
        ['Weekends', 4, 0],
      ] as const) {
        const bar = screen.getByRole('progressbar', { name: label });
        expect(bar).toHaveAttribute('aria-valuenow', String(value));
        expect(bar).toHaveAttribute('aria-valuemax', '2');
        expect(bar.querySelector('[data-metric-fill]')).toHaveStyle({
          background: chartTokens.series[series],
        });
      }
    });

    it('keeps missing and invalid energy distinct from zero, signed and fractional readings', async () => {
      const user = userEvent.setup();
      const readings = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1250.5, 1250.5];
      mockSessions.mockReturnValue(makeQuery({
        data: readings.map((energy, index) => ({
          ...session(index + 1, index, null),
          total_energy_added_wh: energy,
          cost_decimal: index < 5 ? energy : index === 5 ? 0 : index === 6 ? -1.25 : 2.5,
        })),
      }));
      renderPage();
      await user.click(screen.getByRole('button', { name: /data table/ }));
      const region = screen.getByRole('region', { name: 'Charging sessions by weekday and hour of day' });
      for (let hour = 0; hour < 5; hour++) {
        const row = within(region).getByRole('rowheader', { name: `Mon 0${hour}:00` }).closest('tr')!;
        expect(within(row).getByRole('cell', { name: '—' })).toBeInTheDocument();
        expect(within(row).getByText('No recorded measurements in the returned sessions')).toBeInTheDocument();
      }
      for (const [hour, expected] of [[5, '0.00 kWh'], [6, '-1.25 kWh'], [7, '1.25 kWh']] as const) {
        const row = within(region).getByRole('rowheader', { name: `Mon 0${hour}:00` }).closest('tr')!;
        expect(within(row).getByText(expected)).toBeInTheDocument();
      }
      const energyMetric = within(kpiRegion()).getByText('Total Energy').closest('[data-operational-metric]')!;
      expect(energyMetric.querySelector('[data-operational-value]')).toHaveTextContent('0.00 kWh');
      const costMetric = within(kpiRegion()).getByText('Total Cost').closest('[data-operational-metric]')!;
      expect(costMetric.querySelector('[data-operational-value]')).toHaveTextContent('1.25');
    });

    it('keeps all heatmap cells, five legend stops, source charts and raw scoped query', () => {
      mockSessions.mockReturnValue(makeQuery({ data: [session(1, 8, 1000), session(2, 8, null)] }));
      renderPage();

      expect(mockSessions).toHaveBeenCalledWith(7, {
        limit: 2000,
        start: '2026-01-01T08:00:00.000Z',
        end: '2026-03-02T08:00:00.000Z',
      });
      const grid = screen.getByRole('img', { name: 'Charging sessions by weekday and hour of day' });
      expect(grid.querySelectorAll('[title]')).toHaveLength(168);
      expect(grid.parentElement?.parentElement?.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(5);
      const figure = screen.getByRole('figure', { name: 'Weekly Charging Heatmap' });
      expect(within(figure).getAllByRole('row')).toHaveLength(169);
      expect(within(figure).getByRole('button', { name: 'Export chart' })).toBeEnabled();
      expect(screen.getByRole('img', { name: 'Charging session counts at the most frequently used locations' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Charging session counts for each day of the week' })).toBeInTheDocument();
      expect(screen.getAllByText(/This is not a complete-history total/).length).toBeGreaterThan(0);
    });

    it('opens a keyboard-reachable table with every slot and distinguishes absent, partial and measured-zero energy', async () => {
      const user = userEvent.setup();
      mockSessions.mockReturnValue(makeQuery({
        data: [session(1, 8, 1000), session(2, 8, null), session(3, 9, null), session(4, 10, 0)],
      }));
      renderPage();

      const disclosure = screen.getByRole('button', { name: /data table/ });
      disclosure.focus();
      await user.keyboard('{Enter}');
      expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      const region = screen.getByRole('region', { name: 'Charging sessions by weekday and hour of day' });
      expect(within(region).getByRole('table')).toHaveAttribute('tabindex', '0');
      const rows = within(region).getAllByRole('row');
      expect(rows).toHaveLength(169);
      const partial = within(region).getByRole('rowheader', { name: 'Mon 08:00' }).closest('tr')!;
      expect(within(partial).getByRole('cell', { name: '2' })).toBeInTheDocument();
      expect(within(partial).getByText(/recorded values only/)).toBeInTheDocument();
      const absent = within(region).getByRole('rowheader', { name: 'Mon 09:00' }).closest('tr')!;
      expect(within(absent).getByRole('cell', { name: '—' })).toBeInTheDocument();
      expect(within(absent).getByText('No recorded measurements in the returned sessions')).toBeInTheDocument();
      const zero = within(region).getByRole('rowheader', { name: 'Mon 10:00' }).closest('tr')!;
      expect(within(zero).queryByRole('cell', { name: '—' })).not.toBeInTheDocument();
      expect(within(zero).getByText(/0[.,]00 kWh/)).toBeInTheDocument();
      const empty = within(region).getByRole('rowheader', { name: 'Sun 00:00' }).closest('tr')!;
      expect(within(empty).getByRole('cell', { name: '0' })).toBeInTheDocument();
      expect(within(empty).getByText('No reading')).toBeInTheDocument();
    });

    it('retains the grid, loaded-scope disclosure and measurement alternative after refresh failure', () => {
      mockSessions.mockReturnValue(makeQuery({
        data: [session(1, 8, 1000)],
        error: new Error('refresh failed'),
        isError: true,
        status: 'error',
        isStale: true,
      }));
      renderPage();

      expect(screen.getByRole('img', { name: 'Charging sessions by weekday and hour of day' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /data table/ })).toBeEnabled();
      expect(within(kpiRegion()).getByText('Total Energy')).toBeInTheDocument();
      expect(screen.getAllByText(/This is not a complete-history total/).length).toBeGreaterThan(0);
    });

    it('keeps every analysis shell and honest unknowns when initial loading is paused', () => {
      mockSessions.mockReturnValue(makeQuery({
        data: undefined, status: 'pending', fetchStatus: 'paused',
      }));
      renderPage();

      for (const title of ['Weekly Charging Heatmap', 'Charging Insights', 'Top Charging Locations', 'Sessions by Day of Week']) {
        expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      }
      expect(screen.getByText('Loading is paused. Charging history will appear when the connection resumes.')).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'Charging sessions by weekday and hour of day' })).not.toBeInTheDocument();
      expect(within(kpiRegion()).getByText('Total Sessions')).toBeInTheDocument();
    });
  });

  it('shows a retryable error (never fabricated zeros) when the sessions query fails', () => {
    const query = makeQuery({
      data: undefined,
      isError: true,
      error: new Error('sessions down'),
      status: 'error',
    });
    mockSessions.mockReturnValue(query);
    renderPage();

    expect(within(kpiRegion()).queryByText('Total Sessions')).not.toBeInTheDocument();
    const retry = within(kpiRegion()).getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders honest zeros when the query succeeds with no sessions in range', () => {
    mockSessions.mockReturnValue(makeQuery({ data: [] }));
    renderPage();

    // Labels render with zeroed values — legitimate empty data, not an error.
    expect(within(kpiRegion()).getByText('Total Sessions')).toBeInTheDocument();
    expect(within(kpiRegion()).getByText('Total Energy')).toBeInTheDocument();
    expect(within(kpiRegion()).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
