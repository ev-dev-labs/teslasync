// Package crypto — Phase-46 / Prompt 35.
//
// TOTP secret + backup-code envelope helpers.
//
// TeslaSync's per-user TOTP enrollment stores the shared HMAC-SHA1 seed
// in BYTEA. We encrypt it at rest with the same AES-256-GCM envelope
// used for Tesla refresh tokens (see [Encryptor.Encrypt]) so that a
// stolen DB dump alone cannot mint TOTP codes for any subject. Backup
// codes are SHA-256 hashed (not encrypted) because a one-shot consume
// just needs equality on the hash, never the original code value.
//
// Public API surface is intentionally tiny — generation, encrypt/decrypt
// for the binary secret, and SHA-256 hashing for the printable backup
// codes — so the totp_handler/totp_repo wiring never has to touch
// Encryptor primitives directly.
package crypto

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
)

// totpSecretBytes is the size, in raw bytes, of the per-user TOTP seed.
// RFC 6238 §5.1 mandates a minimum of 128 bits (16 bytes) for SHA-1
// implementations and recommends 160 bits (20 bytes). We pick 20 bytes
// to match Google Authenticator's default and to leave headroom for a
// future bump to SHA-256/SHA-512 without reseeding every credential.
const totpSecretBytes = 20

// backupCodeBytes is the raw entropy per single-use backup code BEFORE
// base32 encoding. Ten bytes = 80 bits of entropy = 16 base32 chars
// (we strip padding and the visually-ambiguous chars below); industry
// pattern (GitHub, AWS, Authy) sits in the 64–80 bit range.
const backupCodeBytes = 10

// backupCodeAlphabet is the printable subset used when rendering a
// backup code to the user. Strips visually-ambiguous characters (0/O,
// 1/I) so a recovery code copied off a sticky note still validates
// after a typo. Length = 32 = 5 bits per char, so a 10-byte raw seed
// yields exactly 16 user-visible characters before the cosmetic dash.
const backupCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

// totpSecretBase32 is a strict no-padding base32 alphabet used when we
// hand the secret to the user / authenticator app. RFC 6238 implementers
// universally accept the un-padded form, and Google Authenticator chokes
// on padding characters in QR payloads.
var totpSecretBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// ErrEmptySecret signals that an empty byte slice was passed where a
// concrete TOTP seed was expected. Returned by [EncodeTOTPSecret] and
// the encrypt/decrypt helpers so callers can distinguish "you forgot
// to seed me" from a genuine cipher failure.
var ErrEmptySecret = errors.New("totp: secret must not be empty")

// GenerateTOTPSecret returns a fresh, cryptographically-random 20-byte
// seed suitable for use as the shared secret in an RFC 6238 TOTP
// enrollment. Returns the raw bytes and the base32-no-padding string
// the user / their authenticator app will scan.
//
// crypto/rand.Read is documented to never fail on supported platforms;
// any error here is fatal to the calling request and is surfaced to the
// HTTP layer so a 500 with a real cause beats a silent zero-secret.
func GenerateTOTPSecret() (raw []byte, base32Encoded string, err error) {
	raw = make([]byte, totpSecretBytes)
	if _, err := rand.Read(raw); err != nil {
		return nil, "", fmt.Errorf("totp: read random secret: %w", err)
	}
	return raw, totpSecretBase32.EncodeToString(raw), nil
}

// EncodeTOTPSecret renders a raw secret as base32-no-padding. Useful
// when the secret was generated externally (e.g. for fixture tests) but
// still needs to be presented in the otpauth:// URI.
func EncodeTOTPSecret(raw []byte) (string, error) {
	if len(raw) == 0 {
		return "", ErrEmptySecret
	}
	return totpSecretBase32.EncodeToString(raw), nil
}

// DecodeTOTPSecret parses a base32-no-padding string back to the raw
// seed bytes. Used by the verify path after we pull the encrypted
// secret out of the DB and want to feed it to the OTP library.
func DecodeTOTPSecret(s string) ([]byte, error) {
	if s == "" {
		return nil, ErrEmptySecret
	}
	raw, err := totpSecretBase32.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("totp: decode secret: %w", err)
	}
	return raw, nil
}

