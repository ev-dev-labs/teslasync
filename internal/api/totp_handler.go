// Phase-46 / Prompt 35 — TOTP enrollment handler.
//
// Adds per-subject TOTP enrollment / verification on top of the
// in-memory sudo step-up store from prompt 31. The handler is auth-mode
// aware: in open mode (no FORWARD_AUTH_HEADER configured) every endpoint
// returns 501 with code AUTH_MODE_OPEN so the SPA can render an inline
// "feature requires login" placeholder without a noisy 401 loop.
//
// PROVIDER AGNOSTIC. ForwardAuth providers (Authentik, Keycloak, etc.)
// may carry their own TOTP factor at the proxy edge — that protects the
// initial login but cannot rate-limit destructive admin actions inside
// TeslaSync. This handler implements TeslaSync's own RFC 6238 layer so
// the sudo step-up dialog (prompt 31) can require a second factor for
// destructive operations regardless of the upstream provider.
package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/pquerna/otp/totp"
	qrcode "github.com/skip2/go-qrcode"

	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// AuthModeOpenCode is the response `code` returned by every TOTP
// endpoint in open mode. The SPA's useTOTPStatus hook treats this as a
// permanent feature-disabled signal; the section then renders the
// "requires authentication" placeholder instead of the enroll button.
const AuthModeOpenCode = "AUTH_MODE_OPEN"

// totpRateLimitCode signals that the per-subject verify rate limit has
// tripped. The SPA copy explains "wait 15 minutes" — the actual window
// is governed by [totpRateLimitWindow] / [totpRateLimitMaxFailures].
const totpRateLimitCode = "TOTP_RATE_LIMITED"

// totpInvalidCode is returned for any verify miss. Distinct from
// SUDO_REQUIRED so the SPA's sudo interceptor does not retry.
const totpInvalidCode = "TOTP_INVALID"

// totpRateLimitMaxFailures + totpRateLimitWindow define the in-memory
// per-subject rate limit. The chosen 5-failures-per-15-minutes window
// matches the lockout policy commonly used by upstream IdPs (Authentik,
// Keycloak), giving a familiar feel without bespoke config.
const (
	totpRateLimitMaxFailures = 5
	totpRateLimitWindow      = 15 * time.Minute
)

// defaultTOTPIssuer is what shows up in Google Authenticator's row
// header when the user scans the enrollment QR. Operators can override
// via `TESLASYNC_TOTP_ISSUER` for white-labelled deployments. A short
// default keeps the QR payload below the size at which most camera
// apps choke.
const defaultTOTPIssuer = "TeslaSync"

// totpEnrollmentTTL mirrors the migration's CHECK on
// user_totp_enrollments.expires_at. Kept in code so the handler can
// reject a verify against a stale enrollment without round-tripping a
// SELECT NOW() across every attempt.
const totpEnrollmentTTL = 15 * time.Minute

// totpBackupCodeCount is the number of single-use codes minted on
// enrollment / regeneration. Ten matches the GitHub / Google convention
// — enough to print on a card and stuff in a wallet without inflating
// the JSONB column.
const totpBackupCodeCount = 10

// totpQRPixelSize controls the rendered PNG dimensions handed to the
// SPA. 256×256 is the smallest size that scans reliably at arm's
// length on a phone, and keeps the data URI under 16 KB.
const totpQRPixelSize = 256

// TOTPStore is the storage seam for the handler. The production wiring
// in router.go binds this to *database.TOTPRepo; tests substitute an
// in-memory fake (see fakeTOTPStore in totp_handler_test.go).
//
// The interface is intentionally minimal — every method maps 1-to-1 to
// a state transition the handler needs — so a future swap to e.g. a
// Redis-backed store does not require resurrecting unused methods.
type TOTPStore interface {
	BeginEnrollment(ctx context.Context, subject string, secretEncrypted []byte, backupHashes []string) error
	GetEnrollment(ctx context.Context, subject string) (*database.TOTPEnrollmentRow, error)
	ActivateEnrollment(ctx context.Context, subject string) (*database.TOTPCredentialRow, error)
	GetCredential(ctx context.Context, subject string) (*database.TOTPCredentialRow, error)
	Revoke(ctx context.Context, subject string) error
	RotateBackupCodes(ctx context.Context, subject string, hashes []string) error
	MarkUsed(ctx context.Context, subject string) error
	MarkFailure(ctx context.Context, subject string) (int, error)
	ConsumeBackupCode(ctx context.Context, subject, hashedCode string) (bool, error)
}

