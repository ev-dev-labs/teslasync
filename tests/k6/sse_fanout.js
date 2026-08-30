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
// Core k6 HTTP buffers response bodies and cannot model SSE. The
// community xk6-sse extension keeps a real streaming connection open
// for each VU. CI builds the extension-enabled binary at pinned versions.
import sse from 'k6/x/sse';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const CONFIRM = __ENV.CONFIRM || '';
const TARGET_ENV = __ENV.TARGET_ENV || 'local';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const AUTH_HEADER = __ENV.AUTH_HEADER || 'X-Forwarded-User';
const AUTH_VALUE = __ENV.AUTH_VALUE || '';
const SUBSCRIBERS = parseInt(__ENV.SUBSCRIBERS || '500', 10);
const HOLD = __ENV.HOLD || '5m';
const RAMP = __ENV.RAMP || '30s';

const connectLatency = new Trend('sse_connect_ms', true);
const streamBytes = new Counter('sse_stream_bytes');
const vehicleUpdates = new Counter('sse_vehicle_updates');
const connectFailures = new Rate('sse_connect_failures');
const allowedEnvironments = new Set(['local', 'ephemeral-ci', 'staging']);

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
    sse_stream_bytes: ['count>0'],
    sse_vehicle_updates: ['count>0'],
  },
};

export function setup() {
  if (CONFIRM !== 'RUN') {
    throw new Error(
      'refusing to generate load: set CONFIRM=RUN (see ops/capacity/profiles.yaml safety.require_confirmation)'
    );
  }
  if (!allowedEnvironments.has(TARGET_ENV) || /prod/i.test(TARGET_ENV)) {
    throw new Error(`refusing disallowed target environment: ${TARGET_ENV}`);
  }
  if (!Number.isInteger(SUBSCRIBERS) || SUBSCRIBERS < 1 || SUBSCRIBERS > 2000) {
    throw new Error(`SUBSCRIBERS must be an integer from 1 through 2000, got ${SUBSCRIBERS}`);
  }
}

function headers() {
  const h = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
  if (AUTH_TOKEN) h.Authorization = 'Bearer ' + AUTH_TOKEN;
  if (AUTH_VALUE) h[AUTH_HEADER] = AUTH_VALUE;
  return h;
}

export default function () {
  const started = Date.now();
  let connected = false;
  const response = sse.open(`${BASE_URL}/api/v1/events`, {
    method: 'GET',
    headers: headers(),
    tags: { endpoint: 'sse' },
  }, (client) => {
    client.on('event', (event) => {
      if (event.name === 'connected' && !connected) {
        connected = true;
        connectLatency.add(Date.now() - started);
        connectFailures.add(false);
      }
      if (event.name === 'vehicle_update') {
        vehicleUpdates.add(1);
        if (event.data) streamBytes.add(String(event.data).length);
      }
    });
    client.on('error', () => {
      client.close();
    });
  });

  if (!connected) {
    connectFailures.add(true);
    check(response, {
      'sse handshake returns 200': (r) => r !== null && r.status === 200,
      'sse handshake returns event stream': (r) =>
        r !== null && (r.headers['Content-Type'] || '').includes('text/event-stream'),
    });
  }
  sleep(0.1);
}

export function handleSummary(data) {
  const summary = {
    profile: 'sse-fanout',
    base_url: BASE_URL,
    target_environment: TARGET_ENV,
    subscribers: SUBSCRIBERS,
    connect_p95_ms: data.metrics.sse_connect_ms
      ? data.metrics.sse_connect_ms.values['p(95)']
      : null,
    connect_failure_rate: data.metrics.sse_connect_failures
      ? data.metrics.sse_connect_failures.values.rate
      : null,
    stream_bytes: data.metrics.sse_stream_bytes?.values.count ?? 0,
    vehicle_updates: data.metrics.sse_vehicle_updates?.values.count ?? 0,
  };
  return {
    stdout: JSON.stringify(summary, null, 2),
    'tests/k6/summary-sse-fanout.json': JSON.stringify(summary, null, 2),
  };
}
