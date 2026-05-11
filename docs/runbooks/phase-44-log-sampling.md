# Structured-log sampling (phase-44)

Some log events fire at very high rates. The MQTT consumer ingests
hundreds of payloads per second per vehicle; the normalize pipeline
warns about every malformed atomic. Without sampling, a partial outage
floods stdout, drowning real signal in noise and burning storage budget
in Loki/Cloudwatch.

## Policy

The MQTT and normalize hot-path loggers wrap their parent logger with
the same sampler:

```go
zerolog.BurstSampler{
    Burst:       10,
    Period:      time.Second,
    NextSampler: &zerolog.BasicSampler{N: 100},
}
```

- The first **10 events per second** are always emitted (the "burst"
  budget). A fresh outage produces 10 lines instantly, so operators see
  immediate evidence on `kubectl logs -f`.
- After the burst is exhausted, **1 in every 100** events is emitted
  until the next 1-second window starts. At 1000 events/sec, the sampler
  emits ~20 lines/sec instead of 1000.

## Why both samplers in series

Either sampler alone would be wrong:

| Sampler alone | Failure mode |
|---|---|
| `BurstSampler` only | First 10/sec emitted, rest dropped silently. A long sustained outage produces only 600/min after the first second. |
| `BasicSampler{N:100}` only | A single bad message (rate=1/sec) is dropped 99% of the time. The next time the message fires is unpredictable. |

`BurstSampler.NextSampler` chains them: bursts get a hard ceiling, then
the sustained rate falls back to the basic sampler.

## What is NOT sampled

- Anything emitted from a logger that did not pass through
  `withHotPathSampling`. In particular:
  - cold-path warnings (e.g. startup config errors).
  - `log.Fatal` / `log.Panic` paths.
- Logs from packages outside `internal/tesla/normalize` and
  `internal/mqtt`. Most application code uses the global `log` package
  logger which is unsampled.

If a new high-volume call site is added, use `withHotPathSampling` (the
package-private helper in each of the two packages) on the parent
logger before storing it in your struct.

## Operational impact

- **Storage:** ~95% reduction on hot-path lines in steady state. Burst
  lines are unaffected so an outage is still visible.
- **Debuggability:** A particular bad message may not appear in logs
  until the next burst window if it sits inside the 99% sample dropout.
  When debugging, prefer:
  - traces (kept at 100% for errors / slow per
    `docs/runbooks/phase-44-trace-sampling.md`),
  - metrics / RED dashboards.

## Tuning knobs

The sampler constants are package-level (`hotPathLogSamplerBurst`,
`hotPathLogSamplerPeriod`, `hotPathLogSamplerEvery`) in:

- `internal/mqtt/log_sampling.go`
- `internal/tesla/normalize/log_sampling.go`

Bump them with care; both files must move together to keep the policy
consistent across the consumer and the pipeline.
