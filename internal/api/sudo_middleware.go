package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Phase-46 / Prompt 31 — sudo-style step-up reauth.
//
// Sensitive admin endpoints (revoke API key, delete vehicle, drop a
// data-repair table, restore a backup, rotate the Tesla token) MUST be
// gated by an explicit credential challenge in the seconds before the
// action fires. Without this, a hijacked active session can wipe data
// with a single click. RequireSudo enforces the gate at the router
// layer; the SPA's interceptor (web/src/api/client.ts) catches the
// 401+SUDO_REQUIRED, opens <ReauthDialog>, and replays the request.
//
// AUTH-MODE AWARENESS. Open-mode installs (AUTH_ENABLED=false /
// FORWARD_AUTH_HEADER="") have no upstream credential to re-verify, so
// RequireSudo passes the request through. The frontend dialog falls
// back to its typed-confirmation UI in that mode so destructive actions
// remain gated by an explicit user gesture, but no token is minted and
// no credential check happens.

// SudoRequiredCode is the JSON `code` field returned alongside a 401
// Unauthorized response when RequireSudo blocks a request. The SPA's
// resilient fetch matches on this exact string to open the reauth
// dialog. Changing the value is a coordinated SPA + backend change.
const SudoRequiredCode = "SUDO_REQUIRED"

// reauthNotConfiguredCode signals to the SPA that the install is in
// forward-auth mode but no shared step-up credential has been wired
// (TESLASYNC_SUDO_PASSWORD / TESLASYNC_SUDO_TOTP_SECRET both unset).
// The dialog displays a distinct help message instead of a re-prompt
// loop.
const reauthNotConfiguredCode = "REAUTH_NOT_CONFIGURED"

// SudoConfig is the read-only snapshot of step-up credential settings
// the handler captures at construction. Loaded from environment so the
// operator can rotate credentials with a pod restart and not a code
// deploy.
//
// The handler uses constant-time compare for the password and a 30s
// validity window for the TOTP code. Both fields support a leading or
// trailing whitespace from a docker secrets file (TrimSpace at load).
type SudoConfig struct {
	// PasswordHash is the trimmed value of TESLASYNC_SUDO_PASSWORD.
	// We compare the user-submitted password against this string with
	// crypto/subtle.ConstantTimeCompare. The variable is named "Hash"
	// to flag for any future contributor that this MUST stay opaque to
	// log scrubbers — never marshal it.
	PasswordHash string

	// TOTPSecret is the trimmed value of TESLASYNC_SUDO_TOTP_SECRET.
	// Empty disables the TOTP path. The actual TOTP verification is
	// pluggable via TOTPVerifier so the test suite can substitute a
	// deterministic verifier without pulling in an OTP library.
	TOTPSecret string

	// TTL is how long a successful reauth grants. Defaults to
	// [database.DefaultSudoTokenTTL]; operators override via
	// TESLASYNC_SUDO_TTL_SECONDS.
	TTL time.Duration

	// HeaderName is the proxy header carrying the principal identity
	// (typically "X-Forwarded-User"). Empty in open mode.
	HeaderName string
}

// LoadSudoConfig reads the step-up credentials from the application
// config snapshot + the supporting environment variables. Returns a
// fully populated SudoConfig with sensible defaults; never returns an
// error so a misconfiguration surfaces as a 503 from the handler
// rather than panicking the process at startup.
func LoadSudoConfig(cfg *config.Config) SudoConfig {
	header := ""
	if cfg != nil {
		header = strings.TrimSpace(cfg.Auth.ForwardAuthHeader)
	}
	ttl := database.DefaultSudoTokenTTL
	if raw := strings.TrimSpace(os.Getenv("TESLASYNC_SUDO_TTL_SECONDS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			ttl = time.Duration(n) * time.Second
		}
	}
	return SudoConfig{
		PasswordHash: strings.TrimSpace(os.Getenv("TESLASYNC_SUDO_PASSWORD")),
		TOTPSecret:   strings.TrimSpace(os.Getenv("TESLASYNC_SUDO_TOTP_SECRET")),
		TTL:          ttl,
		HeaderName:   header,
	}
}

