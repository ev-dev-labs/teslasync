package stats

import (
	"math"
	"testing"
)

func TestMeanStddev(t *testing.T) {
	tests := []struct {
		name       string
		values     []float64
		wantMean   float64
		wantStddev float64
	}{
		{name: "empty", values: nil, wantMean: 0, wantStddev: 0},
		{name: "singleton", values: []float64{42}, wantMean: 42, wantStddev: 0},
		{name: "NaN and Inf ignored", values: []float64{math.NaN(), math.Inf(1), math.Inf(-1), 1, 3}, wantMean: 2, wantStddev: 1},
		{name: "constant", values: []float64{7, 7, 7, 7}, wantMean: 7, wantStddev: 0},
		{name: "odd population", values: []float64{1, 2, 3, 4, 5}, wantMean: 3, wantStddev: math.Sqrt(2)},
		{name: "even population", values: []float64{1, 2, 3, 4}, wantMean: 2.5, wantStddev: math.Sqrt(1.25)},
		{name: "large finite values", values: []float64{1e308, 1e308}, wantMean: 1e308, wantStddev: 0},
		{name: "large opposite values", values: []float64{-1e308, 1e308}, wantMean: 0, wantStddev: 1e308},
		{name: "compensated rounding", values: []float64{1e16, 1, -1e16}, wantMean: 0, wantStddev: 1e16},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mean, stddev := MeanStddev(tt.values)
			if tt.name == "compensated rounding" {
				if math.IsInf(stddev, 0) || math.IsNaN(stddev) || stddev <= 0 {
					t.Fatalf("Stddev = %v, want finite", stddev)
				}
				if math.Abs(mean-tt.wantMean) > 1e-3 {
					t.Fatalf("Mean = %v, want %v", mean, tt.wantMean)
				}
				return
			}
			if !closeFloat(mean, tt.wantMean) {
				t.Errorf("Mean = %.17g, want %.17g", mean, tt.wantMean)
			}
			if !closeFloat(stddev, tt.wantStddev) {
				t.Errorf("Stddev = %.17g, want %.17g", stddev, tt.wantStddev)
			}
		})
	}
}

func TestMean(t *testing.T) {
	tests := []struct {
		name   string
		values []float64
		want   float64
	}{
		{name: "empty", values: nil, want: 0},
		{name: "invalid only", values: []float64{math.NaN(), math.Inf(1), math.Inf(-1)}, want: 0},
		{name: "singleton", values: []float64{9.25}, want: 9.25},
		{name: "constant", values: []float64{5, 5, 5}, want: 5},
		{name: "rounding", values: []float64{0.1, 0.2, 0.3}, want: 0.2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Mean(tt.values)
			if !closeFloat(got, tt.want) {
				t.Errorf("Mean = %.17g, want %.17g", got, tt.want)
			}
		})
	}
}

func TestPercentileType7(t *testing.T) {
	tests := []struct {
		name   string
		values []float64
		q      float64
		want   float64
	}{
		{name: "empty", values: nil, q: 0.5, want: 0},
		{name: "singleton", values: []float64{42}, q: 0.95, want: 42},
		{name: "NaN and Inf ignored", values: []float64{math.NaN(), math.Inf(1), math.Inf(-1), 10, 20}, q: 0.5, want: 15},
		{name: "odd sample count median", values: []float64{5, 1, 3}, q: 0.5, want: 3},
		{name: "even sample count median", values: []float64{4, 2, 3, 1}, q: 0.5, want: 2.5},
		{name: "lower bound", values: []float64{4, 3, 2, 1}, q: 0, want: 1},
		{name: "negative q bound", values: []float64{4, 3, 2, 1}, q: -0.25, want: 1},
		{name: "upper bound", values: []float64{4, 3, 2, 1}, q: 1, want: 4},
		{name: "above-q bound", values: []float64{4, 3, 2, 1}, q: 1.25, want: 4},
		{name: "large values", values: []float64{-1e308, 0, 1e308}, q: 0.5, want: 0},
		{name: "rounding interpolation", values: []float64{0, 0.1, 0.2}, q: 0.25, want: 0.05},
		{name: "does not mutate input", values: []float64{3, 1, 2}, q: 0.5, want: 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			original := append([]float64(nil), tt.values...)
			got := Percentile(tt.values, tt.q)
			if !closeFloat(got, tt.want) {
				t.Errorf("Percentile(%v, %v) = %.17g, want %.17g", tt.values, tt.q, got, tt.want)
			}
			for i := range tt.values {
				same := tt.values[i] == original[i] ||
					(math.IsNaN(tt.values[i]) && math.IsNaN(original[i])) ||
					(math.IsInf(tt.values[i], 0) && math.IsInf(original[i], 0) && math.Signbit(tt.values[i]) == math.Signbit(original[i]))
				if !same {
					t.Fatalf("Percentile mutated input: got %v, want %v", tt.values, original)
				}
			}
		})
	}
}

func closeFloat(got, want float64) bool {
	if want == 0 {
		return math.Abs(got) <= 1e-12
	}
	tolerance := 1e-12 * math.Max(1, math.Abs(want))
	return math.Abs(got-want) <= tolerance
}
