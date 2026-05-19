// k6 baseline load test for the TeslaSync API.
//
// Goal: a reproducible smoke + soak that asserts the hot-path
// endpoints meet their SLOs under realistic load. Designed to run
// against a local docker-compose stack or a staging cluster — not
// production.
//
// Usage:
//   k6 run loadtest/baseline.js
//   k6 run --env BASE_URL=https://staging.example.com loadtest/baseline.js
//   k6 run --env STAGE=soak loadtest/baseline.js
//
// Stages:
//   smoke  — 30 s @ 1 VU                  (default, runs in CI)
//   load   — ramp 0→50 VUs, hold 5 min
//   soak   — 50 VUs for 30 min            (manual / staging)

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const STAGE = __ENV.STAGE || 'smoke';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

// Per-endpoint metrics so the summary makes the SLO breach obvious
// instead of hiding it in a global p99 number.
const apiDuration = new Trend('endpoint_duration_ms', true);
const apiErrors = new Rate('endpoint_error_rate');
const apiRequests = new Counter('endpoint_requests_total');

const STAGES = {
  smoke: {
    stages: [{ duration: '30s', target: 1 }],
    thresholds: {
      http_req_failed: ['rate<0.01'],
      http_req_duration: ['p(95)<1000'],
      endpoint_error_rate: ['rate<0.01'],
    },
  },
  load: {
    stages: [
      { duration: '1m', target: 10 },
      { duration: '2m', target: 50 },
      { duration: '5m', target: 50 },
      { duration: '1m', target: 0 },
    ],
    thresholds: {
      http_req_failed: ['rate<0.005'],           // SLO: 99.5% availability
      http_req_duration: ['p(99)<500'],          // SLO: api_latency_p99_500ms
      endpoint_error_rate: ['rate<0.005'],
    },
  },
  soak: {
    stages: [
      { duration: '2m', target: 50 },
      { duration: '30m', target: 50 },
      { duration: '2m', target: 0 },
    ],
    thresholds: {
      http_req_failed: ['rate<0.005'],
      http_req_duration: ['p(99)<500', 'p(99.9)<2000'],
      endpoint_error_rate: ['rate<0.005'],
    },
  },
};

if (!STAGES[STAGE]) {
  throw new Error(`unknown STAGE=${STAGE}; valid: ${Object.keys(STAGES).join(', ')}`);
}

export const options = STAGES[STAGE];

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h.Authorization = `Bearer ${AUTH_TOKEN}`;
  return h;
}

// Endpoints exercised in the smoke + load run. Picked to cover every
// repository in the hot path: vehicle list (read pool), state read
// (live signals + Redis), drive list (TimescaleDB hypertable query),
// fleet aggregate (continuous aggregate).
const ENDPOINTS = [
  { name: 'health',        method: 'GET', path: '/healthz',                  weight: 1, expect: 200 },
  { name: 'ready',         method: 'GET', path: '/readyz',                   weight: 1, expect: 200 },
  { name: 'vehicles',      method: 'GET', path: '/api/v1/vehicles',          weight: 5, expect: 200 },
  { name: 'drives',        method: 'GET', path: '/api/v1/drives?limit=20',   weight: 4, expect: 200 },
  { name: 'fleet',         method: 'GET', path: '/api/v1/analytics/fleet',   weight: 2, expect: 200 },
  { name: 'system_status', method: 'GET', path: '/api/v1/system/status',     weight: 1, expect: 200 },
];

// Build a weighted bag so the iteration picks roughly proportional
// to the documented weight without adding a heavier dependency.
const BAG = ENDPOINTS.flatMap((e) => Array(e.weight).fill(e));

export default function () {
  const ep = BAG[Math.floor(Math.random() * BAG.length)];
  const url = `${BASE_URL}${ep.path}`;
  const res = http.request(ep.method, url, null, {
    headers: headers(),
    tags: { endpoint: ep.name },
  });

  apiRequests.add(1, { endpoint: ep.name });
  apiDuration.add(res.timings.duration, { endpoint: ep.name });
  apiErrors.add(res.status !== ep.expect, { endpoint: ep.name });

  check(res, {
    [`${ep.name}: status is ${ep.expect}`]: (r) => r.status === ep.expect,
    [`${ep.name}: body present`]: (r) => r.body && r.body.length > 0,
  }, { endpoint: ep.name });

  // Pace the VU loop so we don't accidentally DoS the local stack.
  sleep(1);
}
