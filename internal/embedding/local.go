package embedding

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"math"
	"strings"
)

// LocalProvider is a deterministic, offline EmbeddingProvider used for
// development, tests, and CI where no LLM API key is available.
//
// It is NOT semantically meaningful: similar wording will produce similar
// vectors only insofar as the bag-of-words hashing collides. The contract
// it does honor is determinism — the same input always produces the same
// vector — which is enough to exercise pgvector storage and search paths.
type LocalProvider struct {
	dimensions int
}

// NewLocalProvider constructs a deterministic provider with the given
// vector size. dimensions <=0 defaults to 1536 to match the schema.
func NewLocalProvider(dimensions int) *LocalProvider {
	if dimensions <= 0 {
		dimensions = 1536
	}
	return &LocalProvider{dimensions: dimensions}
}

// Dimensions returns the configured vector size.
func (p *LocalProvider) Dimensions() int { return p.dimensions }

// Embed produces a unit-length pseudo-embedding from token hashes.
func (p *LocalProvider) Embed(_ context.Context, text string) ([]float32, error) {
	vec := make([]float32, p.dimensions)
	for _, tok := range tokenize(text) {
		h := sha256.Sum256([]byte(tok))
		// Spread 32 buckets per token across the vector.
		for i := 0; i < 8; i++ {
			idx := int(binary.BigEndian.Uint32(h[i*4:i*4+4])) % p.dimensions
			if idx < 0 {
				idx = -idx
			}
			vec[idx] += 1.0
		}
	}
	// L2-normalize so cosine similarity behaves sensibly.
	var sum float64
	for _, f := range vec {
		sum += float64(f) * float64(f)
	}
	if sum > 0 {
		norm := float32(math.Sqrt(sum))
		for i := range vec {
			vec[i] /= norm
		}
	}
	return vec, nil
}

// EmbedBatch embeds each text independently.
func (p *LocalProvider) EmbedBatch(ctx context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i, t := range texts {
		v, err := p.Embed(ctx, t)
		if err != nil {
			return nil, err
		}
		out[i] = v
	}
	return out, nil
}

func tokenize(s string) []string {
	s = strings.ToLower(s)
	fields := strings.FieldsFunc(s, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
	})
	return fields
}
