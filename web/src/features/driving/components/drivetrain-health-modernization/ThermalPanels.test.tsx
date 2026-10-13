import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deriveDataState } from '@/api/dataState';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { healthFixture, statsFixture, driveFixture } from './fixtures';
import { powerSummary, sensorsFor } from './model';
import { ThermalPanels } from './ThermalPanels';

type Props = ComponentProps<typeof ThermalPanels>;
const retryDrive = vi.fn();
const retryStats = vi.fn();
const timestamp = 1_790_000_000_000;
const previousPreferences = getFormatterPreferences();
let client: QueryClient;

function ready<T>(data: T, refetch?: () => void) {
  return deriveDataState({ data, isSuccess: true, dataUpdatedAt: timestamp, refetch });
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    sensors: sensorsFor(healthFixture),
    power: { peakPower: 2000, avgPowerMax: 1000, minRegenPower: null },
    stats: statsFixture,
    healthState: ready(healthFixture),
    drivesState: ready([driveFixture()], retryDrive),
    statsState: ready(statsFixture, retryStats),
    loading: false,
    ...overrides,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>;
}

function renderPanels(overrides: Partial<Props> = {}) {
  return render(<ThermalPanels {...props(overrides)} />, { wrapper: Providers });
}

function statistic(label: string) {
  const row = screen.getByText(label, { selector: 'dt' }).parentElement;
  if (!row) throw new Error(`Missing statistic row: ${label}`);
  return within(row).getByRole('definition');
}

