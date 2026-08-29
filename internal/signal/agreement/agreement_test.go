package agreement

import (
	"math"
	"testing"
	"time"
)

func TestAnalyze(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	floatValue := func(value float64) Value { return Value{Kind: 6, Float: &value} }
	textValue := func(value string) Value { return Value{Kind: 1, Text: &value} }

	tests := []struct {
		name           string
		samples        []Sample
		wantStatus     string
		wantPairs      int
		wantAgreement  *float64
		wantInvalid    int
		wantFieldCount int
	}{
		{
			name:       "no evidence stays unknown",
			wantStatus: StatusNoEvidence,
		},
		{
			name: "one transport is insufficient overlap",
			samples: []Sample{
				{Field: "VehicleSpeed", Origin: OriginMQTT, SourceEmittedAt: base, Value: floatValue(20)},
			},
			wantStatus:     StatusInsufficientOverlap,
			wantFieldCount: 1,
		},
		{
			name: "source times outside tolerance do not become disagreements",
			samples: []Sample{
				{Field: "VehicleSpeed", Origin: OriginMQTT, SourceEmittedAt: base, Value: floatValue(20)},
				{Field: "VehicleSpeed", Origin: OriginHTTP, SourceEmittedAt: base.Add(3 * time.Second), Value: floatValue(99)},
			},
			wantStatus:     StatusInsufficientOverlap,
			wantFieldCount: 1,
		},
		{
			name: "float precision differences agree and values are paired once",
			samples: []Sample{
				{Field: "VehicleSpeed", Origin: OriginHTTP, SourceEmittedAt: base.Add(time.Second), Value: floatValue(20.00001)},
				{Field: "VehicleSpeed", Origin: OriginHTTP, SourceEmittedAt: base.Add(1500 * time.Millisecond), Value: floatValue(20.00001)},
				{Field: "VehicleSpeed", Origin: OriginMQTT, SourceEmittedAt: base, Value: floatValue(20)},
			},
			wantStatus:     StatusMeasured,
			wantPairs:      1,
			wantAgreement:  floatPointer(100),
			wantFieldCount: 1,
		},
		{
			name: "kind mismatch and exact text mismatch disagree",
			samples: []Sample{
				{Field: "Gear", Origin: OriginHTTP, SourceEmittedAt: base, Value: textValue("D")},
				{Field: "Gear", Origin: OriginMQTT, SourceEmittedAt: base, Value: textValue("R")},
				{Field: "State", Origin: OriginHTTP, SourceEmittedAt: base, Value: textValue("online")},
				{Field: "State", Origin: OriginMQTT, SourceEmittedAt: base, Value: floatValue(1)},
			},
			wantStatus:     StatusMeasured,
			wantPairs:      2,
			wantAgreement:  floatPointer(0),
			wantFieldCount: 2,
		},
		{
			name: "invalid typed values are excluded",
			samples: []Sample{
				{Field: "VehicleSpeed", Origin: OriginHTTP, SourceEmittedAt: base, Value: floatValue(math.Inf(1))},
				{Field: "VehicleSpeed", Origin: OriginMQTT, SourceEmittedAt: base, Value: floatValue(20)},
			},
			wantStatus:     StatusInsufficientOverlap,
			wantInvalid:    1,
			wantFieldCount: 1,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got := Analyze(test.samples, 2*time.Second)
			if got.Status != test.wantStatus {
				t.Fatalf("status = %q, want %q", got.Status, test.wantStatus)
			}
			if got.ComparablePairs != test.wantPairs {
				t.Errorf("comparable pairs = %d, want %d", got.ComparablePairs, test.wantPairs)
			}
			if got.InvalidValueRows != test.wantInvalid {
				t.Errorf("invalid rows = %d, want %d", got.InvalidValueRows, test.wantInvalid)
			}
			if len(got.Fields) != test.wantFieldCount {
				t.Errorf("field count = %d, want %d", len(got.Fields), test.wantFieldCount)
			}
			if test.wantAgreement == nil {
				if got.AgreementPct != nil {
					t.Errorf("agreement = %v, want nil", *got.AgreementPct)
				}
			} else if got.AgreementPct == nil || *got.AgreementPct != *test.wantAgreement {
				t.Errorf("agreement = %v, want %v", got.AgreementPct, *test.wantAgreement)
			}
		})
	}
}

func floatPointer(value float64) *float64 {
	return &value
}
