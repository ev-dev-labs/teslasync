package repairsnapshot

import (
	"encoding/json"
	"errors"
	"math"
	"testing"
)

func TestChecksumNormalizesObjectKeyOrderingAndDetectsTampering(t *testing.T) {
	t.Parallel()

	first := []byte(`{"drive":{"id":7,"distance_m":42},"schema_version":1}`)
	reordered := []byte(`{"schema_version":1,"drive":{"distance_m":42,"id":7}}`)

	checksum, err := Checksum(first)
	if err != nil {
		t.Fatalf("Checksum(first): %v", err)
	}
	ok, err := VerifyChecksum(reordered, checksum)
	if err != nil {
		t.Fatalf("VerifyChecksum(reordered): %v", err)
	}
	if !ok {
		t.Fatal("semantically identical reordered JSON did not verify")
	}

	ok, err = VerifyChecksum([]byte(`{"schema_version":1,"drive":{"id":7,"distance_m":43}}`), checksum)
	if err != nil {
		t.Fatalf("VerifyChecksum(tampered): %v", err)
	}
	if ok {
		t.Fatal("tampered JSON verified")
	}
	if err := RequireChecksum(
		[]byte(`{"schema_version":1,"drive":{"id":7,"distance_m":43}}`),
		checksum,
	); !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("RequireChecksum(tampered) error = %v, want checksum mismatch", err)
	}
	if err := RequireChecksum(reordered, checksum); err != nil {
		t.Fatalf("RequireChecksum(reordered): %v", err)
	}
}

func TestExactObjectRejectsMissingAndUnknownFields(t *testing.T) {
	t.Parallel()

	for _, payload := range [][]byte{
		[]byte(`{"schema_version":1}`),
		[]byte(`{"schema_version":1,"drive":{},"unexpected":true}`),
	} {
		if _, err := ExactObject(payload, []string{"schema_version", "drive"}); !errors.Is(err, ErrMalformedPayload) {
			t.Errorf("ExactObject(%s) error = %v, want malformed payload", payload, err)
		}
	}
}

func TestExactObjectRejectsDuplicateKeys(t *testing.T) {
	t.Parallel()

	_, err := ExactObject([]byte(`{"schema_version":1,"schema_version":1,"drive":{}}`),
		[]string{"schema_version", "drive"})
	if !errors.Is(err, ErrMalformedPayload) {
		t.Fatalf("ExactObject duplicate key error = %v, want malformed payload", err)
	}
}

func TestFloat64PreservesPostgresSpecialValues(t *testing.T) {
	t.Parallel()

	tests := []struct {
		payload string
		check   func(float64) bool
	}{
		{`12.5`, func(v float64) bool { return v == 12.5 }},
		{`"NaN"`, math.IsNaN},
		{`"Infinity"`, func(v float64) bool { return math.IsInf(v, 1) }},
		{`"-Infinity"`, func(v float64) bool { return math.IsInf(v, -1) }},
	}
	for _, tt := range tests {
		var value Float64
		if err := json.Unmarshal([]byte(tt.payload), &value); err != nil {
			t.Fatalf("unmarshal %s: %v", tt.payload, err)
		}
		if !tt.check(float64(value)) {
			t.Errorf("decoded %s as %v", tt.payload, value)
		}
	}

	var invalid Float64
	if err := json.Unmarshal([]byte(`"not-a-number"`), &invalid); !errors.Is(err, ErrMalformedPayload) {
		t.Fatalf("invalid special error = %v, want malformed payload", err)
	}
}
