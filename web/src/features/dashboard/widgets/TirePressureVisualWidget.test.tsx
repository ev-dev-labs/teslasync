/**
 * Own-suite tests for the TirePressureVisualWidget redesign.
 * Keeps vehicle resolution, SI pressure conversion, honest empty/error/retained
 * states, four-corner status, FreshnessDot refresh, and i18n/a11y behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn(), useLatestTirePressure: vi.fn() };
});

import TirePressureVisualWidget from './TirePressureVisualWidget';
import { useVehicles, useLatestTirePressure } from '@/api/hooks/useVehicles';
import type { TirePressureSnapshot } from '@/api/types';
import type { WidgetProps, WidgetSize } from './types';

const mockVehicles = vi.mocked(useVehicles);
const mockLatest = vi.mocked(useLatestTirePressure);

function queryResult(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

function makeSnap(over: Partial<TirePressureSnapshot> = {}): TirePressureSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    front_left: 250_000,
    front_right: 250_000,
    rear_left: 250_000,
    rear_right: 250_000,
    created_at: '2026-07-06T00:00:00Z',
    ...over,
  };
}

function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TirePressureVisualWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReturnValue({ data: [{ id: 7 }, { id: 9 }] } as never);
  mockLatest.mockReturnValue(queryResult({ data: makeSnap() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TirePressureVisualWidget redesign', () => {
  it('uses the selected vehicle and 10-second polling', () => {
    renderWidget({ cols: 2, rows: 2 }, { vehicleId: 42 });
    expect(mockLatest).toHaveBeenCalledWith(42, 10_000);
  });

  it('renders the current vehicle with four positioned Pa-derived corner readouts', () => {
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByRole('heading', { name: 'Tire pressure', level: 3 })).toBeVisible();
    expect(screen.getAllByText('2.50')).toHaveLength(4);
    expect(screen.getByText('All normal')).toBeInTheDocument();
    expect(container.textContent).toContain('bar');
    expect(container.querySelector('[data-vehicle-studio]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-pressure-status="success"]')).toHaveLength(4);
    for (const corner of ['FL', 'FR', 'RL', 'RR']) {
      expect(screen.getByRole('group', { name: corner })).toBeInTheDocument();
    }
  });

  it('converts 290000 Pa through the shared pressure format without fabrication', () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap({
        front_left: 290_000, front_right: 290_000,
        rear_left: 290_000, rear_right: 290_000,
      }),
    }));
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getAllByText('2.90')).toHaveLength(4);
  });

  it('uses each corner SI status and an honest aggregate pill', () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap({
        front_left: 250_000,
        front_right: 240_000,
        rear_left: 200_000,
        rear_right: null,
      }),
    }));
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(container.querySelectorAll('[data-pressure-status="success"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-pressure-status="warning"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-pressure-status="danger"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-pressure-status="neutral"]')).toHaveLength(1);
    expect(screen.getByText('Check pressure')).toBeInTheDocument();
  });

  it('does not suppress retained data on refresh failure', () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap(),
      isError: true,
      error: new Error('offline'),
    }));
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(screen.getAllByText('2.50')).toHaveLength(4);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it('renders null corners as unknown instead of manufactured zero or critical readings', () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap({ front_left: null, front_right: null, rear_left: null, rear_right: null }),
    }));
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(container.querySelectorAll('[data-pressure-status="neutral"]')).toHaveLength(4);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('keeps explicit loading and empty states', () => {
    mockLatest.mockReturnValue(queryResult({ isLoading: true, data: undefined }));
    const first = renderWidget({ cols: 2, rows: 2 });
    expect(first.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    first.unmount();

    mockLatest.mockReturnValue(queryResult({ data: null }));
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('No tire pressure data')).toBeInTheDocument();
  });

  it('shows fatal fetch errors rather than an empty panel', () => {
    mockLatest.mockReturnValue(queryResult({
      isError: true,
      error: new Error('TPMS unavailable'),
      data: undefined,
    }));
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No tire pressure data')).toBeNull();
  });

  it('keeps one title and four values in compact size and wires FreshnessDot refresh', () => {
    const refetch = vi.fn();
    mockLatest.mockReturnValue(queryResult({ data: makeSnap(), refetch }));
    const { container } = renderWidget({ cols: 1, rows: 1 });
    expect(screen.getAllByRole('heading', { name: 'Tire pressure', level: 3 })).toHaveLength(1);
    expect(screen.getAllByText('2.50')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('svg')).not.toHaveLength(0);
  });
});