// EncryptTOTPSecret seals a raw TOTP seed with AES-256-GCM. The output
// is suitable for direct INSERT into a BYTEA column. Empty enc returns
// the raw bytes unchanged so dev/test environments without ENCRYPTION_KEY
// still function — production refuses to start without the key (see
// [NewFromEnv]) so this fallback never fires in prod.
func EncryptTOTPSecret(enc *Encryptor, raw []byte) ([]byte, error) {
	if len(raw) == 0 {
		return nil, ErrEmptySecret
	}
	if enc == nil {
		// Make a defensive copy so callers can't mutate stored bytes
		// later via the same slice header.
		out := make([]byte, len(raw))
		copy(out, raw)
		return out, nil
	}
	// Reuse the GCM AEAD on the Encryptor by going through its string
	// API: base64-decode the result back to bytes for storage so the
	// db column stays plain BYTEA (no nested encoding).
	encoded, err := enc.Encrypt(string(raw))
	if err != nil {
		return nil, fmt.Errorf("totp: encrypt secret: %w", err)
	}
	return []byte(encoded), nil
}

// DecryptTOTPSecret reverses [EncryptTOTPSecret]. The two-mode behaviour
// matches the rest of the crypto package: a nil Encryptor returns the
// stored bytes unchanged, supporting dev/test environments that never
// set ENCRYPTION_KEY.
func DecryptTOTPSecret(enc *Encryptor, stored []byte) ([]byte, error) {
	if len(stored) == 0 {
		return nil, ErrEmptySecret
	}
	if enc == nil {
		out := make([]byte, len(stored))
		copy(out, stored)
		return out, nil
	}
	plain, err := enc.Decrypt(string(stored))
	if err != nil {
		return nil, fmt.Errorf("totp: decrypt secret: %w", err)
	}
	return []byte(plain), nil
}

// GenerateBackupCodes returns count fresh single-use codes. Each code is
// 16 chars from [backupCodeAlphabet], rendered with a hyphen at the
// midpoint (XXXXXXXX-XXXXXXXX) so the printed sheet is easier to read.
// The hyphen is purely cosmetic — [HashBackupCode] strips it before
// hashing so the comparison is whitespace + dash insensitive.
func GenerateBackupCodes(count int) ([]string, error) {
	if count <= 0 {
		return nil, errors.New("totp: backup code count must be positive")
	}
	out := make([]string, count)
	for i := 0; i < count; i++ {
		raw := make([]byte, backupCodeBytes)
		if _, err := rand.Read(raw); err != nil {
			return nil, fmt.Errorf("totp: read backup code entropy: %w", err)
		}
		out[i] = renderBackupCode(raw)
	}
	return out, nil
}

// renderBackupCode encodes raw entropy through the visually-unambiguous
// alphabet. Each base32 char carries 5 bits, so 10 bytes = 80 bits = 16
// chars. The hyphen split mirrors what GitHub and AWS print on the
// recovery card.
func renderBackupCode(raw []byte) string {
	// We intentionally do NOT use base32 here — base32 includes "0",
	// "1", "8" which are easily confused with O/I/B in handwriting. We
	// hand-roll a 5-bit chunker over [backupCodeAlphabet] instead.
	const charsPerCode = backupCodeBytes * 8 / 5 // = 16
	buf := make([]byte, 0, charsPerCode+1)
	bits := uint64(0)
	bitsHeld := 0
	for _, b := range raw {
		bits = (bits << 8) | uint64(b)
		bitsHeld += 8
		for bitsHeld >= 5 {
			bitsHeld -= 5
			idx := byte((bits >> bitsHeld) & 0x1F)
			buf = append(buf, backupCodeAlphabet[idx])
			if len(buf) == charsPerCode/2 {
				buf = append(buf, '-')
			}
		}
	}
	return string(buf)
}

// HashBackupCode returns the lower-hex SHA-256 of the supplied code,
// after stripping ASCII whitespace and dashes so users can paste with
// the printed dash, with surrounding whitespace, with mixed case, etc.
// Hash output is 64 chars; sized to fit comfortably in a JSONB string.
func HashBackupCode(code string) string {
	cleaned := normalizeBackupCode(code)
	if cleaned == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(cleaned))
	return hex.EncodeToString(sum[:])
}

// normalizeBackupCode strips dashes and whitespace then upper-cases the
// remainder. Exposed at the package level so the repo's
// ConsumeBackupCode can run an identical normalisation before lookup.
func normalizeBackupCode(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case ' ', '\t', '\r', '\n', '-', '_':
			continue
		}
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		out = append(out, c)
	}
	return string(out)
}

// NormalizeBackupCode is the exported alias of normalizeBackupCode for
// callers in the api / database packages. Kept as a separate name so
// the unit tests can exercise the unexported form directly while the
// rest of the codebase consumes a stable public symbol.
func NormalizeBackupCode(s string) string {
	return normalizeBackupCode(s)
}
