package auth

import (
	"reflect"
	"testing"
)

func TestEncodeBackupHashes_NilProducesEmptyArray(t *testing.T) {
	got, err := encodeBackupHashes(nil)
	if err != nil {
		t.Fatalf("encode nil: %v", err)
	}
	if string(got) != "[]" {
		t.Fatalf("expected '[]', got %q", got)
	}
}

func TestEncodeBackupHashes_RoundTrip(t *testing.T) {
	in := []string{"abc123", "deadbeef", "feed01"}
	enc, err := encodeBackupHashes(in)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	dec, err := decodeBackupHashes(enc)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !reflect.DeepEqual(in, dec) {
		t.Fatalf("round trip mismatch:\n  in  = %v\n  out = %v", in, dec)
	}
}

func TestDecodeBackupHashes_EmptyBytes(t *testing.T) {
	got, err := decodeBackupHashes(nil)
	if err != nil {
		t.Fatalf("decode nil: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("expected non-nil empty slice, got %v", got)
	}

	got, err = decodeBackupHashes([]byte{})
	if err != nil {
		t.Fatalf("decode []: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("expected non-nil empty slice, got %v", got)
	}
}

func TestDecodeBackupHashes_Invalid(t *testing.T) {
	if _, err := decodeBackupHashes([]byte("not json")); err == nil {
		t.Fatal("expected error on invalid JSON input")
	}
}

func TestDecodeBackupHashes_NullArrayBecomesEmpty(t *testing.T) {
	got, err := decodeBackupHashes([]byte("null"))
	if err != nil {
		t.Fatalf("decode null: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("expected non-nil empty slice for JSON null, got %v", got)
	}
}
