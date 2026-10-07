/**
 * DayLogPage — complete-history contract tests.
 *
 * Strategy:
 *   - `useDayLog` is mocked at the hook boundary with full query state
 *     (`isPending`, `fetchStatus`, `dataUpdatedAt`, …) so loading, error,
 *     empty, and populated branches are deterministic with no network.
 *   - `useSelectedVehicle` is stubbed to a one-car fleet; `useSettings`
 *     renders for real through the file-level mock so `useUnits`
 *     converts SI through the real `unitConversion` boundary.
 *   - URL scope (`date`) is asserted through a real `<LocationProbe>`
 *     reading `useLocation()`. Category search/filter state is local
 *     UI state over the already-complete dataset.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import * as operationalBridge from '@/hooks/useOperationalMetrics';

const operationalMetricsSpy = vi.spyOn(operationalBridge, 'useOperationalMetrics');

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}`,
          );
        }
        return fallbackOrOpts;
      }
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') return o.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSettings')>();
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        unit_of_length: 'km',
        unit_of_temp: 'C',
        unit_of_pressure: 'bar',
        decimal_precision: 1,
        locale: 'en-US',
        timezone_user: '',
      },
      isMiles: false,
      isFahrenheit: false,
      isPSI: false,
      decimals: 1,
      locale: 'en-US',
    }),
  };
});

const { useDayLogMock, useSelectedVehicleMock } = vi.hoisted(() => ({
  useDayLogMock: vi.fn(),
  useSelectedVehicleMock: vi.fn(),
}));

vi.mock('@/api/hooks/useDayLog', () => ({
  useDayLog: useDayLogMock,
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: useSelectedVehicleMock,
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 64,
        size: 64,
        end: (index + 1) * 64,
      })),
    measureElement: () => undefined,
  }),
}));

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import DayLogPage from './DayLogPage';
import type { DayLogEvent, DayLogResponse } from '@/api/types';

function queryState(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    dataUpdatedAt: Date.now(),
    error: null,
    isError: false,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    status: 'success',
    fetchStatus: 'idle',
    refetch: vi.fn(),
    ...over,
  };
}

function dayLogResponse(events: DayLogEvent[] = [], over: Partial<DayLogResponse> = {}): DayLogResponse {
  return {
    vehicle_id: 1,
    date: '2026-09-14',
    timezone: 'UTC',
    day_start: '2026-09-14T00:00:00Z',
    day_end: '2026-09-15T00:00:00Z',
    truncated: false,
    total_events: events.length,
    limit: 2000,
    offset: 0,
    layers: ['turn_signals', 'lights', 'doors_windows', 'hvac', 'gear', 'homelink'],
    summary: {
      drive_count: 0,
      charge_count: 0,
      drive_duration_s: null,
      drive_distance_m: null,
      energy_added_wh: null,
      energy_used_wh: null,
    },
    sources: [],
    events,
    ...over,
  };
}

function LocationProbe({ onLocation }: { onLocation: (search: string) => void }) {
  const location = useLocation();
  onLocation(location.search);
  return null;
}

function renderPage(initialSearch = '?date=2026-09-14', onLocation: (search: string) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/day-log${initialSearch}`]}>
        <LocationProbe onLocation={onLocation} />
        <DayLogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const oneCarFleet = {
  vehicleId: 1,
  vehicle: { id: 1, display_name: 'Model 3' },
  vehicles: [{ id: 1, display_name: 'Model 3' }],
  setVehicleId: vi.fn(),
};

const mixedEvents: DayLogEvent[] = [
  { id: 'drive:7:start', ts: '2026-09-14T15:04:05Z', type: 'drive_start', layer: 'default', source: 'drives', vehicle_id: 1, ref_kind: 'drive', ref_id: 7, payload: { start_place: 'Home' } },
  { id: 'drive:7:end', ts: '2026-09-14T16:04:05Z', type: 'drive_end', layer: 'default', source: 'drives', vehicle_id: 1, ref_kind: 'drive', ref_id: 7, payload: { distance_m: 25000 } },
  { id: 'sec:3', ts: '2026-09-14T17:00:00Z', type: 'locked', layer: 'default', source: 'security_events', vehicle_id: 1, payload: { from: false, to: true } },
  { id: 'sig:LightsTurnSignal:1', ts: '2026-09-14T17:01:00Z', type: 'turn_signal', layer: 'turn_signals', source: 'signal_log', vehicle_id: 1, payload: { component: 'left', from: 'off', to: 'left', from_value: 1, to_value: 2 } },
  { id: 'gear:1', ts: '2026-09-14T17:02:00Z', type: 'gear', layer: 'gear', source: 'drive_telemetry', vehicle_id: 1, payload: { from: 'P', to: 'D', from_raw: 'ShiftStateP', to_raw: 'ShiftStateD' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  useSelectedVehicleMock.mockReturnValue(oneCarFleet);
});

describe('DayLogPage', () => {
  it('keeps historical events, search and business-date controls after a retained refresh failure', () => {
    const refetch = vi.fn();
    useDayLogMock.mockReturnValue(queryState({
      data: dayLogResponse(mixedEvents),
      error: new Error('refresh failed'),
      isError: true,
      status: 'error',
      refetch,
    }));
    renderPage();
    expect(screen.getByTestId('daylog-date')).toHaveValue('2026-09-14');
    expect(screen.getByTestId('daylog-search')).toBeInTheDocument();
    expect(screen.getByText('Day log may be out of date')).toBeInTheDocument();
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
  it('keeps day selection, freshness, and copy link in the page header', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse() }));
    renderPage();

    const header = screen.getByRole('heading', { name: 'Day log' }).closest('header');
    expect(header).not.toBeNull();
    if (!header) throw new Error('Day log header is missing');
    expect(within(header).getByTestId('daylog-controls')).toBeInTheDocument();
    expect(within(header).getByTestId('daylog-date')).toHaveValue('2026-09-14');
    expect(within(header).getByRole('button', { name: /copy link/i })).toBeInTheDocument();
    expect(header.querySelector('[data-action-group="metadata"]')).not.toBeNull();
    const timezoneNote = within(header).getByText(/Day boundaries in/);
    expect(timezoneNote).toBeVisible();
    expect(timezoneNote.closest('[data-action-group="metadata"]')).not.toBeNull();
    expect(within(screen.getByTestId('daylog-controls')).queryByText(/Day boundaries in/)).not.toBeInTheDocument();
    expect(screen.getByTestId('daylog-date')).toHaveAccessibleDescription(/Day boundaries in/);
    expect(screen.getAllByTestId('daylog-controls')).toHaveLength(1);
  });

  it('shows per-section loading states while pending', () => {
    useDayLogMock.mockReturnValue(
      queryState({ data: undefined, isPending: true, isLoading: true, isFetching: true, isSuccess: false, status: 'pending', fetchStatus: 'fetching' }),
    );
    renderPage();

    // Controls shell always renders.
    expect(screen.getByTestId('daylog-controls')).toBeInTheDocument();
    // Timeline + sources announce their own loading regions.
    expect(screen.getByRole('status', { name: 'Loading timeline' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading sources' })).toBeInTheDocument();
  });

  it('renders an honest empty day with a live-telemetry CTA', () => {
    useDayLogMock.mockReturnValue(
      queryState({
        data: dayLogResponse([], {
          sources: [
            { source: 'drives', status: 'empty', count: 0 },
            { source: 'user_presence', status: 'unavailable', count: 0, reason: 'no signal' },
          ],
        }),
      }),
    );
    renderPage();

    expect(screen.getByText('No drives or charging sessions this day.')).toBeInTheDocument();
    expect(screen.getByText('Nothing recorded this day.')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Open live telemetry' });
    expect(cta.getAttribute('href')).toBe('/live-monitor?vehicle_id=1');
    // Source honesty: empty + unavailable rows are explicit.
    expect(screen.getByText('0 rows')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    const sources = screen.getByRole('table', { name: 'Sources' });
    expect(within(sources).getAllByRole('rowheader')).toHaveLength(2);
    expect(within(sources).getByText('0 rows')).toBeInTheDocument();
    expect(within(sources).getByText('no signal')).toBeInTheDocument();
  });

  it('shows every category by default with deep links and SI summaries', () => {
    useDayLogMock.mockReturnValue(
      queryState({
        data: dayLogResponse(mixedEvents, {
          summary: {
            drive_count: 1,
            charge_count: 0,
            drive_duration_s: 3600,
            drive_distance_m: 25000,
            energy_added_wh: null,
            energy_used_wh: 5200,
          },
        }),
      }),
    );
    renderPage();

    // Default + optional-layer events all visible, nothing hidden.
    expect(screen.getByText('Drive started')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Turn signal')).toBeInTheDocument();
    expect(screen.getByText('Gear change')).toBeInTheDocument();
    expect(screen.getByText('5 events')).toBeInTheDocument();
    // Deep links to existing detail routes.
    const driveLinks = screen.getAllByRole('link', { name: 'Drive started' });
    expect(driveLinks[0].getAttribute('href')).toBe('/drives/7');
    // SI: 25000 m renders as km through useUnits, not raw meters.
    expect(screen.getAllByText('25.0 km').length).toBeGreaterThan(0);
  });

  it('renders previous → new state lines from payloads', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(mixedEvents) }));
    renderPage();

    // Lock bools render as Unlocked → Locked; gear shorts pass through raw in tests.
    expect(screen.getByText('Unlocked → Locked')).toBeInTheDocument();
    expect(screen.getByText('P → D')).toBeInTheDocument();
  });

  it('expands a row to structured recorded details without losing list identity', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(mixedEvents) }));
    renderPage();

    const expanders = screen.getAllByRole('button', { name: 'Show details' });
    fireEvent.click(expanders[0]);

    // Labeled rows + provenance visible; the row title stays put; no raw JSON.
    expect(screen.getByText('Drive started')).toBeInTheDocument();
    expect(screen.getByText('Start place:')).toBeInTheDocument();
    expect(screen.getAllByText('Home').length).toBe(2);
    expect(screen.getByText('drives')).toBeInTheDocument();
    expect(screen.queryByText(/"start_place"/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide details' })).toBeInTheDocument();
  });

  it('shows change and stored-value rows for signal transitions', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(mixedEvents) }));
    renderPage();

    const expanders = screen.getAllByRole('button', { name: 'Show details' });
    fireEvent.click(expanders[3]);

    // Turn-signal transition: full change line, labeled component, raw values.
    // (i18n is mocked to fallbacks: token labels render lowercase here.)
    expect(screen.getAllByText('off → left').length).toBe(2);
    expect(screen.getByText('Component:')).toBeInTheDocument();
    expect(screen.getByText('Stored values:')).toBeInTheDocument();
    expect(screen.getByText('1 → 2')).toBeInTheDocument();
  });

  it('uses sentence case for future payload labels while preserving acronyms and values', () => {
    const payload = {
      new_signal_label: 'Midnight Silver Metallic',
      api_signal_id: 'raw_API_id',
      FSD_status: 'CALIBRATED',
      is_recorded: false,
      sample_count: 0,
      missing_detail: null,
    };
    useDayLogMock.mockReturnValue(queryState({
      data: dayLogResponse([{ ...mixedEvents[2], payload }]),
    }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));

    expect(screen.getByText('New signal label:')).toBeInTheDocument();
    expect(screen.getByText('API signal ID:')).toBeInTheDocument();
    expect(screen.getByText('FSD status:')).toBeInTheDocument();
    expect(screen.getByText('Is recorded:')).toBeInTheDocument();
    expect(screen.getByText('Sample count:')).toBeInTheDocument();
    expect(screen.queryByText('New Signal Label:')).not.toBeInTheDocument();
    expect(screen.queryByText('Missing detail:')).not.toBeInTheDocument();
    expect(screen.getByText('Midnight Silver Metallic')).toBeInTheDocument();
    expect(screen.getByText('raw_API_id')).toBeInTheDocument();
    expect(screen.getByText('CALIBRATED')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('Sample count:').parentElement).toHaveTextContent(/^Sample count:\s*0$/);
    expect(payload).toEqual({
      new_signal_label: 'Midnight Silver Metallic',
      api_signal_id: 'raw_API_id',
      FSD_status: 'CALIBRATED',
      is_recorded: false,
      sample_count: 0,
      missing_detail: null,
    });
  });

  it('renders complete-coverage event types with titles and categories', () => {
    const coverageEvents: DayLogEvent[] = [
      { id: 'sig:DestinationName:1', ts: '2026-09-14T08:00:00Z', type: 'destination_changed', layer: 'navigation', source: 'signal_log', vehicle_id: 1, payload: { from: 'Home', to: 'Office' } },
      { id: 'sig:Tpms:1', ts: '2026-09-14T09:00:00Z', type: 'tire_warning_on', layer: 'tires', source: 'signal_log', vehicle_id: 1, payload: { wheel: 'front_left', severity: 'hard', from: false, to: true } },
      { id: 'sig:ChargePort:1', ts: '2026-09-14T10:00:00Z', type: 'charge_port_opened', layer: 'charge_port', source: 'signal_log', vehicle_id: 1, payload: { from: false, to: true } },
      { id: 'sig:Pin:1', ts: '2026-09-14T11:00:00Z', type: 'pin_to_drive_on', layer: 'access', source: 'signal_log', vehicle_id: 1, payload: { from: false, to: true } },
      { id: 'sig:Precon:1', ts: '2026-09-14T12:00:00Z', type: 'preconditioning_on', layer: 'hvac', source: 'signal_log', vehicle_id: 1, payload: { from: false, to: true } },
      { id: 'sig:Sched:1', ts: '2026-09-14T13:00:00Z', type: 'signal', layer: 'charge_port', source: 'signal_log', vehicle_id: 1, payload: { field: 'ScheduledChargingPending', from: false, to: true } },
    ];
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(coverageEvents) }));
    renderPage();

    expect(screen.getByText('Destination changed')).toBeInTheDocument();
    expect(screen.getByText('Home → Office')).toBeInTheDocument();
    expect(screen.getByText('Tire warning')).toBeInTheDocument();
    // (i18n is mocked to fallbacks: wheel id and category chips render raw here.)
    expect(screen.getByText('front_left · Off → On')).toBeInTheDocument();
    expect(screen.getByText('Charge port opened')).toBeInTheDocument();
    expect(screen.getByText('PIN to drive on')).toBeInTheDocument();
    expect(screen.getByText('Preconditioning on')).toBeInTheDocument();
    expect(screen.getByText('Signal change')).toBeInTheDocument();
    expect(screen.getByText('6 events')).toBeInTheDocument();
    expect(screen.getByTestId('daylog-filter-navigation')).toHaveTextContent('navigation (1)');
    expect(screen.getByTestId('daylog-filter-tires')).toHaveTextContent('tires (1)');
  });

  it('filters by search text and declares the subset', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(mixedEvents) }));
    renderPage();

    fireEvent.change(screen.getByTestId('daylog-search'), { target: { value: 'locked' } });
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByText('Drive started')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 5 events')).toBeInTheDocument();

    // Show all restores the complete list.
    fireEvent.click(screen.getByTestId('daylog-show-all'));
    expect(screen.getByText('Drive started')).toBeInTheDocument();
    expect(screen.getByText('5 events')).toBeInTheDocument();
  });

  it('toggles categories and offers show-all on empty matches', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(mixedEvents) }));
    renderPage();

    fireEvent.click(screen.getByTestId('daylog-filter-driving'));
    expect(screen.queryByText('Drive started')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 5 events')).toBeInTheDocument();

    // Toggling every visible category leaves an explicit no-match state.
    fireEvent.click(screen.getByTestId('daylog-filter-lock'));
    fireEvent.click(screen.getByTestId('daylog-filter-turn'));
    fireEvent.click(screen.getByTestId('daylog-filter-gear'));
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('daylog-show-all'));
    expect(screen.getByText('5 events')).toBeInTheDocument();
  });

  it('clears every category and the search so a single category can be selected', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(mixedEvents) }));
    renderPage();

    expect(screen.getByTestId('daylog-show-all')).toBeDisabled();
    fireEvent.change(screen.getByTestId('daylog-search'), { target: { value: 'locked' } });
    fireEvent.click(screen.getByTestId('daylog-clear-all'));

    expect(screen.getByTestId('daylog-search')).toHaveValue('');
    expect(screen.getByText('Showing 0 of 5 events')).toBeInTheDocument();
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
    expect(screen.getByTestId('daylog-clear-all')).toBeDisabled();
    for (const category of ['driving', 'lock', 'turn', 'gear']) {
      expect(screen.getByTestId(`daylog-filter-${category}`)).toHaveAttribute('aria-pressed', 'false');
    }

    fireEvent.click(screen.getByTestId('daylog-filter-lock'));
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 5 events')).toBeInTheDocument();
    expect(screen.queryByText('Drive started')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('daylog-show-all'));
    expect(screen.getByText('5 events')).toBeInTheDocument();
    expect(screen.getByText('Drive started')).toBeInTheDocument();
    expect(screen.getByTestId('daylog-show-all')).toBeDisabled();
  });

  it('shows per-section query errors with retry', () => {
    useDayLogMock.mockReturnValue(
      queryState({ data: undefined, error: new Error('boom'), isError: true, isSuccess: false, status: 'error' }),
    );
    renderPage();

    // Summary, timeline, and sources each surface their own retry.
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(3);
  });

  it('steps the day through the URL without UTC drift', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse() }));
    let search = '';
    renderPage('?date=2026-09-14', (s) => {
      search = s;
    });

    fireEvent.click(screen.getByTestId('daylog-prev'));
    expect(search).toContain('date=2026-09-13');

    fireEvent.click(screen.getByTestId('daylog-next'));
    expect(search).toContain('date=2026-09-14');
  });

  it('asks for a vehicle when none is selected', () => {
    useSelectedVehicleMock.mockReturnValue({ ...oneCarFleet, vehicleId: null });
    useDayLogMock.mockReturnValue(queryState());
    renderPage();

    expect(screen.queryByTestId('daylog-controls')).not.toBeInTheDocument();
    expect(screen.getByText('Day log')).toBeInTheDocument();
  });

  it('bridges raw day counts and SI measurements and retains the real details drawer and routes', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(mixedEvents, {
      summary: { drive_count: 1, charge_count: 0, drive_duration_s: 3600,
        drive_distance_m: 25000, energy_added_wh: null, energy_used_wh: 5200 },
    }) }));
    renderPage();
    const brief = screen.getByTestId('day-log-summary');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(operationalMetricsSpy).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ metricId: 'count', occurrenceId: 'drives', rawValue: 1 }),
      expect.objectContaining({ metricId: 'count', occurrenceId: 'charges', rawValue: 0 }),
      expect.objectContaining({ metricId: 'duration', occurrenceId: 'drive-time', rawValue: 3600 }),
      expect.objectContaining({ metricId: 'distance', occurrenceId: 'distance', rawValue: 25000 }),
      expect.objectContaining({ metricId: 'energy', occurrenceId: 'energy-added', rawValue: null }),
      expect.objectContaining({ metricId: 'energy', occurrenceId: 'energy-used', rawValue: 5200 }),
    ]));
    expect(brief.querySelector('[data-operational-metric="distance"]')).toHaveTextContent('25.0 km');
    expect(brief.querySelector('[data-operational-metric="drive-time"]')).toHaveTextContent('1.0 h');
    expect(brief.querySelector('[data-operational-metric="energy-used"]')).toHaveTextContent('5.2 kWh');
    expect(brief.querySelector('[data-operational-metric="energy-added"]')).toHaveAttribute('data-value-state', 'missing');
    expect(within(brief).getByText('[2026-09-14T00:00:00Z, 2026-09-15T00:00:00Z) · end exclusive')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Day summary details' });
    expect(within(drawer).getByText('25.0 km')).toBeInTheDocument();
    expect(within(drawer).getByText('5.2 kWh')).toBeInTheDocument();
    expect(within(drawer).getByText(/Recorded driving duration in seconds/)).toBeInTheDocument();
    expect(within(drawer).getAllByText(/2026-09-14 · UTC/).length).toBeGreaterThanOrEqual(6);
    expect(within(drawer).getByText(/\[2026-09-14T00:00:00Z, 2026-09-15T00:00:00Z\) · end exclusive/)).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('daylog-search')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Drive started' })[0]).toHaveAttribute('href', '/drives/7');
  });

  it('does not relabel day aggregates when the timeline is filtered to a subset', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(mixedEvents, {
      summary: { drive_count: 1, charge_count: 0, drive_duration_s: 3600,
        drive_distance_m: 25000, energy_added_wh: null, energy_used_wh: 5200 },
    }) }));
    renderPage();
    const brief = screen.getByTestId('day-log-summary');
    fireEvent.change(screen.getByTestId('daylog-search'), { target: { value: 'locked' } });
    expect(screen.getByText('Showing 1 of 5 events')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="distance"]')).toHaveTextContent('25.0 km');
    expect(within(brief).getByText(/independent of timeline search and category filters/)).toBeInTheDocument();
  });

  it('keeps measured zero, missing aggregates and partial source coverage distinct', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse([], {
      summary: { drive_count: 0, charge_count: 0, drive_duration_s: null,
        drive_distance_m: 0, energy_added_wh: null, energy_used_wh: 0 },
      sources: [{ source: 'drives', status: 'empty', count: 0 },
        { source: 'user_presence', status: 'unavailable', count: 0, reason: 'no signal' }],
    }) }));
    renderPage();
    const brief = screen.getByTestId('day-log-summary');
    expect(within(brief).getByText('Some sources unavailable')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="distance"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="distance"]')).toHaveTextContent('0.0 km');
    expect(brief.querySelector('[data-operational-metric="energy-used"]')).toHaveTextContent('0.0 kWh');
    expect(brief.querySelector('[data-operational-metric="drive-time"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByRole('link', { name: 'Open drives' })).toHaveAttribute('href', '/drives');
    expect(screen.getByText('no signal')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Sources' })).toBeInTheDocument();
  });

  it('keeps the summary busy on initial loading and reviewable after a retained refresh failure', () => {
    useDayLogMock.mockReturnValue(queryState({ data: undefined, isPending: true, isLoading: true,
      isSuccess: false, status: 'pending', fetchStatus: 'fetching' }));
    const pending = renderPage();
    const loadingBrief = screen.getByTestId('day-log-summary');
    expect(loadingBrief).toHaveAttribute('aria-busy', 'true');
    expect(loadingBrief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    pending.unmount();
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse(mixedEvents),
      error: new Error('refresh failed'), isError: true, status: 'error' }));
    renderPage();
    const brief = screen.getByTestId('day-log-summary');
    expect(within(brief).getByText('Retained recorded history')).toBeInTheDocument();
    expect(screen.getByText('Day log may be out of date')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog', { name: 'Day summary details' })).toBeInTheDocument();
  });

  it('rejects invalid numeric measurements without displaying a fabricated zero', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse([], {
      summary: { drive_count: 1, charge_count: 0, drive_duration_s: Number.NaN,
        drive_distance_m: Number.POSITIVE_INFINITY, energy_added_wh: null, energy_used_wh: 0 },
    }) }));
    renderPage();
    const brief = screen.getByTestId('day-log-summary');
    expect(brief.querySelector('[data-operational-metric="distance"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(brief.querySelector('[data-operational-metric="distance"]')).toHaveTextContent('—');
    expect(brief.querySelector('[data-operational-metric="drive-time"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(brief.querySelector('[data-operational-metric="energy-used"]')).toHaveAttribute('data-value-state', 'value');
  });
});