// configured reports whether this install has any credential the
// reauth handler can validate. When false, the handler returns 503
// REAUTH_NOT_CONFIGURED rather than 401 — there is no point asking the
// user for a password the server can't check.
func (c SudoConfig) configured() bool {
	return c.PasswordHash != "" || c.TOTPSecret != ""
}

// TOTPVerifier is the pluggable TOTP-validation seam. Production wires
// the standard RFC 6238 HOTP/TOTP algorithm; tests substitute a
// deterministic implementation. Returns nil iff the code is currently
// valid for secret.
type TOTPVerifier func(secret, code string) error

// SudoHandler owns the reauth endpoint and the in-memory token store.
// It is constructed once in NewRouter and shared across the route
// table — the store IS the source of truth for sudo state.
type SudoHandler struct {
	cfg      SudoConfig
	store    *database.SudoTokenStore
	verifier TOTPVerifier
}

// NewSudoHandler builds the handler bundle. verifier may be nil; in
// that case the TOTP path returns 503 REAUTH_NOT_CONFIGURED even when
// a TOTP secret is configured (production wires a real verifier from
// the OTP library landed in prompt 35).
func NewSudoHandler(cfg SudoConfig, store *database.SudoTokenStore, verifier TOTPVerifier) *SudoHandler {
	return &SudoHandler{cfg: cfg, store: store, verifier: verifier}
}

// reauthRequest is the body shape accepted by POST /auth/reauth.
// Exactly one of password / totp_code MUST be set; both empty or both
// present return 400.
type reauthRequest struct {
	Password string `json:"password"`
	TOTPCode string `json:"totp_code"`
}

// reauthResponse is the success-shape returned by POST /auth/reauth.
// In open mode the token is empty and mode is "open" — the SPA does
// not echo X-Sudo-Token because RequireSudo is a passthrough.
type reauthResponse struct {
	Mode      string `json:"mode"`
	SudoToken string `json:"sudo_token,omitempty"`
	ExpiresAt string `json:"expires_at,omitempty"`
}

// Reauth is the POST /auth/reauth handler.
//
// Open mode (no FORWARD_AUTH_HEADER): always returns 200 with
// mode="open" and an empty token. The SPA never calls this in open
// mode (the typed-confirmation dialog short-circuits before the network
// trip), but routing it consistently means a misconfigured proxy
// flipping mode mid-flight does not 503 the dialog.
//
// Forward-auth mode without configured creds: 503 with
// code=REAUTH_NOT_CONFIGURED. The SPA renders an "ask your admin to
// set TESLASYNC_SUDO_PASSWORD" message rather than an infinite reprompt.
//
// Forward-auth mode with creds: validates exactly one of password OR
// totp_code; mints a 5-minute sudo token bound to the X-Forwarded-User
// subject; returns 200 with token + RFC3339 expires_at.
func (h *SudoHandler) Reauth(w http.ResponseWriter, r *http.Request) {
	// Open mode: nothing to verify; nothing to mint.
	if h.cfg.HeaderName == "" {
		writeJSON(w, http.StatusOK, reauthResponse{Mode: "open"})
		return
	}

	subject := strings.TrimSpace(r.Header.Get(h.cfg.HeaderName))
	if subject == "" {
		writeError(w, http.StatusUnauthorized, "missing identity header")
		return
	}

	if !h.cfg.configured() {
		writeErrorCode(w, http.StatusServiceUnavailable,
			"step-up reauth is not configured on this install",
			reauthNotConfiguredCode)
		return
	}

	body, err := decodeReauthBody(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	switch {
	case body.Password != "" && body.TOTPCode != "":
		writeError(w, http.StatusBadRequest, "supply exactly one of password or totp_code")
		return
	case body.Password != "":
		if h.cfg.PasswordHash == "" {
			writeErrorCode(w, http.StatusUnauthorized,
				"password reauth not enabled", "INVALID_CREDENTIAL")
			return
		}
		// Constant-time compare so timing leaks do not expose the
		// length of the configured password.
		want := []byte(h.cfg.PasswordHash)
		got := []byte(body.Password)
		if subtle.ConstantTimeEq(int32(len(want)), int32(len(got))) != 1 ||
			subtle.ConstantTimeCompare(want, got) != 1 {
			writeErrorCode(w, http.StatusUnauthorized,
				"invalid password", "INVALID_CREDENTIAL")
			return
		}
	case body.TOTPCode != "":
		if h.cfg.TOTPSecret == "" || h.verifier == nil {
			writeErrorCode(w, http.StatusUnauthorized,
				"TOTP reauth not enabled", "INVALID_CREDENTIAL")
			return
		}
		if err := h.verifier(h.cfg.TOTPSecret, body.TOTPCode); err != nil {
			writeErrorCode(w, http.StatusUnauthorized,
				"invalid TOTP code", "INVALID_CREDENTIAL")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "supply password or totp_code")
		return
	}

	token, expiresAt, err := h.store.Mint(subject)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mint sudo token")
		return
	}

	writeJSON(w, http.StatusOK, reauthResponse{
		Mode:      "session",
		SudoToken: token,
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
	})
}

