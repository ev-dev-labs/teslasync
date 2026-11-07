import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import type { SignalHistoryResponse } from '@/types/telemetry';
import { PackBoundary } from './designPacks/PackBoundary';
import type { PackId } from './designPacks/types';
import LiveSignalsWidget from './LiveSignalsWidget';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(path: string) => Promise<unknown>>(),
}));
vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: requestMock,
}));
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/setup');
  return createReactI18nextMock();
});
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { unit_of_length: 'mi', unit_of_temp: 'C', unit_of_pressure: 'bar', decimal_precision: 1, locale: 'en-US' },
    locale: 'en-US',
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (value: string | number | Date) => (value instanceof Date ? value : new Date(value)).toISOString(),
  }),
}));

const NOW = Date.parse('2026-11-07T02:00:00Z');
const OBSERVED = '2026-11-07T01:59:50Z';
const NAMES = ['BatteryLevel', 'ACChargingPower', 'InsideTemp', 'OutsideTemp', 'RatedRange'] as const;
const PACKS = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const VALUES = [64, 7000, 22.2, 23, 275000];
let live: VehicleLiveSignalsResponse;
let historiesEmpty: boolean;
let failLive: boolean;
let failHistory: string | null;
let client: QueryClient;

function history(name: string): SignalHistoryResponse {
  const index = NAMES.findIndex((signal) => signal === name);
  return {
    vehicleId: 7, signal: name, from: '2026-11-07T01:00:00Z', to: OBSERVED,
    count: historiesEmpty ? 0 : 3,
    data: historiesEmpty ? [] : [0, 1, 2].map((step) => ({
      ts: new Date(NOW - (30 - step * 10) * 1000).toISOString(),
      kind: 'ValueKindFloat', value: VALUES[index] - 2 + step,
      ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null,
    })),
  };
}

function tree(pack: PackId, cols = 2) {
  return (
    <QueryClientProvider client={client}>
      <PackBoundary requestedPackId={pack}>
        <LiveSignalsWidget vehicleId={7} size={{ cols, rows: 4 }} />
      </PackBoundary>
    </QueryClientProvider>
  );
}

async function settled() {
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="list"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
  await settled();
}

function signalRow(name: string) {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`Missing signal row: ${name}`);
  return within(row);
}

