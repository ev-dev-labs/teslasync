import { expect, type Page } from '@playwright/test';

interface RecordedSource {
  url: string;
  requestStartedAt: number;
  responseCompletedAt: number;
  body: unknown;
}

export interface CatalogueObservationSource {
  vehicleId: number;
  observedAt: number;
  earliestRenderAt: number;
  snapshot: string;
  responses: RecordedSource[];
}

const sources = new WeakMap<Page, {
  pending: Set<Promise<void>>;
  records: RecordedSource[];
  errors: string[];
}>();

export function recordCatalogueObservationSources(page: Page) {
  if (sources.has(page)) throw new Error('Catalogue observation recorder already installed');
  const state = { pending: new Set<Promise<void>>(), records: [] as RecordedSource[], errors: [] as string[] };
  sources.set(page, state);
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (!['/api/v1/vehicles', '/api/v1/vehicles/states'].includes(path)) return;
    const task = (async () => {
      if (!response.ok()) throw new Error(`Observation source HTTP ${response.status()}: ${response.url()}`);
      const body: unknown = await response.json();
      const completionError = await response.finished();
      if (completionError) throw completionError;
      const timing = response.request().timing();
      const requestStartedAt = timing.startTime;
      if (!Number.isFinite(requestStartedAt) || requestStartedAt <= 0
        || !Number.isFinite(timing.responseEnd) || timing.responseEnd < 0) {
        throw new Error(`Observation source has no native request clock: ${response.url()}`);
      }
      state.records.push({ url: response.url(), requestStartedAt,
        responseCompletedAt: requestStartedAt + timing.responseEnd, body });
    })().catch((error: unknown) => {
      state.errors.push(error instanceof Error ? error.message : String(error));
    });
    state.pending.add(task);
    void task.finally(() => state.pending.delete(task));
  });
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function data(body: unknown): unknown {
  return object(body) && 'data' in body ? body.data : body;
}

export async function catalogueObservationSource(page: Page, vehicleId: number): Promise<CatalogueObservationSource> {
  const state = sources.get(page);
  if (!state) throw new Error('FleetPosture age evolution blocked: no pre-navigation observation recorder');
  await Promise.all([...state.pending]);
  if (state.errors.length) throw new Error(`Observation provenance failed: ${state.errors.join('; ')}`);
  const batches = state.records.filter(record => new URL(record.url).pathname === '/api/v1/vehicles/states');
  const rosters = state.records.filter(record => new URL(record.url).pathname === '/api/v1/vehicles');
  const batch = batches[batches.length - 1];
  const roster = rosters[rosters.length - 1];
  if (!batch || !roster) throw new Error('FleetPosture age evolution blocked: missing served batch/vehicle response');
  const payload = data(batch.body);
  const vehicles = data(roster.body);
  // The existing catalogue workspace fixture is exactly one resolved vehicle.
  // Multi-vehicle oldest/scope reconciliation is deliberately not inferred here.
  if (!object(payload) || !Array.isArray(payload.vehicles) || payload.vehicles.length !== 1
    || !Array.isArray(vehicles) || vehicles.length !== 1) {
    throw new Error('FleetPosture age evolution blocked: unsupported observation/vehicle snapshot');
  }
  const entry: unknown = payload.vehicles[0];
  const vehicle: unknown = vehicles[0];
  if (!object(entry) || !object(vehicle) || vehicle.id !== vehicleId || entry.vehicle_id !== vehicleId
    || entry.outcome !== 'resolved' || entry.live !== true || entry.data_source !== 'signal_store'
    || typeof entry.observed_at !== 'string' || !object(entry.state) || entry.state.vehicle_id !== vehicleId) {
    throw new Error('FleetPosture age evolution blocked: scope is not the served resolved observation');
  }
  const observedAt = Date.parse(entry.observed_at);
  if (!Number.isFinite(observedAt)) throw new Error('FleetPosture age evolution blocked: invalid observation instant');
  if (object(payload.summary) && payload.summary.oldest_observed_at !== entry.observed_at) {
    throw new Error('FleetPosture age evolution blocked: summary/entry observation mismatch');
  }
  const snapshot = JSON.stringify({ batchURL: batch.url, batch: batch.body, rosterURL: roster.url, roster: roster.body });
  const matching = batches.filter(record => record.url === batch.url
    && JSON.stringify(record.body) === JSON.stringify(batch.body));
  return {
    vehicleId, observedAt, earliestRenderAt: Math.min(...matching.map(record => record.responseCompletedAt)),
    snapshot, responses: [...state.records],
  };
}

