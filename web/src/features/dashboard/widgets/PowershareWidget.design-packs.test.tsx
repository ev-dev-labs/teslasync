import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import { PackBoundary } from './designPacks/PackBoundary';
import type { PackId } from './designPacks/types';
import PowershareWidget from './PowershareWidget';

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
const PACKS = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const VALUES = {
  PowershareStatus: 'Enabled', PowershareInstantaneousPowerKW: -3.25,
  PowershareHoursLeft: 2.5, PowershareStopReason: 'SOCTooLow',
  PowershareType: 'Home', PowerTransferStatus: 'ChargeEnabled',
};
let live: VehicleLiveSignalsResponse;
let fail: boolean;
let client: QueryClient;

function tree(pack: PackId, cols = 2, vehicleId: number | undefined = 7) {
  return (
    <QueryClientProvider client={client}>
      <PackBoundary requestedPackId={pack}>
        <PowershareWidget vehicleId={vehicleId} size={{ cols, rows: 4 }} />
      </PackBoundary>
    </QueryClientProvider>
  );
}

async function settled() {
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="flow"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
  await settled();
}

function evidenceRow(name: string) {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`Missing signal evidence: ${name}`);
  return within(row);
}

describe('PowershareWidget design packs', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    requestMock.mockReset();
    fail = false;
    live = { vehicle_id: 7, signals: Object.fromEntries(Object.entries(VALUES).map(([name, value]) => [
      name, { value, ts: OBSERVED, source: 'l1', age_ms: 10_000 },
    ])) };
    client = new QueryClient({ defaultOptions: { queries: {
      retry: false, gcTime: Infinity, refetchOnWindowFocus: false,
    } } });
    requestMock.mockImplementation(async (path) => {
      if (path === '/signals/7/live' || path === '/signals/9/live') {
        if (fail) throw new Error('Powershare snapshot failed');
        return live;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  it.each(PACKS)('%s retains all six real observations and refresh without inventing SI units or capability', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    for (const [name, value] of Object.entries(VALUES)) {
      const row = evidenceRow(name);
      expect(row.getByText(String(value))).toBeInTheDocument();
      expect(row.getByText(new Date(OBSERVED).toISOString())).toBeInTheDocument();
      expect(row.getByText('Fresh observation')).toBeInTheDocument();
      expect(row.queryByRole('button')).not.toBeInTheDocument();
    }
    for (const label of ['Power transfer', 'Remaining', 'Last reported status', 'Stop reason', 'Transfer type', 'Power transfer status', 'Vehicle support']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('img', { name: /Vehicle to output/ })).toBeInTheDocument();
    expect(view.container.querySelector('[data-instrument-family="flow"] .lucide-plug-zap')).toBeInTheDocument();
    expect(view.container.querySelector('.flow-active')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/(?:^|\s)kW\b|2\.5 h|Supported/)).not.toBeInTheDocument();
    expect(screen.getByText(/Power and remaining-time units are not verified/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await settled();
    expect(requestMock.mock.calls.every(([path]) => path === '/signals/7/live')).toBe(true);
  });

  it('switches Classic, seven packs and compact/full using a single data controller', async () => {
    const view = render(tree('classic'));
    await screen.findByText('Signal evidence');
    await settled();
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    for (const [pack, appearance] of PACKS) {
      view.rerender(tree(pack, pack === 'v1' ? 1 : 3));
      await presentation(view.container, appearance);
      expect(screen.getAllByRole('listitem')).toHaveLength(6);
      expect(evidenceRow('PowershareInstantaneousPowerKW').getByText('-3.25')).toBeInTheDocument();
    }
    view.rerender(tree('classic', 1));
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each(PACKS)('%s preserves every section for empty vehicle evidence without inferring unsupported or inactive', async (pack, appearance) => {
    live = { vehicle_id: 7, signals: {} };
    const view = render(tree(pack, 1));
    await presentation(view.container, appearance);
    expect(screen.getByText('No timestamped Powershare observations for this vehicle.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getAllByText(/^Observation time unknown \/ /)).toHaveLength(6);
    expect(screen.getByText('Vehicle support')).toBeInTheDocument();
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
    expect(screen.queryByText(/not supported/i)).not.toBeInTheDocument();
    expect(view.container.querySelector('.flow-active')).not.toBeInTheDocument();
  });

  it('distinguishes real raw zero, stale values, invalid numbers and timestamp-free legacy state', async () => {
    live = { signals: {
      PowershareStatus: 'Enabled',
      PowershareInstantaneousPowerKW: { value: 0, timestamp: OBSERVED, source: 'l1' },
      PowershareHoursLeft: { value: Number.NaN, timestamp: OBSERVED, source: 'l1' },
      PowershareStopReason: { value: 'Fault', timestamp: '2026-11-07T01:00:00Z', source: 'stale' },
      PowershareType: { value: 'Home', timestamp: '2026-11-07T02:01:00Z', source: 'l1' },
      PowerTransferStatus: { value: 'InventedState', timestamp: OBSERVED, source: 'l1' },
    } };
    const view = render(tree('v7'));
    await presentation(view.container, 'pixel');
    expect(evidenceRow('PowershareInstantaneousPowerKW').getByText('0')).toBeInTheDocument();
    expect(evidenceRow('PowershareInstantaneousPowerKW').getByText('Fresh observation')).toBeInTheDocument();
    expect(evidenceRow('PowershareStopReason').getByText('Stale observation')).toBeInTheDocument();
    expect(evidenceRow('PowershareHoursLeft').getByText('—')).toBeInTheDocument();
    for (const name of ['PowershareStatus', 'PowershareHoursLeft', 'PowershareType', 'PowerTransferStatus']) {
      expect(evidenceRow(name).getByText('Unknown observation')).toBeInTheDocument();
    }
    expect(view.container.querySelector('.flow-active')).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.0 kW/)).not.toBeInTheDocument();
  });

  it('retains the last observations on refresh failure and recovers through the existing refresh action', async () => {
    const view = render(tree('v4'));
    await presentation(view.container, 'owner');
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    await screen.findByTestId('stale-refresh-warning');
    expect(evidenceRow('PowershareInstantaneousPowerKW').getByText('-3.25')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    await settled();
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the instrument, overview and evidence shells when the initial source fails', async () => {
    fail = true;
    const view = render(tree('v3'));
    await presentation(view.container, 'precision');
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Vehicle to output/ })).toBeInTheDocument();
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
  });

  it('keeps source-shaped loading rows and all overview sections until the first response', async () => {
    let resolve: ((response: VehicleLiveSignalsResponse) => void) | undefined;
    requestMock.mockImplementationOnce(() => new Promise<VehicleLiveSignalsResponse>((done) => { resolve = done; }));
    const view = render(tree('v2'));
    await waitFor(() => expect(view.container.querySelector('[data-widget-family="flow"]'))
      .toHaveAttribute('data-widget-appearance', 'elevated'));
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-pack="v2"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('-3.25')).not.toBeInTheDocument();
    await act(async () => { resolve?.(live); });
    await waitFor(() => expect(evidenceRow('PowershareInstantaneousPowerKW').getByText('-3.25')).toBeInTheDocument());
    await settled();
  });

  it('does not request a fallback vehicle and respects widget-specific vehicle configuration', async () => {
    const view = render(
      <QueryClientProvider client={client}><PackBoundary requestedPackId="v1">
        <PowershareWidget size={{ cols: 1, rows: 4 }} />
      </PackBoundary></QueryClientProvider>,
    );
    await presentation(view.container, 'studio');
    expect(screen.getByText('Select a vehicle to inspect Powershare telemetry.')).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
    live = { ...live, vehicle_id: 9 };
    view.rerender(
      <QueryClientProvider client={client}><PackBoundary requestedPackId="v1">
        <PowershareWidget config={{ vehicleId: 9 }} size={{ cols: 1, rows: 4 }} />
      </PackBoundary></QueryClientProvider>,
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('/signals/9/live', expect.anything()));
    await settled();
  });
});
