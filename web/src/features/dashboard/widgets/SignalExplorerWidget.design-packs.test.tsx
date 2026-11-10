import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AvailableSignalsResponse, FleetTelemetryCoverageResponse, SignalHistoryPoint, SignalValue } from '@/api/types';
import type { VehicleLiveSignal, VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import type { SignalHistoryResponse } from '@/types/telemetry';
import type { WidgetConfig } from './types';
import type { PackId } from './designPacks/types';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';
import { PackBoundary } from './designPacks/PackBoundary';
import SignalExplorerWidget from './SignalExplorerWidget';

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
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'bar', decimal_precision: 1, locale: 'en-US' },
    locale: 'en-US',
  }),
}));
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
    const instant = value instanceof Date ? value : value == null ? null : new Date(value);
    return instant && Number.isFinite(instant.getTime()) ? instant.toISOString() : '—';
  };
  return { useDateFormat: () => ({
    formatDateTime: format, formatTime: format, formatDate: format,
    formatRelative: format, formatRelativeTime: format, tz: 'UTC', locale: 'en-US',
  }) };
});

const NOW = Date.parse('2026-11-07T02:00:00Z');
const OBSERVED = '2026-11-07T01:59:50Z';
const PACKS = PACK_IDS.filter((pack): pack is Exclude<PackId, 'classic'> => pack !== 'classic')
  .map(pack => [pack, PACK_APPEARANCES[pack]] as const);
const SECTION_NAMES = ['Signal inventory', 'Current observation', 'Signal history', 'Routing and evidence'];
let client: QueryClient;
let catalog: AvailableSignalsResponse;
let coverage: FleetTelemetryCoverageResponse;
let live: VehicleLiveSignalsResponse;
let emptyHistory: boolean;
let failures: Set<string>;

function envelope(value: SignalValue, kind = 'ValueKindDouble', overrides: Partial<VehicleLiveSignal> = {}): VehicleLiveSignal {
  return { kind, value, ts: OBSERVED, timestamp: OBSERVED, source: 'l1', age_ms: 10_000, ...overrides };
}

function history(name: string): SignalHistoryResponse {
  const values: SignalValue[] = name === 'PackCurrent' ? [-10, 0, -12]
    : name === 'DoorStateDriverFront' || name === 'HvacPower' ? [false, true]
      : name === 'BMSState' ? [0, 2]
        : name === 'DestinationName' ? ['Home', 'Work'] : [70, null, 72];
  const kind = name === 'DoorStateDriverFront' || name === 'HvacPower' ? 'ValueKindBool'
    : name === 'DestinationName' ? 'ValueKindString'
      : name === 'BMSState' ? 'ValueKindEnum' : 'ValueKindDouble';
  const data: SignalHistoryPoint[] = emptyHistory ? [] : values.map((value, index) => ({
    ts: new Date(NOW - (30 - index * 10) * 1000).toISOString(), value, kind,
    ingest_origin: 'fleet_telemetry_mqtt', source_emitted_at: null,
    received_at: OBSERVED, normalization_version: 1,
  }));
  return { vehicleId: 7, signal: name, from: '2026-11-07T01:00:00Z', to: OBSERVED, count: data.length, data };
}

function tree(pack: PackId = 'v1', cols = 2, config?: WidgetConfig, vehicleId = 7) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={pack}>
          <SignalExplorerWidget vehicleId={vehicleId} size={{ cols, rows: 5 }} config={config} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function settled() {
  await waitFor(() => expect(client.isFetching()).toBe(0), { timeout: 10_000 });
}

async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="list"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
  await settled();
}

function currentRow(name: string) {
  const row = within(screen.getByRole('list', { name: 'Current observation' })).getByText(name).closest('li');
  if (!row) throw new Error(`Missing signal row: ${name}`);
  return within(row);
}

function historyRequests(name: string) {
  return requestMock.mock.calls.filter(([path]) => path.startsWith(`/signals/7/${name}/history?`));
}

