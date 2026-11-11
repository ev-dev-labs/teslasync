import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Drive } from '@/types/driving';
import EfficiencyLandscapePage from './EfficiencyLandscapePage';

const h = vi.hoisted(() => ({ data: [] as Drive[] | undefined, error: null as Error | null, retry: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) =>
    (typeof fallback === 'string' ? fallback : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name] ?? '')),
  i18n: { language: 'en' } }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: () => ({
  start: '2026-01-01', end: '2026-01-31', startInstant: '2026-01-01T00:00:00Z',
  endInstantExclusive: '2026-02-01T00:00:00Z', setRange: vi.fn(),
}) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km' }, formatTemperature: (value: number) => `${value}°C`,
}) }));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: () => ({
  data: h.data, error: h.error, isError: h.error != null,
  isLoading: false, dataUpdatedAt: 1, refetch: h.retry,
}) }));
vi.mock('@/components/forms', () => ({ RangePicker: () => null }));
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/operationalbrief-a-m/DrivingSummaryBrief', () => ({
  DrivingSummaryBrief: () => <div data-testid="landscape-summary" />,
}));
vi.mock('@/components/layout', async (original) => {
  const actual = await original<typeof import('@/components/layout')>();
  return { ...actual, PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> };
});

beforeEach(() => {
  vi.clearAllMocks(); h.error = null;
  h.data = [
    { startTs: '2026-01-05T00:00:00Z', distanceM: 12000, energyUsedWh: 1800, avgSpeedMps: 20, outsideTempAvgC: 20 },
    { startTs: '2026-01-06T00:00:00Z', distanceM: 2000, energyUsedWh: 600, avgSpeedMps: 10, outsideTempAvgC: 0 },
  ] as Drive[];
});
const mount = () => render(<MemoryRouter><EfficiencyLandscapePage /></MemoryRouter>);

describe('EfficiencyLandscape specialized chart composition', () => {
  it('retains the measured grid and scale while exposing every bin, including thin and missing evidence', () => {
    const { container } = mount();
    const table = screen.getByRole('table', { name: 'Consumption Field — data table' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(30);
    expect(table).toHaveTextContent('150');
    expect(table).toHaveTextContent('300');
    expect(table).toHaveTextContent('—');
    const grid = container.querySelector('[data-app-part="chart-plot"].grid')!;
    expect(grid).toHaveClass('min-w-[640px]');
    expect(grid).toHaveStyle({ gridTemplateColumns: '7rem repeat(6, 1fr)' });
    const thin = screen.getByTitle('-5°C–5°C · 30–50 km/h · 300 Wh/km (1)');
    expect(thin).toHaveStyle({ background: 'var(--surface-2)' });
    expect(thin).toHaveAttribute('data-heatmap-state', 'active');
    expect(container.querySelector('[data-chart-scale]')).toHaveTextContent('150 Wh/km');
  });

  it('retains chart evidence and its table after a refresh failure', () => {
    h.error = new Error('refresh failed');
    mount();
    expect(screen.getByRole('table', { name: 'Consumption Field — data table' })).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('preserves the independent summary and field empty/error shells and retry', () => {
    h.data = [];
    const { rerender } = mount();
    expect(screen.getByText('No drives with speed, temperature, and energy data in this period.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Landscape summary metrics' })).toBeInTheDocument();
    h.data = undefined; h.error = new Error('offline');
    rerender(<MemoryRouter><EfficiencyLandscapePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.retry).toHaveBeenCalledOnce();
    expect(screen.getByText('Consumption Field')).toBeInTheDocument();
  });
});
