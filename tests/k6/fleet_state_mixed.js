// Capacity profile: `fleet-state-mixed`.
//
// Runs the fleet-state REST batch read (see fleet_state_batch.js) and
// the SSE fan-out subscriber load (see sse_fanout.js) CONCURRENTLY in
// the same k6 run. k6 executes every entry under `options.scenarios` in
// parallel by default, so this profile models the real production mix:
// operators polling/paging the fleet roster over REST while every
// connected browser tab holds a live EventSource subscription open —
// the two paths share the same Redis Pub/Sub fan-out and DB pool, so
// testing them in isolation understates contention either one alone
// would not reveal.
//
// SAFE OPT-IN. This script generates real load. It refuses to run
// unless CONFIRM=RUN is set, and it refuses to point at anything that
// is not explicitly allow-listed in ops/capacity/profiles.yaml
// (local / ephemeral-ci / staging).
//
//   k6 run -e CONFIRM=RUN -e TARGET_ENV=local -e VEHICLES=500 \
//     -e SUBSCRIBERS=200 -e BASE_URL=http://localhost:8080 \
//     tests/k6/fleet_state_mixed.js
import http from 'k6/http';
import sse from 'k6/x/sse';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const CONFIRM = __ENV.CONFIRM || '';
const TARGET_ENV = __ENV.TARGET_ENV || 'local';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const AUTH_HEADER = __ENV.AUTH_HEADER || 'X-Forwarded-User';
const AUTH_VALUE = __ENV.AUTH_VALUE || '';
const VEHICLES = parseInt(__ENV.VEHICLES || '500', 10);
const SUBSCRIBERS = parseInt(__ENV.SUBSCRIBERS || '200', 10);
const RAMP = __ENV.RAMP || '30s';
const HOLD = __ENV.HOLD || '5m';

const MAX_PAGE_SIZE = 500;
const MAX_VEHICLES = 5000;

const allowedEnvironments = new Set(['local', 'ephemeral-ci', 'staging']);

const fleetBatchLatency = new Trend('fleet_state_batch_ms', true);
const fleetBatchErrors = new Rate('fleet_state_batch_errors');
const fleetBatchIncomplete = new Rate('fleet_state_batch_incomplete');
const fleetScanIncomplete = new Rate('fleet_state_scan_incomplete');

const sseConnectLatency = new Trend('sse_connect_ms', true);
const sseStreamBytes = new Counter('sse_stream_bytes');
const sseVehicleUpdates = new Counter('sse_vehicle_updates');
const sseConnectFailures = new Rate('sse_connect_failures');

