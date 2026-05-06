package crypto

import (
	"bytes"
	"strings"
	"testing"
)

func TestGenerateTOTPSecret_LengthAndUniqueness(t *testing.T) {
	raw1, b32_1, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("first generate: %v", err)
	}
	if len(raw1) != totpSecretBytes {
		t.Fatalf("raw len = %d, want %d", len(raw1), totpSecretBytes)
	}
	if b32_1 == "" {
		t.Fatal("expected non-empty base32 encoding")
	}
	if strings.ContainsRune(b32_1, '=') {
		t.Fatalf("base32 should be unpadded, got %q", b32_1)
	}

	raw2, b32_2, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("second generate: %v", err)
	}
	if bytes.Equal(raw1, raw2) {
		t.Fatal("two random secrets should differ; got identical")
	}
	if b32_1 == b32_2 {
		t.Fatal("two random base32 secrets should differ; got identical")
	}
}

func TestEncodeDecodeTOTPSecret_RoundTrip(t *testing.T) {
	raw := []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
		0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14}
	enc, err := EncodeTOTPSecret(raw)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	dec, err := DecodeTOTPSecret(enc)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !bytes.Equal(raw, dec) {
		t.Fatalf("round-trip mismatch:\n  in  = %x\n  out = %x", raw, dec)
	}
}

func TestEncodeTOTPSecret_RejectsEmpty(t *testing.T) {
	_, err := EncodeTOTPSecret(nil)
	if err == nil {
		t.Fatal("expected error on empty secret")
	}
	if err != ErrEmptySecret {
		t.Fatalf("expected ErrEmptySecret, got %v", err)
	}
}

func TestDecodeTOTPSecret_RejectsEmpty(t *testing.T) {
	if _, err := DecodeTOTPSecret(""); err != ErrEmptySecret {
		t.Fatalf("expected ErrEmptySecret on empty string, got %v", err)
	}
}

func TestDecodeTOTPSecret_RejectsInvalid(t *testing.T) {
	if _, err := DecodeTOTPSecret("not!base32"); err == nil {
		t.Fatal("expected decode error on invalid base32")
	}
}

func TestEncryptDecryptTOTPSecret_NilEncryptor(t *testing.T) {
	raw := []byte("hello-world-secret-20")
	stored, err := EncryptTOTPSecret(nil, raw)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !bytes.Equal(stored, raw) {
		t.Fatalf("nil encryptor should pass-through; got %x, want %x", stored, raw)
	}

	// Mutating the returned slice MUST NOT alter the input slice — the
	// helper has to defensively copy.
	stored[0] ^= 0xFF
	if raw[0] == stored[0] {
		t.Fatal("encrypt with nil enc should defensively copy")
	}

	plain, err := DecryptTOTPSecret(nil, stored)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	storedSnapshot := bytes.Clone(stored)
	plain[0] ^= 0xFF
	if !bytes.Equal(stored, storedSnapshot) {
		t.Fatal("decrypt with nil enc should defensively copy (mutating plain must not alter stored)")
	}
}

func TestEncryptDecryptTOTPSecret_RealEncryptor(t *testing.T) {
	enc, err := New("test-encryption-key-for-totp-secret")
	if err != nil {
		t.Fatalf("new encryptor: %v", err)
	}
	raw, _, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	stored, err := EncryptTOTPSecret(enc, raw)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if bytes.Equal(stored, raw) {
		t.Fatal("encrypted output should differ from plaintext")
	}
	got, err := DecryptTOTPSecret(enc, stored)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(got, raw) {
		t.Fatalf("round-trip mismatch:\n  in  = %x\n  out = %x", raw, got)
	}
}

func TestEncryptTOTPSecret_RejectsEmpty(t *testing.T) {
	if _, err := EncryptTOTPSecret(nil, nil); err != ErrEmptySecret {
		t.Fatalf("expected ErrEmptySecret on empty input, got %v", err)
	}
}

