package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
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

// oauthExchangeTimeout bounds each outbound Tesla OAuth token exchange
// (authorization-code grant + refresh) together with the subsequent
// token persistence, so a hung upstream can never wedge the request
// goroutine indefinitely. The tesla-auth HTTP client enforces its own
// 30s budget; mirroring it at the handler boundary also covers the DB
// write and keeps the two in lock-step.
const oauthExchangeTimeout = 30 * time.Second

// tokenStore is the persistence port for the single stored Tesla OAuth
// token. *dbauth.TokenRepo is the production implementation; tests
// supply an in-memory fake so no database is required.
type tokenStore interface {
	Upsert(ctx context.Context, t *authmodel.Token) error
	Get(ctx context.Context) (*authmodel.Token, error)
	Delete(ctx context.Context) error
}

// teslaAuthClient is the Tesla OAuth port used by the handler.
// *tesla.Client is the production implementation; tests supply a fake
// that performs no network I/O.
type teslaAuthClient interface {
	GetAuthURL(state string) string
	ExchangeCode(ctx context.Context, code string) (*tesla.TokenResponse, error)
	RefreshTokens(ctx context.Context) (*tesla.TokenResponse, error)
	SetTokens(access, refresh string, expiresAt time.Time)
}

// Handler handles OAuth flow with Tesla.
type Handler struct {
	tokenRepo   tokenStore
	teslaClient teslaAuthClient
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

	ctx, cancel := context.WithTimeout(r.Context(), oauthExchangeTimeout)
	defer cancel()

	tokenResp, err := h.teslaClient.ExchangeCode(ctx, code)
	if err != nil {
		metrics.AuthAttempts.WithLabelValues("failure").Inc()
		log.Error().Err(err).Msg("failed to exchange code")
		httpx.WriteError(w, http.StatusBadGateway, "failed to exchange authorization code")
		return
	}
	if tokenResp == nil {
		metrics.AuthAttempts.WithLabelValues("failure").Inc()
		log.Error().Msg("tesla returned a nil token response on code exchange")
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
	if err := h.tokenRepo.Upsert(ctx, token); err != nil {
		log.Error().Err(err).Msg("failed to save token")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save token")
		return
	}

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

	ctx, cancel := context.WithTimeout(r.Context(), oauthExchangeTimeout)
	defer cancel()

	tokenResp, err := h.teslaClient.RefreshTokens(ctx)
	if err != nil {
		metrics.TokenRefreshes.WithLabelValues("failure").Inc()
		log.Error().Err(err).Msg("failed to refresh token")
		httpx.WriteError(w, http.StatusBadGateway, "failed to refresh token")
		return
	}
	if tokenResp == nil {
		metrics.TokenRefreshes.WithLabelValues("failure").Inc()
		log.Error().Msg("tesla returned a nil token response on refresh")
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
	if err := h.tokenRepo.Upsert(ctx, token); err != nil {
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
		return "", fmt.Errorf("generate oauth state: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// Disconnect removes the stored Tesla token, effectively logging out.
func (h *Handler) Disconnect(w http.ResponseWriter, r *http.Request) {
	if err := h.tokenRepo.Delete(r.Context()); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to disconnect")
		return
	}
	h.teslaClient.SetTokens("", "", time.Time{})
	log.Info().Msg("Tesla account disconnected")
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}
