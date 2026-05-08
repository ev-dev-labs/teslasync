package normalize

import (
	"bytes"
	"strings"
	"testing"

	"github.com/rs/zerolog"
)

// TestWithHotPathSampling_DropsAfterBurst exercises the contract
// documented in docs/runbooks/phase-44-log-sampling.md: the first
// `hotPathLogSamplerBurst` events fire unconditionally, then sampling
// kicks in. We assert the dropped/emitted ratio rather than a specific
// post-burst event count because BasicSampler's behaviour is timing
// sensitive across the period boundary.
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
