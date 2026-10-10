import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { PeriodStats } from '@/api/hooks/usePeriodStats';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const { requestMock, aiCapture, units } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  aiCapture: { props: null as Record<string, unknown> | null },
  units: { distance: 'km' as 'km' | 'mi' },
}));

vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: requestMock,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 10, setVehicleId: vi.fn() }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: units }),
}));
vi.mock('@/components/ai/AIPeriodCompareNarration', () => ({
  AIPeriodCompareNarration: (props: Record<string, unknown>) => {
    aiCapture.props = props;
    return <div data-testid="period-ai-context" />;
  },
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : key;
      const vars = options && typeof options === 'object'
        ? options as Record<string, unknown> : {};
      return text.replace(/{{(\w+)}}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match);
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import PeriodComparePage from '../../pages/PeriodComparePage';

const A: PeriodStats = {
  total_distance: 1000, total_drives: 50, energy_used: 200,
  avg_efficiency: 200, total_cost: 40, co2_saved: 120,
};
const B: PeriodStats = {
  total_distance: 2000, total_drives: 90, energy_used: 420,
  avg_efficiency: 210, total_cost: 88, co2_saved: 250,
};
const ZERO: PeriodStats = {
  total_distance: 0, total_drives: 0, energy_used: 0,
  avg_efficiency: 0, total_cost: 0, co2_saved: 0,
};

function install(
  resolve: (days: number) => Promise<PeriodStats> = days => Promise.resolve(days === 90 ? B : A),
) {
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith('/analytics/period-stats?')) {
      return resolve(Number(new URLSearchParams(path.split('?')[1]).get('days')));
    }
    if (path.startsWith('/vehicles')) {
      return Promise.resolve([
        { id: 10, display_name: 'Model 3', vin: 'VIN10' },
        { id: 20, display_name: 'Model Y', vin: 'VIN20' },
      ]);
    }
    return Promise.resolve({});
  });
}

function mount(path = '/period-compare', cached = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) {
    client.setQueryData(['period-stats', '10', 30], A);
    client.setQueryData(['period-stats', '10', 90], B);
  }
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <PeriodComparePage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function statsPaths() {
  return requestMock.mock.calls.map(call => String(call[0]))
    .filter(path => path.startsWith('/analytics/period-stats?'));
}

beforeEach(() => {
  requestMock.mockReset();
  aiCapture.props = null;
  units.distance = 'km';
  window.localStorage.clear();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});
afterEach(() => vi.clearAllMocks());