export interface CatalogueObservationAgeLayout {
  tag: string;
  className: string | null;
  bounds: { top: number; bottom: number; left: number; right: number };
  clipBounds: { top: number; bottom: number; left: number; right: number };
  clipsX: boolean;
  clipsY: boolean;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
}

interface Reading {
  id: string;
  text: string;
  relativeTop: number;
  relativeBottom: number;
  relativeLeft: number;
  relativeRight: number;
  top: number;
  bottom: number;
  hitInsidePanel: boolean;
  observationAgeRole: 'scope' | 'oldest' | null;
  observationAgeLayout?: CatalogueObservationAgeLayout[] | null;
}

export interface ObservationInventoryFrame {
  wallTimeMs: number;
  usable: { top: number; bottom: number };
  fleetObservation: { scopeVehicleId: number | null } | null;
  observationSource?: CatalogueObservationSource | null;
  readings: Reading[];
}

function ageInterval(text: string, role: 'scope' | 'oldest') {
  const match = (role === 'scope'
    ? /^Last real observation (\d+)(s|m|h|d) ago$/
    : /^(\d+)(s|m|h|d) ago$/).exec(text);
  if (!match) throw new Error(`Source-bound observation age has invalid text: ${text}`);
  const count = Number(match[1]);
  const unit = match[2];
  if (!Number.isSafeInteger(count) || (unit === 's' ? count >= 60
    : unit === 'm' ? count < 1 || count >= 60
    : unit === 'h' ? count < 1 || count >= 24 : count < 1)) {
    throw new Error(`Source-bound observation age has invalid unit/count: ${text}`);
  }
  const scale = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  // formatObservationAge rounds seconds, then floors minutes/hours/days.
  return { from: count === 0 ? -Infinity : (count * scale - 0.5) * 1000,
    to: ((count + 1) * scale - 0.5) * 1000, order: count * scale };
}

