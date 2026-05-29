package mqtt

import (
	"time"

	"github.com/rs/zerolog"
)

// hotPathLogSamplerBurst, hotPathLogSamplerPeriod, and
// hotPathLogSamplerEvery configure the per-process log sampler shared
// by the MQTT consumer (and mirrored by the normalize pipeline in
// internal/tesla/normalize/log_sampling.go). The contract is documented
// in the log-sampling runbook:
//
//   - The first `Burst` events in any rolling `Period` window are
//     emitted unconditionally so a fresh outage produces immediate
//     evidence in the logs.
//   - After the burst is exhausted, one in every `Every` events is
//     emitted (1% sample by default) until the next period rolls over.
const (
	hotPathLogSamplerBurst  uint32 = 10
	hotPathLogSamplerPeriod        = time.Second
	hotPathLogSamplerEvery  uint32 = 100
)

// withHotPathSampling returns a derivative logger whose hot-path events
// are sampled per the package-level policy. Callers who need to emit a
// guaranteed log line (e.g. fatal startup errors) should retain the
// unsampled parent and use it directly.
func withHotPathSampling(parent zerolog.Logger) zerolog.Logger {
	burst := &zerolog.BurstSampler{
		Burst:       hotPathLogSamplerBurst,
		Period:      hotPathLogSamplerPeriod,
		NextSampler: &zerolog.BasicSampler{N: hotPathLogSamplerEvery},
	}
	return parent.Sample(burst)
}
