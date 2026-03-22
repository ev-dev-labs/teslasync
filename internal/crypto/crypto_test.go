package crypto

import (
	"os"
	"testing"
)

func TestEncryptDecrypt(t *testing.T) {
	enc, err := New("test-secret-key-for-teslasync")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	tests := []struct {
		name      string
		plaintext string
	}{
		{"simple", "hello world"},
		{"empty", ""},
		{"token-like", "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0"},
		{"unicode", "tëslà-tökèn-🚗"},
		{"long", string(make([]byte, 10000))},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encrypted, err := enc.Encrypt(tt.plaintext)
			if err != nil {
				t.Fatalf("Encrypt() error: %v", err)
			}

			if encrypted == tt.plaintext && tt.plaintext != "" {
				t.Error("Encrypt() returned plaintext unchanged")
			}

			decrypted, err := enc.Decrypt(encrypted)
			if err != nil {
				t.Fatalf("Decrypt() error: %v", err)
			}

			if decrypted != tt.plaintext {
				t.Errorf("Decrypt() = %q, want %q", decrypted, tt.plaintext)
			}
		})
	}
}

func TestEncryptProducesDifferentCiphertexts(t *testing.T) {
	enc, _ := New("test-key")
	ct1, _ := enc.Encrypt("same-plaintext")
	ct2, _ := enc.Encrypt("same-plaintext")

	if ct1 == ct2 {
		t.Error("Two encryptions of same plaintext should produce different ciphertexts (random nonce)")
	}
}

func TestDecryptWithWrongKey(t *testing.T) {
	enc1, _ := New("key-one")
	enc2, _ := New("key-two")

	ct, _ := enc1.Encrypt("secret data")
	_, err := enc2.Decrypt(ct)
	if err == nil {
		t.Error("Decrypt() with wrong key should fail")
	}
}

func TestDecryptInvalidBase64(t *testing.T) {
	enc, _ := New("key")
	_, err := enc.Decrypt("not-valid-base64!!!")
	if err == nil {
		t.Error("Decrypt() with invalid base64 should fail")
	}
}

func TestNewEmptyKey(t *testing.T) {
	_, err := New("")
	if err == nil {
		t.Error("New() with empty key should fail")
	}
}

func TestEncryptIfEnabled(t *testing.T) {
	// nil encryptor — returns plaintext
	result := EncryptIfEnabled(nil, "plaintext")
	if result != "plaintext" {
		t.Errorf("EncryptIfEnabled(nil) = %q, want plaintext", result)
	}

	// with encryptor — returns encrypted
	enc, _ := New("key")
	result = EncryptIfEnabled(enc, "plaintext")
	if result == "plaintext" {
		t.Error("EncryptIfEnabled(enc) should not return plaintext")
	}
}

func TestDecryptIfEnabled(t *testing.T) {
	// nil encryptor — returns as-is
	result := DecryptIfEnabled(nil, "anything")
	if result != "anything" {
		t.Errorf("DecryptIfEnabled(nil) = %q, want 'anything'", result)
	}

	// with encryptor + valid ciphertext
	enc, _ := New("key")
	ct, _ := enc.Encrypt("secret")
	result = DecryptIfEnabled(enc, ct)
	if result != "secret" {
		t.Errorf("DecryptIfEnabled(enc, ct) = %q, want 'secret'", result)
	}

	// with encryptor + unencrypted legacy data — returns as-is
	result = DecryptIfEnabled(enc, "plain-legacy-token")
	if result != "plain-legacy-token" {
		t.Errorf("DecryptIfEnabled(enc, legacy) = %q, want 'plain-legacy-token'", result)
	}
}

func TestNewFromEnv(t *testing.T) {
	// No env var — returns nil
	os.Unsetenv("ENCRYPTION_KEY")
	enc := NewFromEnv()
	if enc != nil {
		t.Error("NewFromEnv() with no env var should return nil")
	}

	// With env var — returns encryptor
	os.Setenv("ENCRYPTION_KEY", "test-key")
	defer os.Unsetenv("ENCRYPTION_KEY")
	enc = NewFromEnv()
	if enc == nil {
		t.Error("NewFromEnv() with env var should return encryptor")
	}
}
