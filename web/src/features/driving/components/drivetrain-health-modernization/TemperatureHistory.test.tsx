import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import { chartTokens } from '@/lib/tokens';
import type { DriveChartRow } from './model';
import { TemperatureHistory } from './TemperatureHistory';

const preferences = vi.hoisted(() => ({ temperature: 'C' }));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: 'km', unit_of_temp: preferences.temperature,
      unit_of_pressure: 'bar', locale: 'en-US', decimal_precision: 0,
    },
    decimals: 0,
    locale: 'en-US',
    density: 'comfortable',
  }),
}));

const rows: DriveChartRow[] = [
  { date: 'Oct 01', outsideTemp: -10, powerMax: null, powerMin: null, distance: null },
  { date: 'Oct 02', outsideTemp: null, powerMax: null, powerMin: null, distance: null },
  { date: 'Oct 03', outsideTemp: 0, powerMax: null, powerMin: null, distance: null },
  { date: 'Oct 04', outsideTemp: 35, powerMax: null, powerMin: null, distance: null },
];

function sourceState(data: DriveChartRow[] = rows, error?: Error) {
  return deriveDataState(
    { data, isSuccess: !error, isError: !!error, error, dataUpdatedAt: 1 },
    { provenance: 'historical' },
  );
}

async function renderedChart() {
  await waitFor(() => {
    expect(document.querySelector('.recharts-line-curve')).toBeInTheDocument();
    expect(document.querySelectorAll('.recharts-line-dot')).toHaveLength(3);
  }, { timeout: 5000 });
  return document.querySelector('.recharts-wrapper') as HTMLElement;
}

beforeEach(() => {
  preferences.temperature = 'C';
  document.documentElement.style.setProperty('--font-scale', '1.5');
  document.documentElement.style.setProperty('--font-sans', 'Test Sans');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 300,
    width: 800, height: 300, toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--font-scale');
  document.documentElement.style.removeProperty('--font-sans');
});