export function assertCatalogueReadingInventory(before: ObservationInventoryFrame, after: ObservationInventoryFrame) {
  const identity = (frame: ObservationInventoryFrame) => frame.readings.map(reading => ({
    id: reading.id, top: reading.relativeTop, bottom: reading.relativeBottom,
    left: reading.relativeLeft, right: reading.observationAgeRole ? null : reading.relativeRight,
    role: reading.observationAgeRole,
  }));
  expect(identity(after), 'Every rendered reading region must retain its exact identity/relative geometry')
    .toEqual(identity(before));
  const ageReadings = before.readings.filter(reading => reading.observationAgeRole !== null);
  if (ageReadings.length) {
    expect([...new Set(ageReadings.map(reading => reading.observationAgeRole))].sort(),
      'Only the two source-bound FleetPosture age nodes may evolve').toEqual(['oldest', 'scope']);
    for (const role of ['scope', 'oldest']) {
      expect(new Set(ageReadings.filter(reading => reading.observationAgeRole === role)
        .map(reading => reading.id.split(':')[0])).size, 'Each age binding must identify exactly one text node').toBe(1);
    }
    const source = before.observationSource;
    if (!source || !after.observationSource || !before.fleetObservation || !after.fleetObservation) {
      throw new Error('FleetPosture age evolution blocked: missing recorded observation provenance');
    }
    expect(after.observationSource.snapshot, 'Observation/vehicle/source snapshot must not change').toBe(source.snapshot);
    expect(after.observationSource.observedAt, 'Underlying observation instant must not change').toBe(source.observedAt);
    expect(after.observationSource.vehicleId).toBe(source.vehicleId);
    expect(after.observationSource.earliestRenderAt).toBe(source.earliestRenderAt);
    expect(after.observationSource.responses.slice(0, source.responses.length),
      'Recorded observation response history must not disappear/change').toEqual(source.responses);
    for (const response of after.observationSource.responses.slice(source.responses.length)) {
      const previous = source.responses.filter(record =>
        new URL(record.url).pathname === new URL(response.url).pathname).slice(-1)[0];
      if (!previous) throw new Error('New observation source has no prior recorded provenance');
      expect({ url: response.url, body: response.body },
        'Observation/vehicle/source snapshot must not change between frames')
        .toEqual({ url: previous.url, body: previous.body });
    }
    expect(before.fleetObservation.scopeVehicleId).toBe(source.vehicleId);
    expect(after.fleetObservation).toEqual(before.fleetObservation);
    expect(after.wallTimeMs, 'Real capture clock must be monotonic').toBeGreaterThanOrEqual(before.wallTimeMs);
  }
  for (let index = 0; index < before.readings.length; index++) {
    const first = before.readings[index];
    const next = after.readings[index];
    if (!first.observationAgeRole) {
      expect(next.text, `${first.id}: non-age reading text must remain exact`).toBe(first.text);
      continue;
    }
    const source = before.observationSource;
    if (!source) throw new Error('Missing source-bound age provenance');
    const firstAge = ageInterval(first.text, first.observationAgeRole);
    const nextAge = ageInterval(next.text, first.observationAgeRole);
    expect(nextAge.order, `${first.id}: observation age must not decrease`).toBeGreaterThanOrEqual(firstAge.order);
    if (!first.observationAgeLayout?.length || !next.observationAgeLayout?.length) {
      throw new Error(`${first.id}: source-bound age evolution needs actual measured containing layout`);
    }
    expect(next.observationAgeLayout, `${first.id}: source-bound age containing layout must remain exact`)
      .toEqual(first.observationAgeLayout);
    if (next.text === first.text) {
      expect(next.relativeRight, `${first.id}: unchanged age text must retain exact intrinsic extent`)
        .toBe(first.relativeRight);
    }
    for (const [frame, reading, interval] of [[before, first, firstAge], [after, next, nextAge]] as const) {
      expect(frame.wallTimeMs).toBeGreaterThanOrEqual(source.earliestRenderAt);
      expect(interval.to, `${reading.id}: age cannot predate any possible source-backed render`)
        .toBeGreaterThan(source.earliestRenderAt - source.observedAt);
      expect(interval.from, `${reading.id}: age cannot exceed real observation-to-capture elapsed time`)
        .toBeLessThanOrEqual(frame.wallTimeMs - source.observedAt);
      for (const layout of reading.observationAgeLayout ?? []) {
        if (layout.clipsX) {
          expect(reading.relativeLeft, `${reading.id}: Full source-bound age glyph must remain contained horizontally`)
            .toBeGreaterThanOrEqual(layout.clipBounds.left);
          expect(reading.relativeRight, `${reading.id}: Full source-bound age glyph must remain contained horizontally`)
            .toBeLessThanOrEqual(layout.clipBounds.right);
        }
        if (layout.clipsY) {
          expect(reading.relativeTop, `${reading.id}: Full source-bound age glyph must remain contained vertically`)
            .toBeGreaterThanOrEqual(layout.clipBounds.top);
          expect(reading.relativeBottom, `${reading.id}: Full source-bound age glyph must remain contained vertically`)
            .toBeLessThanOrEqual(layout.clipBounds.bottom);
        }
      }
      if (reading.top >= frame.usable.top && reading.bottom <= frame.usable.bottom) {
        expect(reading.hitInsidePanel, `${reading.text}: reading occluded at native center hit`).toBe(true);
      }
    }
  }
}
