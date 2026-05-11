package mqtt

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

// TestWithHotPathSampling_DropsAfterBurst exercises the contract
// documented in docs/runbooks/phase-44-log-sampling.md: the first
// `hotPathLogSamplerBurst` events fire unconditionally, then sampling
// kicks in.
func TestWithHotPathSampling_DropsAfterBurst(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	parent := zerolog.New(&buf).Level(zerolog.DebugLevel)
	logger := withHotPathSampling(parent)

	const total = 1000
	for i := 0; i < total; i++ {
		logger.Info().Int("i", i).Msg("hot")
	}

	emitted := strings.Count(buf.String(), `"message":"hot"`)
	if emitted < int(hotPathLogSamplerBurst) {
		t.Fatalf("expected at least burst=%d events, got %d", hotPathLogSamplerBurst, emitted)
	}
	if emitted >= total {
		t.Fatalf("expected sampling to drop events; got all %d emitted", emitted)
	}
}

// TestSamplerChainShape pins the BurstSampler+BasicSampler chain shape
// against accidental changes to the config tuple. Bumping Burst, Period
// or N is allowed only via this test + the runbook.
func TestSamplerChainShape(t *testing.T) {
	t.Parallel()
	want := &zerolog.BurstSampler{
		Burst:       hotPathLogSamplerBurst,
		Period:      hotPathLogSamplerPeriod,
		NextSampler: &zerolog.BasicSampler{N: hotPathLogSamplerEvery},
	}
	if want.Burst != 10 {
		t.Errorf("Burst should be 10, got %d", want.Burst)
	}
	if want.Period != time.Second {
		t.Errorf("Period should be 1s, got %v", want.Period)
	}
	next, ok := want.NextSampler.(*zerolog.BasicSampler)
	if !ok || next.N != 100 {
		t.Errorf("expected BasicSampler{N:100}, got %#v", want.NextSampler)
	}
}
