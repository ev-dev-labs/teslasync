/**
 * DayLogPage — day-timeline contract tests.
 *
 * Strategy:
 *   - `useDayLog` is mocked at the hook boundary with full query state
 *     (`isPending`, `fetchStatus`, `dataUpdatedAt`, …) so loading, error,
 *     empty, and populated branches are deterministic with no network.
 *   - `useSelectedVehicle` is stubbed to a one-car fleet; `useSettings`
 *     renders for real through the file-level mock so `useUnits`
 *     converts SI through the real `unitConversion` boundary.
 *   - URL scope (`date`, `layers`) is asserted through a real
 *     `<LocationProbe>` reading `useLocation()`, not by spying on the
 *     router, so search-param wiring is verified end to end.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

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
import type { DayLogResponse } from '@/api/types';

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

function dayLogResponse(over: Partial<DayLogResponse> = {}): DayLogResponse {
  return {
    vehicle_id: 1,
    date: '2026-09-14',
    timezone: 'UTC',
    day_start: '2026-09-14T00:00:00Z',
    day_end: '2026-09-15T00:00:00Z',
    truncated: false,
    layers: [],
    summary: {
      drive_count: 0,
      charge_count: 0,
      drive_duration_s: null,
      drive_distance_m: null,
      energy_added_wh: null,
      energy_used_wh: null,
    },
    sources: [],
    events: [],
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

beforeEach(() => {
  vi.clearAllMocks();
  useSelectedVehicleMock.mockReturnValue(oneCarFleet);
});

describe('DayLogPage', () => {
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
        data: dayLogResponse({
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
  });

  it('renders populated events with deep links and SI summaries', () => {
    useDayLogMock.mockReturnValue(
      queryState({
        data: dayLogResponse({
          summary: {
            drive_count: 1,
            charge_count: 1,
            drive_duration_s: 3600,
            drive_distance_m: 25000,
            energy_added_wh: 12000,
            energy_used_wh: 5200,
          },
          sources: [{ source: 'drives', status: 'ok', count: 1 }],
          events: [
            { id: 'drive:7:start', ts: '2026-09-14T15:04:05Z', type: 'drive_start', layer: 'default', vehicle_id: 1, ref_kind: 'drive', ref_id: 7, payload: { start_place: 'Home' } },
            { id: 'drive:7:end', ts: '2026-09-14T16:04:05Z', type: 'drive_end', layer: 'default', vehicle_id: 1, ref_kind: 'drive', ref_id: 7, payload: { distance_m: 25000 } },
            { id: 'sec:3', ts: '2026-09-14T17:00:00Z', type: 'locked', layer: 'default', vehicle_id: 1, payload: {} },
          ],
        }),
      }),
    );
    renderPage();

    expect(screen.getByText('Drive started')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    // Deep links to existing detail routes.
    const driveLinks = screen.getAllByRole('link', { name: 'Drive started' });
    expect(driveLinks[0].getAttribute('href')).toBe('/drives/7');
    // SI: 25000 m renders as km through useUnits, not raw meters.
    expect(screen.getAllByText('25.0 km').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('3 events')).toBeInTheDocument();
  });

  it('shows per-section query errors with retry', () => {
    useDayLogMock.mockReturnValue(
      queryState({ data: undefined, error: new Error('boom'), isError: true, isSuccess: false, status: 'error' }),
    );
    renderPage();

    // Summary, timeline, and sources each surface their own retry.
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(3);
  });

  it('toggles optional layers through the URL', () => {
    useDayLogMock.mockReturnValue(queryState({ data: dayLogResponse() }));
    let search = '';
    renderPage('?date=2026-09-14', (s) => {
      search = s;
    });

    fireEvent.click(screen.getByRole('switch', { name: 'Lights / hazards' }));
    expect(search).toContain('layers=lights');

    fireEvent.click(screen.getByRole('switch', { name: 'Lights / hazards' }));
    expect(search).not.toContain('layers=');
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
});
