import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { VehicleLiveSignal, VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import type { WidgetProps, WidgetSize } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))
        : key,
    i18n: { language: 'en', resolvedLanguage: 'en', dir: () => 'ltr' },
  }),
}));
vi.mock('@/api/client', () => ({ request: vi.fn() }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | number | Date) => new Date(value).toISOString(),
    formatTime: () => '12:00 AM',
  }),
}));

import { request } from '@/api/client';
import ChargeReadinessWidget from './ChargeReadinessWidget';
import { PackBoundary } from './designPacks/PackBoundary';

const packs = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const full: WidgetSize = { cols: 2, rows: 2 };
const compact: WidgetSize = { cols: 1, rows: 1 };
const clients: QueryClient[] = [];
const requestMock = vi.mocked(request);
const loadLive = vi.fn<(id: number) => Promise<VehicleLiveSignalsResponse>>();
const loadVehicles = vi.fn<() => Promise<Array<{ id: number }>>>();

function envelope(value: unknown, age = 1_000): VehicleLiveSignal {
  return {
    value, kind: typeof value === 'boolean' ? 'ValueKindBool' : 'ValueKindEnum',
    ts: new Date(Date.now() - age).toISOString(), source: 'l1', age_ms: age,
  };
}

function snapshot(overrides: Record<string, VehicleLiveSignal | undefined> = {}, id = 7): VehicleLiveSignalsResponse {
  const signals: Record<string, VehicleLiveSignal | undefined> = {
    ChargeState: envelope('Stopped'), DetailedChargeState: envelope('Stopped'),
    ChargePort: envelope('CCS'), ChargePortDoorOpen: envelope(false),
    ChargePortLatch: envelope('Disengaged'), ChargingCableType: envelope('IEC'),
    ScheduledChargingPending: envelope(true), ChargeEnableRequest: envelope(false),
    ...overrides,
  };
  return { vehicle_id: id, count: Object.keys(signals).length, at: new Date().toISOString(), signals };
}

function renderWidget(pack: unknown, size = full, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const tree = (requestedPackId: unknown, nextProps = props) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <ChargeReadinessWidget vehicleId={7} size={size} {...nextProps} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(pack));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)),
    selectVehicle: (vehicleId: number) => view.rerender(tree(pack, { ...props, vehicleId })) };
}

async function expectPack(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="status"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
}

function signalRow(name: string) {
  const row = screen.getByText(name, { exact: true }).closest('dt')?.parentElement;
  if (!row) throw new Error(`Missing evidence row: ${name}`);
  return within(row);
}

function checklistRow(label: string) {
  const row = screen.getAllByRole('listitem').find(item => within(item).queryByText(label, { exact: true }));
  if (!row) throw new Error(`Missing checklist row: ${label}`);
  return within(row);
}

function summary() {
  const node = screen.getByText('Charge readiness').parentElement;
  if (!node) throw new Error('Missing readiness summary');
  return within(node);
}

