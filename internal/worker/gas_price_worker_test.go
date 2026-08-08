package worker

import (
	"math"
	"testing"
)

func TestGasPricePerConfiguredUnit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		pricePerGallon float64
		unit           string
		want           float64
	}{
		{
			name:           "gallon",
			pricePerGallon: 3.50,
			unit:           "gallon",
			want:           3.50,
		},
		{
			name:           "liter",
			pricePerGallon: litersPerUSGallon,
			unit:           "liter",
			want:           1,
		},
		{
			name:           "case insensitive litre",
			pricePerGallon: litersPerUSGallon,
			unit:           " LITRE ",
			want:           1,
		},
		{
			name:           "unknown defaults to gallon",
			pricePerGallon: 4,
			unit:           "unknown",
			want:           4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := gasPricePerConfiguredUnit(tt.pricePerGallon, tt.unit)
			if math.Abs(got-tt.want) > 0.000_001 {
				t.Fatalf("gasPricePerConfiguredUnit() = %f, want %f", got, tt.want)
			}
		})
	}
}
