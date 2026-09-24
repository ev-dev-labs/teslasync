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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

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
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockRange.mockReturnValue({
    start: '2026-01-01',
    end: '2026-03-01',
    setRange: vi.fn(),
  });
  mockSessions.mockReturnValue(makeQuery({ data: [] }));
});

describe('ChargingHeatmapPage — KPI band branches', () => {
  it('shows skeletons (not cards) while the sessions query is in flight', () => {
    mockSessions.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    const { container } = renderPage();

    expect(kpiRegion()).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(within(kpiRegion()).queryByText('Total Sessions')).not.toBeInTheDocument();
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
