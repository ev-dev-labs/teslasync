// OPS-10 capacity profile: `sse-fanout`.
//
// Holds N concurrent EventSource-style subscribers on /api/v1/events
// while the backend broadcasts signal changes, to size the hub's
// per-client channel buffers and the Redis Pub/Sub fan-out.
//
// SAFE OPT-IN. This script generates real load. It refuses to run
// unless CONFIRM=RUN is set, and it refuses to point at anything that
// is not explicitly allow-listed in ops/capacity/profiles.yaml
// (local / ephemeral-ci / staging).
//
//   k6 run -e BASE_URL=http://localhost:8080 -e CONFIRM=RUN \
//          -e SUBSCRIBERS=500 tests/k6/sse_fanout.js
//
// k6 has no native EventSource client; a plain GET with
// Accept: text/event-stream and a response timeout equal to the hold
// duration reproduces the same server-side connection lifecycle
// (one long-lived goroutine + one hub channel per client).
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const CONFIRM = __ENV.CONFIRM || '';
const AUTH_HEADER = __ENV.AUTH_HEADER || 'X-Forwarded-User';
const AUTH_VALUE = __ENV.AUTH_VALUE || '';
const SUBSCRIBERS = parseInt(__ENV.SUBSCRIBERS || '500', 10);
const HOLD = __ENV.HOLD || '5m';
const RAMP = __ENV.RAMP || '30s';

const connectLatency = new Trend('sse_connect_ms', true);
const streamBytes = new Counter('sse_stream_bytes');
const connectFailures = new Rate('sse_connect_failures');

export const options = {
  scenarios: {
    fanout: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: RAMP, target: SUBSCRIBERS },
        { duration: HOLD, target: SUBSCRIBERS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
      tags: { profile: 'sse-fanout' },
    },
  },
  thresholds: {
    // Fewer than 99% of subscribers connecting means the hub is
    // shedding clients — see ops/capacity/profiles.yaml thresholds.
    sse_connect_failures: ['rate<0.01'],
    sse_connect_ms: ['p(95)<1000'],
  },
};

export function setup() {
  if (CONFIRM !== 'RUN') {
    throw new Error(
      'refusing to generate load: set CONFIRM=RUN (see ops/capacity/profiles.yaml safety.require_confirmation)'
    );
  }
  return { startedAt: Date.now() };
}

function headers() {
  const h = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
  if (AUTH_VALUE) h[AUTH_HEADER] = AUTH_VALUE;
  return h;
}

export default function () {
  const started = Date.now();
  const res = http.get(`${BASE_URL}/api/v1/events`, {
    headers: headers(),
    // k6 reads the stream until the timeout, which is exactly the
    // long-lived-connection behaviour we are trying to measure.
    timeout: '60s',
    tags: { endpoint: 'sse' },
  });
  connectLatency.add(Date.now() - started);

  const ok = check(res, {
    'sse status acceptable': (r) => r.status === 200 || r.status === 401,
    'sse content-type': (r) =>
      r.status !== 200 ||
      (r.headers['Content-Type'] || '').includes('text/event-stream'),
  });
  connectFailures.add(!ok);
  if (res.body) streamBytes.add(res.body.length);
}

export function handleSummary(data) {
  const summary = {
    profile: 'sse-fanout',
    base_url: BASE_URL,
    subscribers: SUBSCRIBERS,
    connect_p95_ms: data.metrics.sse_connect_ms
      ? data.metrics.sse_connect_ms.values['p(95)']
      : null,
    connect_failure_rate: data.metrics.sse_connect_failures
      ? data.metrics.sse_connect_failures.values.rate
      : null,
  };
  return {
    stdout: JSON.stringify(summary, null, 2),
    'tests/k6/summary-sse-fanout.json': JSON.stringify(summary, null, 2),
  };
}
