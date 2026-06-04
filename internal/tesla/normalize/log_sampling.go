package normalize

import (
	"time"

	"github.com/rs/zerolog"
)

// hotPathLogSamplerBurst, hotPathLogSamplerPeriod, and
// hotPathLogSamplerEvery configure the per-process log sampler shared
// by the normalize pipeline (and mirrored by the MQTT consumer in
// internal/mqtt). The contract is documented in
// the log-sampling runbook:
//
//   - The first `Burst` events in any rolling `Period` window are
//     emitted unconditionally so a fresh outage produces immediate
//     evidence in the logs.
//   - After the burst is exhausted, one in every `Every` events is
//     emitted (1% sample by default) until the next period rolls over.
//
// The values are package constants (not config) because they are part
// of the operational contract operators are trained on.
const (
	hotPathLogSamplerBurst  uint32 = 10
	hotPathLogSamplerPeriod        = time.Second
	hotPathLogSamplerEvery  uint32 = 100
)

// withHotPathSampling returns a derivative logger whose hot-path events
// are sampled per the package-level policy. Errors and warnings emitted
// from cold paths can still be routed through the unsampled parent
// logger by capturing it before the call.
func withHotPathSampling(parent zerolog.Logger) zerolog.Logger {
	burst := &zerolog.BurstSampler{
		Burst:       hotPathLogSamplerBurst,
		Period:      hotPathLogSamplerPeriod,
		NextSampler: &zerolog.BasicSampler{N: hotPathLogSamplerEvery},
	}
	return parent.Sample(burst)
}
