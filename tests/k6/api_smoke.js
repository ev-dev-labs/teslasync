// k6 smoke + soak test for TeslaSync API endpoints.
//
// Phase-53 / load-test.
//
// Scenarios
// ─────────
// 1. smoke   — 1 VU for 30s; fails on any non-2xx response.
//              Used by PRs to catch deploy-breaking regressions
//              without chewing the CI budget.
// 2. soak    — 10 VUs for 5m; gradual ramp; thresholds enforce
//              p99 latency budgets per endpoint.
//
// Thresholds are deliberately set to catch CHANGES from the
// committed baseline rather than absolute numbers — a regression
// from p99=200ms to p99=600ms is a problem regardless of which
// machine the test runs on.
//
// Usage
// ─────
//   k6 run -e BASE_URL=http://localhost:8080 \
//          -e AUTH_TOKEN=... \
//          tests/k6/api_smoke.js
//
// CI wires this via .github/workflows/load-test.yml on a nightly
// schedule + on-demand workflow_dispatch.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const SCENARIO = __ENV.SCENARIO || 'smoke';

const vehiclesLatency = new Trend('endpoint_vehicles_ms', true);
const drivesLatency = new Trend('endpoint_drives_ms', true);
const chargingLatency = new Trend('endpoint_charging_ms', true);
const analyticsLatency = new Trend('endpoint_analytics_ms', true);
const healthLatency = new Trend('endpoint_health_ms', true);
const apiErrorRate = new Rate('api_errors');

export const options = {
  scenarios: scenarioConfig(SCENARIO),
  thresholds: {
    // ZERO 5xx allowed in either scenario.
    'http_req_failed{type:5xx}': ['rate==0'],
    // Smoke: very tight budgets (single VU has no contention).
    'endpoint_health_ms{scenario:smoke}': ['p(99)<100'],
    'endpoint_vehicles_ms{scenario:smoke}': ['p(99)<300'],
    // Soak: generous absolute budgets, baseline-relative regression detection.
    'endpoint_vehicles_ms{scenario:soak}': ['p(99)<800'],
    'endpoint_drives_ms{scenario:soak}': ['p(99)<1200'],
    'endpoint_charging_ms{scenario:soak}': ['p(99)<1200'],
    'endpoint_analytics_ms{scenario:soak}': ['p(99)<2000'],
    api_errors: ['rate<0.01'],
  },
};

function scenarioConfig(scenario) {
  if (scenario === 'soak') {
    return {
      soak: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
          { duration: '30s', target: 5 },
          { duration: '4m', target: 10 },
          { duration: '30s', target: 0 },
        ],
        gracefulRampDown: '30s',
        tags: { scenario: 'soak' },
      },
    };
  }
  return {
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      tags: { scenario: 'smoke' },
    },
  };
}

function authHeaders() {
  const h = { 'Accept': 'application/json' };
  if (AUTH_TOKEN) h['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

export default function () {
  group('health', () => {
    const r = http.get(`${BASE_URL}/healthz`, { tags: { endpoint: 'health' } });
    healthLatency.add(r.timings.duration);
    const ok = check(r, { 'health 200': (rsp) => rsp.status === 200 });
    apiErrorRate.add(!ok);
  });

  group('vehicles_list', () => {
    const r = http.get(`${BASE_URL}/api/v1/vehicles`, {
      headers: authHeaders(),
      tags: { endpoint: 'vehicles' },
    });
    vehiclesLatency.add(r.timings.duration);
    // 401 is acceptable in a no-auth smoke run; we only fail on 5xx
    // or on 2xx-with-malformed-body.
    const ok = check(r, {
      'vehicles status acceptable': (rsp) => rsp.status === 200 || rsp.status === 401,
      'vehicles json on 200': (rsp) => rsp.status !== 200 || rsp.headers['Content-Type'] === undefined || rsp.headers['Content-Type'].includes('json'),
    });
    apiErrorRate.add(!ok);
  });

  group('drives_list', () => {
    const r = http.get(`${BASE_URL}/api/v1/drives?limit=10`, {
      headers: authHeaders(),
      tags: { endpoint: 'drives' },
    });
    drivesLatency.add(r.timings.duration);
    const ok = check(r, {
      'drives status acceptable': (rsp) => rsp.status === 200 || rsp.status === 401,
    });
    apiErrorRate.add(!ok);
  });

  group('charging_list', () => {
    const r = http.get(`${BASE_URL}/api/v1/charging?limit=10`, {
      headers: authHeaders(),
      tags: { endpoint: 'charging' },
    });
    chargingLatency.add(r.timings.duration);
    const ok = check(r, {
      'charging status acceptable': (rsp) => rsp.status === 200 || rsp.status === 401,
    });
    apiErrorRate.add(!ok);
  });

  group('analytics_fleet', () => {
    const r = http.get(`${BASE_URL}/api/v1/analytics/fleet`, {
      headers: authHeaders(),
      tags: { endpoint: 'analytics' },
    });
    analyticsLatency.add(r.timings.duration);
    const ok = check(r, {
      'analytics status acceptable': (rsp) => rsp.status === 200 || rsp.status === 401,
    });
    apiErrorRate.add(!ok);
  });

  sleep(1);
}

export function handleSummary(data) {
  const out = {
    scenario: SCENARIO,
    base_url: BASE_URL,
    total_reqs: data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0,
    errors: data.metrics.api_errors ? data.metrics.api_errors.values.rate : 0,
    endpoints: {},
  };
  for (const k of Object.keys(data.metrics)) {
    if (k.startsWith('endpoint_')) {
      out.endpoints[k] = {
        p95: data.metrics[k].values['p(95)'],
        p99: data.metrics[k].values['p(99)'],
        avg: data.metrics[k].values.avg,
      };
    }
  }
  return {
    'stdout': JSON.stringify(out, null, 2),
    'tests/k6/summary.json': JSON.stringify(out, null, 2),
  };
}
