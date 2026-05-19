# Load testing

Reproducible API load tests written in [k6](https://k6.io/). One file
per scenario so the smoke run in CI stays decoupled from manual soak
runs against staging clusters.

## Quickstart

```bash
# Smoke (default) — 30 s, 1 VU, runs in CI:
k6 run loadtest/baseline.js

# Load — ramp to 50 VUs, hold 5 min:
k6 run --env STAGE=load loadtest/baseline.js

# Soak — 50 VUs for 30 min (run on staging, not your laptop):
k6 run --env STAGE=soak loadtest/baseline.js

# Hit a remote target:
k6 run --env BASE_URL=https://staging.example.com loadtest/baseline.js

# With auth:
k6 run --env AUTH_TOKEN=$TOKEN --env STAGE=load loadtest/baseline.js
```

## What it checks

`baseline.js` exercises the hot-path endpoints with weighted
selection (vehicles + drives get more traffic than `/healthz`) and
asserts each stage's thresholds. The `load` and `soak` stages assert
the same numbers we publish as SLOs:

- `99.5%` availability (matches `api_availability` SLO)
- `p99 < 500 ms` on hot endpoints (matches `api_latency_p99_500ms`)
- `p99.9 < 2 s` on long-tail (soak only)

If the thresholds fail, k6 exits non-zero — so the CI job fails
loudly instead of producing a green-but-degraded baseline.

## Running against a fresh local stack

```bash
docker compose up -d
# wait for /readyz to return 200
until curl -sf http://localhost:8080/readyz >/dev/null; do sleep 2; done
k6 run loadtest/baseline.js
```

## Why k6

- Scripts are plain JavaScript — everyone on the team already reads it.
- Single static binary, no runtime install (Locust needs Python;
  Gatling needs JVM).
- First-class thresholds → CI fail/pass without parsing logs.
- Native Prometheus output via `--out experimental-prometheus-rw`
  so the load-test traffic shows up in the same dashboards as
  production traffic.
