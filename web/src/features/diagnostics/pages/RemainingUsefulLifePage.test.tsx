import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentRUL, ComponentDetailResponse } from '@/api/hooks/useRUL';
import type { FormatOptions } from '@/hooks/useUnits';
import { formatDistance, type DistanceUnitPref } from '@/lib/unitConversion';
import RemainingUsefulLifePage from './RemainingUsefulLifePage';

const sources = vi.hoisted(() => ({ board: vi.fn(), detail: vi.fn() }));
const units = vi.hoisted((): { distance: DistanceUnitPref } => ({ distance: 'km' }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: units.distance, speed: 'km/h', temperature: 'C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
    },
    formatDistance: (value: number | null | undefined, options?: FormatOptions) => formatDistance(value, {
      distance: units.distance, speed: 'km/h', temperature: 'C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
    }, options),
  }),
}));
vi.mock('@/api/hooks/useRUL', () => ({
  useRUL: () => sources.board(),
  useComponentRUL: () => sources.detail(),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', async (importActual) => ({
  ...await importActual<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key)
        .replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

const component: ComponentRUL = {
  component: 'tires', label: 'Tires', health_pct: 75, wear_rate_per_day: 0.1,
  remaining_days: 100, remaining_km: null, projected_eol_date: '2026-08-01',
  confidence: 0.75, status: 'watch', basis: 'Measured tread trend',
};
const detail: ComponentDetailResponse = {
  ...component, eol_threshold: 20, nominal_life_km: null, nominal_life_days: null,
  notes: 'Observed trend only', projection: [{
    date: '2026-08-01', projected_health: 20, confidence_low: 15, confidence_high: 25,
  }],
};

function query<T>(data: T, error: Error | null = null) {
  return {
    data, error, isError: error != null, isLoading: false, isFetching: false,
    dataUpdatedAt: Date.now(), refetch: vi.fn(),
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RemainingUsefulLifePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  units.distance = 'km';
  sources.board.mockReturnValue(query({
    vehicle_id: 7, components: [component], next_service: { component: 'tires', date: '2026-08-01' },
  }));
  sources.detail.mockReturnValue(query(detail));
});

describe('RemainingUsefulLifePage independent sources', () => {
  it('opens the actual next-service review drawer without converting the projection into a certainty', () => {
    renderPage();
    const brief = screen.getByTestId('rul-next-service-summary');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(2);
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(2);
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Service component')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('Tires');
    expect(drawer).toHaveTextContent('2026-08-01');
    expect(drawer).toHaveTextContent('not a guaranteed failure date');
    expect(drawer).toHaveTextContent('component forecasts retain their own confidence and basis below');
    expect(drawer).toHaveTextContent('Existing next-service projection from the component health board.');
  });

  it('retains the real board projection, forecast confidence band and basis during an offline pause', () => {
    sources.board.mockReturnValue({ ...sources.board(), fetchStatus: 'paused' });
    sources.detail.mockReturnValue({ ...sources.detail(), fetchStatus: 'paused' });
    renderPage();
    const brief = screen.getByTestId('rul-next-service-summary');
    expect(within(brief).getByText('Showing retained measurements')).toBeInTheDocument();
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(2);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Show forecast for Tires' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Measured tread trend')).toBeInTheDocument();
    expect(screen.getByText('75% · High')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Health forecast/ })).toBeInTheDocument();
    expect(detail.projection[0]).toEqual({
      date: '2026-08-01', projected_health: 20, confidence_low: 15, confidence_high: 25,
    });
  });

  it('keeps an absent next-service projection missing, distinct from a completed board with none projected', () => {
    sources.board.mockReturnValue({ ...query(undefined), isLoading: true });
    const { unmount } = renderPage();
    const pending = screen.getByTestId('rul-next-service-summary');
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(pending.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    unmount();
    sources.board.mockReturnValue(query({ vehicle_id: 7, components: [], next_service: null }));
    renderPage();
    const empty = screen.getByTestId('rul-next-service-summary');
    expect(within(empty).getByText('No upcoming service projected — all components healthy.')).toBeInTheDocument();
    expect(empty.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    expect(empty).not.toHaveAttribute('aria-busy');
  });

  it.each([
    { preference: 'km' as const, remaining: 2, expected: /^2\s+km$/ },
    { preference: 'mi' as const, remaining: 1.609344, expected: /^1\s+mi$/ },
    { preference: 'km' as const, remaining: 0, expected: /^0\s+km$/ },
  ])('formats $remaining wire kilometres for the $preference display preference', ({ preference, remaining, expected }) => {
    units.distance = preference;
    const measured = { ...component, remaining_km: remaining };
    sources.board.mockReturnValue(query({
      vehicle_id: 7, components: [measured], next_service: null,
    }));
    renderPage();
    const card = screen.getByRole('option', { name: 'Show forecast for Tires' });
    expect(within(card).getByText(expected)).toBeInTheDocument();
    expect(measured.remaining_km).toBe(remaining);
  });

  it('keeps missing wear distance unknown instead of formatting a measured zero', () => {
    renderPage();
    const card = screen.getByRole('option', { name: 'Show forecast for Tires' });
    expect(within(card).getByText('—')).toBeInTheDocument();
    expect(within(card).queryByText(/^0\s+(km|mi)$/)).toBeNull();
  });

  it('keeps component selection, forecast basis and readings when both sources fail to refresh', () => {
    sources.board.mockReturnValue({
      ...sources.board(), error: new Error('board refresh'), isError: true,
    });
    sources.detail.mockReturnValue(query(detail, new Error('forecast refresh')));
    renderPage();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Show forecast for Tires' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Measured tread trend')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Health forecast/ })).toBeInTheDocument();
    expect(screen.queryByText('Unable to load service projection.')).toBeNull();
  });

  it('keeps a recoverable forecast prerequisite panel when the board source has a fatal initial failure', () => {
    sources.board.mockReturnValue(query(undefined, new Error('board unavailable')));
    renderPage();
    expect(screen.getByText('Unable to load service projection.')).toBeInTheDocument();
    // No component can be selected from an absent board, so forecast remains a
    // labelled, recoverable prerequisite panel rather than disappearing.
    expect(screen.getByRole('heading', { name: /Health forecast/ })).toBeInTheDocument();
    expect(screen.getByText('Select a component above to see its forecast.')).toBeInTheDocument();
  });
});
