import { expect, type Page } from '@playwright/test';
import type { SignalHistoryPoint, SignalHistoryResp, TransportAgreementResponse } from '../../src/api/types';
import type { SignalDiffServerResponse, VehicleLiveSignalsResponse } from '../../src/api/hooks/useTelemetry';
import type { TelemetryStatus, VehicleTelemetry } from '../../src/types/telemetry';
import { fulfillApiFixture, type MockApiController } from '../mockApi';

export const TELEMETRY_VEHICLE = 7;
export const HISTORY_FROM = '2026-08-27T00:00:00.000Z';
export const HISTORY_TO = '2026-08-28T00:00:00.000Z';
export const HISTORY_ROWS = 40;
export const TELEMETRY_SIGNALS = ['BatteryLevel', 'VehicleSpeed'] as const;

// The native history envelope is deliberately not padded with obsolete
// timestamp/valueNum fields: doing so would conceal the scientific-page defect.
export function numericHistory(signal: typeof TELEMETRY_SIGNALS[number]): SignalHistoryResp {
  return {
    vehicle_id: TELEMETRY_VEHICLE, signal, expected_kind: 'ValueKindFloat',
    from: HISTORY_FROM, to: HISTORY_TO, count: HISTORY_ROWS,
    data: Array.from({ length: HISTORY_ROWS }, (_, index): SignalHistoryPoint => {
      const ts = new Date(Date.parse(HISTORY_FROM) + index * 60_000).toISOString();
      return {
        ts, kind: 'ValueKindFloat', value: 0,
        ingest_origin: 'fleet_telemetry_mqtt', source_emitted_at: ts, received_at: ts,
        normalization_version: 1,
      };
    }),
  };
}

export function agreementFixture(
  mode: 'measured' | 'insufficient_overlap',
  from: string,
  to: string,
): TransportAgreementResponse {
  const measured = mode === 'measured';
  return {
    vehicle_id: TELEMETRY_VEHICLE, from, to, pair_tolerance_ms: 2000,
    row_limit: 10_000, truncated: false, source_time_only: true,
    generated_at: '2026-08-28T00:00:01.000Z', status: mode,
    agreement_pct: measured ? 99.5 : null, scanned_rows: measured ? 402 : 5,
    invalid_value_rows: 0, http_evidence_rows: measured ? 201 : 0,
    mqtt_evidence_rows: measured ? 201 : 5, comparable_pairs: measured ? 200 : 0,
    agreeing_pairs: measured ? 199 : 0, disagreeing_pairs: measured ? 1 : 0,
    fields: measured ? [{
      field: 'VehicleSpeed', status: 'measured', agreement_pct: 99.5,
      http_evidence_rows: 201, mqtt_evidence_rows: 201, comparable_pairs: 200,
      agreeing_pairs: 199, disagreeing_pairs: 1,
    }] : [],
  };
}

export interface TelemetryFixtureControls {
  historyRequests: URL[];
  agreementRequests: URL[];
  liveRequests: number;
  holdNextLive: () => void;
  releaseLive: () => void;
  emptyHistory: boolean;
  agreementMode: 'measured' | 'insufficient_overlap';
  brokerEmpty: boolean;
  brokerUnavailable: boolean;
}

