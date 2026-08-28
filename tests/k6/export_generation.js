// OPS-10 capacity profile: `export-generation`.
//
// Drives parallel large export requests through the export worker to
// size memory, temp storage, and object-storage upload throughput.
//
// DESTRUCTIVE: it enqueues real export jobs and writes real artifacts.
// ops/capacity/profiles.yaml marks this profile
// `destructive: true`, which means the runner MUST point it at an
// ephemeral stack. This script enforces both guards itself:
//   * CONFIRM=RUN must be set.
//   * EPHEMERAL=1 must be set, asserting the target stack is disposable.
//
//   k6 run -e BASE_URL=http://localhost:8080 -e CONFIRM=RUN -e EPHEMERAL=1 \
//          tests/k6/export_generation.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const CONFIRM = __ENV.CONFIRM || '';
const EPHEMERAL = __ENV.EPHEMERAL || '';
const AUTH_HEADER = __ENV.AUTH_HEADER || 'X-Forwarded-User';
const AUTH_VALUE = __ENV.AUTH_VALUE || '';
const CONCURRENT = parseInt(__ENV.CONCURRENT || '10', 10);
const HOLD = __ENV.HOLD || '10m';

const enqueueLatency = new Trend('export_enqueue_ms', true);
const exportErrors = new Rate('export_errors');

export const options = {
  scenarios: {
    exports: {
      executor: 'constant-vus',
      vus: CONCURRENT,
      duration: HOLD,
      tags: { profile: 'export-generation' },
    },
  },
  thresholds: {
    export_errors: ['rate<0.01'],
    'http_req_failed{type:5xx}': ['rate==0'],
  },
};

export function setup() {
  if (CONFIRM !== 'RUN') {
    throw new Error(
      'refusing to generate load: set CONFIRM=RUN (see ops/capacity/profiles.yaml safety.require_confirmation)'
    );
  }
  if (EPHEMERAL !== '1') {
    throw new Error(
      'export-generation is marked destructive: set EPHEMERAL=1 to assert the target stack is disposable ' +
        '(ops/capacity/profiles.yaml safety.destructive_profiles_require_ephemeral_stack)'
    );
  }
  return {};
}

function headers() {
  const h = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (AUTH_VALUE) h[AUTH_HEADER] = AUTH_VALUE;
  return h;
}

export default function () {
  const body = JSON.stringify({
    format: 'csv',
    data_type: 'drives',
    date_from: '2020-01-01T00:00:00Z',
    date_to: '2030-01-01T00:00:00Z',
  });
  const res = http.post(`${BASE_URL}/api/v1/exports`, body, {
    headers: headers(),
    tags: { endpoint: 'exports' },
  });
  enqueueLatency.add(res.timings.duration);
  const ok = check(res, {
    'status acceptable': (r) => r.status < 500,
  });
  exportErrors.add(!ok);
  sleep(5);
}

export function handleSummary(data) {
  const summary = {
    profile: 'export-generation',
    base_url: BASE_URL,
    concurrent: CONCURRENT,
    enqueue_p95_ms: data.metrics.export_enqueue_ms
      ? data.metrics.export_enqueue_ms.values['p(95)']
      : null,
    error_rate: data.metrics.export_errors ? data.metrics.export_errors.values.rate : null,
  };
  return {
    stdout: JSON.stringify(summary, null, 2),
    'tests/k6/summary-export-generation.json': JSON.stringify(summary, null, 2),
  };
}