// decodeReauthBody parses the request body with a hard 1KB cap. The
// body should be ~100 bytes; capping at 1KB rejects misbehaving
// clients that try to send a multi-MB password to exhaust memory.
func decodeReauthBody(r *http.Request) (reauthRequest, error) {
	var body reauthRequest
	if r.Body == nil {
		return body, errors.New("missing request body")
	}
	limited := http.MaxBytesReader(nil, r.Body, 1024)
	defer limited.Close()
	dec := json.NewDecoder(limited)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return body, errors.New("invalid request body")
	}
	body.Password = strings.TrimSpace(body.Password)
	body.TOTPCode = strings.TrimSpace(body.TOTPCode)
	return body, nil
}

// RequireSudo returns a middleware that gates the wrapped handler on a
// valid X-Sudo-Token header. In open mode (headerName == "") it is a
// passthrough — the typed-confirmation dialog on the SPA carries the
// authorisation guarantee instead.
//
// On reject it returns 401 with a structured error body:
//
//	{"error": "...", "code": "SUDO_REQUIRED"}
//
// The SPA's interceptor matches on `code === 'SUDO_REQUIRED'` to
// decide whether to open <ReauthDialog>; never match on the human
// message string.
func RequireSudo(store *database.SudoTokenStore, cfg SudoConfig) func(http.Handler) http.Handler {
	if store == nil {
		// Defensive — a nil store means the handler bundle was wired
		// incorrectly; serving the route open would silently undo the
		// step-up guarantee, so we 500 instead.
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				writeError(w, http.StatusInternalServerError, "sudo store not configured")
			})
		}
	}
	if cfg.HeaderName == "" {
		// Open mode: no upstream identity to bind a token to. The SPA
		// substitutes the typed-confirmation dialog; the route runs
		// unmodified.
		return func(next http.Handler) http.Handler { return next }
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			subject := strings.TrimSpace(r.Header.Get(cfg.HeaderName))
			if subject == "" {
				writeErrorCode(w, http.StatusUnauthorized,
					"step-up reauth required: missing identity header",
					SudoRequiredCode)
				return
			}
			token := strings.TrimSpace(r.Header.Get("X-Sudo-Token"))
			if err := store.Validate(token, subject); err != nil {
				writeErrorCode(w, http.StatusUnauthorized,
					"step-up reauth required",
					SudoRequiredCode)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
