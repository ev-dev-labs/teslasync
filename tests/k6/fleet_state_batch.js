// Capacity profile: `fleet-state-batch`.
//
// Exercises the canonical GET /api/v1/vehicles/states bulk read across
// three fleet-size tiers (100 / 500 / 5,000 vehicles — see
// ops/capacity/profiles.yaml fleet-state-batch-100/-500/-5000). The
// endpoint caps `limit` at 500 server-side, so any fleet size above 500
// is walked as a sequence of offset-paginated 500-row pages within a
// single VU iteration — the same access pattern the SPA's fleet-wide
// roster fetch would use for a fleet that size. The profile validates
// both latency and response completeness (every page fully populated,
// and the whole paginated scan accounts for every requested vehicle) so
// a fast partial response cannot pass.
//
// Safe local invocation:
//   k6 run -e CONFIRM=RUN -e TARGET_ENV=local -e VEHICLES=500 \
//     -e BASE_URL=http://localhost:8080 tests/k6/fleet_state_batch.js
//
//   # 5,000-vehicle fleet, walked as ten 500-row pages per iteration:
//   k6 run -e CONFIRM=RUN -e TARGET_ENV=local -e VEHICLES=5000 \
//     -e BASE_URL=http://localhost:8080 tests/k6/fleet_state_batch.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const CONFIRM = __ENV.CONFIRM || '';
const TARGET_ENV = __ENV.TARGET_ENV || 'local';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const AUTH_HEADER = __ENV.AUTH_HEADER || 'X-Forwarded-User';
const AUTH_VALUE = __ENV.AUTH_VALUE || '';
const VEHICLES = parseInt(__ENV.VEHICLES || '500', 10);
const VUS = parseInt(__ENV.VUS || '25', 10);
const RAMP = __ENV.RAMP || '30s';
const HOLD = __ENV.HOLD || '5m';

// The fleet-state endpoint's server-side page-size ceiling
// (fleetstatesvc.MaxLimit). Any VEHICLES above this is walked as
// multiple offset-paginated pages per iteration instead of one request.
const MAX_PAGE_SIZE = 500;
const MAX_VEHICLES = 5000;
const PAGE_P95_MS = VEHICLES <= 100 ? 400 : 750;
const PAGE_P99_MS = VEHICLES <= 100 ? 800 : 1500;

const allowedEnvironments = new Set(['local', 'ephemeral-ci', 'staging']);
// Per-page latency/completeness (one page == one HTTP request).
const fleetBatchLatency = new Trend('fleet_state_batch_ms', true);
const fleetBatchErrors = new Rate('fleet_state_batch_errors');
const fleetBatchIncomplete = new Rate('fleet_state_batch_incomplete');
// Whole-scan latency/completeness (one scan == every page needed to
// cover VEHICLES; equals a single page's metrics when VEHICLES <= 500).
const fleetScanLatency = new Trend('fleet_state_scan_ms', true);
const fleetScanIncomplete = new Rate('fleet_state_scan_incomplete');

export const options = {
  scenarios: {
    fleetBatch: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: HOLD, target: VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
      tags: { profile: `fleet-state-batch-${VEHICLES}` },
    },
  },
  thresholds: {
    fleet_state_batch_errors: ['rate<0.01'],
    fleet_state_batch_incomplete: ['rate<0.01'],
    fleet_state_batch_ms: [`p(95)<${PAGE_P95_MS}`, `p(99)<${PAGE_P99_MS}`],
    fleet_state_scan_incomplete: ['rate<0.01'],
    // The full paginated scan of a 5,000-vehicle fleet is ten
    // sequential requests; its p95/p99 budget scales accordingly so a
    // healthy 10-page scan doesn't trip the same ceiling as one page.
    fleet_state_scan_ms: ['p(95)<4000', 'p(99)<8000'],
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
  if (!Number.isInteger(VUS) || VUS < 1 || VUS > 100) {
    throw new Error(`VUS must be an integer from 1 through 100, got ${VUS}`);
  }
}

function headers() {
  const result = { Accept: 'application/json' };
  if (AUTH_TOKEN) result.Authorization = 'Bearer ' + AUTH_TOKEN;
  if (AUTH_VALUE) result[AUTH_HEADER] = AUTH_VALUE;
  return result;
}

// fetchPage issues one bounded-size page request and records its
// per-page latency/completeness metrics. Returns the number of
// vehicles the page reported (0 on any failure) so the caller can
// track how much of VEHICLES the whole scan actually covered.
function fetchPage(offset, limit) {
  const response = http.get(
    `${BASE_URL}/api/v1/vehicles/states?limit=${limit}&offset=${offset}`,
    {
      headers: headers(),
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

export default function () {
  const scanStart = Date.now();
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
  fleetScanLatency.add(Date.now() - scanStart);
  fleetScanIncomplete.add(!complete || seenVehicleIDs.size !== VEHICLES);
  sleep(0.1);
}

export function handleSummary(data) {
  const latency = data.metrics.fleet_state_batch_ms?.values || {};
  const scanLatency = data.metrics.fleet_state_scan_ms?.values || {};
  const summary = {
    profile: `fleet-state-batch-${VEHICLES}`,
    target_environment: TARGET_ENV,
    fleet_size: VEHICLES,
    pages_per_scan: Math.ceil(VEHICLES / MAX_PAGE_SIZE),
    virtual_users: VUS,
    requests: data.metrics.http_reqs?.values.count || 0,
    page_p95_ms: latency['p(95)'] ?? null,
    page_p99_ms: latency['p(99)'] ?? null,
    scan_p95_ms: scanLatency['p(95)'] ?? null,
    scan_p99_ms: scanLatency['p(99)'] ?? null,
    error_rate: data.metrics.fleet_state_batch_errors?.values.rate ?? null,
    incomplete_rate: data.metrics.fleet_state_batch_incomplete?.values.rate ?? null,
    scan_incomplete_rate: data.metrics.fleet_state_scan_incomplete?.values.rate ?? null,
  };
  return {
    stdout: JSON.stringify(summary, null, 2),
    'tests/k6/summary-fleet-state-batch.json': JSON.stringify(summary, null, 2),
  };
}