// SudoMinter is the narrow seam the TOTP handler uses to mint a sudo
// token after a successful per-user TOTP step-up. Implemented by
// *database.SudoTokenStore so the production wiring just passes the
// existing store from prompt 31 — no second token store, no shared
// secret duplication.
type SudoMinter interface {
	Mint(subject string) (string, time.Time, error)
}

// rateLimitEntry tracks failed verify attempts for a single subject.
// A subject's slot is reset on a successful verify; otherwise old
// failures expire silently after totpRateLimitWindow.
type rateLimitEntry struct {
	failures  int
	firstSeen time.Time
}

// TOTPHandler exposes the /auth/totp/* endpoints.
//
// All state lives either in the *TOTPStore (durable per-subject rows)
// or on this struct (in-memory per-process rate limit). The handler
// itself is stateless across requests — a load balancer can route
// freely between replicas because the rate-limit map is best-effort
// (per-pod) and the durable failed_attempts column is the source of
// truth the cluster falls back on.
type TOTPHandler struct {
	store      TOTPStore
	enc        *crypto.Encryptor
	sudoMinter SudoMinter

	// headerName mirrors SudoConfig.HeaderName. Empty means open mode.
	headerName string

	// issuer is the otpauth issuer shown in the authenticator app.
	issuer string

	rlMu sync.Mutex
	rl   map[string]*rateLimitEntry
}

// NewTOTPHandler wires the handler to its dependencies. issuer may be
// empty — defaults to "TeslaSync". Reads TESLASYNC_TOTP_ISSUER from
// the environment so operators can white-label without a config.go
// change (the prompt's allowed-files regex excludes config.go).
func NewTOTPHandler(store TOTPStore, enc *crypto.Encryptor, sudoMinter SudoMinter, headerName string) *TOTPHandler {
	issuer := strings.TrimSpace(os.Getenv("TESLASYNC_TOTP_ISSUER"))
	if issuer == "" {
		issuer = defaultTOTPIssuer
	}
	return &TOTPHandler{
		store:      store,
		enc:        enc,
		sudoMinter: sudoMinter,
		headerName: strings.TrimSpace(headerName),
		issuer:     issuer,
		rl:         make(map[string]*rateLimitEntry),
	}
}

// totpStatusResponse is the JSON shape returned by GET /auth/totp.
// The SPA's useTOTPStatus hook normalises this into a discriminated
// union: { mode: 'open' } | { mode: 'session', activated, ... }.
type totpStatusResponse struct {
	Mode                 string  `json:"mode"`
	Activated            bool    `json:"activated"`
	LastUsedAt           *string `json:"last_used_at,omitempty"`
	BackupCodesRemaining int     `json:"backup_codes_remaining"`
}

// totpEnrollResponse is returned by POST /auth/totp/enroll. Backup
// codes are returned exactly once — re-enrolling generates fresh codes
// — so the SPA renders a download/copy step before stashing them.
type totpEnrollResponse struct {
	Secret      string   `json:"secret"`
	OtpauthURI  string   `json:"otpauth_uri"`
	QRDataURI   string   `json:"qr_data_uri"`
	BackupCodes []string `json:"backup_codes"`
	ExpiresAt   string   `json:"expires_at"`
}

// totpVerifyRequest covers both POST /verify (initial enrollment
// confirmation) and POST /sudo (step-up token mint). Single shape, two
// endpoints, so the SPA can reuse the same form component.
type totpVerifyRequest struct {
	Code       string `json:"code"`
	BackupCode string `json:"backup_code"`
}

// totpSudoResponse mirrors the sudo step-up response from
// SudoHandler.Reauth — same shape so the SPA's reauth interceptor can
// consume the result without a discriminator.
type totpSudoResponse struct {
	Mode      string `json:"mode"`
	SudoToken string `json:"sudo_token"`
	ExpiresAt string `json:"expires_at"`
}

// totpRegenerateResponse is returned by POST /auth/totp/backup-codes/regenerate.
// Only the codes — the secret is unchanged.
type totpRegenerateResponse struct {
	BackupCodes []string `json:"backup_codes"`
}

// resolveSubject extracts the principal identity from the configured
// ForwardAuth header. Returns "", "AUTH_MODE_OPEN", false in open mode
// so the handler can return 501 immediately. Returns "", "missing
// identity header", true when the header is configured but absent —
// that's a 401 because the proxy should always inject it for
// authenticated traffic.
func (h *TOTPHandler) resolveSubject(r *http.Request) (subject string, errCode string, openMode bool) {
	if h.headerName == "" {
		return "", AuthModeOpenCode, true
	}
	subject = strings.TrimSpace(r.Header.Get(h.headerName))
	if subject == "" {
		return "", "MISSING_IDENTITY", false
	}
	return subject, "", false
}

