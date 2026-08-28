// OPS-10 capacity profile: `analytics-query`.
//
// Concurrent reads across the heaviest analytics endpoints to expose
// hypertable scan regressions and pgx pool starvation.
//
// SAFE OPT-IN — requires CONFIRM=RUN. Read-only: it issues GETs only.
//
//   k6 run -e BASE_URL=http://localhost:8080 -e CONFIRM=RUN \
//          -e VUS=50 tests/k6/analytics_read.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const CONFIRM = __ENV.CONFIRM || '';
const AUTH_HEADER = __ENV.AUTH_HEADER || 'X-Forwarded-User';
const AUTH_VALUE = __ENV.AUTH_VALUE || '';
const VUS = parseInt(__ENV.VUS || '50', 10);
const HOLD = __ENV.HOLD || '5m';
const RAMP = __ENV.RAMP || '1m';

const analyticsLatency = new Trend('analytics_read_ms', true);
const analyticsErrors = new Rate('analytics_read_errors');

// Heaviest read paths per internal/api/router.go. Each one fans out
// across hypertables or continuous aggregates.
const ENDPOINTS = [
  '/api/v1/analytics/fleet',
  '/api/v1/analytics/battery-degradation',
  '/api/v1/analytics/route-efficiency',
  '/api/v1/analytics/speed-profile',
  '/api/v1/analytics/temperature-impact',
  '/api/v1/analytics/regen',
];

export const options = {
  scenarios: {
    analytics: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: HOLD, target: VUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
      tags: { profile: 'analytics-query' },
    },
  },
  thresholds: {
    // Mirrors ops/capacity/profiles.yaml analytics-query thresholds.
    analytics_read_ms: ['p(99)<1500'],
    analytics_read_errors: ['rate<0.01'],
    'http_req_failed{type:5xx}': ['rate==0'],
  },
};

export function setup() {
  if (CONFIRM !== 'RUN') {
    throw new Error(
      'refusing to generate load: set CONFIRM=RUN (see ops/capacity/profiles.yaml safety.require_confirmation)'
    );
  }
  return {};
}

function headers() {
  const h = { Accept: 'application/json' };
  if (AUTH_VALUE) h[AUTH_HEADER] = AUTH_VALUE;
  return h;
}

export default function () {
  for (const path of ENDPOINTS) {
    group(path, () => {
      const res = http.get(`${BASE_URL}${path}`, {
        headers: headers(),
        tags: { endpoint: path },
      });
      analyticsLatency.add(res.timings.duration);
      const ok = check(res, {
        'status acceptable': (r) => r.status === 200 || r.status === 401 || r.status === 404,
        'no server error': (r) => r.status < 500,
      });
      analyticsErrors.add(!ok);
    });
  }
  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    profile: 'analytics-query',
    base_url: BASE_URL,
    vus: VUS,
    p99_ms: data.metrics.analytics_read_ms
      ? data.metrics.analytics_read_ms.values['p(99)']
      : null,
    error_rate: data.metrics.analytics_read_errors
      ? data.metrics.analytics_read_errors.values.rate
      : null,
  };
  return {
    stdout: JSON.stringify(summary, null, 2),
    'tests/k6/summary-analytics-query.json': JSON.stringify(summary, null, 2),
  };
}
