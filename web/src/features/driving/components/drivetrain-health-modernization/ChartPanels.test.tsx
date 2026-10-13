import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deriveDataState } from '@/api/dataState';
import { ChartPanels } from './ChartPanels';
import type { DriveChartRow, MotorChartRow } from './model';

const preferences = vi.hoisted(() => ({ temperature: 'C' }));
vi.mock('@/hooks/useSettings', async () => ({
  ...await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings'),
  useSettings: () => ({
    settings: {
      unit_of_temp: preferences.temperature,
      unit_of_length: 'km',
      decimal_precision: 2,
      locale: 'en-US',
      chart_palette: 'cb_safe',
    },
    settingsUnavailable: false,
  }),
}));

const motorRows: MotorChartRow[] = [
  { time: '12:00', stator: 0, statorRel: null, statorRer: 20, torque: 0, speed: null, axle: 0 },
  { time: '12:01', stator: 25, statorRel: 30, statorRer: null, torque: null, speed: null, axle: 50 },
];
const driveRows: DriveChartRow[] = [
  { date: 'Oct 1', powerMax: 0, powerMin: null, outsideTemp: 0, distance: 0 },
  { date: 'Oct 2', powerMax: 2000, powerMin: null, outsideTemp: 20, distance: 1000 },
];
const titles = ['Stator Temperature History', 'Motor Torque', 'Temperature Trend', 'Power Output History'];
let client: QueryClient;

function Providers({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/drivetrain-health']}>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </MemoryRouter>;
}

function props(): ComponentProps<typeof ChartPanels> {
  return {
    motorRows,
    driveRows,
    motorState: deriveDataState({ data: motorRows }, { provenance: 'historical' }),
    drivesState: deriveDataState({ data: driveRows }, { provenance: 'historical' }),
    motorLoading: false,
    drivesLoading: false,
  };
}

function table(title: string) {
  return screen.getByRole('table', { name: `${title} — data table` });
}

function cells(title: string, index: number) {
  return within(within(table(title)).getAllByRole('row')[index]).getAllByRole('cell')
    .map(cell => cell.textContent);
}

beforeEach(() => {
  preferences.temperature = 'C';
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  client.clear();
});

describe('ChartPanels supported layout composition', () => {
  it('mounts all four real chart frames in order with zero and unknown source readings intact', () => {
    const { container } = render(<ChartPanels {...props()} />, { wrapper: Providers });
    expect(screen.getByRole('group', { name: 'Motor, temperature and power history charts' }))
      .toHaveAttribute('data-card-grid');
    const figures = container.querySelectorAll('figure');
    expect(figures).toHaveLength(4);
    titles.forEach((title, index) => {
      expect(figures[index]).toContainElement(table(title));
      expect(within(table(title)).getAllByRole('row')).toHaveLength(3);
    });
    expect(cells(titles[0], 1)).toEqual(['12:00', '0 °C', '—', '20 °C']);
    expect(cells(titles[1], 1)).toEqual(['12:00', '0.00 Nm']);
    expect(cells(titles[1], 2)).toEqual(['12:01', '—']);
    expect(cells(titles[2], 1)).toEqual(['Oct 1', '0 °C']);
    expect(cells(titles[3], 1)).toEqual(['Oct 1', '0 kW', '—']);
    expect(cells(titles[3], 2)).toEqual(['Oct 2', '2 kW', '—']);
  });

  it('keeps independent drive charts mounted while only motor history is initially loading', () => {
    const { container } = render(<ChartPanels {...props()} motorRows={[]}
      motorState={deriveDataState({ isPending: true, isLoading: true })}
      motorLoading />, { wrapper: Providers });
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    expect(screen.getAllByLabelText('Loading chart…')).toHaveLength(2);
    expect(cells(titles[2], 2)).toEqual(['Oct 2', '20 °C']);
    expect(cells(titles[3], 2)).toEqual(['Oct 2', '2 kW', '—']);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('isolates fatal motor errors and forwards retry before recovering the same four mounts', () => {
    const retry = vi.fn();
    const { container, rerender } = render(<ChartPanels {...props()} motorRows={[]}
      motorState={deriveDataState({ error: new Error('Fixture motor history failed'), refetch: retry })} />,
    { wrapper: Providers });
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(2);
    fireEvent.click(retries[0]);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(cells(titles[2], 1)).toEqual(['Oct 1', '0 °C']);
    expect(cells(titles[3], 2)).toEqual(['Oct 2', '2 kW', '—']);
    rerender(<ChartPanels {...props()} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(cells(titles[0], 1)).toEqual(['12:00', '0 °C', '—', '20 °C']);
    expect(container.querySelectorAll('figure')).toHaveLength(4);
  });

  it.each([
    { name: 'refresh failure', source: { error: new Error('Fixture refresh failed'), fetchStatus: 'idle' as const } },
    { name: 'paused refresh', source: { fetchStatus: 'paused' as const } },
  ])('retains motor readings and independent drive charts during $name', ({ source }) => {
    const retry = vi.fn();
    const { container } = render(<ChartPanels {...props()} motorLoading
      motorState={deriveDataState({ data: motorRows, refetch: retry, ...source })} />,
    { wrapper: Providers });
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.queryByLabelText('Loading chart…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(cells(titles[0], 1)).toEqual(['12:00', '0 °C', '—', '20 °C']);
    expect(cells(titles[1], 1)).toEqual(['12:00', '0.00 Nm']);
    expect(cells(titles[3], 2)).toEqual(['Oct 2', '2 kW', '—']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('retains all four shells and explicit empty states for authoritatively empty sources', () => {
    const { container } = render(<ChartPanels {...props()} motorRows={[]} driveRows={[]}
      motorState={deriveDataState({ data: [] }, { unavailable: true })}
      drivesState={deriveDataState({ data: [] }, { unavailable: true })} />,
    { wrapper: Providers });
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    expect(screen.getAllByText('No chartable observations are available for the current selection yet.'))
      .toHaveLength(4);
    for (const title of titles) expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('updates real display preferences without scaling SI inputs or replacing chart mounts', () => {
    const { container, rerender } = render(<ChartPanels {...props()} />, { wrapper: Providers });
    const figures = Array.from(container.querySelectorAll('figure'));
    expect(cells(titles[0], 1)).toEqual(['12:00', '0 °C', '—', '20 °C']);
    preferences.temperature = 'F';
    rerender(<ChartPanels {...props()} />);
    expect(cells(titles[0], 1)).toEqual(['12:00', '32 °F', '—', '68 °F']);
    expect(cells(titles[2], 2)).toEqual(['Oct 2', '68 °F']);
    expect(cells(titles[3], 2)).toEqual(['Oct 2', '2 kW', '—']);
    figures.forEach((figure, index) => {
      expect(container.querySelectorAll('figure')[index]).toBe(figure);
    });
    expect(motorRows[0].stator).toBe(0);
    expect(driveRows[1].powerMax).toBe(2000);
  });
});