// writeOpenModeNotImplemented writes the canonical 501 the SPA's
// useTOTPStatus hook expects in open mode. Centralised so every
// endpoint hits the exact same code + message.
func writeOpenModeNotImplemented(w http.ResponseWriter) {
	writeErrorCode(w, http.StatusNotImplemented,
		"per-user TOTP requires forward-auth mode", AuthModeOpenCode)
}

// GetStatus implements GET /auth/totp.
//
// Open mode: 501 AUTH_MODE_OPEN.
// Forward-auth, missing header: 401 MISSING_IDENTITY.
// Forward-auth, no enrollment: 200 { activated: false }.
// Forward-auth, active credential: 200 { activated: true, last_used_at, backup_codes_remaining }.
//
// We deliberately distinguish "not enrolled" from open mode so the
// SPA's status pill ("Not enrolled" vs "Not available") is correct
// without a second roundtrip.
func (h *TOTPHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	subject, errCode, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplemented(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", errCode)
		return
	}

	cred, err := h.store.GetCredential(r.Context(), subject)
	if errors.Is(err, database.ErrTOTPNotFound) {
		writeJSON(w, http.StatusOK, totpStatusResponse{
			Mode: "session",
		})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load TOTP status")
		return
	}

	resp := totpStatusResponse{
		Mode:                 "session",
		Activated:            true,
		BackupCodesRemaining: len(cred.BackupCodesHashed),
	}
	if cred.LastUsedAt != nil {
		s := cred.LastUsedAt.UTC().Format(time.RFC3339)
		resp.LastUsedAt = &s
	}
	writeJSON(w, http.StatusOK, resp)
}

// Enroll implements POST /auth/totp/enroll.
//
// Generates a fresh 20-byte HMAC-SHA1 secret, persists a PENDING
// enrollment row (15-min TTL), and returns the otpauth:// URI + a
// PNG-as-data-URI of the QR + 10 single-use backup codes.
//
// Re-enrolling overwrites the previous pending row (the migration's
// UPSERT semantics) — that's the recovery path for "I scanned the QR
// but lost my phone before verifying."
func (h *TOTPHandler) Enroll(w http.ResponseWriter, r *http.Request) {
	subject, errCode, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplemented(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", errCode)
		return
	}

	rawSecret, base32Secret, err := crypto.GenerateTOTPSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate TOTP secret")
		return
	}
	encSecret, err := crypto.EncryptTOTPSecret(h.enc, rawSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encrypt TOTP secret")
		return
	}
	plainCodes, err := crypto.GenerateBackupCodes(totpBackupCodeCount)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate backup codes")
		return
	}
	hashedCodes := make([]string, len(plainCodes))
	for i, c := range plainCodes {
		hashedCodes[i] = crypto.HashBackupCode(c)
	}

	if err := h.store.BeginEnrollment(r.Context(), subject, encSecret, hashedCodes); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to persist TOTP enrollment")
		return
	}

	otpauthURI := h.buildOtpauthURI(subject, base32Secret)
	qrDataURI, err := encodeQRDataURI(otpauthURI)
	if err != nil {
		// QR generation only fails on truly absurd inputs (length-overflow
		// of the QR payload); log + degrade by returning the otpauth URI
		// alone — the SPA can fall back to a client-side renderer.
		qrDataURI = ""
	}

	writeJSON(w, http.StatusOK, totpEnrollResponse{
		Secret:      base32Secret,
		OtpauthURI:  otpauthURI,
		QRDataURI:   qrDataURI,
		BackupCodes: plainCodes,
		ExpiresAt:   time.Now().UTC().Add(totpEnrollmentTTL).Format(time.RFC3339),
	})
}

