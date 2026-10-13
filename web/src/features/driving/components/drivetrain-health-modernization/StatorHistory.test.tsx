import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deriveDataState } from '@/api/dataState';
import { downloadCSV } from '@/lib/csvExport';
import { chartTokens } from '@/lib/tokens';
import { StatorHistory } from './StatorHistory';
import type { MotorChartRow } from './model';

const preferences = vi.hoisted(() => ({ temperature: 'C', search: '' }));

vi.mock('@/hooks/useSettings', async () => ({
  ...await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings'),
  useSettings: () => ({
    settings: {
      unit_of_temp: preferences.temperature,
      unit_of_length: 'km',
      unit_of_pressure: 'bar',
      decimal_precision: 2,
      locale: 'en-US',
      currency_symbol: '$',
    },
  }),
}));

vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadCSV: vi.fn(),
}));

vi.mock('@/components/charts', async () => {
  const actual = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  return {
    ...actual,
    // jsdom supplies no layout; keep the real chart, series, axes and legend.
    ResponsiveContainer: ({ children }: ComponentProps<typeof actual.ResponsiveContainer>) =>
      cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 640, height: 280 }),
  };
});

const rows: MotorChartRow[] = [
  { time: '12:00', stator: 0, statorRel: 30, statorRer: 40, torque: null, speed: null, axle: null },
  { time: '12:01', stator: 65, statorRel: 70, statorRer: 75, torque: null, speed: null, axle: null },
  { time: '12:02', stator: 95, statorRel: 100, statorRer: 105, torque: null, speed: null, axle: null },
];
const ready = deriveDataState({ data: rows, isSuccess: true }, { provenance: 'historical' });
const originalRootStyle = document.documentElement.getAttribute('style');
let client: QueryClient;

function LocationProbe() {
  return <output data-testid="stator-location">{useLocation().search}</output>;
}

