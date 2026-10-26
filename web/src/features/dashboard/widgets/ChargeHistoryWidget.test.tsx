import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      if (typeof defaultValue === 'string') {
        return defaultValue.replace('{{count}}', String(options?.count ?? ''));
      }
      return key;
    },
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [] }),
}));

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { energy: 'kWh' } }),
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => Number(value).toFixed(2) }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateShort: (value: string | null) => value === '2026-07-01T00:00:00Z' ? 'Jul 1, 2026' : '—',
    formatDateTime: (value: string | null) => value === '2026-07-01T00:00:00Z' ? 'Jul 1, 2026, 12:00 AM' : '—',
    formatTime: (value: string | null) => value ? '12:00 AM' : '—',
    formatRelative: (value: string | null) => value ? '1 hour ago' : '—',
    formatRelativeTime: (value: string | null) => value ? '1 hour ago' : '—',
  }),
}));

vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    EmbeddedChart: ({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) =>
      <div role="img" aria-label={ariaLabel}>{children}</div>,
  };
});

import { request } from '@/api/client';
import ChargeHistoryWidget from './ChargeHistoryWidget';
import type { WidgetSize } from './types';

const requestMock = request as unknown as ReturnType<typeof vi.fn>;
const full: WidgetSize = { cols: 2, rows: 2 };
const compact: WidgetSize = { cols: 1, rows: 1 };

function session(id: number, wh: number | null, charger_type: string | null = null) {
  return {
    id, vehicle_id: 7, started_at: '2026-07-01T00:00:00Z', ended_at: null,
    start_soc_pct: 20, end_soc_pct: 80, delta_soc_pct: 60,
    start_odometer_m: null, end_odometer_m: null, start_lat: null, start_lng: null,
    start_place: null, total_energy_added_wh: wh, peak_power_w: null, avg_power_w: null,
    cost_decimal: null, cost_currency: null, charger_type, cable_type: null,
  };
}

function renderWidget(size: WidgetSize) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChargeHistoryWidget vehicleId={7} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());
afterEach(cleanup);

describe('ChargeHistoryWidget redesign contract', () => {
  it('renders one true total and no fabricated average', async () => {
    requestMock.mockResolvedValue([
      session(1, 10_000, 'ac'),
      session(2, 20_000, 'supercharger'),
      session(3, 30_000, 'dc'),
    ]);
    renderWidget(full);

    expect(await screen.findByText('60.00')).toBeInTheDocument();
    expect(screen.queryByText('Avg')).not.toBeInTheDocument();
    expect(screen.getByText('Last 3 sessions')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /energy added/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Refresh/i })).toHaveLength(1);
  });

  it('preserves compact totals and null readings', async () => {
    requestMock.mockResolvedValue([
      session(1, null),
      session(2, 0),
      session(3, -2_000, 'ac'),
    ]);
    renderWidget(compact);

    expect(await screen.findByText('-2.00')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /energy added/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Refresh/i })).toHaveLength(1);
  });

  it('shows shared empty state without chart data', async () => {
    requestMock.mockResolvedValue([]);
    renderWidget(full);
    expect(await screen.findByText('No charge sessions yet')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /energy added/i })).not.toBeInTheDocument();
  });

});