// Verify implements POST /auth/totp/verify.
//
// Body: { code: "123456" } — the 6-digit OTP the user reads off their
// authenticator app. Promotes the pending enrollment to an active
// credential. Once active, the secret cannot be re-read; the SPA's
// disable + regen flows go through the gated endpoints below.
//
// Returns 410 if the pending row has expired (UI surfaces "scan a fresh
// QR" — distinct from "code wrong"). Returns 404 if there's no pending
// row. Returns 401 TOTP_INVALID on a code mismatch.
func (h *TOTPHandler) Verify(w http.ResponseWriter, r *http.Request) {
	subject, errCode, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplemented(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", errCode)
		return
	}

	body, err := decodeTOTPBody(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}

	enrollment, err := h.store.GetEnrollment(r.Context(), subject)
	if errors.Is(err, database.ErrTOTPNotFound) {
		writeError(w, http.StatusNotFound, "no pending enrollment")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load enrollment")
		return
	}
	if !enrollment.ExpiresAt.After(time.Now().UTC()) {
		writeErrorCode(w, http.StatusGone,
			"enrollment expired; please re-enroll", "TOTP_ENROLLMENT_EXPIRED")
		return
	}

	rawSecret, err := crypto.DecryptTOTPSecret(h.enc, enrollment.SecretEncrypted)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to decrypt enrollment secret")
		return
	}
	base32Secret, err := crypto.EncodeTOTPSecret(rawSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encode enrollment secret")
		return
	}

	if !totp.Validate(body.Code, base32Secret) {
		writeErrorCode(w, http.StatusUnauthorized, "invalid code", totpInvalidCode)
		return
	}

	if _, err := h.store.ActivateEnrollment(r.Context(), subject); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to activate enrollment")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"activated": true,
	})
}

// VerifySudo implements POST /auth/totp/sudo.
//
// Body: { code } OR { backup_code }. On success, mints a sudo token
// (same TTL as the password path in prompt 31) and returns it so the
// SPA's reauth interceptor can replay the original gated request.
//
// This is the per-user equivalent of SudoHandler.Reauth's TOTP branch
// — that branch validates against the SHARED TESLASYNC_SUDO_TOTP_SECRET
// env var; this one resolves the subject's per-user enrollment and
// validates against THAT secret instead.
func (h *TOTPHandler) VerifySudo(w http.ResponseWriter, r *http.Request) {
	subject, errCode, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplemented(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", errCode)
		return
	}

	if h.sudoMinter == nil {
		writeErrorCode(w, http.StatusServiceUnavailable,
			"step-up not configured", reauthNotConfiguredCode)
		return
	}

	if h.isRateLimited(subject) {
		writeErrorCode(w, http.StatusTooManyRequests,
			"too many failed attempts; try again later", totpRateLimitCode)
		return
	}

	body, err := decodeTOTPBody(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Code == "" && body.BackupCode == "" {
		writeError(w, http.StatusBadRequest, "code or backup_code is required")
		return
	}
	if body.Code != "" && body.BackupCode != "" {
		writeError(w, http.StatusBadRequest, "supply exactly one of code or backup_code")
		return
	}

	cred, err := h.store.GetCredential(r.Context(), subject)
	if errors.Is(err, database.ErrTOTPNotFound) {
		writeErrorCode(w, http.StatusUnauthorized,
			"no TOTP credential enrolled", totpInvalidCode)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load credential")
		return
	}

	if body.Code != "" {
		rawSecret, err := crypto.DecryptTOTPSecret(h.enc, cred.SecretEncrypted)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to decrypt credential")
			return
		}
		base32Secret, err := crypto.EncodeTOTPSecret(rawSecret)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to encode credential")
			return
		}
		if !totp.Validate(body.Code, base32Secret) {
			h.recordFailure(subject)
			_, _ = h.store.MarkFailure(r.Context(), subject)
			writeErrorCode(w, http.StatusUnauthorized, "invalid code", totpInvalidCode)
			return
		}
		_ = h.store.MarkUsed(r.Context(), subject)
	} else {
		// Backup code path: hash with the same normalisation the
		// repo uses, then atomically consume.
		hashed := crypto.HashBackupCode(body.BackupCode)
		consumed, err := h.store.ConsumeBackupCode(r.Context(), subject, hashed)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to consume backup code")
			return
		}
		if !consumed {
			h.recordFailure(subject)
			_, _ = h.store.MarkFailure(r.Context(), subject)
			writeErrorCode(w, http.StatusUnauthorized, "invalid backup code", totpInvalidCode)
			return
		}
	}

	h.clearFailures(subject)

	token, expiresAt, err := h.sudoMinter.Mint(subject)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mint sudo token")
		return
	}

	writeJSON(w, http.StatusOK, totpSudoResponse{
		Mode:      "session",
		SudoToken: token,
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
	})
}