describe('TemperatureHistory', () => {
  it('renders restrained series and references with scaled readable chart text', async () => {
    render(<TemperatureHistory rows={rows} state={sourceState()} loading={false} />);
    const chart = await renderedChart();
    expect(screen.getByRole('img', {
      name: 'Outside temperature trend line chart per recent drive',
    })).toBeInTheDocument();
    expect(chart.querySelector('.recharts-line-curve')).toHaveAttribute('stroke', chartTokens.series[0]);
    const dots = chart.querySelectorAll('.recharts-line-dot');
    expect(dots).toHaveLength(3);
    dots.forEach(dot => {
      expect(dot).toHaveAttribute('fill', chartTokens.series[0]);
      expect(dot).toHaveAttribute('r', '3');
    });
    const stops = chart.querySelectorAll('#dtTempGrad stop');
    expect(stops).toHaveLength(2);
    stops.forEach(stop => expect(stop).toHaveAttribute('stop-color', chartTokens.series[0]));
    const grid = chart.querySelector('.recharts-cartesian-grid-horizontal line');
    expect(grid).toHaveAttribute('stroke', chartTokens.gridStroke);
    const references = chart.querySelectorAll('.recharts-reference-line-line');
    expect(references).toHaveLength(2);
    expect(references[0]).toHaveAttribute('stroke', chartTokens.series[2]);
    expect(references[1]).toHaveAttribute('stroke', chartTokens.series[0]);
    references.forEach(reference => expect(reference).toHaveAttribute('stroke-dasharray', '4 4'));
    expect(within(chart).getByText('Warm Zone · 35°C').closest('text')).toHaveAttribute('font-size', '18');
    expect(within(chart).getByText('Freezing · 0°C').closest('text')).toHaveAttribute('font-family', 'Test Sans');
    const ticks = chart.querySelectorAll('.recharts-cartesian-axis-tick-value');
    expect(ticks.length).toBeGreaterThan(0);
    ticks.forEach(tick => {
      expect(tick).toHaveAttribute('font-size', '18');
      expect(tick).toHaveAttribute('font-family', 'Test Sans');
      expect(tick).toHaveAttribute('fill', chartTokens.axisStroke);
    });
    expect(within(chart).getByText('Outside Temp')).toBeInTheDocument();
  });

  it('keeps raw SI geometry while table and reference labels follow Fahrenheit preference', async () => {
    const original = structuredClone(rows);
    const view = render(<TemperatureHistory rows={rows} state={sourceState()} loading={false} />);
    let chart = await renderedChart();
    const path = chart.querySelector('.recharts-line-curve')?.getAttribute('d');
    const referencePositions = Array.from(
      chart.querySelectorAll('.recharts-reference-line-line'),
      reference => reference.getAttribute('y1'),
    );
    expect(screen.getByRole('columnheader', { name: 'Outside Temp (°C)' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').map(row => row.textContent)).toEqual([
      'DateOutside Temp (°C)', 'Oct 01-10°C', 'Oct 02—', 'Oct 030°C', 'Oct 0435°C',
    ]);
    preferences.temperature = 'F';
    view.rerender(<TemperatureHistory rows={rows} state={sourceState()} loading={false} />);
    chart = await renderedChart();
    expect(chart.querySelector('.recharts-line-curve')).toHaveAttribute('d', path);
    expect(Array.from(
      chart.querySelectorAll('.recharts-reference-line-line'),
      reference => reference.getAttribute('y1'),
    )).toEqual(referencePositions);
    expect(within(chart).getByText('Warm Zone · 95°F')).toBeInTheDocument();
    expect(within(chart).getByText('Freezing · 32°F')).toBeInTheDocument();
    expect(within(table).getAllByRole('row').map(row => row.textContent)).toEqual([
      'DateOutside Temp (°F)', 'Oct 0114°F', 'Oct 02—', 'Oct 0332°F', 'Oct 0495°F',
    ]);
    expect(rows).toEqual(original);
  });

  it('exports the same display temperatures without inventing a missing measurement', async () => {
    preferences.temperature = 'F';
    let downloaded: Blob | undefined;
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL(blob: Blob) {
        downloaded = blob;
        return 'blob:temperature-history';
      }
      static revokeObjectURL() {}
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<TemperatureHistory rows={rows} state={sourceState()} loading={false} />);
    await renderedChart();
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));
    expect(click).toHaveBeenCalledOnce();
    expect(downloaded).toBeInstanceOf(Blob);
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(downloaded as Blob);
    });
    expect(csv.replace(/^\uFEFF/, '')).toBe(
      'date,outsideTemp\r\nOct 01,14°F\r\nOct 02,—\r\nOct 03,32°F\r\nOct 04,95°F',
    );
  });

  it('keeps unknown rows as chronological gaps rather than connecting across missing measurements', async () => {
    const data = [
      { ...rows[1], date: 'Sep 30' },
      ...rows,
      { ...rows[1], date: 'Oct 05' },
    ];
    render(<TemperatureHistory rows={data} state={sourceState(data)} loading={false} />);
    const chart = await renderedChart();
    const path = chart.querySelector('.recharts-line-curve')?.getAttribute('d');
    expect(path?.match(/M/g)).toHaveLength(2);
    expect(within(screen.getByRole('table')).getAllByRole('row').map(row => row.textContent)).toEqual([
      'DateOutside Temp (°C)', 'Sep 30—', 'Oct 01-10°C', 'Oct 02—',
      'Oct 030°C', 'Oct 0435°C', 'Oct 05—',
    ]);
    expect(screen.getByRole('button', { name: 'Export chart' })).toBeInTheDocument();
  });

  it('retains chart and measured zero during refresh failure and paused refresh', async () => {
    const view = render(
      <TemperatureHistory rows={rows} state={sourceState(rows, new Error('Refresh failed'))} loading />,
    );
    await renderedChart();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '0°C' })).toBeInTheDocument();
    const paused = deriveDataState(
      { data: rows, isSuccess: true, fetchStatus: 'paused', dataUpdatedAt: 1 },
      { provenance: 'historical' },
    );
    view.rerender(<TemperatureHistory rows={rows} state={paused} loading />);
    await renderedChart();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByRole('cell', { name: '0°C' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    view.rerender(<TemperatureHistory rows={rows} state={sourceState()} loading={false} />);
    await renderedChart();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '0°C' })).toBeInTheDocument();
  });

  it.each([
    { name: 'empty', data: [] },
    { name: 'all unknown', data: [rows[1], { ...rows[1], date: 'Oct 05' }] },
    { name: 'single measured zero', data: [rows[2], rows[1]] },
  ])('keeps the named empty frame for $name temperatures', ({ data }) => {
    render(<TemperatureHistory rows={data} state={sourceState(data)} loading={false} />);
    expect(screen.getByRole('heading', { name: 'Temperature Trend' })).toBeInTheDocument();
    expect(document.querySelector('.recharts-line-curve')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export chart' })).not.toBeInTheDocument();
  });

  it('preserves the source loading and initial failure frames without fabricated temperatures', () => {
    const initial = deriveDataState({ isPending: true, isLoading: true });
    const view = render(<TemperatureHistory rows={[]} state={initial} loading />, { wrapper: MemoryRouter });
    expect(screen.getByRole('heading', { name: 'Temperature Trend' })).toBeInTheDocument();
    expect(document.querySelector('.recharts-line-curve')).not.toBeInTheDocument();
    const fatal = deriveDataState({ isError: true, error: new Error('Temperature history failed') });
    view.rerender(<TemperatureHistory rows={[]} state={fatal} loading={false} />);
    expect(screen.getByRole('heading', { name: 'Temperature Trend' })).toBeInTheDocument();
    // QueryError classifies the failure; the frame switches to its error state without readings.
    expect(document.querySelector('[data-chart-state="error"]')).toBeInTheDocument();
    expect(document.querySelector('.recharts-line-curve')).not.toBeInTheDocument();
  });
});
