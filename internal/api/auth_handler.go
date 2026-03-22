package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// AuthHandler handles OAuth flow with Tesla.
type AuthHandler struct {
	tokenRepo   *database.TokenRepo
	teslaClient *tesla.Client
}

func NewAuthHandler(db *database.DB, tc *tesla.Client) *AuthHandler {
	return &AuthHandler{
		tokenRepo:   database.NewTokenRepo(db),
		teslaClient: tc,
	}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	state, err := generateState()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate state")
		return
	}

	url := h.teslaClient.GetAuthURL(state)
	writeJSON(w, http.StatusOK, map[string]string{
		"auth_url": url,
		"state":    state,
	})
}

func (h *AuthHandler) Callback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "missing authorization code")
		return
	}

	tokenResp, err := h.teslaClient.ExchangeCode(r.Context(), code)
	if err != nil {
		log.Error().Err(err).Msg("failed to exchange code")
		writeError(w, http.StatusBadGateway, "failed to exchange authorization code")
		return
	}

	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	token := &models.Token{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresAt:    expiresAt,
	}
	if err := h.tokenRepo.Upsert(r.Context(), token); err != nil {
		log.Error().Err(err).Msg("failed to save token")
		writeError(w, http.StatusInternalServerError, "failed to save token")
		return
	}

	// Redirect to frontend after successful auth
	http.Redirect(w, r, "/?auth=success", http.StatusTemporaryRedirect)
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	tokenResp, err := h.teslaClient.RefreshTokens(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to refresh token")
		writeError(w, http.StatusBadGateway, "failed to refresh token")
		return
	}

	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	token := &models.Token{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresAt:    expiresAt,
	}
	if err := h.tokenRepo.Upsert(r.Context(), token); err != nil {
		log.Error().Err(err).Msg("failed to save refreshed token")
		writeError(w, http.StatusInternalServerError, "failed to save token")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "refreshed"})
}

func (h *AuthHandler) Status(w http.ResponseWriter, r *http.Request) {
	token, err := h.tokenRepo.Get(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get token status")
		return
	}

	if token == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"authenticated": false,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"authenticated": true,
		"expires_at":    token.ExpiresAt,
		"expired":       time.Now().After(token.ExpiresAt),
	})
}

func generateState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
