package geocoding

import (
	"testing"
)

func TestShortName(t *testing.T) {
	tests := []struct {
		name   string
		result NominatimResult
		want   string
	}{
		{
			"road and city",
			NominatimResult{
				Address: NominatimAddress{Road: "Main St", City: "Springfield"},
			},
			"Main St, Springfield",
		},
		{
			"house number, road and city",
			NominatimResult{
				Address: NominatimAddress{HouseNumber: "123", Road: "Main St", City: "Springfield"},
			},
			"123 Main St, Springfield",
		},
		{
			"town fallback",
			NominatimResult{
				Address: NominatimAddress{Road: "Oak Ave", Town: "Shelbyville"},
			},
			"Oak Ave, Shelbyville",
		},
		{
			"village fallback",
			NominatimResult{
				Address: NominatimAddress{Village: "Smallville"},
			},
			"Smallville",
		},
		{
			"display name truncation",
			NominatimResult{
				DisplayName: "A very long display name that should be truncated because it exceeds sixty characters in length surely",
			},
			"A very long display name that should be truncated because it...",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.result.ShortName()
			if got != tt.want {
				t.Errorf("ShortName() = %q, want %q", got, tt.want)
			}
		})
	}
}
