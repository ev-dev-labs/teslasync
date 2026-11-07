import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { load } from 'js-yaml';
import type { FleetTelemetryCoverageResponse, SignalDescriptor, SignalValue } from '../src/api/types';
import type { VehicleLiveSignalsResponse } from '../src/api/hooks/useTelemetry';
import { fulfillApiFixture, type MockApiController } from './mockApi';

interface SignalDisposition {
  field: string;
  semanticUnit: string;
  disposition: 'live' | 'live-and-history' | 'not-routed' | 'unit-context';
  subscriptionPolicy: { desired: boolean; intervalSeconds: number | null; appliedToVehicle: 'unknown' };
  children: Array<{
    field: string;
    historyAvailable: boolean;
    routing: { destination: string; column: string | null; alsoSignalLog: boolean };
  }>;
}

const planFile = fileURLToPath(new URL('../../.agent-status/widget-design-packs/a4d1959b-c94c-481d-a946-35ec50ecfe20/execution-plan-v4.json', import.meta.url));
const approvedPlanHash = '11cc8e4ad9bba5369cadaf68ddbac6ca71b0ca0721b7ada5e73dc871194f19b5';
if (existsSync(planFile) && createHash('sha256').update(readFileSync(planFile)).digest('hex') !== approvedPlanHash) {
  throw new Error('Widget review requires the unchanged user-approved execution plan');
}
const inventoryBytes = readFileSync(fileURLToPath(new URL('./__fixtures__/approved-widget-signal-inventory.json', import.meta.url)));
if (createHash('sha256').update(inventoryBytes).digest('hex')
  !== '692e87d54706cedb50d70e6ba91754f0f9f315de19f99b147c5e3c96ca30061b') {
  throw new Error('Approved portable inventory changed');
}
const inventory = JSON.parse(inventoryBytes.toString('utf8')) as {
  schemaVersion: number; approvedPlanSha256: string; widgetIds: string[]; signalCoverage: SignalDisposition[];
};
if (inventory.schemaVersion !== 1 || inventory.approvedPlanSha256 !== approvedPlanHash
  || inventory.widgetIds.length !== 132 || new Set(inventory.widgetIds).size !== 132) {
  throw new Error('Incomplete approved portable inventory');
}
export const approvedWidgetIds = inventory.widgetIds;
export const signalDispositions = inventory.signalCoverage;
const metadataFile = fileURLToPath(new URL('../../internal/tesla/protomodel/signal_metadata_gen.go', import.meta.url));
const metadata = new Map([...readFileSync(metadataFile, 'utf8').matchAll(
  /\{Field: "([^"]+)", ProtoEnumNum: \d+, Category: "([^"]+)", ValueKind: (ValueKind\w+),.*?IsCompound: (true|false), CompoundKind: CompoundKind(\w+), UnitKind: UnitKind(\w+), IsSettingUnit: (true|false)\}/g,
)].map(match => [match[1], {
  category: match[2], kind: match[3], compound: match[4] === 'true',
  compoundKind: match[5], unit: match[6], setting: match[7] === 'true',
}]));
const routingFile = fileURLToPath(new URL('../../internal/tesla/router/routing.yaml', import.meta.url));
const routes = new Map((load(readFileSync(routingFile, 'utf8')) as {
  routes: Array<{ field: string; dest: string; column?: string; also_signal_log?: boolean }>;
}).routes.map(route => [route.field, route]));
if (signalDispositions.length !== 250 || new Set(signalDispositions.map(item => item.field)).size !== 250) {
  throw new Error('Incomplete or duplicate approved signal dispositions');
}
const intervalSource = readFileSync(fileURLToPath(new URL('../../internal/tesla/config/intervals.go', import.meta.url)), 'utf8');
function intervalTable(name: string) {
  const body = intervalSource.match(new RegExp(`var ${name} = map\\[string\\]int\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!body) throw new Error('Subscription policy table missing: ' + name);
  return new Map([...body.matchAll(/"([^"]+)":\s*(\d+),/g)].map(match => [match[1], Number(match[2])]));
}
const categoryIntervals = intervalTable('categoryDefaults');
const fieldIntervals = intervalTable('fieldOverrides');
const builderSource = readFileSync(fileURLToPath(new URL('../../internal/tesla/config/config.go', import.meta.url)), 'utf8');
if (!/if s\.Category == "metadata" \{\s*continue/.test(builderSource)
  || !/policy, ok := PolicyFor\(s\.Field\)/.test(builderSource)
  || !/if !ok \|\| policy\.IntervalSeconds <= 0/.test(builderSource)) {
  throw new Error('Subscription builder changed; re-audit its desired-field policy');
}

const liveValues: Record<string, SignalValue> = {
  BatteryLevel: 72, ChargeLimitSoc: 80, InsideTemp: 21, OutsideTemp: 18,
  RatedRange: 410_000, IdealBatteryRange: 430_000, Odometer: 32_100_000,
  ACChargingPower: 11_000, DCChargingPower: 0, PackVoltage: 390, PackCurrent: 35.9,
  PowershareInstantaneousPowerKW: -3.25, PowershareHoursLeft: 2.5,
  PowershareStatus: 'Enabled', PowershareStopReason: 'None', PowershareType: 'Home',
  PowerTransferStatus: 'ChargeEnabled', Gear: 'D', DetailedChargeState: 'Disconnected',
  HvacPower: 'Off', HvacFanSpeed: 3, DriverSeatBelt: true, PassengerSeatBelt: false,
  DriverSeatOccupied: true, SeatHeaterLeft: 1, SeatHeaterRight: 0,
  ClimateSeatCoolingFrontLeft: 0, ClimateSeatCoolingFrontRight: 2,
  TpmsPressureFl: 280_000, TpmsPressureFr: 285_000, TpmsPressureRl: 290_000, TpmsPressureRr: 295_000,
  ScheduledChargingMode: 'StartAt', ScheduledChargingPending: true,
  SettingDistanceUnit: 'Kilometers', SettingTemperatureUnit: 'Celsius',
  SettingTirePressureUnit: 'Bar', SettingChargeUnit: 'Percent',
  ExpectedEnergyPercentAtTripArrival: 50, DestinationName: 'Review destination',
  DestinationLocationLatitude: 37.4, DestinationLocationLongitude: -122.1,
  MilesToArrival: 17_400, MinutesToArrival: 12, RouteTrafficMinutesDelay: 2,
};

export function signalReviewManifest(timestamp: string) {
  const signals: Array<Omit<SignalDescriptor, 'value_kind' | 'unit_kind'> & { value_kind: string; unit_kind: string }> = [];
  const fields: FleetTelemetryCoverageResponse['categories'][number]['fields'] = [];
  const observations: NonNullable<VehicleLiveSignalsResponse['signals']> = {};
  const live: VehicleLiveSignalsResponse = { vehicle_id: 7, at: timestamp, signals: observations };
  const history = new Map<string, { kind: string; value: SignalValue }>();
  for (const disposition of signalDispositions) {
    const meta = metadata.get(disposition.field);
    if (!meta || meta.unit !== disposition.semanticUnit) throw new Error('Signal metadata drift: ' + disposition.field);
    const interval = fieldIntervals.get(disposition.field) ?? categoryIntervals.get(meta.category) ?? 60;
    const desired = meta.category !== 'metadata' && interval > 0;
    if (disposition.subscriptionPolicy.desired !== desired
      || disposition.subscriptionPolicy.intervalSeconds !== (desired ? interval : null)
      || disposition.subscriptionPolicy.appliedToVehicle !== 'unknown') {
      throw new Error('Approved subscription policy drift: ' + disposition.field);
    }
    const kind = meta.kind === 'ValueKindEnum' ? 'string' : meta.kind === 'ValueKindBool' ? 'bool'
      : meta.kind === 'ValueKindString' ? 'string' : meta.kind === 'ValueKindTime' ? 'time'
        : meta.kind === 'ValueKindInt32' || meta.kind === 'ValueKindInt64' ? 'int'
          : meta.kind === 'ValueKindFloat' || meta.kind === 'ValueKindDouble' ? 'float' : 'unknown';
    signals.push({
      name: disposition.field, category: meta.category, value_kind: meta.kind,
      unit_kind: `UnitKind${meta.unit}`,
      is_compound: meta.compound, is_setting_unit: meta.setting,
    });
    for (const child of disposition.children) {
      const route = routes.get(child.field);
      if (!route || route.dest !== child.routing.destination
        || (route.column ?? null) !== child.routing.column
        || (route.also_signal_log === true) !== child.routing.alsoSignalLog
        || child.historyAvailable !== (route.dest === 'signal_log' || route.also_signal_log === true)) {
        throw new Error('Approved signal routing drift: ' + child.field);
      }
      fields.push({
        field: child.field, destination: child.routing.destination,
        column: child.routing.column ?? undefined, also_signal_log: child.routing.alsoSignalLog,
        subscribed: disposition.subscriptionPolicy.desired,
      });
      if (child.routing.destination === 'drop') continue;
      const childKind = meta.compound ? meta.compoundKind === 'Time' ? 'time'
        : meta.compoundKind === 'Location' ? 'float' : 'bool' : kind;
      const value = liveValues[child.field] ?? (childKind === 'bool' ? false : childKind === 'string' ? 'Unknown'
        : childKind === 'time' ? timestamp : meta.unit === 'Charge' ? 50 : 1);
      const discriminator = typeof value === 'boolean' ? 'ValueKindBool'
        : meta.compound ? childKind === 'time' ? 'ValueKindTime'
        : childKind === 'bool' ? 'ValueKindBool' : 'ValueKindFloat' : meta.kind;
      observations[child.field] = { value, kind: discriminator, ts: timestamp,
        timestamp, source: 'l1', age_ms: 10_000 };
      if (child.historyAvailable) history.set(child.field, {
        kind: typeof value === 'string' && childKind !== 'time' ? 'ValueKindString' : discriminator, value,
      });
    }
  }
  const catalog = { vehicle_id: 7, count: signals.length, source: 'proto', signals };
  const coverage: FleetTelemetryCoverageResponse = {
    categories: [{ category: 'Approved synthetic signal review', fields, total_fields: fields.length, destinations: {} }],
    destination_totals: {}, orphan_fields: [],
  };
  return { catalog, coverage, live, history };
}

export async function installCompleteSignalReview(page: Page, mocks: MockApiController, timestamp: string) {
  const manifest = signalReviewManifest(timestamp);
  for (const [path, json] of [
    ['/signals/7/available', manifest.catalog], ['/signals/7/live', manifest.live],
    ['/tesla/fleet-telemetry/coverage', manifest.coverage],
  ] as const) {
    await page.route(url => url.pathname === `/api/v1${path}`, route => fulfillApiFixture(route, mocks, { json }));
  }
  await page.route(url => /^\/api\/v1\/signals\/7\/[^/]+\/history$/.test(url.pathname), route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[5]);
    const source = manifest.history.get(name);
    const data = source ? [source.value, null, source.value].map((value, index) => ({
      ts: new Date(Date.parse(timestamp) - (2 - index) * 10_000).toISOString(),
      kind: source.kind, value, ingest_origin: 'fleet_telemetry_mqtt',
      source_emitted_at: timestamp, received_at: timestamp, normalization_version: 1,
    })) : [];
    return fulfillApiFixture(route, mocks, { json: {
      vehicle_id: 7, signal: name, count: data.length, data,
      from: new URL(route.request().url()).searchParams.get('from'), to: timestamp,
    } });
  });
  return manifest;
}