export async function installTelemetryFixtures(
  page: Page,
  mocks: MockApiController | null,
): Promise<TelemetryFixtureControls> {
  if (!mocks) throw new Error('OperationalBrief telemetry contracts require strict mocked E2E mode');
  let holdLive = false;
  let release: (() => void) | undefined;
  const controls: TelemetryFixtureControls = {
    historyRequests: [], agreementRequests: [], liveRequests: 0,
    emptyHistory: false, agreementMode: 'measured', brokerEmpty: false, brokerUnavailable: false,
    holdNextLive: () => { holdLive = true; },
    releaseLive: () => { holdLive = false; release?.(); release = undefined; },
  };
  await page.route('**/api/v1/signals/7/available', route => {
    expect(route.request().method()).toBe('GET');
    return fulfillApiFixture(route, mocks, { json: {
      vehicle_id: TELEMETRY_VEHICLE, count: 2, source: 'protomodel',
      signals: TELEMETRY_SIGNALS.map(name => ({
        name, category: name === 'VehicleSpeed' ? 'driving' : 'charging',
        value_kind: 'ValueKindFloat',
        unit_kind: name === 'VehicleSpeed' ? 'UnitKindNone' : 'UnitKindCharge',
        is_compound: false, is_setting_unit: false,
      })),
    } });
  });
  for (const signal of TELEMETRY_SIGNALS) {
    await page.route(new RegExp(`/api/v1/signals/7/${signal}/history(?:\\?.*)?$`), route => {
      expect(route.request().method()).toBe('GET');
      controls.historyRequests.push(new URL(route.request().url()));
      const fixture = numericHistory(signal);
      return fulfillApiFixture(route, mocks, {
        json: controls.emptyHistory ? { ...fixture, count: 0, data: [] } : fixture,
      });
    });
  }
  await page.route('**/api/v1/signals/7/transport-agreement?*', route => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe('GET');
    controls.agreementRequests.push(url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) throw new Error('The submitted agreement query must retain both date bounds');
    return fulfillApiFixture(route, mocks, {
      json: agreementFixture(controls.agreementMode, from, to),
    });
  });
  await page.route('**/api/v1/signals/7/live', async route => {
    expect(route.request().method()).toBe('GET');
    controls.liveRequests += 1;
    if (holdLive) {
      holdLive = false;
      await new Promise<void>(resolve => { release = resolve; });
    }
    const now = Date.now();
    const data: VehicleLiveSignalsResponse = {
      vehicle_id: TELEMETRY_VEHICLE, count: 4, at: new Date(now).toISOString(),
      signals: {
        BatteryLevel: { value: 0, timestamp: new Date(now - 10_000).toISOString(), kind: 'ValueKindFloat', source: 'l1', age_ms: 10_000 },
        VehicleSpeed: { value: 0, timestamp: new Date(now - 120_000).toISOString(), kind: 'ValueKindFloat', source: 'l2', age_ms: 120_000 },
        InsideTemp: { value: 21.5, timestamp: new Date(now - 600_000).toISOString(), kind: 'ValueKindDouble', source: 'stale', age_ms: 600_000 },
        Gear: { value: null, kind: 'ValueKindEnum', source: 'unknown' },
      },
    };
    await fulfillApiFixture(route, mocks, { json: data });
  });
  await page.route('**/api/v1/signals/7/diff?*', route => {
    expect(route.request().method()).toBe('GET');
    const params = new URL(route.request().url()).searchParams;
    const atA = params.get('at_a');
    const atB = params.get('at_b');
    if (!atA || !atB) throw new Error('Snapshot diff must send at_a and at_b');
    const data: SignalDiffServerResponse = {
      vehicle_id: TELEMETRY_VEHICLE, at_a: atA, at_b: atB, count: 2,
      data: [
        { name: 'BatteryLevel', value_a: 0, value_b: 1, changed: true, source_a: 'log', source_b: 'log' },
        { name: 'VehicleSpeed', value_a: 0, value_b: 2.5, changed: true, source_a: 'log', source_b: 'log' },
      ],
    };
    return fulfillApiFixture(route, mocks, { json: data });
  });
  await page.route('**/api/v1/telemetry', route => {
    expect(route.request().method()).toBe('GET');
    if (controls.brokerUnavailable) return fulfillApiFixture(route, mocks, {
      status: 503, json: { error: 'Synthetic unavailable broker snapshot' },
    });
    type BrokerVehicleWire = Pick<VehicleTelemetry,
      'vin' | 'signal_count' | 'batch_count' | 'signals_per_second' |
      'last_received' | 'state' | 'is_streaming' | 'data_source'>;
    const data: Pick<TelemetryStatus, 'connected' | 'broker' | 'uptime_seconds' | 'topics'> & {
      vehicles: Record<string, BrokerVehicleWire>;
    } = {
      connected: true, broker: 'synthetic-broker', uptime_seconds: 7200,
      topics: ['telemetry/+/v/+'],
      vehicles: controls.brokerEmpty ? {} : { 'E2E-SYNTHETIC-TELEMETRY': {
        vin: 'E2E-SYNTHETIC-TELEMETRY',
        signal_count: 12, batch_count: 3, signals_per_second: 1.25,
        last_received: new Date().toISOString(), state: 'online',
        is_streaming: true, data_source: 'fleet_telemetry',
      } },
    };
    return fulfillApiFixture(route, mocks, { json: data });
  });
  return controls;
}

export async function installEndedTailFixture(
  page: Page,
  mocks: MockApiController | null,
): Promise<() => void> {
  if (!mocks) throw new Error('The finite native SSE fixture requires the strict API ledger');
  let release: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { release = resolve; });
  page.once('close', () => release?.());
  let published = false;
  await page.route('**/api/v1/events', async route => {
    expect(route.request().method()).toBe('GET');
    mocks.sse.add('/events');
    mocks.sseRequests += 1;
    if (published) return fulfillApiFixture(route, mocks, { status: 204, body: '' });
    published = true;
    // The shell may open its singleton before the route's lazy page mounts.
    // Release the first response only once the real page subscriber is ready.
    await ready;
    const frame: {
      vehicle_id: number;
      ts: string;
      signals: { BatteryLevel: number; IsUserPresent: boolean; VehicleName: string };
    } = {
      vehicle_id: TELEMETRY_VEHICLE, ts: new Date().toISOString(),
      signals: { BatteryLevel: 0, IsUserPresent: false, VehicleName: 'Synthetic tail vehicle' },
    };
    // EOF is intentional: the real EventSource must report disconnect while
    // the page retains its three buffered rows. No EventSource replacement.
    return fulfillApiFixture(route, mocks, {
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache' },
      body: [
        'retry: 60000',
        'event: connected',
        'data: {"client_id":"synthetic-finite-tail"}',
        '',
        'event: vehicle_update',
        `data: ${JSON.stringify(frame)}`,
        '',
        '',
      ].join('\n'),
    });
  });
  return () => {
    if (!release) throw new Error('The native SSE publication gate was not initialized');
    release();
  };
}
