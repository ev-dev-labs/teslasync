// Package crypto provides AES-256-GCM encryption for sensitive data at rest.
//
// Usage:
//
//	enc, _ := crypto.New("my-32-byte-secret-key-here!!")
//	ciphertext, _ := enc.Encrypt("plaintext-token")
//	plaintext, _ := enc.Decrypt(ciphertext)
//
// The encryption key is derived from the user-provided key using SHA-256,
// ensuring any length key produces a valid 32-byte AES key.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/rs/zerolog/log"
)

// Encryptor provides AES-256-GCM encryption and decryption.
type Encryptor struct {
	gcm cipher.AEAD
}

// New creates an Encryptor from the given key. The key is hashed with SHA-256
// to produce a 32-byte AES key.
func New(key string) (*Encryptor, error) {
	if key == "" {
		return nil, errors.New("encryption key must not be empty")
	}

	hash := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(hash[:])
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	return &Encryptor{gcm: gcm}, nil
}

// NewFromEnv creates an Encryptor using the ENCRYPTION_KEY environment variable.
// Returns nil (no encryption) if the variable is not set in non-production environments.
// In production (APP_ENV or GO_ENV set to "production" or "prod"), the process is
// terminated to prevent accidental plaintext token storage.
func NewFromEnv() *Encryptor {
	key := os.Getenv("ENCRYPTION_KEY")
	if key == "" {
		env := strings.ToLower(os.Getenv("APP_ENV"))
		if env == "" {
			env = strings.ToLower(os.Getenv("GO_ENV"))
		}
		if env == "production" || env == "prod" {
			log.Fatal().Msg("ENCRYPTION_KEY is required in production — refusing to start with plaintext token storage")
		}
		log.Warn().Msg("ENCRYPTION_KEY not set — tokens will be stored in PLAINTEXT. Set ENCRYPTION_KEY before deploying to production")
		return nil
	}
	enc, err := New(key)
	if err != nil {
		return nil
	}
	return enc
}

// Encrypt encrypts plaintext and returns a base64-encoded ciphertext string.
func (e *Encryptor) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, e.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	ciphertext := e.gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decodes a base64-encoded ciphertext and returns the plaintext.
func (e *Encryptor) Decrypt(encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}

	nonceSize := e.gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := e.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}

	return string(plaintext), nil
}

// EncryptIfEnabled encrypts if an encryptor is provided, otherwise returns plaintext.
func EncryptIfEnabled(enc *Encryptor, plaintext string) string {
	// When enc is nil, returns plaintext. This is only safe in dev/test —
	// production startup is blocked by NewFromEnv() when ENCRYPTION_KEY is missing.
	if enc == nil {
		return plaintext
	}
	encrypted, err := enc.Encrypt(plaintext)
	if err != nil {
		return plaintext
	}
	return encrypted
}

// DecryptIfEnabled decrypts if an encryptor is provided, otherwise returns as-is.
func DecryptIfEnabled(enc *Encryptor, ciphertext string) string {
	if enc == nil {
		return ciphertext
	}
	plaintext, err := enc.Decrypt(ciphertext)
	if err != nil {
		// May be unencrypted legacy data — return as-is
		return ciphertext
	}
	return plaintext
}