beforeEach(() => {
  requestMock.mockReset();
  loadLive.mockReset().mockImplementation(async id => snapshot({}, id));
  loadVehicles.mockReset().mockResolvedValue([{ id: 7 }]);
  requestMock.mockImplementation(async path => {
    if (path === '/vehicles') return loadVehicles();
    const live = /^\/signals\/(\d+)\/live$/.exec(path);
    if (live) return loadLive(Number(live[1]));
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe('ChargeReadinessWidget real production presentations', () => {
  it.each(packs)('%s preserves each independently reported state, timestamps and read-only meaning', async (pack, appearance) => {
    const { container } = renderWidget(pack);
    await expectPack(container, appearance);
    expect(await screen.findByText('Not charging')).toBeInTheDocument();
    expect(checklistRow('Port').getByText('Closed')).toBeInTheDocument();
    expect(checklistRow('Latch').getByText('Released')).toBeInTheDocument();
    expect(checklistRow('Cable').getByText('IEC')).toBeInTheDocument();
    expect(checklistRow('Schedule').getByText('Pending')).toBeInTheDocument();
    expect(signalRow('ChargePort').getByText('CCS')).toBeInTheDocument();
    expect(signalRow('ChargeEnableRequest').getByText('Not requested')).toBeInTheDocument();
    expect(signalRow('DetailedChargeState').getByText('Stopped')).toBeInTheDocument();
    expect(signalRow('ChargePortDoorOpen').getByText(/Recent observation · \d{4}-/)).toBeInTheDocument();
    expect(screen.getByText('Available power').closest('dt')?.parentElement).toHaveTextContent('Unknown');
    expect(screen.getByText(/Cable type does not confirm connection/)).toBeInTheDocument();
    expect(screen.getByText(/does not operate the charge port/)).toBeInTheDocument();
    expect(container.querySelector('[role="meter"]')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-plug-zap')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open port|start charging|enable charging/i })).not.toBeInTheDocument();
    expect(loadLive).toHaveBeenCalledTimes(1);
    expect(loadLive).toHaveBeenCalledWith(7);
    expect(requestMock.mock.calls.find(([path]) => path === '/signals/7/live')?.[1]?.signal).toBeDefined();
  });

  it.each(packs)('%s keeps all compact evidence accessible through the shared disclosure', async (pack, appearance) => {
    const { container } = renderWidget(pack, compact);
    await expectPack(container, appearance);
    expect(await screen.findByText('Not charging')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    const disclosure = screen.getByRole('button', { name: 'Reported signal evidence' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(signalRow('ChargeState').getByText('Stopped')).toBeInTheDocument();
    expect(signalRow('ChargePort').getByText('CCS')).toBeInTheDocument();
    expect(signalRow('ChargeEnableRequest').getByText('Not requested')).toBeInTheDocument();
    expect(screen.getByText('Available power')).toBeInTheDocument();
    expect(loadLive).toHaveBeenCalledTimes(1);
  });

  it('switches every pack and recovers Classic without remounting its data controller', async () => {
    const { container, selectPack } = renderWidget('classic');
    expect(await screen.findByText('Not charging')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    for (const [pack, appearance] of packs) {
      selectPack(pack);
      await expectPack(container, appearance);
      expect(signalRow('ChargePort').getByText('CCS')).toBeInTheDocument();
      expect(checklistRow('Port').getByText('Closed')).toBeInTheDocument();
    }
    for (const pack of ['classic', 'retired-pack', null]) {
      selectPack(pack);
      expect(container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
      expect(summary().getByText('Not charging')).toBeInTheDocument();
      expect(signalRow('ChargingCableType').getByText('IEC')).toBeInTheDocument();
    }
    expect(loadLive).toHaveBeenCalledTimes(1);
  });

  it.each(packs)('%s keeps unknown source shells instead of inventing readiness or available power', async (pack, appearance) => {
    loadLive.mockResolvedValue({ vehicle_id: 7, signals: {}, count: 0 });
    const { container } = renderWidget(pack);
    await expectPack(container, appearance);
    expect(await screen.findByText('No charge-readiness signals have been observed for this vehicle.')).toBeInTheDocument();
    expect(summary().getByText('Unknown')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(signalRow('ChargePortDoorOpen').getByText('Not observed')).toBeInTheDocument();
    expect(signalRow('ChargePort').getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Available power')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="unavailable"]')).toBeInTheDocument();
    expect(screen.queryByText('Not charging')).not.toBeInTheDocument();
  });

  it('refreshes real evidence once, retains it on failure, and recovers without issuing commands', async () => {
    const { container } = renderWidget('v4');
    await expectPack(container, 'owner');
    expect(await screen.findByText('Not charging')).toBeInTheDocument();
    loadLive.mockRejectedValueOnce(new Error('Synthetic refresh failure'));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument());
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
    expect(checklistRow('Port').getByText('Closed')).toBeInTheDocument();
    expect(signalRow('ChargePort').getByText('CCS')).toBeInTheDocument();
    expect(signalRow('ChargePort').getByText(/Retained observation/)).toBeInTheDocument();
    expect(summary().getByText('Unknown')).toBeInTheDocument();
    loadLive.mockResolvedValue(snapshot({ ChargeState: envelope('Charging'), DetailedChargeState: envelope('Charging') }));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(summary().getByText('Charging')).toBeInTheDocument());
    expect(loadLive).toHaveBeenCalledTimes(3);
    expect(requestMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });

  it('keeps checklist and evidence sections present through first loading and initial failure', async () => {
    let rejectLoad: (error: Error) => void = () => undefined;
    loadLive.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLoad = reject; }));
    const { container } = renderWidget('v3');
    await expectPack(container, 'precision');
    expect(screen.getAllByText('Loading charge signals…').length).toBeGreaterThan(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    rejectLoad(new Error('Synthetic initial failure'));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="initialFailure"]')).toBeInTheDocument();
    expect(signalRow('ChargeState').getByText('Not observed')).toBeInTheDocument();
    expect(screen.getByText('Available power')).toBeInTheDocument();
    expect(summary().getByText('Unknown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Not charging')).toBeInTheDocument();
  });

  it('disables duplicate refreshes while keeping the observed checklist visible in flight', async () => {
    const { container } = renderWidget('v1');
    await expectPack(container, 'studio');
    expect(await screen.findByText('Not charging')).toBeInTheDocument();
    let finishRefresh: (value: VehicleLiveSignalsResponse) => void = () => undefined;
    loadLive.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Refresh data/i })).toBeDisabled());
    expect(checklistRow('Port').getByText('Closed')).toBeInTheDocument();
    expect(signalRow('ChargePort').getByText('CCS')).toBeInTheDocument();
    expect(loadLive).toHaveBeenCalledTimes(2);
    finishRefresh(snapshot());
    await waitFor(() => expect(screen.getByRole('button', { name: /^Refresh data/i })).toBeEnabled());
  });

  it('preserves reported false values without implying disabled configuration or cable connection', async () => {
    loadLive.mockResolvedValue(snapshot({
      ScheduledChargingPending: envelope(false), ChargingCableType: envelope('SNA'),
    }));
    const { container } = renderWidget('v7');
    await expectPack(container, 'pixel');
    expect(await screen.findByText('Not charging')).toBeInTheDocument();
    expect(checklistRow('Port').getByText('Closed')).toBeInTheDocument();
    expect(checklistRow('Schedule').getByText('Not pending')).toBeInTheDocument();
    expect(signalRow('ChargeEnableRequest').getByText('Not requested')).toBeInTheDocument();
    expect(checklistRow('Cable').getByText('Unknown')).toBeInTheDocument();
    expect(signalRow('ChargingCableType').getByText(/Reported: SNA/)).toBeInTheDocument();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
  });

  it.each(['', 'invalid', new Date(Date.now() - 300_000).toISOString(), new Date(Date.now() + 300_000).toISOString()])(
    'does not refresh old or unknown observation time %s merely because a poll succeeded',
    async ts => {
      loadLive.mockResolvedValue(snapshot({
        ChargeState: { ...envelope('Charging'), ts },
        DetailedChargeState: { ...envelope('Charging'), ts },
      }));
      const { container } = renderWidget('v2');
      await expectPack(container, 'elevated');
      await waitFor(() => expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument());
      expect(summary().getByText('Unknown')).toBeInTheDocument();
      expect(signalRow('ChargeState').getByText('Charging')).toBeInTheDocument();
      expect(screen.queryByText('Not charging')).not.toBeInTheDocument();
    },
  );

  it('shows contradictory fresh charge states separately without choosing a successful interpretation', async () => {
    loadLive.mockResolvedValue(snapshot({ ChargeState: envelope('Charging') }));
    const { container } = renderWidget('v5');
    await expectPack(container, 'iconic');
    expect(await screen.findByText('Reported charge states differ; review each source.')).toBeInTheDocument();
    expect(summary().getByText('Unknown')).toBeInTheDocument();
    expect(signalRow('ChargeState').getByText('Charging')).toBeInTheDocument();
    expect(signalRow('DetailedChargeState').getByText('Stopped')).toBeInTheDocument();
  });

  it.each([{ source: 'stale' }, { age_ms: 300_000 }])(
    'honors server freshness evidence %s even with recent timestamps',
    async evidence => {
      loadLive.mockResolvedValue(snapshot({
        ChargeState: { ...envelope('Charging'), ...evidence },
        DetailedChargeState: { ...envelope('Charging'), ...evidence },
      }));
      const { container } = renderWidget('v6');
      await expectPack(container, 'expressive');
      await waitFor(() => expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument());
      expect(summary().getByText('Unknown')).toBeInTheDocument();
      expect(signalRow('DetailedChargeState').getByText(/Stale observation/)).toBeInTheDocument();
    },
  );

  it('rejects malformed, numeric and unrecognized evidence instead of treating it as closed or ready', async () => {
    loadLive.mockResolvedValue(snapshot({
      ChargePortDoorOpen: { ...envelope(false), value: 'false' },
      ChargePortLatch: envelope(0), ChargePort: envelope('UnexpectedConnector'),
      ChargeState: envelope('Unknown'), DetailedChargeState: envelope(null),
    }));
    const { container } = renderWidget('v6');
    await expectPack(container, 'expressive');
    await waitFor(() => expect(container.querySelector('[data-data-state="partial"]')).toBeInTheDocument());
    expect(checklistRow('Port').getByText('Unknown')).toBeInTheDocument();
    expect(checklistRow('Latch').getByText('Unknown')).toBeInTheDocument();
    expect(signalRow('ChargePort').getByText(/Reported: UnexpectedConnector/)).toBeInTheDocument();
    expect(summary().getByText('Unknown')).toBeInTheDocument();
  });

  it('does not request signals without a valid target or claim that a catalog proves support', async () => {
    loadVehicles.mockResolvedValue([]);
    renderWidget('v1', full, { vehicleId: undefined });
    expect(await screen.findByText('Select a vehicle to inspect charge readiness.')).toBeInTheDocument();
    expect(loadLive).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(summary().getByText('Unknown')).toBeInTheDocument();
  });

  it('honors configured vehicle scope and discards another vehicle’s evidence during a change', async () => {
    const { container, selectVehicle } = renderWidget('v3', full, { vehicleId: undefined, config: { vehicleId: 9 } });
    await expectPack(container, 'precision');
    expect(await screen.findByText('Not charging')).toBeInTheDocument();
    expect(loadLive).toHaveBeenCalledWith(9);
    loadLive.mockImplementationOnce(() => new Promise(() => undefined));
    selectVehicle(11);
    expect(screen.queryByText('Not charging')).not.toBeInTheDocument();
    expect(screen.queryByText('CCS')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    await waitFor(() => expect(loadLive).toHaveBeenCalledWith(11));
  });
});