function Providers({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={[`/drivetrain-health${preferences.search}`]}>
    <QueryClientProvider client={client}>
      {children}
      <LocationProbe />
    </QueryClientProvider>
  </MemoryRouter>;
}

beforeEach(() => {
  vi.clearAllMocks();
  preferences.temperature = 'C';
  preferences.search = '';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.documentElement.style.setProperty('--font-scale', '1');
  document.documentElement.style.setProperty('--font-sans', 'Fixture Sans, sans-serif');
});

afterEach(() => {
  client.clear();
  if (originalRootStyle == null) document.documentElement.removeAttribute('style');
  else document.documentElement.setAttribute('style', originalRootStyle);
});

describe('StatorHistory restrained presentation', () => {
  it('renders all three named stator series with existing restrained roles and subdued threshold references', async () => {
    const { container } = render(<StatorHistory rows={rows} state={ready} loading={false} />, { wrapper: Providers });
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(3);
    });
    const curves = container.querySelectorAll('.recharts-line-curve');
    expect(Array.from(curves, curve => curve.getAttribute('stroke'))).toEqual([
      chartTokens.series[3], chartTokens.series[4], chartTokens.series[5],
    ]);
    for (const curve of curves) {
      expect(curve).toHaveAttribute('stroke-width', '2');
      expect(curve.getAttribute('d')).toMatch(/^M/);
    }
    for (const name of ['Stator Temp', 'Rear-Left Stator Temp', 'Rear-Right Stator Temp']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    const references = container.querySelectorAll('.recharts-reference-line-line');
    expect(Array.from(references, line => line.getAttribute('stroke'))).toEqual([
      'var(--semantic-success)', 'var(--semantic-warning)',
    ]);
    for (const reference of references) {
      expect(reference).toHaveAttribute('stroke-dasharray', '4 4');
      expect(reference).toHaveAttribute('stroke-opacity', '0.5');
    }
    expect(container.querySelector('.recharts-cartesian-grid-horizontal line'))
      .toHaveAttribute('stroke', chartTokens.gridStroke);
    expect(screen.getByText(/^Normal · 60(?:\.0+)?°C$/).closest('text')).toHaveAttribute('fill', 'var(--semantic-success)');
    expect(screen.getByText(/^Warm · 80(?:\.0+)?°C$/).closest('text')).toHaveAttribute('fill', 'var(--semantic-warning)');
  });

  it('renders caption-sized SVG ticks and threshold labels using the current font and text scale', () => {
    const { container, rerender } = render(<StatorHistory rows={rows} state={ready} loading={false} />, { wrapper: Providers });
    const labels = () => container.querySelectorAll('.recharts-cartesian-axis-tick text, .recharts-reference-line text');
    expect(labels().length).toBeGreaterThan(4);
    for (const label of labels()) {
      expect(label).toHaveAttribute('font-size', '12');
      expect(label).toHaveAttribute('font-family', 'Fixture Sans, sans-serif');
    }
    document.documentElement.style.setProperty('--font-scale', '1.5');
    document.documentElement.style.setProperty('--font-sans', 'Scaled Fixture Sans, sans-serif');
    rerender(<StatorHistory rows={rows} state={ready} loading={false} />);
    for (const label of labels()) {
      expect(label).toHaveAttribute('font-size', '18');
      expect(label).toHaveAttribute('font-family', 'Scaled Fixture Sans, sans-serif');
    }
    expect(container.querySelector('.recharts-cartesian-axis-tick text'))
      .toHaveAttribute('fill', chartTokens.axisStroke);
  });

  it('changes only display temperature units while retaining raw SI plot and threshold positions', async () => {
    const { container, rerender } = render(<StatorHistory rows={rows} state={ready} loading={false} />, { wrapper: Providers });
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(3));
    const references = () => Array.from(container.querySelectorAll('.recharts-reference-line-line'),
      line => [line.getAttribute('y1'), line.getAttribute('y2')]);
    const originalPositions = references();
    preferences.temperature = 'F';
    rerender(<StatorHistory rows={rows} state={ready} loading={false} />);
    expect(screen.getByText(/^Normal · 140(?:\.0+)?°F$/)).toBeInTheDocument();
    expect(screen.getByText(/^Warm · 176(?:\.0+)?°F$/)).toBeInTheDocument();
    expect(references()).toEqual(originalPositions);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Stator — Front Motor (°F)' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Rear-Left — Rear Motor (°F)' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Rear-Right — Inverter (°F)' })).toBeInTheDocument();
    expect(within(table).getByText(/^32(?:\.0+)?°F$/)).toBeInTheDocument();
    expect(rows[0].stator).toBe(0);
    expect(rows[2].statorRer).toBe(105);
  });

  it('preserves every table and CSV reading including unknowns, measured zero and negative temperatures', async () => {
    const measurements = rows.map(row => ({ ...row }));
    measurements[0] = { ...measurements[0], stator: 0, statorRel: null, statorRer: -10 };
    render(<StatorHistory rows={measurements} state={ready} loading={false} />, { wrapper: Providers });
    const table = screen.getByRole('table');
    const firstRow = within(table).getAllByRole('row')[1];
    expect(within(firstRow).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
      '12:00', '0.00°C', '—', '-10.00°C',
    ]);
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByText(/These aliases do not identify additional motors/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledOnce());
    expect(vi.mocked(downloadCSV).mock.calls[0][1]).toBe(
      "time,stator,statorRel,statorRer\r\n12:00,0.00°C,—,'-10.00°C\r\n12:01,65.00°C,70.00°C,75.00°C\r\n12:02,95.00°C,100.00°C,105.00°C",
    );
  });

  it('keeps the original hidden-series URL key and each stator identity through legend interaction', async () => {
    preferences.search = '?hidden_stator-temp-chart=statorRel';
    render(<StatorHistory rows={rows} state={ready} loading={false} />, { wrapper: Providers });
    const rearLeft = await screen.findByRole('button', { name: 'Rear-Left Stator Temp' });
    expect(rearLeft).toHaveAttribute('data-series-key', 'statorRel');
    expect(rearLeft).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Stator Temp' })).toHaveAttribute('data-series-key', 'stator');
    expect(screen.getByRole('button', { name: 'Rear-Right Stator Temp' })).toHaveAttribute('data-series-key', 'statorRer');
    fireEvent.click(rearLeft);
    await waitFor(() => expect(rearLeft).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByTestId('stator-location')).toHaveTextContent(/^$/);
    fireEvent.click(screen.getByRole('button', { name: 'Rear-Right Stator Temp' }));
    await waitFor(() => expect(screen.getByTestId('stator-location'))
      .toHaveTextContent('?hidden_stator-temp-chart=statorRer'));
  });

  it('retains the real frame and source feedback for initial, unavailable and retained refresh states', () => {
    const { container, rerender } = render(<StatorHistory rows={[]} state={deriveDataState({ isPending: true, isLoading: true })}
      loading />, { wrapper: Providers });
    expect(screen.getAllByText('Stator Temperature History').length).toBeGreaterThan(0);
    expect(container.querySelector('figure')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading chart…' })).toBeInTheDocument();
    rerender(<StatorHistory rows={[]} state={deriveDataState({ data: [], isSuccess: true }, { unavailable: true })} loading={false} />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
    const retained = deriveDataState({ data: rows, error: new Error('fixture refresh failed'), isError: true });
    rerender(<StatorHistory rows={rows} state={retained} loading />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stator Temp' })).toBeInTheDocument();
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
  });
});
