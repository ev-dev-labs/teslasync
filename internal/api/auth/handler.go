package auth

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	authmodel "github.com/ev-dev-labs/teslasync/internal/models/auth"

	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// Handler handles OAuth flow with Tesla.
type Handler struct {
	tokenRepo   *dbauth.TokenRepo
	teslaClient *tesla.Client
}

func NewHandler(db *database.DB, tc *tesla.Client, enc ...*crypto.Encryptor) *Handler {
	var e *crypto.Encryptor
	if len(enc) > 0 {
		e = enc[0]
	}
	return &Handler{
		tokenRepo:   dbauth.NewTokenRepo(db, e),
		teslaClient: tc,
	}
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	state, err := generateState()
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to generate state")
		return
	}

	url := h.teslaClient.GetAuthURL(state)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"auth_url": url,
		"state":    state,
	})
}

func (h *Handler) Callback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		httpx.WriteError(w, http.StatusBadRequest, "missing authorization code")
		return
	}

	tokenResp, err := h.teslaClient.ExchangeCode(r.Context(), code)
	if err != nil {
		metrics.AuthAttempts.WithLabelValues("failure").Inc()
		log.Error().Err(err).Msg("failed to exchange code")
		httpx.WriteError(w, http.StatusBadGateway, "failed to exchange authorization code")
		return
	}
	metrics.AuthAttempts.WithLabelValues("success").Inc()

	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	token := &authmodel.Token{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresAt:    expiresAt,
	}
	if err := h.tokenRepo.Upsert(r.Context(), token); err != nil {
		log.Error().Err(err).Msg("failed to save token")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save token")
		return
	}

	// Redirect to frontend after successful auth
	http.Redirect(w, r, "/?auth=success", http.StatusTemporaryRedirect)
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	// No-op fast-path: when no Tesla account is linked there is nothing
	// to refresh. Returning 200 with a `noop` status (instead of 502)
	// stops the SPA's auto-refresh-on-401 loop from spamming the console
	// in open-mode / unconfigured installs. The Settings UI's manual
	// "Refresh Tesla token" button also receives a meaningful payload
	// instead of a generic Bad Gateway.
	existing, err := h.tokenRepo.Get(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to read token before refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read token")
		return
	}
	if existing == nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{
			"status": "noop",
			"reason": "no tesla account linked",
		})
		return
	}

	tokenResp, err := h.teslaClient.RefreshTokens(r.Context())
	if err != nil {
		metrics.TokenRefreshes.WithLabelValues("failure").Inc()
		log.Error().Err(err).Msg("failed to refresh token")
		httpx.WriteError(w, http.StatusBadGateway, "failed to refresh token")
		return
	}
	metrics.TokenRefreshes.WithLabelValues("success").Inc()

	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	token := &authmodel.Token{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresAt:    expiresAt,
	}
	if err := h.tokenRepo.Upsert(r.Context(), token); err != nil {
		log.Error().Err(err).Msg("failed to save refreshed token")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save token")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "refreshed"})
}

func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	token, err := h.tokenRepo.Get(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get token status")
		return
	}

	if token == nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"authenticated": false,
		})
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
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

// Disconnect removes the stored Tesla token, effectively logging out.
func (h *Handler) Disconnect(w http.ResponseWriter, r *http.Request) {
	if err := h.tokenRepo.Delete(r.Context()); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to disconnect")
		return
	}
	// Clear in-memory tokens so the client stops making API calls
	h.teslaClient.SetTokens("", "", time.Time{})
	log.Info().Msg("Tesla account disconnected")
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}
