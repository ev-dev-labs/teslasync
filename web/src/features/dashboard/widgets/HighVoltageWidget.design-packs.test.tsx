import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetProps } from './types';
import HighVoltageWidget from './HighVoltageWidget';

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
vi.mock('@/hooks/useDateFormat', () => {
  const iso = (value: string | number | Date) => (value instanceof Date ? value : new Date(value)).toISOString();
  return { useDateFormat: () => ({ formatDateTime: iso, formatTime: iso }) };
});

const NOW = Date.parse('2026-11-07T02:00:00Z');
const OBSERVED = '2026-11-07T01:59:55Z';
const PACKS = PACK_IDS.filter((pack): pack is Exclude<PackId, 'classic'> => pack !== 'classic')
  .map(pack => [pack, PACK_APPEARANCES[pack]] as const);
const VALUES = {
  PackVoltage: 384, PackCurrent: -12, IsolationResistance: 1_200_000,
  Hvil: 'OK', BMSState: 'Charge', DCDCEnable: true,
};
let live: VehicleLiveSignalsResponse;
let fail: boolean;
let client: QueryClient;

function sample(value: unknown, kind: string, extra: Record<string, unknown> = {}) {
  return { kind, value, ts: OBSERVED, source: 'l1', age_ms: 5_000, ...extra };
}

function tree(pack: PackId, props: Partial<WidgetProps> = {}) {
  return <QueryClientProvider client={client}><PackBoundary requestedPackId={pack}>
    <HighVoltageWidget vehicleId={7} size={{ cols: 2, rows: 4 }} {...props} />
  </PackBoundary></QueryClientProvider>;
}

async function settled() {
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="pack-map"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
  await settled();
}

function row(name: keyof typeof VALUES) {
  const element = screen.getByText(name).closest('li');
  if (!element) throw new Error(`Missing evidence row: ${name}`);
  return within(element);
}