describe('period comparison live modernization regressions', () => {
  it('preserves independent all-time A and rolling B URLs and AI operands', async () => {
    install();
    mount('/analytics/compare?period_a=0&period_b=7');
    await screen.findByText(/Distance traveled was/);
    expect(statsPaths()).toContain('/analytics/period-stats?vehicle_id=10&days=0');
    expect(statsPaths()).toContain('/analytics/period-stats?vehicle_id=10&days=7');
    expect(aiCapture.props).toMatchObject({ vehicleId: '10', daysA: 0, daysB: 7 });
    expect(screen.queryByRole('combobox', { name: 'Vehicle' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Period B' }), { target: { value: '90' } });
    await waitFor(() => expect(aiCapture.props).toMatchObject({ daysA: 0, daysB: 90 }));
    expect(screen.getByRole('combobox', { name: 'Period A' })).toHaveValue('0');
    await waitFor(() => expect(statsPaths()).toContain('/analytics/period-stats?vehicle_id=10&days=90'));
  });

  it('retains both metrics, chart and table when cached sources fail refresh', async () => {
    install(() => Promise.reject(new Error('refresh failed')));
    const { client } = mount('/period-compare', true);
    await waitFor(() => expect(client.getQueryState(['period-stats', '10', 30])?.status).toBe('error'));
    await waitFor(() => expect(client.getQueryState(['period-stats', '10', 90])?.status).toBe('error'));
    expect(screen.getByText(/Distance traveled was -50\.00% less/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Total drives/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Change vs period B (%)' })).toBeInTheDocument();
    expect(screen.queryByText(/Comparison requires both periods/)).not.toBeInTheDocument();
    expect(client.getQueryData(['period-stats', '10', 30])).toEqual(A);
    expect(client.getQueryData(['period-stats', '10', 90])).toEqual(B);
  });

  it.each([30, 90])('keeps all six independent neighbor values if days=%s initially fails', async failedDays => {
    install(days => days === failedDays
      ? Promise.reject(new Error('source failed'))
      : Promise.resolve(days === 90 ? B : A));
    mount();
    const label = failedDays === 30 ? 'Period B' : 'Period A';
    const source = await screen.findByRole('region', { name: label });
    await waitFor(() => expect(within(source).getByText('Total drives')).toBeInTheDocument());
    expect(within(source).getByText(failedDays === 30 ? '90' : '50')).toBeInTheDocument();
    for (const metric of ['Total distance', 'Total drives', 'Energy used', 'Avg efficiency', 'Total cost', 'CO₂ saved']) {
      expect(within(source).getByText(metric)).toBeInTheDocument();
    }
    expect(screen.queryByText(/Distance traveled was/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Comparison details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeInTheDocument();
  });

  it('keeps a pending B unknown while all available A values remain visible', async () => {
    install(days => days === 90 ? new Promise<PeriodStats>(() => {}) : Promise.resolve(A));
    mount();
    const source = await screen.findByRole('region', { name: 'Period A' });
    await waitFor(() => expect(within(source).getByText('50')).toBeInTheDocument());
    expect(within(source).getByText('1,000.00 km')).toBeInTheDocument();
    const pending = screen.getByRole('region', { name: 'Period B' });
    expect(within(pending).queryByText('0')).not.toBeInTheDocument();
    expect(within(pending).queryByText('Total drives')).not.toBeInTheDocument();
    expect(screen.queryByText(/Distance traveled was/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Comparison details' })).toBeInTheDocument();
  });

  it('keeps actual zero baselines neutral without inventing a percent chart', async () => {
    install(days => Promise.resolve(days === 90 ? ZERO : A));
    mount();
    await screen.findByText(/Percent change requires a nonzero period B baseline/);
    expect(screen.getByText(/Distance change is unavailable: period B has no baseline/)).toBeInTheDocument();
    const drives = within(screen.getByRole('row', { name: /Total drives/ }));
    expect(drives.getByText('0')).toBeInTheDocument();
    expect(drives.getByText('—')).toBeInTheDocument();
  });

  it('keeps locale-aware integer counts and SI display conversion for miles', async () => {
    units.distance = 'mi';
    setGlobalPrecision(3);
    setGlobalLocale('de-DE');
    install();
    const { container } = mount();
    await screen.findByText(/Distance traveled was -50,000% less/);
    const drives = within(screen.getByRole('row', { name: /Total drives/ }));
    expect(drives.getByText('50')).toBeInTheDocument();
    expect(drives.getByText('↓ 40')).toBeInTheDocument();
    expect(container.textContent).toContain('621,371 mi');
    expect(container.textContent).toContain('321,869 Wh/mi');
    expect(A.total_distance).toBe(1000);
    expect(A.avg_efficiency).toBe(200);
  });

  it('uses one card grid and leaves canonical-route vehicle selection to the header', async () => {
    install();
    const { container } = mount('/period-compare');
    await screen.findByText(/Distance traveled was/);
    expect(container.querySelectorAll('[data-card-grid]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-layout-reference]')).toHaveLength(1);
    expect(screen.queryByRole('combobox', { name: 'Vehicle' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-card-grid] [data-card-title], [data-card-grid] [data-operational-brief] h3')).toHaveLength(4);
    expect(container.querySelector('[data-layout-reference]')).toHaveClass('w-full', 'min-w-0');
  });
});
