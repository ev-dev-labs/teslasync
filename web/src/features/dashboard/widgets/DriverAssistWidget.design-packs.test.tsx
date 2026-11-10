import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SignalHistoryPoint, SignalValue } from '@/api/types';
import type { VehicleLiveSignal, VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import type { SignalHistoryResponse } from '@/types/telemetry';
import type { WidgetConfig } from './types';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import { PackBoundary } from './designPacks/PackBoundary';
import DriverAssistWidget from './DriverAssistWidget';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(path: string) => Promise<unknown>>(),
}));
vi.mock('@/api/client', async importOriginal => ({
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
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-11-07T01:00:00Z',
    endInstantExclusive: '2026-11-07T02:00:00Z',
  }),
}));
vi.mock('@/hooks/useDateFormat', () => {
  const format = (value: string | number | Date | null | undefined) => {
    const date = value instanceof Date ? value : value == null ? null : new Date(value);
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : '—';
  };
  return { useDateFormat: () => ({ formatDateTime: format, formatTime: format }) };
});

const NOW = Date.parse('2026-11-07T02:00:00Z');
const OBSERVED = '2026-11-07T01:59:50Z';
const PACKS = PACK_IDS.filter((pack): pack is Exclude<PackId, 'classic'> => pack !== 'classic')
  .map(pack => [pack, PACK_APPEARANCES[pack]] as const);
const SETTINGS = 'Reported settings';
const HISTORY = 'Reported changes and samples';
const LABELS = [
  'Emergency braking', 'Lane departure', 'Blind-spot camera', 'Follow distance',
  'Blind-spot warning chime', 'Forward collision warning',
  'Emergency lane departure avoidance', 'Reported emergency braking state',
];
let client: QueryClient;
let live: VehicleLiveSignalsResponse;
let emptyHistory: boolean;
let failures: Set<string>;

function envelope(value: SignalValue, kind = 'ValueKindBool', overrides: Partial<VehicleLiveSignal> = {}): VehicleLiveSignal {
  return { kind, value, ts: OBSERVED, timestamp: OBSERVED, source: 'l1', age_ms: 10_000, ...overrides };
}

function history(name: string): SignalHistoryResponse {
  const values: SignalValue[] = name === 'CruiseFollowDistance' ? ['2', '3'] : [true, false, false, null, true];
  const data: SignalHistoryPoint[] = emptyHistory ? [] : values.map((value, index) => ({
    ts: new Date(NOW - (60 - index * 10) * 1000).toISOString(),
    kind: name === 'CruiseFollowDistance' ? 'ValueKindEnum' : 'ValueKindBool',
    value, ingest_origin: 'fleet_telemetry_mqtt', source_emitted_at: null,
    received_at: OBSERVED, normalization_version: 1,
  }));
  return { vehicleId: 7, signal: name, from: '2026-11-07T01:00:00Z', to: OBSERVED, count: data.length, data };
}

function tree(pack: PackId = 'v1', cols = 2, vehicleId: number | null = 7, config?: WidgetConfig) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={pack}>
          <DriverAssistWidget vehicleId={vehicleId ?? undefined} size={{ cols, rows: 5 }} config={config} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function settled() {
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="status"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
  await settled();
}

function settingRow(label: string) {
  const term = within(screen.getByRole('region', { name: SETTINGS })).getByText(label).closest('dt');
  if (!term?.parentElement) throw new Error(`Missing setting row: ${label}`);
  return within(term.parentElement);
}

function historyRequests(name: string, id = 7) {
  return requestMock.mock.calls.filter(([path]) => path.startsWith(`/signals/${id}/${name}/history?`));
}