export const options = {
  scenarios: {
    fleetBatch: {
      executor: 'ramping-vus',
      exec: 'fleetBatch',
      startVUs: 1,
      stages: [
        { duration: RAMP, target: Math.max(1, Math.round(SUBSCRIBERS / 10)) },
        { duration: HOLD, target: Math.max(1, Math.round(SUBSCRIBERS / 10)) },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
      tags: { profile: 'fleet-state-mixed', leg: 'rest' },
    },
    sseFanout: {
      executor: 'ramping-vus',
      exec: 'sseSubscribe',
      startVUs: 1,
      stages: [
        { duration: RAMP, target: SUBSCRIBERS },
        { duration: HOLD, target: SUBSCRIBERS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
      tags: { profile: 'fleet-state-mixed', leg: 'sse' },
    },
  },
  thresholds: {
    fleet_state_batch_errors: ['rate<0.01'],
    fleet_state_batch_incomplete: ['rate<0.01'],
    fleet_state_scan_incomplete: ['rate<0.01'],
    fleet_state_batch_ms: ['p(95)<1000', 'p(99)<1500'],
    sse_connect_failures: ['rate<0.01'],
    sse_connect_ms: ['p(95)<1000'],
    sse_stream_bytes: ['count>0'],
    sse_vehicle_updates: ['count>0'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  if (CONFIRM !== 'RUN') {
    throw new Error(
      'refusing to generate load: set CONFIRM=RUN (see ops/capacity/profiles.yaml)',
    );
  }
  if (!allowedEnvironments.has(TARGET_ENV) || /prod/i.test(TARGET_ENV)) {
    throw new Error(`refusing disallowed target environment: ${TARGET_ENV}`);
  }
  if (!Number.isInteger(VEHICLES) || VEHICLES < 1 || VEHICLES > MAX_VEHICLES) {
    throw new Error(`VEHICLES must be an integer from 1 through ${MAX_VEHICLES}, got ${VEHICLES}`);
  }
  if (!Number.isInteger(SUBSCRIBERS) || SUBSCRIBERS < 1 || SUBSCRIBERS > 2000) {
    throw new Error(`SUBSCRIBERS must be an integer from 1 through 2000, got ${SUBSCRIBERS}`);
  }
}

function restHeaders() {
  const result = { Accept: 'application/json' };
  if (AUTH_TOKEN) result.Authorization = 'Bearer ' + AUTH_TOKEN;
  if (AUTH_VALUE) result[AUTH_HEADER] = AUTH_VALUE;
  return result;
}

function sseHeaders() {
  const h = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
  if (AUTH_TOKEN) h.Authorization = 'Bearer ' + AUTH_TOKEN;
  if (AUTH_VALUE) h[AUTH_HEADER] = AUTH_VALUE;
  return h;
}

function fetchPage(offset, limit) {
  const response = http.get(
    `${BASE_URL}/api/v1/vehicles/states?limit=${limit}&offset=${offset}`,
    {
      headers: restHeaders(),
      tags: { endpoint: 'fleet-state-batch' },
      timeout: '10s',
    },
  );
  fleetBatchLatency.add(response.timings.duration);

  let payload = null;
  try {
    payload = response.json();
  } catch {
    payload = null;
  }
  const batch = payload && typeof payload === 'object' ? payload.data : null;
  const vehicles = batch && Array.isArray(batch.vehicles) ? batch.vehicles : null;
  const vehicleIDs = vehicles === null ? [] : vehicles.map((vehicle) => vehicle.vehicle_id);
  const validVehicleIDs = vehicleIDs.length === limit
    && vehicleIDs.every((id) => Number.isSafeInteger(id) && id > 0)
    && new Set(vehicleIDs).size === limit;
  const complete = response.status === 200
    && vehicles !== null
    && vehicles.length === limit
    && batch.total === VEHICLES
    && batch.limit === limit
    && batch.offset === offset
    && batch.summary
    && batch.summary.counted === limit
    && validVehicleIDs;
  const healthy = check(response, {
    'fleet batch page returns 200': (res) => res.status === 200,
    'fleet batch page is JSON': (res) =>
      (res.headers['Content-Type'] || '').includes('application/json'),
    'fleet batch page is fully populated': () => complete,
  });
  fleetBatchErrors.add(!healthy);
  fleetBatchIncomplete.add(!complete);
  return complete ? vehicleIDs : null;
}

// fleetBatch is the REST leg: one full paginated scan of VEHICLES per
// iteration, exactly like fleet_state_batch.js.
export function fleetBatch() {
  const seenVehicleIDs = new Set();
  let complete = true;
  for (let offset = 0; offset < VEHICLES; offset += MAX_PAGE_SIZE) {
    const limit = Math.min(MAX_PAGE_SIZE, VEHICLES - offset);
    const vehicleIDs = fetchPage(offset, limit);
    if (vehicleIDs === null) {
      complete = false;
      continue;
    }
    for (const vehicleID of vehicleIDs) {
      if (seenVehicleIDs.has(vehicleID)) complete = false;
      seenVehicleIDs.add(vehicleID);
    }
  }
  fleetScanIncomplete.add(!complete || seenVehicleIDs.size !== VEHICLES);
  sleep(0.1);
}

// sseSubscribe is the SSE leg: one long-lived subscriber connection per
// iteration, exactly like sse_fanout.js.
export function sseSubscribe() {
  const started = Date.now();
  let connected = false;
  const response = sse.open(`${BASE_URL}/api/v1/events`, {
    method: 'GET',
    headers: sseHeaders(),
    tags: { endpoint: 'sse' },
  }, (client) => {
    client.on('event', (event) => {
      if (event.name === 'connected' && !connected) {
        connected = true;
        sseConnectLatency.add(Date.now() - started);
        sseConnectFailures.add(false);
      }
      if (event.name === 'vehicle_update') {
        sseVehicleUpdates.add(1);
        if (event.data) sseStreamBytes.add(String(event.data).length);
      }
    });
    client.on('error', () => {
      client.close();
    });
  });

  if (!connected) {
    sseConnectFailures.add(true);
    check(response, {
      'sse handshake returns 200': (r) => r !== null && r.status === 200,
      'sse handshake returns event stream': (r) =>
        r !== null && (r.headers['Content-Type'] || '').includes('text/event-stream'),
    });
  }
  sleep(0.1);
}

export function handleSummary(data) {
  const batchLatency = data.metrics.fleet_state_batch_ms?.values || {};
  const sseLatency = data.metrics.sse_connect_ms?.values || {};
  const summary = {
    profile: 'fleet-state-mixed',
    target_environment: TARGET_ENV,
    fleet_size: VEHICLES,
    subscribers: SUBSCRIBERS,
    rest_page_p95_ms: batchLatency['p(95)'] ?? null,
    rest_page_p99_ms: batchLatency['p(99)'] ?? null,
    rest_error_rate: data.metrics.fleet_state_batch_errors?.values.rate ?? null,
    rest_scan_incomplete_rate: data.metrics.fleet_state_scan_incomplete?.values.rate ?? null,
    sse_connect_p95_ms: sseLatency['p(95)'] ?? null,
    sse_connect_failure_rate: data.metrics.sse_connect_failures?.values.rate ?? null,
    sse_stream_bytes: data.metrics.sse_stream_bytes?.values.count ?? 0,
    sse_vehicle_updates: data.metrics.sse_vehicle_updates?.values.count ?? 0,
  };
  return {
    stdout: JSON.stringify(summary, null, 2),
    'tests/k6/summary-fleet-state-mixed.json': JSON.stringify(summary, null, 2),
  };
}
