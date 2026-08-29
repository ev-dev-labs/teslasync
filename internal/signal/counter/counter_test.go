package counter

import (
	"math"
	"testing"
)

func TestValid(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		value float64
		want  bool
	}{
		{name: "zero", value: 0, want: true},
		{name: "positive", value: 12.5, want: true},
		{name: "negative", value: -1, want: false},
		{name: "nan", value: math.NaN(), want: false},
		{name: "positive infinity", value: math.Inf(1), want: false},
		{name: "negative infinity", value: math.Inf(-1), want: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := Valid(tt.value); got != tt.want {
				t.Fatalf("Valid(%v) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}

func TestCompare(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		previous float64
		current  float64
		want     Change
	}{
		{
			name:     "advanced",
			previous: 100,
			current:  112.5,
			want:     Change{Kind: ChangeAdvanced, Delta: 12.5},
		},
		{
			name:     "unchanged",
			previous: 100,
			current:  100,
			want:     Change{Kind: ChangeUnchanged},
		},
		{
			name:     "reset",
			previous: 100,
			current:  3,
			want:     Change{Kind: ChangeReset},
		},
		{
			name:     "invalid previous",
			previous: math.NaN(),
			current:  3,
			want:     Change{Kind: ChangeInvalid},
		},
		{
			name:     "invalid current",
			previous: 3,
			current:  math.Inf(1),
			want:     Change{Kind: ChangeInvalid},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := Compare(tt.previous, tt.current); got != tt.want {
				t.Fatalf("Compare(%v, %v) = %+v, want %+v", tt.previous, tt.current, got, tt.want)
			}
		})
	}
}