describe('LiveSignalsWidget design packs', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    requestMock.mockReset();
    historiesEmpty = false;
    failLive = false;
    failHistory = null;
    live = { vehicle_id: 7, signals: Object.fromEntries(NAMES.map((name, index) => [
      name, { value: VALUES[index], timestamp: OBSERVED, source: 'l1' },
    ])) };
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } });
    requestMock.mockImplementation(async (path) => {
      if (path === '/vehicles') return [];
      if (path === '/signals/7/live') {
        if (failLive) throw new Error('Live snapshot failed');
        return live;
      }
      const match = /^\/signals\/7\/([^/]+)\/history\?hours=1$/.exec(path);
      if (match) {
        if (match[1] === failHistory) throw new Error('Signal trend failed');
        return history(match[1]);
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  it.each(PACKS)('%s preserves five SI-backed values, original sparklines and shared-header refresh', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    for (const value of ['64 %', '7.0 kW', '22.2°C', '23.0°C', '170.9 mi']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText('Live signal snapshot')).toBeInTheDocument();
    expect(screen.getByText('Each signal has its own observation time and freshness.')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /trend$/ })).toHaveLength(5);
    expect(signalRow('BatteryLevel').getByRole('img', { name: 'BatteryLevel trend' }).querySelector('polyline'))
      .toHaveAttribute('points', '0,20 36,10 72,0');
    expect(view.container.querySelector('[data-instrument-family="list"] .lucide-radio')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    expect(signalRow('BatteryLevel').getByText('Fresh observation')).toBeInTheDocument();
    expect(signalRow('BatteryLevel').getByText(OBSERVED.replace('Z', '.000Z'))).toBeInTheDocument();
    expect(signalRow('BatteryLevel').queryByRole('button')).not.toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: /^Refresh data/ });
    fireEvent.click(refresh);
    await waitFor(() => expect(requestMock.mock.calls.filter(([path]) => path === '/signals/7/live')).toHaveLength(2));
    await settled();
    expect(requestMock.mock.calls.filter(([path]) => path === '/signals/7/BatteryLevel/history?hours=1')).toHaveLength(2);
    expect(requestMock.mock.calls.filter(([path]) => path === '/signals/7/InsideTemp/history?hours=1')).toHaveLength(2);
  });

  it('switches all seven packs, compact/full and Classic without adding source requests', async () => {
    const view = render(tree('classic'));
    await screen.findByText('64 %');
    await settled();
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    for (const [pack, appearance] of PACKS) {
      view.rerender(tree(pack, pack === 'v1' ? 1 : 3));
      await presentation(view.container, appearance);
      expect(screen.getAllByRole('listitem')).toHaveLength(5);
    }
    view.rerender(tree('classic'));
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(screen.getByText('170.9 mi')).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(7);
    const headerRefresh = screen.getByRole('button', { name: /^Refresh data/ });
    fireEvent.click(headerRefresh);
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(13));
    await settled();
  });

  it('keeps irregular history spacing and explicit gaps without changing the Classic renderer', async () => {
    const view = render(tree('v7'));
    await presentation(view.container, 'pixel');
    const original = history('BatteryLevel');
    const samples = [
      [0, 0], [10, 10], [20, null], [90, 90], [100, 100],
    ] as const;
    await act(async () => {
      client.setQueryData(['signal-history', 7, 'BatteryLevel', 1], {
        ...original,
        data: samples.map(([seconds, value]) => ({
          ...original.data[0], ts: new Date(NOW - 100_000 + seconds * 1000).toISOString(), value,
        })),
      });
    });
    await waitFor(() => {
      const plot = signalRow('BatteryLevel').getByRole('img', { name: 'BatteryLevel trend' });
      expect([...plot.querySelectorAll('polyline[fill="none"]')].map(line => line.getAttribute('points')))
        .toEqual(['0,20 7.2,18', '64.8,2 72,0']);
    });
    view.rerender(tree('classic'));
    expect(signalRow('BatteryLevel').getByRole('img', { name: 'BatteryLevel trend' }).querySelectorAll('polyline[fill="none"]'))
      .toHaveLength(1);
    expect(requestMock).toHaveBeenCalledTimes(7);
  });

  it.each(PACKS)('%s keeps empty source rows visible with unknown readings and no invented trend', async (pack, appearance) => {
    live = { vehicle_id: 7, signals: {} };
    historiesEmpty = true;
    const view = render(tree(pack, 1));
    await presentation(view.container, appearance);
    expect(screen.getByText('No live signal data')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByText('Insufficient history')).toHaveLength(5);
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByRole('img', { name: /trend$/ })).not.toBeInTheDocument();
    for (const name of NAMES) {
      expect(signalRow(name).getByText('Unknown observation')).toBeInTheDocument();
    }
  });

  it('distinguishes real zero, stale observations, invalid values and timestamp-free legacy values', async () => {
    live = { signals: {
      BatteryLevel: { value: 0, timestamp: OBSERVED, source: 'l1' },
      ACChargingPower: { value: -7000, timestamp: '2026-11-07T01:00:00Z', source: 'stale' },
      InsideTemp: { value: Number.NaN, timestamp: OBSERVED },
      OutsideTemp: 23,
      RatedRange: { value: 275000, timestamp: 'not-an-instant' },
    } };
    const view = render(tree('v7'));
    await presentation(view.container, 'pixel');
    expect(signalRow('BatteryLevel').getByText('0 %')).toBeInTheDocument();
    expect(signalRow('BatteryLevel').getByText('Fresh observation')).toBeInTheDocument();
    expect(signalRow('ACChargingPower').getByText('-7.0 kW')).toBeInTheDocument();
    expect(signalRow('ACChargingPower').getByText('Stale observation')).toBeInTheDocument();
    expect(signalRow('InsideTemp').getByText('—')).toBeInTheDocument();
    for (const name of ['InsideTemp', 'OutsideTemp', 'RatedRange']) {
      expect(signalRow(name).getByText('Unknown observation')).toBeInTheDocument();
    }
  });

  it.each([['BatteryLevel', 101], ['RatedRange', -1]] as const)('does not present an invalid %s as a fresh measurement', async (name, value) => {
    live = { signals: { [name]: { value, timestamp: OBSERVED, source: 'l1' } } };
    const view = render(tree('v1'));
    await presentation(view.container, 'studio');
    expect(signalRow(name).getByText('—')).toBeInTheDocument();
    expect(signalRow(name).getByText('Unknown observation')).toBeInTheDocument();
  });

  it('retains all readings and trends on failed background refresh and retries the affected sources', async () => {
    const view = render(tree('v4'));
    await presentation(view.container, 'owner');
    failLive = true;
    failHistory = 'BatteryLevel';
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    await screen.findByText('Retained trend');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('64 %')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /trend$/ })).toHaveLength(5);
    failLive = false;
    failHistory = null;
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    await waitFor(() => expect(screen.queryByText('Retained trend')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
  });

  it('preserves independent histories when the initial live snapshot fails', async () => {
    failLive = true;
    const view = render(tree('v3'));
    await presentation(view.container, 'precision');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByRole('img', { name: /trend$/ })).toHaveLength(5);
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByText('No live signal data')).toBeInTheDocument();
    expect(screen.queryByText('64 %')).not.toBeInTheDocument();
  });

  it('shows a per-signal initial history error without erasing the other four trends', async () => {
    failHistory = 'BatteryLevel';
    const view = render(tree('v2'));
    await presentation(view.container, 'elevated');
    expect(screen.getByText('Trend unavailable')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /trend$/ })).toHaveLength(4);
    expect(screen.getByText('64 %')).toBeInTheDocument();
    failHistory = null;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ })); });
    await screen.findByRole('img', { name: 'BatteryLevel trend' });
  });
});