describe('SignalExplorerWidget design packs', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    requestMock.mockReset();
    failures = new Set();
    emptyHistory = false;
    catalog = {
      vehicle_id: 7, count: 11, source: 'proto',
      signals: [
        { name: 'BatteryLevel', category: 'Battery', value_kind: 'float', unit_kind: 'charge', is_compound: false, is_setting_unit: false },
        { name: 'InsideTemp', category: 'Climate', value_kind: 'float', unit_kind: 'temperature', is_compound: false, is_setting_unit: false },
        { name: 'PackCurrent', category: 'Battery', value_kind: 'float', unit_kind: 'none', is_compound: false, is_setting_unit: false },
        { name: 'Gear', category: 'Driving', value_kind: 'int', unit_kind: 'none', is_compound: false, is_setting_unit: false },
        { name: 'HvacPower', category: 'Climate', value_kind: 'bool', unit_kind: 'none', is_compound: false, is_setting_unit: false },
        { name: 'DestinationName', category: 'Navigation', value_kind: 'string', unit_kind: 'none', is_compound: false, is_setting_unit: false },
        { name: 'DoorState', category: 'Security', value_kind: 'unknown', unit_kind: 'none', is_compound: true, is_setting_unit: false },
        { name: 'BMSState', category: 'Battery', value_kind: 'int', unit_kind: 'none', is_compound: false, is_setting_unit: false },
        { name: 'SettingDistanceUnit', category: 'Settings', value_kind: 'int', unit_kind: 'none', is_compound: false, is_setting_unit: true },
        { name: 'TestDropped', category: 'Diagnostics', value_kind: 'float', unit_kind: 'none', is_compound: false, is_setting_unit: false },
        { name: 'TpmsPressureFl', category: 'Tires', value_kind: 'float', unit_kind: 'pressure', is_compound: false, is_setting_unit: false },
      ],
    };
    const fields = catalog.signals.filter(item => !item.is_compound).map(item => ({
      field: item.name, destination: item.name === 'Gear' ? 'driving_telemetry'
        : item.is_setting_unit ? 'unit_history' : item.name === 'TestDropped' ? 'drop'
          : item.name === 'TpmsPressureFl' ? 'tire_pressure' : 'signal_log',
      subscribed: item.name !== 'TestDropped',
    }));
    coverage = {
      categories: [{ category: 'Fixture catalog', total_fields: fields.length + 2, destinations: {}, fields: [
        ...fields,
        { field: 'DoorStateDriverFront', destination: 'signal_log', subscribed: true },
        { field: 'DoorStateDriverRear', destination: 'signal_log', subscribed: true },
      ] }],
      destination_totals: {}, orphan_fields: [],
    };
    live = { vehicle_id: 7, at: OBSERVED, signals: {
      BatteryLevel: envelope(72), InsideTemp: envelope(20),
      PackCurrent: envelope(-12), Gear: envelope(4, 'ValueKindEnum'),
      DoorStateDriverFront: envelope(false, 'ValueKindBool'),
      HvacPower: envelope(false, 'ValueKindBool'),
      DestinationName: envelope('Work', 'ValueKindString'),
      BMSState: envelope(2, 'ValueKindEnum'), TestDropped: envelope(99),
      TpmsPressureFl: envelope(220_000),
    } };
    client = new QueryClient({ defaultOptions: { queries: {
      retry: false, gcTime: Infinity, refetchOnWindowFocus: false,
    } } });
    requestMock.mockImplementation(async path => {
      if (failures.has(path.split('?')[0])) throw new Error('Signal source failed');
      if (path === '/vehicles') return [];
      if (/^\/signals\/\d+\/available$/.test(path)) return catalog;
      if (path === '/tesla/fleet-telemetry/coverage') return coverage;
      if (/^\/signals\/\d+\/live$/.test(path)) return live;
      const match = /^\/signals\/\d+\/([^/]+)\/history\?/.exec(path);
      if (match) return history(decodeURIComponent(match[1]));
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  it('inspects a time compound through its routed scalar identity, not an invented child', async () => {
    catalog.signals.push({
      name: 'ScheduledChargingStartTime', category: 'Charging', value_kind: 'unknown',
      unit_kind: 'none', is_compound: true, is_setting_unit: false,
    });
    coverage.categories[0].fields.push({
      field: 'ScheduledChargingStartTime', destination: 'signal_log', subscribed: true,
    });
    live.signals.ScheduledChargingStartTime = envelope(OBSERVED, 'ValueKindTime');
    const view = render(tree('v1', 2, { signalName: 'ScheduledChargingStartTime' }));
    await presentation(view.container, 'studio');
    expect(currentRow('ScheduledChargingStartTime').getByText('Fresh observation')).toBeInTheDocument();
    expect(historyRequests('ScheduledChargingStartTime')).toHaveLength(1);
    expect(requestMock.mock.calls.some(([path]) => path.includes('ScheduledChargingStartTimeTime/'))).toBe(false);
  });

  it('shows canonical live enum strings without treating them as missing numeric readings', async () => {
    live.signals.BMSState = envelope('Drive', 'ValueKindEnum');
    const view = render(tree('v1', 2, { signalName: 'BMSState' }));
    await presentation(view.container, 'studio');
    expect(currentRow('BMSState').getByText('Drive')).toBeInTheDocument();
    expect(currentRow('BMSState').getByText('Fresh observation')).toBeInTheDocument();
  });

  it.each(['PowershareInstantaneousPowerKW', 'EnergyRemaining', 'LifetimeEnergyUsed'])(
    'retains %s as raw evidence when the pipeline does not establish SI units', async name => {
      catalog.signals.push({
        name, category: 'Charging', value_kind: 'float', unit_kind: 'none',
        is_compound: false, is_setting_unit: false,
      });
      catalog.count = catalog.signals.length;
      coverage.categories[0].fields.push({ field: name, destination: 'signal_log', subscribed: true });
      live.signals[name] = envelope(-3.25);
      const view = render(tree('v1', 2, { signalName: name }));
      await presentation(view.container, 'studio');
      expect(currentRow(name).getByText('-3.25')).toBeInTheDocument();
      expect(currentRow(name).queryByText(/kW|Wh/)).not.toBeInTheDocument();
      expect(currentRow(name).getByText('Fresh observation')).toBeInTheDocument();
    },
  );

  it.each(PACKS)('%s composes all sections, real samples, search, selection and refresh through the shared presentation', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    for (const name of SECTION_NAMES) expect(screen.getByRole('region', { name })).toBeInTheDocument();
    expect(currentRow('BatteryLevel').getByText('72.0 %')).toBeInTheDocument();
    expect(currentRow('BatteryLevel').getByText('Fresh observation')).toBeInTheDocument();
    expect(currentRow('BatteryLevel').getByText(`Observed: ${OBSERVED.replace('Z', '.000Z')}`)).toBeInTheDocument();
    expect(screen.getByText(/Applied configuration and vehicle support: unknown/)).toBeInTheDocument();
    const table = within(screen.getByRole('region', { name: 'Signal history' })).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('70.0 %')).toBeInTheDocument();
    expect(within(table).getByText('Unknown')).toBeInTheDocument();
    expect(view.container.querySelector('[data-instrument-family="list"] .lucide-radio')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    const request = historyRequests('BatteryLevel')[0][0];
    expect(new URL(request, 'https://test.invalid').searchParams.get('from')).toBe('2026-11-07T01:00:00Z');
    expect(new URL(request, 'https://test.invalid').searchParams.get('to')).toBe('2026-11-07T01:59:59.999999Z');

    fireEvent.change(screen.getByRole('textbox', { name: 'Search catalog' }), { target: { value: 'Pack' } });
    expect(screen.queryByRole('option', { name: 'InsideTemp' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Signal field' }), { target: { value: 'PackCurrent' } });
    await waitFor(() => expect(currentRow('PackCurrent').getByText('-12.0 A')).toBeInTheDocument());
    await settled();
    const signedTable = within(screen.getByRole('region', { name: 'Signal history' })).getByRole('table');
    expect(within(signedTable).getByText('0.0 A')).toBeInTheDocument();
    expect(within(signedTable).getByText('-10.0 A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh signal evidence' }));
    await waitFor(() => expect(historyRequests('PackCurrent')).toHaveLength(2));
    await settled();
    expect(currentRow('PackCurrent').getByText('-12.0 A')).toBeInTheDocument();
  });

  it('switches Classic, every pack and compact/full without multiplying readers or losing field selection', async () => {
    const view = render(tree('classic', 1));
    await screen.findByRole('combobox', { name: 'Signal field' });
    await settled();
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Signal field' }), { target: { value: 'InsideTemp' } });
    await settled();
    expect(currentRow('InsideTemp').getByText('68.0°F')).toBeInTheDocument();
    const count = requestMock.mock.calls.length;
    for (const [pack, appearance] of PACKS) {
      view.rerender(tree(pack, pack === 'v1' ? 1 : 3));
      await presentation(view.container, appearance);
      expect(screen.getByRole('combobox', { name: 'Signal field' })).toHaveValue('InsideTemp');
      expect(currentRow('InsideTemp').getByText('68.0°F')).toBeInTheDocument();
    }
    view.rerender(tree('classic', 3));
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(currentRow('InsideTemp').getByText('68.0°F')).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(count);
  });

  it.each(PACKS)('%s exposes compound children independently, including missing evidence, and never queries the parent', async (pack, appearance) => {
    emptyHistory = true;
    const view = render(tree(pack, 1, { signalName: 'DoorState' }));
    await presentation(view.container, appearance);
    expect(currentRow('DoorStateDriverFront').getByText('No')).toBeInTheDocument();
    expect(currentRow('DoorStateDriverRear').getByText('Unknown')).toBeInTheDocument();
    expect(currentRow('DoorStateDriverRear').getByText('Freshness unknown')).toBeInTheDocument();
    expect(screen.getByText('No recorded samples in the selected workspace range.')).toBeInTheDocument();
    expect(historyRequests('DoorState')).toHaveLength(0);
    fireEvent.change(screen.getByRole('combobox', { name: 'Compound child' }), { target: { value: 'DoorStateDriverRear' } });
    await waitFor(() => expect(historyRequests('DoorStateDriverRear')).toHaveLength(1));
    await settled();
    for (const name of SECTION_NAMES) expect(screen.getByRole('region', { name })).toBeInTheDocument();
  });

  describe.each(PACKS)('%s source evidence', (pack, appearance) => {
    it.each([
      ['HvacPower', 'No', 'Yes'],
      ['DestinationName', 'Home', 'Work'],
      ['BMSState', '0', '2'],
    ])('adapts %s to a typed state/text timeline rather than a numeric trend', async (name, first, last) => {
      const view = render(tree(pack, 2, { signalName: name }));
      await presentation(view.container, appearance);
      const timeline = within(screen.getByRole('region', { name: 'Signal history' })).getByRole('list', { name: `${name} — Signal history` });
      expect(within(timeline).getByText(first)).toBeInTheDocument();
      expect(within(timeline).getByText(last)).toBeInTheDocument();
      expect(within(timeline).getAllByText(/Origin: fleet_telemetry_mqtt/)).toHaveLength(2);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it.each([
      ['Gear', 'No signal_log route; generic history is unavailable for this field.'],
      ['SettingDistanceUnit', 'Unit settings use a separate unit-history source, not signal_log.'],
      ['TestDropped', 'Dropped; unavailable'],
    ])('does not request unproved generic history for %s or turn dropped evidence into live data', async (name, message) => {
      const view = render(tree(pack, 1, { signalName: name }));
      await presentation(view.container, appearance);
      expect(within(screen.getByRole('region', { name: 'Signal history' })).getByText(message)).toBeInTheDocument();
      expect(historyRequests(name)).toHaveLength(0);
      if (name === 'TestDropped') {
        expect(currentRow(name).getByText('Unknown')).toBeInTheDocument();
        expect(currentRow(name).queryByText('99.00')).not.toBeInTheDocument();
      }
    });

    it.each([
      ['zero', envelope(0), '0.0 %', 'Fresh observation'],
      ['stale', envelope(72, 'ValueKindDouble', { ts: '2026-11-07T01:00:00Z' }), '72.0 %', 'Stale observation'],
      ['log', envelope(72, 'ValueKindDouble', { source: 'log' }), '72.0 %', 'Historical fallback'],
      ['unknown source', envelope(72, 'ValueKindDouble', { source: 'unknown' }), '72.0 %', 'Freshness unknown'],
      ['future', envelope(72, 'ValueKindDouble', { ts: '2026-11-08T01:00:00Z' }), '72.0 %', 'Freshness unknown'],
      ['invalid', envelope('72'), 'Unknown', 'Freshness unknown'],
      ['out of range', envelope(101), 'Unknown', 'Freshness unknown'],
      ['legacy scalar', 72, 'Unknown', 'Freshness unknown'],
    ] as const)('keeps %s evidence distinct from a fresh measurement', async (_label, reading, value, trust) => {
      live = { signals: { BatteryLevel: reading } };
      const view = render(tree(pack));
      await presentation(view.container, appearance);
      expect(currentRow('BatteryLevel').getByText(value)).toBeInTheDocument();
      expect(currentRow('BatteryLevel').getByText(trust)).toBeInTheDocument();
    });

    it('formats raw Pa through the shared pressure boundary without claiming hot-table history', async () => {
      const view = render(tree(pack, 2, { signalName: 'TpmsPressureFl' }));
      await presentation(view.container, appearance);
      expect(currentRow('TpmsPressureFl').getByText('2.2 bar')).toBeInTheDocument();
      expect(historyRequests('TpmsPressureFl')).toHaveLength(0);
    });

    it('resolves a configured flattened field to its real parent and queries only the selected child', async () => {
      const view = render(tree(pack, 2, { signalName: 'DoorStateDriverRear' }));
      await presentation(view.container, appearance);
      expect(screen.getByRole('combobox', { name: 'Signal field' })).toHaveValue('DoorState');
      expect(screen.getByRole('combobox', { name: 'Compound child' })).toHaveValue('DoorStateDriverRear');
      expect(historyRequests('DoorStateDriverRear')).toHaveLength(1);
      expect(historyRequests('DoorState')).toHaveLength(0);
      expect(historyRequests('DoorStateDriverFront')).toHaveLength(0);
    });

    it('retains independent readings and all history samples on failed refresh, then recovers', async () => {
      const view = render(tree(pack));
      await presentation(view.container, appearance);
      failures.add('/signals/7/live');
      failures.add('/signals/7/BatteryLevel/history');
      fireEvent.click(screen.getByRole('button', { name: 'Refresh signal evidence' }));
      await settled();
      expect(currentRow('BatteryLevel').getByText('72.0 %')).toBeInTheDocument();
      expect(currentRow('BatteryLevel').getByText('Retained snapshot')).toBeInTheDocument();
      expect(screen.getAllByText('Previously loaded data remains visible while affected sources recover.')).toHaveLength(2);
      expect(within(screen.getByRole('region', { name: 'Signal history' })).getByRole('table')).toBeInTheDocument();
      failures.clear();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh signal evidence' }));
      await settled();
      expect(currentRow('BatteryLevel').getByText('Fresh observation')).toBeInTheDocument();
      expect(screen.queryByText('Previously loaded data remains visible while affected sources recover.')).not.toBeInTheDocument();
    });

    it('isolates an initial live failure without removing inventory, routing or historical evidence', async () => {
      failures.add('/signals/7/live');
      const view = render(tree(pack));
      await presentation(view.container, appearance);
      expect(screen.getByText('Live signal evidence could not be loaded.')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Signal field' })).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Signal history' })).getByRole('table')).toBeInTheDocument();
      for (const name of SECTION_NAMES) expect(screen.getByRole('region', { name })).toBeInTheDocument();
    });

    it('does not turn a routing failure into permission to query unproved history', async () => {
      failures.add('/tesla/fleet-telemetry/coverage');
      const view = render(tree(pack));
      await presentation(view.container, appearance);
      expect(screen.getByText('Routing evidence could not be loaded.')).toBeInTheDocument();
      expect(currentRow('BatteryLevel').getByText('72.0 %')).toBeInTheDocument();
      expect(screen.getByText('History eligibility is unknown until routing evidence is available.')).toBeInTheDocument();
      expect(historyRequests('BatteryLevel')).toHaveLength(0);
    });

    it('keeps every source shell and the shared presentation mounted while the catalog is loading', async () => {
      let resolveCatalog: ((value: AvailableSignalsResponse) => void) | undefined;
      const pending = new Promise<AvailableSignalsResponse>(resolve => { resolveCatalog = resolve; });
      const implementation = requestMock.getMockImplementation();
      if (!implementation) throw new Error('Missing fixture implementation');
      requestMock.mockImplementation(path => path === '/signals/7/available' ? pending : implementation(path));
      const view = render(tree(pack));
      await waitFor(() => expect(view.container.querySelector(`[data-widget-appearance="${appearance}"]`)).toBeInTheDocument());
      for (const name of SECTION_NAMES) expect(screen.getByRole('region', { name })).toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Loading Signal inventory' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Refresh signal evidence' })).toBeDisabled();
      await act(async () => { resolveCatalog?.(catalog); });
      await settled();
      expect(currentRow('BatteryLevel').getByText('72.0 %')).toBeInTheDocument();
    });

    it('keeps source shells for an empty catalog and never invents a default measurement', async () => {
      catalog = { ...catalog, count: 0, signals: [] };
      live = { signals: {} };
      const view = render(tree(pack));
      await presentation(view.container, appearance);
      expect(screen.getByText('No catalog fields are available.')).toBeInTheDocument();
      for (const name of SECTION_NAMES) expect(screen.getByRole('region', { name })).toBeInTheDocument();
      expect(screen.queryByText('0.0 %')).not.toBeInTheDocument();
      expect(requestMock.mock.calls.some(([path]) => path.includes('/history?'))).toBe(false);
    });
  });

  it('honors explicit configuration changes and never silently falls back from an unknown configured field', async () => {
    const view = render(tree('classic', 2, { signalName: 'NotInCatalog' }));
    await settled();
    expect(screen.getByText('Configured field is not in this catalog: NotInCatalog')).toBeInTheDocument();
    expect(historyRequests('BatteryLevel')).toHaveLength(0);
    view.rerender(tree('classic', 2, { signalName: 'PackCurrent' }));
    await settled();
    expect(currentRow('PackCurrent').getByText('-12.0 A')).toBeInTheDocument();
    view.rerender(tree('classic', 2, { signalName: 'InsideTemp' }, 8));
    await settled();
    expect(currentRow('InsideTemp').getByText('68.0°F')).toBeInTheDocument();
    expect(requestMock.mock.calls.some(([path]) => path === '/signals/8/live')).toBe(true);
  });
});
