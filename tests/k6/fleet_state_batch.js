// Capacity profile: `fleet-state-batch`.
//
// Exercises the canonical GET /api/v1/vehicles/states bulk read with the
// maximum supported page size. The profile validates both latency and response
// completeness so a fast partial response cannot pass.
//
// Safe local invocation:
//   k6 run -e CONFIRM=RUN -e TARGET_ENV=local \
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

const allowedEnvironments = new Set(['local', 'ephemeral-ci', 'staging']);
const fleetBatchLatency = new Trend('fleet_state_batch_ms', true);
const fleetBatchErrors = new Rate('fleet_state_batch_errors');
const fleetBatchIncomplete = new Rate('fleet_state_batch_incomplete');

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
      tags: { profile: 'fleet-state-batch' },
    },
  },
  thresholds: {
    fleet_state_batch_errors: ['rate<0.01'],
    fleet_state_batch_incomplete: ['rate<0.01'],
    fleet_state_batch_ms: ['p(95)<750', 'p(99)<1500'],
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
  if (!Number.isInteger(VEHICLES) || VEHICLES < 1 || VEHICLES > 500) {
    throw new Error(`VEHICLES must be an integer from 1 through 500, got ${VEHICLES}`);
  }
  if (!Number.isInteger(VUS) || VUS < 1 || VUS > 100) {
    throw new Error(`VUS must be an integer from 1 through 100, got ${VUS}`);
  }
}

function headers() {
  const result = { Accept: 'application/json' };
  if (AUTH_TOKEN) result.Authorization = `Bearer ${AUTH_TOKEN}`;
  if (AUTH_VALUE) result[AUTH_HEADER] = AUTH_VALUE;
  return result;
}

export default function () {
  const response = http.get(`${BASE_URL}/api/v1/vehicles/states?limit=${VEHICLES}`, {
    headers: headers(),
    tags: { endpoint: 'fleet-state-batch' },
    timeout: '10s',
  });
  fleetBatchLatency.add(response.timings.duration);

  let payload = null;
  try {
    payload = response.json();
  } catch {
    payload = null;
  }
  const batch = payload && typeof payload === 'object' ? payload.data : null;
  const vehicles = batch && Array.isArray(batch.vehicles) ? batch.vehicles : null;
  const complete = response.status === 200
    && vehicles !== null
    && vehicles.length === VEHICLES
    && batch.summary
    && batch.summary.counted === VEHICLES;
  const healthy = check(response, {
    'fleet batch returns 200': (res) => res.status === 200,
    'fleet batch is JSON': (res) =>
      (res.headers['Content-Type'] || '').includes('application/json'),
    'fleet batch contains every seeded vehicle': () => complete,
  });
  fleetBatchErrors.add(!healthy);
  fleetBatchIncomplete.add(!complete);
  sleep(0.1);
}

export function handleSummary(data) {
  const latency = data.metrics.fleet_state_batch_ms?.values || {};
  const summary = {
    profile: 'fleet-state-batch',
    target_environment: TARGET_ENV,
    fleet_size: VEHICLES,
    virtual_users: VUS,
    requests: data.metrics.http_reqs?.values.count || 0,
    p95_ms: latency['p(95)'] ?? null,
    p99_ms: latency['p(99)'] ?? null,
    error_rate: data.metrics.fleet_state_batch_errors?.values.rate ?? null,
    incomplete_rate: data.metrics.fleet_state_batch_incomplete?.values.rate ?? null,
  };
  return {
    stdout: JSON.stringify(summary, null, 2),
    'tests/k6/summary-fleet-state-batch.json': JSON.stringify(summary, null, 2),
  };
}