function expectSections() {
  expect(screen.getAllByRole('listitem')).toHaveLength(6);
  expect(screen.getByRole('img', { name: 'High-voltage pack schematic' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Reported signals & source evidence' })).toBeInTheDocument();
  const configuration = screen.getByRole('region', { name: 'Configuration & capability evidence' });
  expect(within(configuration).getByText('Desired subscription')).toBeInTheDocument();
  expect(within(configuration).getByText('Applied to vehicle')).toBeInTheDocument();
  expect(within(configuration).getByText('Vehicle support')).toBeInTheDocument();
  expect(within(configuration).getAllByText('Unknown')).toHaveLength(3);
  expect(screen.getByText(/not an inspection, alarm, or proof of electrical safety/)).toBeInTheDocument();
  expect(screen.getByText(/not cell readings or the vehicle’s module layout/)).toBeInTheDocument();
  expect(screen.getByText('Signed current is shown as reported; direction is not inferred.')).toBeInTheDocument();
  expect(screen.getByText(/Isolation resistance and HV interlock have no established signal-log history/)).toBeInTheDocument();
  expect(screen.getByText(/Server intent and routing are not vehicle configuration, support, or delivery receipts/)).toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
}

describe('HighVoltageWidget design packs', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    requestMock.mockReset();
    fail = false;
    live = { vehicle_id: 7, count: 6, at: new Date(NOW).toISOString(),
      signals: Object.fromEntries(Object.entries(VALUES).map(([name, value]) => [
        name, sample(value, typeof value === 'boolean' ? 'ValueKindBool'
          : typeof value === 'string' ? 'ValueKindEnum' : 'ValueKindFloat'),
      ])) };
    client = new QueryClient({ defaultOptions: { queries: {
      retry: false, gcTime: Infinity, refetchOnWindowFocus: false,
    } } });
    requestMock.mockImplementation(async (path) => {
      if (path !== '/signals/7/live' && path !== '/signals/9/live') throw new Error(`Unexpected request: ${path}`);
      if (fail) throw new Error('High-voltage source unavailable');
      return live;
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  it.each(PACKS)('%s preserves real readings, source evidence and the refresh action', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectSections();
    expect(row('PackVoltage').getByText(/^384(?:\.0+)? V$/)).toBeInTheDocument();
    expect(row('PackCurrent').getByText(/^-12(?:\.0+)? A$/)).toBeInTheDocument();
    expect(row('IsolationResistance').getByText(/^1,200,000(?:\.0+)? Ω$/)).toBeInTheDocument();
    expect(row('Hvil').getByText('OK')).toBeInTheDocument();
    expect(row('BMSState').getByText('Charge')).toBeInTheDocument();
    expect(row('DCDCEnable').getByText('Yes')).toBeInTheDocument();
    for (const name of Object.keys(VALUES) as Array<keyof typeof VALUES>) {
      expect(row(name).getByText('Fresh observation')).toBeInTheDocument();
      expect(row(name).getByText(new Date(OBSERVED).toISOString())).toHaveAttribute('datetime', OBSERVED);
      expect(row(name).getByText('Source: l1')).toBeInTheDocument();
    }
    expect(view.container.querySelector('[data-instrument-family="pack-map"] .lucide-battery')).toBeInTheDocument();
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh high-voltage signals' }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await settled();
    expect(requestMock.mock.calls.every(([path]) => path === '/signals/7/live')).toBe(true);
  });

  it('switches Classic and every compact/full appearance without another data controller', async () => {
    const view = render(tree('classic'));
    await screen.findAllByText('Fresh observation');
    await settled();
    expectSections();
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    for (const [pack, appearance] of PACKS) {
      for (const cols of [1, 3]) {
        view.rerender(tree(pack, { size: { cols, rows: 4 } }));
        await presentation(view.container, appearance);
        expectSections();
        expect(row('PackCurrent').getByText(/^-12(?:\.0+)? A$/)).toBeInTheDocument();
      }
    }
    view.rerender(tree('classic', { size: { cols: 1, rows: 4 } }));
    expectSections();
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each(PACKS)('%s keeps all sections for an empty vehicle response without inventing success', async (pack, appearance) => {
    live = { vehicle_id: 7, count: 0, signals: {} };
    const view = render(tree(pack, { size: { cols: 1, rows: 4 } }));
    await presentation(view.container, appearance);
    expectSections();
    expect(screen.getByText('No valid timestamped high-voltage observations for this vehicle.')).toBeInTheDocument();
    expect(screen.getAllByText('No valid reading')).toHaveLength(6);
    expect(screen.getAllByText('Observation time unknown')).toHaveLength(6);
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    expect(row('PackVoltage').queryByText(/^0(?:\.0+)? V$/)).not.toBeInTheDocument();
    expect(row('Hvil').queryByText('OK')).not.toBeInTheDocument();
  });

  it.each(PACKS)('%s preserves measured zero and false while rejecting nonfinite, negative and fabricated enum readings', async (pack, appearance) => {
    live.signals = {
      PackVoltage: sample(0, 'ValueKindFloat'), PackCurrent: sample(Number.NaN, 'ValueKindFloat'),
      IsolationResistance: sample(-1, 'ValueKindFloat'), Hvil: sample('Closed', 'ValueKindEnum'),
      BMSState: sample('Available', 'ValueKindEnum'), DCDCEnable: sample(false, 'ValueKindBool'),
    };
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectSections();
    expect(row('PackVoltage').getByText(/^0(?:\.0+)? V$/)).toBeInTheDocument();
    expect(row('PackVoltage').getByText('Fresh observation')).toBeInTheDocument();
    expect(row('DCDCEnable').getByText('No')).toBeInTheDocument();
    expect(row('DCDCEnable').getByText('Fresh observation')).toBeInTheDocument();
    for (const name of ['PackCurrent', 'IsolationResistance', 'Hvil', 'BMSState'] as const) {
      expect(row(name).getByText('Unknown')).toBeInTheDocument();
      expect(row(name).getByText('No valid reading')).toBeInTheDocument();
    }
    expect(screen.queryByText(/NaN|Infinity|Healthy|Safe/)).not.toBeInTheDocument();
  });

  it.each(PACKS)('%s does not equate missing, future, stale, malformed-age or unclassified evidence with fresh data', async (pack, appearance) => {
    live.signals = {
      PackVoltage: sample(384, 'ValueKindFloat', { ts: '' }),
      PackCurrent: sample(-12, 'ValueKindFloat', { ts: '2026-11-07T01:00:00Z', source: 'stale' }),
      IsolationResistance: sample(1_200_000, 'ValueKindFloat', { age_ms: -1 }),
      Hvil: sample('OK', 'ValueKindEnum', { ts: '2026-11-07T02:01:00Z' }),
      BMSState: sample('Drive', 'ValueKindEnum', { source: 'unknown' }),
      DCDCEnable: true,
    };
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectSections();
    expect(row('PackVoltage').getByText('Observation time unknown')).toBeInTheDocument();
    expect(row('PackVoltage').getByText('Freshness unknown')).toBeInTheDocument();
    expect(row('Hvil').getByText('Observation time unknown')).toBeInTheDocument();
    expect(row('PackCurrent').getByText('Stale observation')).toBeInTheDocument();
    expect(row('PackCurrent').getByText(/^-12(?:\.0+)? A$/)).toBeInTheDocument();
    expect(row('IsolationResistance').getByText('Freshness unknown')).toBeInTheDocument();
    expect(row('BMSState').getByText('Freshness unknown')).toBeInTheDocument();
    expect(row('DCDCEnable').getByText('No valid reading')).toBeInTheDocument();
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('—');
  });

  it.each(PACKS)('%s retains observations on refresh failure and recovers using the same real action', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh high-voltage signals' }));
    await screen.findByTestId('stale-refresh-warning');
    expectSections();
    expect(row('PackCurrent').getByText(/^-12(?:\.0+)? A$/)).toBeInTheDocument();
    expect(screen.getAllByText('Retained observation')).toHaveLength(6);
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh high-voltage signals' }));
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    await settled();
    expect(screen.getAllByText('Fresh observation')).toHaveLength(6);
  });

  it.each(PACKS)('%s preserves the source shells during first failure and retries the failed source', async (pack, appearance) => {
    fail = true;
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectSections();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getAllByText('Fresh observation')).toHaveLength(6));
    await settled();
  });

  it.each(PACKS)('%s keeps source-shaped loading rows and disables duplicate refresh while in flight', async (pack, appearance) => {
    let resolve: ((response: VehicleLiveSignalsResponse) => void) | undefined;
    requestMock.mockImplementationOnce(() => new Promise<VehicleLiveSignalsResponse>(done => { resolve = done; }));
    const view = render(tree(pack));
    await waitFor(() => expect(view.container.querySelector('[data-widget-family="pack-map"]'))
      .toHaveAttribute('data-widget-appearance', appearance));
    expectSections();
    expect(screen.getByRole('button', { name: 'Refresh high-voltage signals' })).toBeDisabled();
    expect(view.container.querySelector(`[data-widget-pack="${pack}"]`)).toHaveAttribute('aria-busy', 'true');
    expect(row('PackCurrent').queryByText(/^-12(?:\.0+)? A$/)).not.toBeInTheDocument();
    await act(async () => { resolve?.(live); });
    await waitFor(() => expect(screen.getAllByText('Fresh observation')).toHaveLength(6));
    expect(screen.getByRole('button', { name: 'Refresh high-voltage signals' })).toBeEnabled();
    await settled();
  });

  it.each(PACKS)('%s does not choose another vehicle and uses the widget configuration when no vehicle prop exists', async (pack, appearance) => {
    const view = render(tree(pack, { vehicleId: undefined }));
    await presentation(view.container, appearance);
    expectSections();
    expect(screen.getByText('Select a vehicle to inspect high-voltage telemetry.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh high-voltage signals' })).toBeDisabled();
    expect(requestMock).not.toHaveBeenCalled();
    live = { ...live, vehicle_id: 9 };
    view.rerender(tree(pack, { vehicleId: undefined, config: { vehicleId: 9 } }));
    await waitFor(() => expect(screen.getAllByText('Fresh observation')).toHaveLength(6));
    expect(requestMock).toHaveBeenCalledWith('/signals/9/live', expect.anything());
    await settled();
  });

  it.each(PACKS)('%s does not display another vehicle’s response', async (pack, appearance) => {
    live = { ...live, vehicle_id: 9 };
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectSections();
    expect(screen.getByText('No valid timestamped high-voltage observations for this vehicle.')).toBeInTheDocument();
    expect(screen.getAllByText('Observation time unknown')).toHaveLength(6);
    expect(row('PackVoltage').queryByText(/^384(?:\.0+)? V$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
  });

  it.each(PACKS)('%s does not use snapshot assembly time as an observation or coerce a malformed typed number', async (pack, appearance) => {
    live.signals = {
      PackVoltage: sample(384, 'ValueKindFloat', { ts: '' }),
      PackCurrent: sample('0', 'ValueKindFloat'), IsolationResistance: sample(Number.POSITIVE_INFINITY, 'ValueKindFloat'),
    };
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectSections();
    expect(row('PackVoltage').getByText('Observation time unknown')).toBeInTheDocument();
    expect(row('PackVoltage').getByText('Freshness unknown')).toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('—');
    expect(row('PackCurrent').getByText('No valid reading')).toBeInTheDocument();
    expect(row('IsolationResistance').getByText('No valid reading')).toBeInTheDocument();
    expect(row('PackCurrent').queryByText(/^0(?:\.0+)? A$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
  });
});
