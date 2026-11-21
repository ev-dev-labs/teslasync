package smartmediasvc

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

const oauthStateTTL = 10 * time.Minute

func (s *Reviews) StartSpotify(ctx context.Context, scope port.Scope) (string, error) {
	if err := s.checkScope(ctx, scope); err != nil {
		return "", err
	}
	if !s.available() {
		return "", ErrUnavailable
	}
	state := base64.RawURLEncoding.EncodeToString(randomBytes())
	verifier := base64.RawURLEncoding.EncodeToString(randomBytes())
	stateHash, challenge := sha256.Sum256([]byte(state)), sha256.Sum256([]byte(verifier))
	cipher, err := s.encrypt(scope.Subject, "verifier", hex.EncodeToString(stateHash[:]), verifier)
	if err != nil {
		return "", err
	}
	if err := s.repo.StartSpotify(ctx, scope, stateHash[:], cipher, s.now().UTC().Add(oauthStateTTL)); err != nil {
		return "", err
	}
	return s.spotify.AuthorizationURL(state, base64.RawURLEncoding.EncodeToString(challenge[:])), nil
}

func (s *Reviews) CompleteSpotify(ctx context.Context, subject, state, code string) (int64, error) {
	if !validSubject(subject) || len(state) != 43 || len(code) > 4096 {
		return 0, ErrInvalidInput
	}
	if !s.available() {
		return 0, ErrUnavailable
	}
	stateHash := sha256.Sum256([]byte(state))
	attempt, err := s.repo.ConsumeSpotify(ctx, subject, stateHash[:], s.now().UTC())
	if err != nil {
		return 0, err
	}
	if attempt == nil {
		return 0, ErrConnect
	}
	vehicleID := attempt.VehicleID
	if code == "" {
		return vehicleID, ErrConnect
	}
	if err := s.checkScope(ctx, port.Scope{Subject: subject, VehicleID: vehicleID}); err != nil {
		return vehicleID, err
	}
	verifier, err := s.decrypt(subject, "verifier", hex.EncodeToString(stateHash[:]), attempt.VerifierCipher)
	if err != nil {
		return vehicleID, err
	}
	grant, err := s.spotify.Exchange(ctx, code, verifier)
	if err != nil || grant.ExpiresIn <= 0 || grant.AccessToken == "" {
		return vehicleID, ErrConnect
	}
	cipher, err := s.encrypt(subject, "grant", strconv.FormatInt(attempt.Revision, 10), grant.AccessToken)
	if err != nil {
		return vehicleID, err
	}
	now := s.now().UTC()
	return vehicleID, s.repo.SetSpotifyGrant(ctx, subject, attempt.Revision, port.Grant{
		Revision: attempt.Revision, TokenCipher: cipher, ExpiresAt: now.Add(min(grant.ExpiresIn, time.Hour)),
	}, now)
}

func (s *Reviews) DisconnectSpotify(ctx context.Context, subject string) error {
	if !validSubject(subject) {
		return ErrInvalidInput
	}
	return s.repo.DisconnectSpotify(ctx, subject)
}

func randomBytes() []byte {
	value := make([]byte, 32)
	_, _ = rand.Read(value)
	return value
}

func (s *Reviews) encrypt(subject, kind, key, value string) (string, error) {
	return encryptSpotifySecret(s.secrets, subject, kind, key, value)
}

func encryptSpotifySecret(secrets port.SecretCodec, subject, kind, key, value string) (string, error) {
	ciphertext, err := secrets.Encrypt(secretPrefix(subject, kind, key) + value)
	if err != nil {
		return "", fmt.Errorf("protect private media authorization: %w", err)
	}
	return ciphertext, nil
}

func (s *Reviews) decrypt(subject, kind, key, ciphertext string) (string, error) {
	return decryptSpotifySecret(s.secrets, subject, kind, key, ciphertext)
}

func decryptSpotifySecret(secrets port.SecretCodec, subject, kind, key, ciphertext string) (string, error) {
	plaintext, err := secrets.Decrypt(ciphertext)
	if err != nil {
		return "", errors.New("private media authorization could not be opened")
	}
	value, match := strings.CutPrefix(plaintext, secretPrefix(subject, kind, key))
	if !match || value == "" {
		return "", errors.New("private media authorization scope mismatch")
	}
	return value, nil
}

func (s *Reviews) unwrap(subject, kind string, revision int64, ciphertext string) (string, error) {
	return s.decrypt(subject, kind, strconv.FormatInt(revision, 10), ciphertext)
}

func secretPrefix(subject, kind, key string) string {
	subjectHash := sha256.Sum256([]byte(subject))
	return "smart-media:spotify:" + hex.EncodeToString(subjectHash[:]) + ":" + kind + ":" + key + ":"
}
