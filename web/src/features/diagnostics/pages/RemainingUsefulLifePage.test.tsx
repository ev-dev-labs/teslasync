import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentRUL, ComponentDetailResponse } from '@/api/hooks/useRUL';
import RemainingUsefulLifePage from './RemainingUsefulLifePage';

const sources = vi.hoisted(() => ({ board: vi.fn(), detail: vi.fn() }));
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
  sources.board.mockReturnValue(query({
    vehicle_id: 7, components: [component], next_service: { component: 'tires', date: '2026-08-01' },
  }));
  sources.detail.mockReturnValue(query(detail));
});

describe('RemainingUsefulLifePage independent sources', () => {
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
