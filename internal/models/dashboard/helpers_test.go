package dashboard

import (
	"bytes"
	"encoding/json"
	"sort"
	"testing"
)

// toKeyMap marshals v to JSON and decodes the top-level object into a map of
// raw values so tests can assert on exact wire key names (the snake_case
// contract shared with the frontend) without coupling to struct field order.
func toKeyMap(t *testing.T, v any) map[string]json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal %T: %v", v, err)
	}
	m := map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal %T into key map (%s): %v", v, raw, err)
	}
	return m
}

// assertKeys asserts that every key in present exists and every key in absent
// does not. Absent is typically the camelCase spelling of a snake_case field —
// a cheap guard against an accidental json-tag rename that would break the
// TypeScript wire contract.
func assertKeys(t *testing.T, m map[string]json.RawMessage, present, absent []string) {
	t.Helper()
	for _, k := range present {
		if _, ok := m[k]; !ok {
			t.Errorf("missing required wire key %q; keys=%v", k, keysOf(m))
		}
	}
	for _, k := range absent {
		if _, ok := m[k]; ok {
			t.Errorf("unexpected wire key %q (should be omitted/renamed); keys=%v", k, keysOf(m))
		}
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

// jsonEqual reports whether a and b are the same JSON text ignoring
// insignificant whitespace. It is intentionally order-sensitive: it is used to
// assert that an opaque json.RawMessage survives (un)marshalling verbatim.
func jsonEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var ca, cb bytes.Buffer
	if err := json.Compact(&ca, a); err != nil {
		t.Fatalf("compact a (%s): %v", a, err)
	}
	if err := json.Compact(&cb, b); err != nil {
		t.Fatalf("compact b (%s): %v", b, err)
	}
	return bytes.Equal(ca.Bytes(), cb.Bytes())
}
