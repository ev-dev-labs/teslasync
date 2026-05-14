package rag

import (
	"errors"
	"math"
	"strings"
	"testing"
)

func TestFormatVector_RoundTrip(t *testing.T) {
	t.Parallel()
	cases := [][]float32{
		{0},
		{1, 2, 3},
		{-1.5, 0, 1.5},
		{0.123456789, -0.987654321},
		// One full 768-dim vector with a deterministic pattern so
		// the test exercises the realistic payload size.
		dimVector(768),
	}
	for _, in := range cases {
		s, err := formatVector(in)
		if err != nil {
			t.Fatalf("formatVector(len=%d): %v", len(in), err)
		}
		out, err := parseVector(s)
		if err != nil {
			t.Fatalf("parseVector: %v", err)
		}
		if len(out) != len(in) {
			t.Fatalf("len mismatch: in=%d out=%d", len(in), len(out))
		}
		for i := range in {
			if in[i] != out[i] {
				t.Fatalf("element %d: in=%g out=%g (text=%s)", i, in[i], out[i], s)
			}
		}
	}
}

func TestFormatVector_Bracketed(t *testing.T) {
	t.Parallel()
	s, err := formatVector([]float32{1, 2, 3})
	if err != nil {
		t.Fatalf("formatVector: %v", err)
	}
	if !strings.HasPrefix(s, "[") || !strings.HasSuffix(s, "]") {
		t.Fatalf("output not bracketed: %s", s)
	}
	if got := strings.Count(s, ","); got != 2 {
		t.Fatalf("want 2 commas, got %d (%s)", got, s)
	}
}

func TestFormatVector_RejectsZeroLength(t *testing.T) {
	t.Parallel()
	if _, err := formatVector(nil); err == nil {
		t.Fatal("nil: want error, got nil")
	}
	if _, err := formatVector([]float32{}); err == nil {
		t.Fatal("empty: want error, got nil")
	}
}

func TestFormatVector_RejectsNaNAndInf(t *testing.T) {
	t.Parallel()
	cases := map[string][]float32{
		"NaN":    {1, float32(math.NaN()), 3},
		"PosInf": {float32(math.Inf(1))},
		"NegInf": {0, float32(math.Inf(-1))},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := formatVector(in)
			if !errors.Is(err, ErrInvalidVectorElement) {
				t.Fatalf("want ErrInvalidVectorElement, got %v", err)
			}
		})
	}
}

func TestParseVector_RejectsMalformed(t *testing.T) {
	t.Parallel()
	cases := []string{
		"",
		"1,2,3",            // missing brackets
		"[1,2,",            // unterminated
		"[abc]",            // not a number
		"[1, , 3]",         // empty element
		"[NaN]",            // NaN literal
		"[Inf]",            // Inf literal
	}
	for _, in := range cases {
		t.Run(in, func(t *testing.T) {
			if _, err := parseVector(in); err == nil {
				t.Fatalf("input %q: want error, got nil", in)
			}
		})
	}
}

// dimVector returns a deterministic []float32 of length n whose
// values exercise both negative and positive ranges. Used by
// round-trip tests to confirm the serializer handles realistic
// payload sizes.
func dimVector(n int) []float32 {
	out := make([]float32, n)
	for i := range out {
		out[i] = float32(i%17) * 0.1234
		if i%3 == 0 {
			out[i] = -out[i]
		}
	}
	return out
}
