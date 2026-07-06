package dto

import (
	"bytes"
	"encoding/json"
	"errors"
	"sort"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

// marshalToMap marshals v to JSON and decodes the result into a generic map
// so tests can assert exactly which wire keys are present (guarding json tags
// and omitempty behaviour).
func marshalToMap(t *testing.T, v any) map[string]json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal(%T): %v", v, err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("json.Unmarshal(%s) into map: %v", b, err)
	}
	return m
}

// assertKeys fails unless the keys in m are exactly the wanted set — no more,
// no fewer. This pins the serialized contract for a DTO.
func assertKeys(t *testing.T, m map[string]json.RawMessage, want ...string) {
	t.Helper()
	got := make(map[string]bool, len(m))
	for k := range m {
		got[k] = true
	}
	for _, k := range want {
		if !got[k] {
			t.Errorf("missing expected JSON key %q; got keys %v", k, keysOf(m))
		}
		delete(got, k)
	}
	for k := range got {
		t.Errorf("unexpected JSON key %q present; wanted only %v", k, want)
	}
}

func keysOf(m map[string]json.RawMessage) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// assertRoundTrip verifies that a value survives a Marshal -> Unmarshal ->
// Marshal cycle byte-for-byte. Comparing the two marshaled forms (rather than
// using reflect.DeepEqual) sidesteps time.Time's internal wall/monotonic
// representation, which can make logically-equal times compare unequal.
func assertRoundTrip[T any](t *testing.T, v T) {
	t.Helper()
	first, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("first Marshal(%T): %v", v, err)
	}
	var decoded T
	if err := json.Unmarshal(first, &decoded); err != nil {
		t.Fatalf("Unmarshal(%s): %v", first, err)
	}
	second, err := json.Marshal(decoded)
	if err != nil {
		t.Fatalf("second Marshal(%T): %v", decoded, err)
	}
	if !bytes.Equal(first, second) {
		t.Errorf("round-trip mismatch:\n first:  %s\n second: %s", first, second)
	}
}

// validationFields extracts the Field values from a domain.ValidationErrors
// error, failing the test if err is not a ValidationErrors.
func validationFields(t *testing.T, err error) []string {
	t.Helper()
	var ve domain.ValidationErrors
	if !errors.As(err, &ve) {
		t.Fatalf("expected domain.ValidationErrors, got %T: %v", err, err)
	}
	fields := make([]string, len(ve))
	for i, e := range ve {
		fields[i] = e.Field
	}
	return fields
}

func containsStr(hay []string, needle string) bool {
	for _, s := range hay {
		if s == needle {
			return true
		}
	}
	return false
}