function powerMetric(label: string) {
  const metric = screen.getByText(label).closest<HTMLElement>('[data-operational-metric]');
  if (!metric) throw new Error(`Missing power metric: ${label}`);
  return metric;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

afterEach(() => {
  client.clear();
  setGlobalLocale(previousPreferences.locale);
  setGlobalPrecision(previousPreferences.precision);
});

describe('ThermalPanels independent source trust', () => {
  it('preserves all thermal sensors, ceilings, zero readings and SI power with omitted optional props', () => {
    renderPanels();
    expect(screen.getByText('Temperature Gauges')).toBeVisible();
    expect(screen.getByText('Thermal Load Indicators')).toBeVisible();
    expect(screen.getAllByRole('meter', { name: 'Front Motor' })).toHaveLength(2);
    for (const meter of screen.getAllByRole('meter', { name: 'Front Motor' })) {
      expect(meter).toHaveAttribute('aria-valuenow', '0');
    }
    expect(screen.getAllByRole('meter', { name: 'Rear Motor' })).toHaveLength(2);
    expect(screen.getAllByRole('meter', { name: 'Inverter' })).toHaveLength(2);
    expect(screen.queryByRole('meter', { name: 'Battery' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Battery')).toHaveLength(2);
    expect(screen.getAllByText(/Gauge scale:.*150.*°C/)).toHaveLength(2);
    expect(screen.getByText(/Gauge scale:.*120.*°C/)).toBeVisible();
    expect(screen.getByText(/Gauge scale:.*60.*°C/)).toBeVisible();
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(screen.getByText('Avg Power')).toBeVisible();
    expect(within(powerMetric('Peak Power')).getByText('2.00 kW')).toBeVisible();
    expect(within(powerMetric('Avg Power')).getByText('1.00 kW')).toBeVisible();
    expect(statistic('Drives')).toHaveTextContent('2');
    expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
  });

  it.each(['drives', 'stats'] as const)(
    'replaces only the initial failed %s source and retries its own query',
    source => {
      const failed = deriveDataState({
        error: new Error(`${source} source failed`),
        refetch: source === 'drives' ? retryDrive : retryStats,
      });
      renderPanels(source === 'drives'
        ? { drivesState: failed, power: powerSummary([]) }
        : { statsState: failed, stats: undefined });
      expect(screen.getByRole('alert')).toHaveTextContent("Can't reach server");
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(source === 'drives' ? retryDrive : retryStats).toHaveBeenCalledTimes(1);
      expect(source === 'drives' ? retryStats : retryDrive).not.toHaveBeenCalled();
      expect(screen.getAllByRole('meter', { name: 'Front Motor' })).toHaveLength(2);
      if (source === 'drives') {
        expect(statistic('Drives')).toHaveTextContent('2');
        expect(screen.queryByText('Peak Power')).not.toBeInTheDocument();
      } else {
        expect(screen.getByText('Peak Power')).toBeVisible();
        expect(screen.queryByText('Regen Ratio')).not.toBeInTheDocument();
      }
    },
  );

  it.each(['drives', 'stats'] as const)(
    'shows an initial %s skeleton without fabricated evidence and recovers independently',
    source => {
      const pending = deriveDataState({ isLoading: true, isPending: true });
      const { container, rerender } = renderPanels(source === 'drives'
        ? { drivesState: pending, drivesLoading: true, power: powerSummary([]) }
        : { statsState: pending, statsLoading: true, stats: undefined });
      expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(1);
      expect(screen.getAllByRole('meter', { name: 'Rear Motor' })).toHaveLength(2);
      if (source === 'drives') {
        expect(screen.queryByText('Returned evidence')).not.toBeInTheDocument();
        expect(statistic('Drives')).toHaveTextContent('2');
        expect(screen.queryByText('Peak Power')).not.toBeInTheDocument();
      } else {
        expect(screen.getByText('Returned evidence')).toBeVisible();
        expect(screen.getByText('Peak Power')).toBeVisible();
        expect(screen.queryByText('Regen Ratio')).not.toBeInTheDocument();
      }
      rerender(<ThermalPanels {...props()} />);
      expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(0);
      expect(screen.getByText('Returned evidence')).toBeVisible();
      expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
    },
  );

  it('distinguishes an empty selected drive subset from missing power readings in returned drives', () => {
    const { rerender } = renderPanels({ drivesEmpty: true, power: powerSummary([]) });
    expect(screen.getByText('No data')).toBeVisible();
    expect(screen.queryByText('Returned evidence')).not.toBeInTheDocument();
    expect(statistic('Drives')).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retryDrive).toHaveBeenCalledTimes(1);
    expect(retryStats).not.toHaveBeenCalled();
    rerender(<ThermalPanels {...props({ drivesEmpty: false, power: powerSummary([
      { date: '2026-09-01', powerMax: null, powerMin: null, outsideTemp: null, distance: null },
    ]) })} />);
    expect(screen.queryByText('No data')).not.toBeInTheDocument();
    expect(screen.getByText('Returned evidence')).toBeVisible();
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(powerMetric('Peak Power')).toHaveAttribute('data-value-state', 'missing');
    expect(within(powerMetric('Peak Power')).getByText('—')).toBeVisible();
    expect(powerMetric('Avg Power')).toHaveAttribute('data-value-state', 'missing');
    expect(within(powerMetric('Avg Power')).getByText('—')).toBeVisible();
    expect(screen.queryByText('0.00 kW')).not.toBeInTheDocument();
  });

  it('shows authoritative empty statistics without erasing power or measured zero statistics after recovery', () => {
    const { rerender } = renderPanels({ stats: undefined, statsEmpty: true });
    expect(screen.getByText('No drive statistics available yet')).toBeVisible();
    expect(screen.queryByText('Regen Ratio')).not.toBeInTheDocument();
    expect(screen.getByText('Peak Power')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retryStats).toHaveBeenCalledTimes(1);
    expect(retryDrive).not.toHaveBeenCalled();
    const zeroStats = { ...statsFixture, totalDrives: 0, regenRatio: 0 };
    rerender(<ThermalPanels {...props({ stats: zeroStats, statsState: ready(zeroStats), statsEmpty: false })} />);
    expect(screen.queryByText('No drive statistics available yet')).not.toBeInTheDocument();
    expect(statistic('Drives')).toHaveTextContent(/^0$/);
    expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
    const unknownRatio = { ...zeroStats, regenRatio: null };
    rerender(<ThermalPanels {...props({ stats: unknownRatio, statsState: ready(unknownRatio) })} />);
    expect(statistic('Drives')).toHaveTextContent(/^0$/);
    expect(statistic('Regen Ratio')).toHaveTextContent(/^—$/);
  });

  it('uses existing source states for initial and authoritative empty defaults without new caller inputs', () => {
    const { container, rerender } = renderPanels({
      drivesState: deriveDataState({ isPending: true }),
      statsState: deriveDataState({ isPending: true }),
      stats: undefined,
      power: powerSummary([]),
    });
    expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(2);
    expect(screen.queryByText('Returned evidence')).not.toBeInTheDocument();
    rerender(<ThermalPanels {...props({
      drivesState: ready([], retryDrive),
      statsState: deriveDataState({ data: null, isSuccess: true, refetch: retryStats }, { unavailable: true }),
      stats: undefined,
      power: powerSummary([]),
    })} />);
    expect(screen.getByText('No data')).toBeVisible();
    expect(screen.getByText('No drive statistics available yet')).toBeVisible();
    expect(screen.queryByText('Peak Power')).not.toBeInTheDocument();
    expect(screen.queryByText('Regen Ratio')).not.toBeInTheDocument();
    expect(screen.getAllByRole('meter', { name: 'Inverter' })).toHaveLength(2);
  });

  it.each(['drives', 'stats'] as const)(
    'keeps retained %s readings and source retry on refresh failure until recovery',
    source => {
      const retained = deriveDataState({
        data: source === 'drives' ? [driveFixture()] : statsFixture,
        dataUpdatedAt: timestamp,
        error: new Error(`${source} refresh failed`),
        refetch: source === 'drives' ? retryDrive : retryStats,
      });
      const { rerender } = renderPanels({
        drivesState: source === 'drives' ? retained : props().drivesState,
        statsState: source === 'stats' ? retained : props().statsState,
        drivesLoading: true,
        statsLoading: true,
        power: { peakPower: 0, avgPowerMax: 0, minRegenPower: null },
      });
      const warning = screen.getByTestId('stale-refresh-warning');
      expect(warning).toHaveTextContent(source === 'drives' ? 'Power Summary may be out of date' : 'Drive Statistics may be out of date');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getAllByText('0.00 kW')).toHaveLength(2);
      expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
      expect(screen.getByText(source === 'drives' ? 'Retained source' : 'Returned evidence')).toBeVisible();
      fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
      expect(source === 'drives' ? retryDrive : retryStats).toHaveBeenCalledTimes(1);
      expect(source === 'drives' ? retryStats : retryDrive).not.toHaveBeenCalled();
      rerender(<ThermalPanels {...props()} />);
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      expect(screen.getByText('Returned evidence')).toBeVisible();
    },
  );

  it('keeps paused drive readings qualified as retained without inventing an offline cause', () => {
    renderPanels({
      drivesState: deriveDataState({ data: [driveFixture()], fetchStatus: 'paused', dataUpdatedAt: timestamp }),
    });
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByText('Retained source')).toBeVisible();
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(statistic('Drives')).toHaveTextContent('2');
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps both retained sources visible during actual background fetching without a false stale warning', () => {
    const { container } = renderPanels({
      drivesState: deriveDataState({ data: [driveFixture()], isFetching: true, dataUpdatedAt: timestamp }),
      statsState: deriveDataState({ data: statsFixture, isFetching: true, dataUpdatedAt: timestamp }),
      drivesLoading: true,
      statsLoading: true,
    });
    expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(0);
    expect(within(powerMetric('Peak Power')).getByText('2.00 kW')).toBeVisible();
    expect(statistic('Drives')).toHaveTextContent('2');
    expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
    expect(screen.getByText('Returned evidence')).toBeVisible();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps independent drive and statistics measurements when only thermal health is loading or fails', () => {
    const { rerender } = renderPanels({
      healthState: deriveDataState({ isPending: true }),
      loading: true,
    });
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(statistic('Drives')).toHaveTextContent('2');
    rerender(<ThermalPanels {...props({
      healthState: deriveDataState({ error: new Error('health source failed') }),
    })} />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
  });
});