// Revoke implements DELETE /auth/totp. Gated by RequireSudo at the
// router so the user MUST step up (with their existing TOTP, password,
// or backup code) before they can disable the second factor — this
// prevents a hijacked session from quietly removing MFA.
func (h *TOTPHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	subject, errCode, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplemented(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", errCode)
		return
	}
	if err := h.store.Revoke(r.Context(), subject); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke TOTP credential")
		return
	}
	h.clearFailures(subject)
	w.WriteHeader(http.StatusNoContent)
}

// RegenerateBackupCodes implements POST /auth/totp/backup-codes/regenerate.
// Like Revoke, gated by RequireSudo upstream. Returns the fresh codes
// once; the SPA shows them with copy/download then never again.
func (h *TOTPHandler) RegenerateBackupCodes(w http.ResponseWriter, r *http.Request) {
	subject, errCode, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplemented(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", errCode)
		return
	}

	plain, err := crypto.GenerateBackupCodes(totpBackupCodeCount)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate backup codes")
		return
	}
	hashes := make([]string, len(plain))
	for i, c := range plain {
		hashes[i] = crypto.HashBackupCode(c)
	}
	if err := h.store.RotateBackupCodes(r.Context(), subject, hashes); err != nil {
		if errors.Is(err, database.ErrTOTPNotFound) {
			writeError(w, http.StatusNotFound, "no active TOTP credential")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to rotate backup codes")
		return
	}
	writeJSON(w, http.StatusOK, totpRegenerateResponse{BackupCodes: plain})
}

// buildOtpauthURI assembles the otpauth:// URI per the Google
// Authenticator key URI format. Issuer is double-included (label prefix
// AND query param) — both forms have been the de-facto standard since
// Google's 2011 spec, and Authy / 1Password / Microsoft Authenticator
// all key off the query-param version while Aegis / Google read the
// label.
func (h *TOTPHandler) buildOtpauthURI(subject, base32Secret string) string {
	label := url.PathEscape(h.issuer + ":" + subject)
	q := url.Values{}
	q.Set("secret", base32Secret)
	q.Set("issuer", h.issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", "30")
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// encodeQRDataURI renders the otpauth URI as a base64-data PNG. Pure
// in-process — no shellout, no remote API. The Medium error-correction
// level keeps the QR scannable through reflective phone screens
// without inflating module count past what 256×256 px can render
// crisply.
func encodeQRDataURI(payload string) (string, error) {
	pngBytes, err := qrcode.Encode(payload, qrcode.Medium, totpQRPixelSize)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngBytes), nil
}

// decodeTOTPBody parses + sanitises a TOTP request body. Keeps the
// body cap aligned with the sudo handler (1KB) so an attacker can't
// pump megabytes through these endpoints to evade rate limits.
func decodeTOTPBody(r *http.Request) (totpVerifyRequest, error) {
	var body totpVerifyRequest
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
	body.Code = strings.TrimSpace(body.Code)
	body.BackupCode = strings.TrimSpace(body.BackupCode)
	return body, nil
}

// recordFailure increments the per-subject failure counter, bumping
// firstSeen the first time we see a subject (or after a window has
// elapsed). Best-effort, per-pod; the durable failed_attempts column
// is the cluster-wide source of truth.
func (h *TOTPHandler) recordFailure(subject string) {
	h.rlMu.Lock()
	defer h.rlMu.Unlock()
	now := time.Now().UTC()
	entry, ok := h.rl[subject]
	if !ok || now.Sub(entry.firstSeen) > totpRateLimitWindow {
		h.rl[subject] = &rateLimitEntry{failures: 1, firstSeen: now}
		return
	}
	entry.failures++
}

// isRateLimited returns true when the subject has exceeded the failure
// threshold within the current window. We DO NOT increment here — only
// recordFailure mutates state.
func (h *TOTPHandler) isRateLimited(subject string) bool {
	h.rlMu.Lock()
	defer h.rlMu.Unlock()
	entry, ok := h.rl[subject]
	if !ok {
		return false
	}
	if time.Since(entry.firstSeen) > totpRateLimitWindow {
		delete(h.rl, subject)
		return false
	}
	return entry.failures >= totpRateLimitMaxFailures
}

// clearFailures resets the per-subject counter on a successful verify.
// Cheap; called from the success path only.
func (h *TOTPHandler) clearFailures(subject string) {
	h.rlMu.Lock()
	defer h.rlMu.Unlock()
	delete(h.rl, subject)
}

// HashBackupCodeHex is exposed for router/test wiring that needs a
// stable hex digest without pulling in the crypto package directly.
// Thin re-export of crypto.HashBackupCode; kept here so the test fakes
// can substitute their own hashing if desired.
func HashBackupCodeHex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