describe('DriverAssistWidget design packs', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    requestMock.mockReset();
    failures = new Set();
    emptyHistory = false;
    live = { vehicle_id: 7, signals: {
      AutomaticEmergencyBrakingOff: envelope(false),
      LaneDepartureAvoidance: envelope('Assist', 'ValueKindEnum'),
      AutomaticBlindSpotCamera: envelope(false),
      CruiseFollowDistance: envelope('3', 'ValueKindEnum'),
      BlindSpotCollisionWarningChime: envelope(true),
      ForwardCollisionWarning: envelope('Early', 'ValueKindEnum'),
      EmergencyLaneDepartureAvoidance: envelope(false),
      AutomaticEmergencyBrakingState: envelope('Standby', 'ValueKindEnum'),
    } };
    client = new QueryClient({ defaultOptions: { queries: {
      retry: false, gcTime: Infinity, refetchOnWindowFocus: false,
    } } });
    requestMock.mockImplementation(async path => {
      if (failures.has(path.split('?')[0])) throw new Error('Driver-assistance source failed');
      if (path === '/vehicles') return [];
      if (/^\/signals\/\d+\/live$/.test(path)) return live;
      const match = /^\/signals\/\d+\/([^/]+)\/history\?/.exec(path);
      if (match?.[1]) return history(decodeURIComponent(match[1]));
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  it.each(PACKS)('%s preserves eight settings, all history samples, source metadata and selection/refresh in full and compact', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    const values = ['Enabled', 'Assist', 'Disabled', '3', 'Enabled', 'Early', 'Disabled', 'Standby'];
    LABELS.forEach((name, index) => {
      expect(settingRow(name).getByText(values[index])).toBeInTheDocument();
      expect(settingRow(name).getByText('Fresh observation')).toBeInTheDocument();
      expect(settingRow(name).getByText(`Observed: ${OBSERVED.replace('Z', '.000Z')} · Source: l1`)).toBeInTheDocument();
    });
    const timeline = screen.getByRole('list', { name: HISTORY });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(5);
    expect(within(timeline).getByText('Disabled → Enabled')).toBeInTheDocument();
    expect(within(timeline).queryByText('Enabled → Disabled')).not.toBeInTheDocument();
    expect(within(timeline).getByText('Reported: Unknown')).toBeInTheDocument();
    expect(within(timeline).getAllByText(/Origin: fleet_telemetry_mqtt/)).toHaveLength(5);
    expect(screen.getByText('Configuration and change history are not evidence of system activations.')).toBeInTheDocument();
    expect(screen.getByText(/Vehicle support and desired\/applied telemetry configuration are unknown/)).toBeInTheDocument();
    expect(view.container.querySelector('[data-instrument-family="status"] .lucide-shield')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    const request = new URL(historyRequests('AutomaticEmergencyBrakingOff')[0][0], 'https://test.invalid');
    expect(request.searchParams.get('from')).toBe('2026-11-07T01:00:00Z');
    expect(request.searchParams.get('to')).toBe('2026-11-07T01:59:59.999999Z');

    fireEvent.change(screen.getByRole('combobox', { name: 'History setting' }), { target: { value: 'CruiseFollowDistance' } });
    await screen.findByText('2 → 3');
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh driver-assistance evidence' }));
    await waitFor(() => expect(historyRequests('CruiseFollowDistance')).toHaveLength(2));
    await settled();
    expect(requestMock.mock.calls.filter(([path]) => path === '/signals/7/live')).toHaveLength(2);
    const count = requestMock.mock.calls.length;
    view.rerender(tree(pack, 1));
    await presentation(view.container, appearance);
    expect(screen.getByRole('combobox', { name: 'History setting' })).toHaveValue('CruiseFollowDistance');
    LABELS.forEach(name => expect(settingRow(name).getByText(name)).toBeInTheDocument());
    expect(within(screen.getByRole('list', { name: HISTORY })).getAllByRole('listitem')).toHaveLength(2);
    expect(requestMock).toHaveBeenCalledTimes(count);
  });

  it.each(PACKS)('%s retains all source shells and explicit unknown settings with no observations or history', async (pack, appearance) => {
    live = { signals: {} };
    emptyHistory = true;
    const view = render(tree(pack, 1));
    await presentation(view.container, appearance);
    LABELS.forEach(name => {
      expect(settingRow(name).getByText('Unknown')).toBeInTheDocument();
      expect(settingRow(name).getByText('Freshness unknown')).toBeInTheDocument();
    });
    expect(screen.getByRole('region', { name: HISTORY })).toBeInTheDocument();
    expect(screen.getByText('No recorded samples in the selected workspace range.')).toBeInTheDocument();
    expect(screen.getByText('No valid reported settings in this snapshot. Missing evidence does not mean disabled or unsupported.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: SETTINGS })).queryByText('Enabled')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'History setting' })).toBeEnabled();
  });

  it('keeps Classic and selection intact across all presentations without remounting data readers', async () => {
    const view = render(tree('classic', 1));
    await screen.findByText('Disabled → Enabled');
    await settled();
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'History setting' }), { target: { value: 'CruiseFollowDistance' } });
    await screen.findByText('2 → 3');
    await settled();
    const count = requestMock.mock.calls.length;
    for (const [pack, appearance] of PACKS) {
      view.rerender(tree(pack, pack === 'v1' ? 1 : 3));
      await presentation(view.container, appearance);
      expect(screen.getByRole('combobox', { name: 'History setting' })).toHaveValue('CruiseFollowDistance');
      expect(settingRow('Emergency braking').getByText('Enabled')).toBeInTheDocument();
      expect(screen.getByText('2 → 3')).toBeInTheDocument();
    }
    view.rerender(tree('classic', 3));
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(screen.getByText('2 → 3')).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(count);
  });

  describe.each(PACKS)('%s source states', (pack, appearance) => {
    it.each([
      ['explicit false', envelope(false), 'Enabled', 'Fresh observation'],
      ['explicit true', envelope(true), 'Disabled', 'Fresh observation'],
      ['stale timestamp', envelope(false, 'ValueKindBool', { ts: '2026-11-07T01:00:00Z' }), 'Enabled', 'Stale observation'],
      ['old source age', envelope(false, 'ValueKindBool', { age_ms: 180_000 }), 'Enabled', 'Stale observation'],
      ['historical fallback', envelope(false, 'ValueKindBool', { source: 'log' }), 'Enabled', 'Historical fallback'],
      ['unknown source', envelope(false, 'ValueKindBool', { source: 'unknown' }), 'Enabled', 'Freshness unknown'],
      ['future timestamp', envelope(false, 'ValueKindBool', { ts: '2026-11-08T02:00:00Z' }), 'Enabled', 'Freshness unknown'],
      ['invalid age', envelope(false, 'ValueKindBool', { age_ms: -1 }), 'Enabled', 'Freshness unknown'],
      ['wrong kind', envelope(false, 'ValueKindEnum'), 'Unknown', 'Freshness unknown'],
      ['wrong value', envelope('false'), 'Unknown', 'Freshness unknown'],
      ['legacy scalar', false, 'Unknown', 'Freshness unknown'],
      ['missing', null, 'Unknown', 'Freshness unknown'],
    ] as const)('does not turn %s evidence into unproved success or a zero', async (_name, value, expected, trust) => {
      live = { signals: { AutomaticEmergencyBrakingOff: value } };
      const view = render(tree(pack));
      await presentation(view.container, appearance);
      expect(settingRow('Emergency braking').getByText(expected)).toBeInTheDocument();
      expect(settingRow('Emergency braking').getByText(trust)).toBeInTheDocument();
      expect(settingRow('Reported emergency braking state').getByText('Unknown')).toBeInTheDocument();
    });

    it('rejects unknown enum, numeric-zero enum and invalid follow-distance values without inventing activation', async () => {
      live = { signals: {
        LaneDepartureAvoidance: envelope('Unknown', 'ValueKindEnum'),
        AutomaticEmergencyBrakingState: envelope(0, 'ValueKindEnum'),
        CruiseFollowDistance: envelope('0', 'ValueKindEnum'),
      } };
      const view = render(tree(pack));
      await presentation(view.container, appearance);
      for (const label of ['Lane departure', 'Reported emergency braking state', 'Follow distance']) {
        expect(settingRow(label).getByText('Unknown')).toBeInTheDocument();
        expect(settingRow(label).getByText('Freshness unknown')).toBeInTheDocument();
      }
    });

    it('retains both source payloads after failed refresh and recovers independently', async () => {
      const view = render(tree(pack));
      await presentation(view.container, appearance);
      failures.add('/signals/7/live');
      failures.add('/signals/7/AutomaticEmergencyBrakingOff/history');
      fireEvent.click(screen.getByRole('button', { name: 'Refresh driver-assistance evidence' }));
      await waitFor(() => expect(screen.getAllByText('Previously loaded data remains visible while affected sources recover.')).toHaveLength(2));
      await settled();
      expect(settingRow('Emergency braking').getByText('Enabled')).toBeInTheDocument();
      expect(settingRow('Emergency braking').getByText('Retained snapshot')).toBeInTheDocument();
      expect(within(screen.getByRole('list', { name: HISTORY })).getAllByRole('listitem')).toHaveLength(5);
      failures.delete('/signals/7/live');
      fireEvent.click(screen.getByRole('button', { name: 'Refresh driver-assistance evidence' }));
      await waitFor(() => expect(settingRow('Emergency braking').getByText('Fresh observation')).toBeInTheDocument());
      await settled();
      expect(screen.getAllByText('Previously loaded data remains visible while affected sources recover.')).toHaveLength(1);
      failures.clear();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh driver-assistance evidence' }));
      await waitFor(() => expect(screen.queryByText('Previously loaded data remains visible while affected sources recover.')).not.toBeInTheDocument());
    });

    it.each([
      ['/signals/7/live', 'Reported settings could not be loaded.', HISTORY],
      ['/signals/7/AutomaticEmergencyBrakingOff/history', 'Signal history could not be loaded.', SETTINGS],
    ])('isolates an initial failure of %s without hiding the independent source', async (path, message, other) => {
      failures.add(path);
      const view = render(tree(pack));
      await presentation(view.container, appearance);
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.getByRole('region', { name: SETTINGS })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: HISTORY })).toBeInTheDocument();
      if (other === HISTORY) expect(screen.getByText('Disabled → Enabled')).toBeInTheDocument();
      else {
        expect(settingRow('Emergency braking').getByText('Enabled')).toBeInTheDocument();
        expect(screen.getByText('Recorded sample count is unknown until history loads.')).toBeInTheDocument();
      }
      expect(screen.getByRole('combobox', { name: 'History setting' })).toBeEnabled();
    });

    it('keeps both shells and the settings selector visible during initial loading', async () => {
      let resolveLive: ((value: VehicleLiveSignalsResponse) => void) | undefined;
      let resolveHistory: ((value: SignalHistoryResponse) => void) | undefined;
      const pendingLive = new Promise<VehicleLiveSignalsResponse>(resolve => { resolveLive = resolve; });
      const pendingHistory = new Promise<SignalHistoryResponse>(resolve => { resolveHistory = resolve; });
      requestMock.mockImplementation(path => path === '/vehicles' ? Promise.resolve([])
        : path.endsWith('/live') ? pendingLive : pendingHistory);
      const view = render(tree(pack));
      await waitFor(() => expect(view.container.querySelector('[data-widget-family="status"]'))
        .toHaveAttribute('data-widget-appearance', appearance));
      expect(screen.getByRole('status', { name: `Loading ${SETTINGS}` })).toBeInTheDocument();
      expect(screen.getByRole('status', { name: `Loading ${HISTORY}` })).toBeInTheDocument();
      expect(screen.getByText('Recorded sample count is unknown until history loads.')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'History setting' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Refresh driver-assistance evidence' })).toBeDisabled();
      await act(async () => { resolveLive?.(live); resolveHistory?.(history('AutomaticEmergencyBrakingOff')); });
      await settled();
      expect(settingRow('Emergency braking').getByText('Enabled')).toBeInTheDocument();
    });

    it('uses the pinned vehicle configuration and never invents a fallback for an invalid explicit vehicle', async () => {
      const view = render(tree(pack, 2, null, { vehicleId: 42 }));
      await presentation(view.container, appearance);
      expect(requestMock.mock.calls.some(([path]) => path === '/signals/42/live')).toBe(true);
      expect(historyRequests('AutomaticEmergencyBrakingOff', 42)).toHaveLength(1);
      const count = requestMock.mock.calls.length;
      view.rerender(tree(pack, 1, 0, { vehicleId: 42 }));
      await settled();
      expect(screen.getAllByText('Select a vehicle to inspect reported driver-assistance settings.')).toHaveLength(2);
      expect(screen.getByRole('region', { name: HISTORY })).toBeInTheDocument();
      expect(requestMock).toHaveBeenCalledTimes(count);
    });
  });
});
