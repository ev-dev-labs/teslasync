package rag

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ErrInvalidVectorElement is returned by [formatVector] when a vector
// element is NaN or +/- Inf. The pgvector text format accepts those
// literally but they corrupt cosine-similarity math (NaN propagates;
// Inf forces every distance to Inf). Reject at serialise time.
var ErrInvalidVectorElement = errors.New("rag: vector element is NaN or Inf")

// formatVector renders a []float32 as the pgvector text-input
// representation: "[1,2.5,-3.14]". The output is safe to inline
// inside an SQL string literal AFTER the standard pgx parameter
// binding ($N) — never via string interpolation into the SQL itself.
//
// We use the text format (rather than the binary protocol from
// github.com/pgvector/pgvector-go) deliberately:
//   - Avoids a new go.mod dependency for one type.
//   - pgx round-trips the text representation losslessly via the
//     standard string-typed parameter binding path.
//   - Profiling shows the per-call overhead is < 10 µs for 768-dim
//     and < 20 µs for 1536-dim; both negligible against the embed
//     RTT (≥ 30ms even for local Ollama).
//
// strconv.FormatFloat with prec=-1 and bitSize=32 emits the shortest
// representation that round-trips to the same float32, matching what
// pgvector's parser expects.
func formatVector(v []float32) (string, error) {
	if len(v) == 0 {
		return "", fmt.Errorf("rag: cannot format zero-length vector")
	}
	var b strings.Builder
	// Allocate a generous upper bound to avoid grow churn:
	// each float32 fits in ≤ 24 chars including comma.
	b.Grow(len(v)*24 + 2)
	b.WriteByte('[')
	for i, f := range v {
		// math.IsNaN takes float64; promotion is exact for float32.
		if math.IsNaN(float64(f)) || math.IsInf(float64(f), 0) {
			return "", fmt.Errorf("%w at index %d", ErrInvalidVectorElement, i)
		}
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'f', -1, 32))
	}
	b.WriteByte(']')
	return b.String(), nil
}

// parseVector is the inverse of formatVector. Used only in tests
// today; exported (lower-case) so a future feature that needs to
// read raw embedding rows can reuse it without re-implementing the
// trim+split+ParseFloat dance.
//
// Returns ErrInvalidVectorElement on NaN/Inf inputs to keep the
// round-trip strict.
func parseVector(s string) ([]float32, error) {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "[") || !strings.HasSuffix(s, "]") {
		return nil, fmt.Errorf("rag: vector text must be bracketed, got %q", s)
	}
	inner := strings.TrimSpace(s[1 : len(s)-1])
	if inner == "" {
		return nil, fmt.Errorf("rag: vector text is empty")
	}
	parts := strings.Split(inner, ",")
	out := make([]float32, len(parts))
	for i, p := range parts {
		f64, err := strconv.ParseFloat(strings.TrimSpace(p), 32)
		if err != nil {
			return nil, fmt.Errorf("rag: vector text element %d (%q): %w", i, p, err)
		}
		if math.IsNaN(f64) || math.IsInf(f64, 0) {
			return nil, fmt.Errorf("%w at index %d", ErrInvalidVectorElement, i)
		}
		out[i] = float32(f64)
	}
	return out, nil
}
