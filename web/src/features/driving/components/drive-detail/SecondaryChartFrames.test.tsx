import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SocChart } from './SocChart';
import { ElevationChart } from './ElevationChart';
import { SpeedHistogramChart } from './SpeedHistogramChart';
import type { ChartDataPoint, DriveStats } from './types';

vi.mock('react-i18next', async (importActual) => ({
  ...await importActual<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null }, exportPNG: vi.fn(), exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const), exporting: false,
  }),
}));
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/components/motion', async (importActual) => ({
  ...await importActual<typeof import('@/components/motion')>(),
  FadeIn: ({ children, className }: { children: ReactNode; className?: string }) =>
    <div className={className}>{children}</div>,
}));

function point(time: string, battery: number | null, elevation: number | null): ChartDataPoint {
  return {
    time, speed: 15, battery, elevation, power: 0, outsideTemp: null, insideTemp: null,
    driverTemp: null, passengerTemp: null, idealRange: null, ratedRange: null, estRange: null,
    odometer: null, soc: null, usableSoc: null, tireFl: null, tireFr: null, tireRl: null,
    tireRr: null, climateOn: null, fanStatus: null,
  };
}
const points = [point('08:00', 0, 10), point('08:01', null, null), point('08:02', 1, 12)];
const stats: DriveStats = {
  maxSpd: 0, avgSpd: 0, minSpd: 0, powerMax: 0, powerMin: 0, avgPower: 0,
  energyWh: 0, regenWh: 0, consumptionWhKm: 0, elevGain: 2, elevLoss: 0,
  avgOutsideTemp: null, avgInsideTemp: null, hasAnyTemp: false,
  insideTemps: [], outsideTemps: [], driverTemps: [], passengerTemps: [],
  climateStatus: null, avgFanSpeed: null, maxFanSpeed: null, startRange: null, endRange: null,
  odometerStart: 0, odometerEnd: 0, hasTirePressure: false, efficiencyPctPer100: null,
};

function mount(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>,
  );
}

describe('secondary detail charts using the actual shared chart-card chain', () => {
  it.each([
    { title: 'SOC % over time', element: <SocChart chartData={points} /> },
    { title: 'Elevation profile', element: <ElevationChart chartData={points} stats={stats} /> },
    { title: 'Speed histogram', element: <SpeedHistogramChart speedHistData={[{ range: '0–20', pct: 100 }]} /> },
  ])('preserves one named card, canonical export controls and 220px sizing for $title', ({ title, element }) => {
    const { container } = mount(element);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chart-toolbar]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Export chart' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
    const viewport = container.querySelector('[data-chart-viewport]');
    expect(viewport).toHaveStyle('--chart-height-mobile: 220px');
    expect(viewport).toHaveStyle('--chart-height-desktop: 220px');
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    expect(screen.getByText(/PNG/)).toBeInTheDocument();
    expect(screen.getByText(/SVG/)).toBeInTheDocument();
  });

  it('keeps all supplied histogram buckets and the sample-share basis in the accessible alternative', () => {
    const buckets = Array.from({ length: 30 }, (_, index) => ({ range: `bucket-${index}`, pct: index }));
    mount(<SpeedHistogramChart speedHistData={buckets} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(31);
    expect(within(table).getByText('bucket-29')).toBeInTheDocument();
    expect(within(table).getByText('% of speed samples')).toBeInTheDocument();
    expect(buckets).toHaveLength(30);
  });

  it('preserves independently visible elevation gain/loss/net evidence and the persistent legend key', () => {
    const { container } = mount(<ElevationChart chartData={points} stats={stats} />);
    const table = screen.getByRole('table', { name: 'Elevation summary' });
    expect(within(table).getByRole('rowheader', { name: 'Gain' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Loss' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Net' })).toBeInTheDocument();
    expect(container.querySelector('[data-chart-key="drive-detail-elevation"]')).not.toBeNull();
  });

  it('keeps the named card and explicit telemetry absence without converting missing readings to a numeric plot', () => {
    mount(<SocChart chartData={[point('08:00', null, null), point('08:01', null, null)]} />);
    expect(screen.getByRole('heading', { name: 'SOC % over time' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No telemetry data available');
  });
});