func TestDecryptTOTPSecret_RejectsEmpty(t *testing.T) {
	if _, err := DecryptTOTPSecret(nil, nil); err != ErrEmptySecret {
		t.Fatalf("expected ErrEmptySecret on empty input, got %v", err)
	}
}

func TestGenerateBackupCodes_ShapeAndUniqueness(t *testing.T) {
	codes, err := GenerateBackupCodes(10)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(codes) != 10 {
		t.Fatalf("len = %d, want 10", len(codes))
	}
	seen := make(map[string]struct{}, len(codes))
	for i, c := range codes {
		if !strings.Contains(c, "-") {
			t.Errorf("code %d missing hyphen separator: %q", i, c)
		}
		if len(strings.ReplaceAll(c, "-", "")) != 16 {
			t.Errorf("code %d wrong length: %q", i, c)
		}
		// All chars must come from the visually-unambiguous alphabet.
		bare := strings.ReplaceAll(c, "-", "")
		for _, r := range bare {
			if !strings.ContainsRune(backupCodeAlphabet, r) {
				t.Errorf("code %d contains forbidden char %q: %q", i, r, c)
			}
		}
		if _, dup := seen[c]; dup {
			t.Errorf("duplicate backup code: %q", c)
		}
		seen[c] = struct{}{}
	}
}

func TestGenerateBackupCodes_RejectsZero(t *testing.T) {
	if _, err := GenerateBackupCodes(0); err == nil {
		t.Fatal("expected error on count=0")
	}
	if _, err := GenerateBackupCodes(-1); err == nil {
		t.Fatal("expected error on count=-1")
	}
}

func TestHashBackupCode_NormalisesInput(t *testing.T) {
	canonical := HashBackupCode("ABCD-EFGH-JKMN-PQRS")
	if canonical == "" {
		t.Fatal("expected non-empty hash")
	}
	cases := map[string]string{
		"with surrounding spaces":     "  ABCD-EFGH-JKMN-PQRS  ",
		"lowercase":                   "abcd-efgh-jkmn-pqrs",
		"no separator":                "ABCDEFGHJKMNPQRS",
		"underscore separator":        "ABCD_EFGH_JKMN_PQRS",
		"mixed case + extra dashes":   "abcd--EFGH--jKmN--PQRS",
		"newline-tab embedded inside": "ABCD\tEFGH\nJKMNPQRS",
	}
	for name, variant := range cases {
		variant := variant
		t.Run(name, func(t *testing.T) {
			if got := HashBackupCode(variant); got != canonical {
				t.Fatalf("variant should hash identically:\n  canonical = %s\n  variant   = %s", canonical, got)
			}
		})
	}
}

func TestHashBackupCode_DifferentCodesDiffer(t *testing.T) {
	a := HashBackupCode("ABCD-EFGH-JKMN-PQRS")
	b := HashBackupCode("ABCD-EFGH-JKMN-PQRT") // off by one
	if a == b {
		t.Fatal("distinct codes must hash to distinct digests")
	}
}

func TestHashBackupCode_EmptyReturnsEmpty(t *testing.T) {
	if got := HashBackupCode(""); got != "" {
		t.Fatalf("empty input should hash to empty string, got %q", got)
	}
	if got := HashBackupCode("   ---  "); got != "" {
		t.Fatalf("whitespace-only input should hash to empty, got %q", got)
	}
}

func TestNormalizeBackupCode_PassThrough(t *testing.T) {
	got := NormalizeBackupCode("  abc-DEF gh\n")
	want := "ABCDEFGH"
	if got != want {
		t.Fatalf("normalise mismatch: got %q want %q", got, want)
	}
}

func TestNormalizeBackupCode_Empty(t *testing.T) {
	if got := NormalizeBackupCode(""); got != "" {
		t.Fatalf("expected empty result, got %q", got)
	}
	if got := NormalizeBackupCode("---  \t\n"); got != "" {
		t.Fatalf("expected empty result for separator-only input, got %q", got)
	}
}
