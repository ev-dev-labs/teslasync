package auth

import (
	"testing"
	"time"
)

func TestToken_NotExpired(t *testing.T) {
	tok := Token{
		AccessToken:  "test-token",
		RefreshToken: "test-refresh",
		ExpiresAt:    time.Now().Add(1 * time.Hour),
	}
	if tok.AccessToken == "" {
		t.Error("expected non-empty access token")
	}
	if tok.ExpiresAt.Before(time.Now()) {
		t.Error("expected token to not be expired")
	}
}

func TestToken_Expired(t *testing.T) {
	tok := Token{
		AccessToken:  "expired-token",
		RefreshToken: "expired-refresh",
		ExpiresAt:    time.Now().Add(-1 * time.Hour),
	}
	if !tok.ExpiresAt.Before(time.Now()) {
		t.Error("expected token to be expired")
	}
}
