import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { Drive } from '@/types/driving';

const h = vi.hoisted(() => ({
  source: {} as DataStateSource<Drive[]>,
  refetch: vi.fn(),
  setCategory: vi.fn(),
  setCategories: vi.fn(),
  setRatePerKm: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: () => h.source }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({ start: '2026-01-01', end: '2026-12-31', setRange: vi.fn() }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km', speed: 'km/h', temperature: 'C' },
    formatDistance: (value: number) => `${value} m`,
    formatEnergy: (value: number) => `${value} Wh`,
    formatTemperature: (value: number) => `${value} °C`,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (value: number) => `$${value}` }),
}));
vi.mock('../hooks/useTripLogbook', () => ({
  useTripLogbook: () => ({
    categories: {},
    ratesPerKm: { business: 0.5, commute: 0.25, personal: 0 },
    setCategory: h.setCategory,
    setCategories: h.setCategories,
    setRatePerKm: h.setRatePerKm,
  }),
}));
vi.mock('@/components/motion', async (importActual) => ({
  ...await importActual<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/forms', () => ({ RangePicker: () => null }));
vi.mock('@/components/layout', async (importActual) => ({
  ...await importActual<typeof import('@/components/layout')>(),
  PageLayout: ({ title, children }: { title: string; children: ReactNode }) =>
    <main><h1>{title}</h1>{children}</main>,
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) =>
    <section aria-label={title}><h2>{title}</h2>{children}</section>,
  ChartCard: ({ title, children, error, loading, empty, emptyMessage, onRetry }: {
    title: string; children: ReactNode; error?: unknown; loading?: boolean;
    empty?: boolean; emptyMessage?: string; onRetry?: () => void;
  }) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      {error ? <div role="alert"><button onClick={onRetry}>Retry chart</button></div>
        : loading ? <div role="status">Loading chart</div>
        : empty ? <p>{emptyMessage}</p> : children}
    </section>
  ),
}));
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    ChartTooltip: Inert, ComposedChart: Inert, Line: Inert, Scatter: Inert, Area: Inert,
    XAxis: Inert, YAxis: Inert, CartesianGrid: Inert, Tooltip: Inert, ResponsiveContainer: Inert,
  };
});

import DriveAnomaliesPage from './DriveAnomaliesPage';
import EfficiencyLandscapePage from './EfficiencyLandscapePage';
import EnergyAnatomyPage from './EnergyAnatomyPage';
import TripLogbookPage from './TripLogbookPage';

const drives: Drive[] = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1, vehicleId: 7,
  startTs: `2026-08-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
  endTs: `2026-08-${String(index + 1).padStart(2, '0')}T08:30:00Z`,
  durationS: 1800, distanceM: 20000, startAddress: 'Home', endAddress: 'Office',
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: 80, endBatteryPct: 70, energyUsedWh: 3000 + index * 100,
  regenEnergyWh: 400, avgSpeedMps: 10 + index * 2, maxSpeedMps: 35,
  avgPowerW: null, outsideTempAvgC: 20, insideTempAvgC: null,
  score: null, endedStatus: 'completed', createdAt: '', updatedAt: '',
}));

const surfaces = [
  { title: 'Anomaly Detective', Component: DriveAnomaliesPage, sections: ['Your Consumption Law', 'Case Files'], metric: 'Drives Analyzed' },
  { title: 'Efficiency Landscape', Component: EfficiencyLandscapePage, sections: ['Consumption Field'], metric: 'Drives Mapped' },
  { title: 'Energy Anatomy', Component: EnergyAnatomyPage, sections: ['Energy Flow'], metric: 'Energy Used' },
  { title: 'Trip Logbook', Component: TripLogbookPage, sections: ['Reimbursement', 'Drives'], metric: 'of 12 drives' },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.source = { data: drives, isSuccess: true, error: null, refetch: h.refetch };
});

describe.each(surfaces)('$title retained source trust', ({ Component, sections, metric }) => {
  it('keeps every report body and metric through a failed refresh, with source-local recovery', () => {
    const view = render(<MemoryRouter><Component /></MemoryRouter>);
    expect(screen.getByText(metric)).toBeInTheDocument();
    for (const name of sections) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    h.source = { ...h.source, isError: true, error: new Error('refresh failed') };
    view.rerender(<MemoryRouter><Component /></MemoryRouter>);
    expect(screen.getByText(metric)).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    for (const name of sections) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('retains the report outline without claiming a successful empty result after an initial failure', () => {
    h.source = { data: undefined, isError: true, error: new Error('initial failed'), refetch: h.refetch };
    render(<MemoryRouter><Component /></MemoryRouter>);
    for (const name of sections) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    if (metric === 'of 12 drives') {
      expect(screen.queryByText(metric)).not.toBeInTheDocument();
    } else {
      const metricItem = screen.getByText(metric).closest('[role="listitem"]');
      expect(metricItem).toHaveAttribute('data-value-state', 'missing');
      expect(metricItem?.querySelector('[data-operational-value]')).toHaveTextContent(/^—$/);
      expect(metricItem?.querySelector('[data-operational-value]')).not.toHaveTextContent(/^0(?:\s|$)/);
    }
    expect(screen.getByText('Source unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Returned evidence')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Retry/ }).length).toBeGreaterThan(0);
  });

  it('preserves retained content and declares paused/offline refreshes rather than inventing an empty window', () => {
    h.source = { ...h.source, fetchStatus: 'paused' };
    render(<MemoryRouter><Component /></MemoryRouter>);
    expect(screen.getByText(metric)).toBeInTheDocument();
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(warning).toHaveTextContent('The latest values are temporarily unavailable. Previously loaded data remains visible.');
    expect(warning).not.toHaveTextContent(/offline/i);
  });
});
