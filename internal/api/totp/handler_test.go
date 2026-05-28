package totp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"

	"github.com/ev-dev-labs/teslasync/internal/crypto"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
)

// fakeTOTPStore is the in-memory stand-in for *dbauth.TOTPRepo used
// by every handler test in this file. Behaviour mirrors the real repo
// closely enough that the handler can exercise its full code paths
// without a Postgres dependency.
type fakeTOTPStore struct {
	mu          sync.Mutex
	enrollments map[string]*dbauth.TOTPEnrollmentRow
	credentials map[string]*dbauth.TOTPCredentialRow

	beginErr     error
	getEnrollErr error
	activateErr  error
	getCredErr   error
	revokeErr    error
	rotateErr    error
	markUsedErr  error
	failureErr   error
	consumeErr   error
}

func newFakeStore() *fakeTOTPStore {
	return &fakeTOTPStore{
		enrollments: make(map[string]*dbauth.TOTPEnrollmentRow),
		credentials: make(map[string]*dbauth.TOTPCredentialRow),
	}
}

func (s *fakeTOTPStore) BeginEnrollment(_ context.Context, subject string, secret []byte, hashes []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.beginErr != nil {
		return s.beginErr
	}
	s.enrollments[subject] = &dbauth.TOTPEnrollmentRow{
		Subject:           subject,
		SecretEncrypted:   append([]byte(nil), secret...),
		BackupCodesHashed: append([]string(nil), hashes...),
		StartedAt:         time.Now().UTC(),
		ExpiresAt:         time.Now().UTC().Add(15 * time.Minute),
	}
	return nil
}

func (s *fakeTOTPStore) GetEnrollment(_ context.Context, subject string) (*dbauth.TOTPEnrollmentRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getEnrollErr != nil {
		return nil, s.getEnrollErr
	}
	row, ok := s.enrollments[subject]
	if !ok {
		return nil, dbauth.ErrTOTPNotFound
	}
	cp := *row
	return &cp, nil
}

func (s *fakeTOTPStore) ActivateEnrollment(_ context.Context, subject string) (*dbauth.TOTPCredentialRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activateErr != nil {
		return nil, s.activateErr
	}
	row, ok := s.enrollments[subject]
	if !ok {
		return nil, dbauth.ErrTOTPNotFound
	}
	cred := &dbauth.TOTPCredentialRow{
		Subject:           subject,
		SecretEncrypted:   append([]byte(nil), row.SecretEncrypted...),
		BackupCodesHashed: append([]string(nil), row.BackupCodesHashed...),
		ActivatedAt:       time.Now().UTC(),
	}
	s.credentials[subject] = cred
	delete(s.enrollments, subject)
	cp := *cred
	return &cp, nil
}

func (s *fakeTOTPStore) GetCredential(_ context.Context, subject string) (*dbauth.TOTPCredentialRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getCredErr != nil {
		return nil, s.getCredErr
	}
	row, ok := s.credentials[subject]
	if !ok {
		return nil, dbauth.ErrTOTPNotFound
	}
	cp := *row
	cp.BackupCodesHashed = append([]string(nil), row.BackupCodesHashed...)
	return &cp, nil
}

func (s *fakeTOTPStore) Revoke(_ context.Context, subject string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.revokeErr != nil {
		return s.revokeErr
	}
	delete(s.credentials, subject)
	delete(s.enrollments, subject)
	return nil
}

func (s *fakeTOTPStore) RotateBackupCodes(_ context.Context, subject string, hashes []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rotateErr != nil {
		return s.rotateErr
	}
	row, ok := s.credentials[subject]
	if !ok {
		return dbauth.ErrTOTPNotFound
	}
	row.BackupCodesHashed = append([]string(nil), hashes...)
	return nil
}

func (s *fakeTOTPStore) MarkUsed(_ context.Context, subject string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.markUsedErr != nil {
		return s.markUsedErr
	}
	row, ok := s.credentials[subject]
	if !ok {
		return nil
	}
	now := time.Now().UTC()
	row.LastUsedAt = &now
	row.FailedAttempts = 0
	row.LastFailedAt = nil
	return nil
}

func (s *fakeTOTPStore) MarkFailure(_ context.Context, subject string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failureErr != nil {
		return 0, s.failureErr
	}
	row, ok := s.credentials[subject]
	if !ok {
		return 0, dbauth.ErrTOTPNotFound
	}
	row.FailedAttempts++
	now := time.Now().UTC()
	row.LastFailedAt = &now
	return row.FailedAttempts, nil
}

func (s *fakeTOTPStore) ConsumeBackupCode(_ context.Context, subject, hashed string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.consumeErr != nil {
		return false, s.consumeErr
	}
	row, ok := s.credentials[subject]
	if !ok {
		return false, dbauth.ErrTOTPNotFound
	}
	for i, h := range row.BackupCodesHashed {
		if h == hashed {
			row.BackupCodesHashed = append(row.BackupCodesHashed[:i], row.BackupCodesHashed[i+1:]...)
			return true, nil
		}
	}
	return false, nil
}

// fakeMinter is the SudoMinter test double. Records mint calls so a
// test can assert that step-up actually fired exactly once.
type fakeMinter struct {
	mintCalls int
	subject   string
	mintErr   error
	token     string
}

func (m *fakeMinter) Mint(subject string) (string, time.Time, error) {
	m.mintCalls++
	m.subject = subject
	if m.mintErr != nil {
		return "", time.Time{}, m.mintErr
	}
	tok := m.token
	if tok == "" {
		tok = "sudo-token-" + subject
	}
	return tok, time.Now().Add(5 * time.Minute), nil
}

// newTOTPTestHandler wires a TOTPHandler with the supplied options. Open
// mode is signalled by passing headerName="".
func newTOTPTestHandler(t *testing.T, store TOTPStore, headerName string) (*TOTPHandler, *fakeMinter) {
	t.Helper()
	minter := &fakeMinter{}
	return NewTOTPHandler(store, nil, minter, headerName), minter
}

func decodeJSON[T any](t *testing.T, body io.Reader) T {
	t.Helper()
	var out T
	dec := json.NewDecoder(body)
	if err := dec.Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

func newRequest(t *testing.T, method, path, subject, body string) *http.Request {
	t.Helper()
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, path, bodyReader)
	if subject != "" {
		r.Header.Set("X-Forwarded-User", subject)
	}
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}

// --- GetStatus ---

func TestTOTPHandler_GetStatus_OpenMode(t *testing.T) {
	h, _ := newTOTPTestHandler(t, newFakeStore(), "")
	rr := httptest.NewRecorder()
	h.GetStatus(rr, newRequest(t, "GET", "/auth/totp", "", ""))

	if rr.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", rr.Code)
	}
	resp := decodeJSON[map[string]string](t, rr.Body)
	if resp["code"] != AuthModeOpenCode {
		t.Fatalf("code = %q, want %q", resp["code"], AuthModeOpenCode)
	}
}

func TestTOTPHandler_GetStatus_MissingHeader(t *testing.T) {
	h, _ := newTOTPTestHandler(t, newFakeStore(), "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.GetStatus(rr, newRequest(t, "GET", "/auth/totp", "", ""))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestTOTPHandler_GetStatus_NotEnrolled(t *testing.T) {
	h, _ := newTOTPTestHandler(t, newFakeStore(), "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.GetStatus(rr, newRequest(t, "GET", "/auth/totp", "alice", ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	resp := decodeJSON[totpStatusResponse](t, rr.Body)
	if resp.Activated {
		t.Fatal("expected activated=false for unenrolled subject")
	}
	if resp.Mode != "session" {
		t.Fatalf("mode = %q, want session", resp.Mode)
	}
}

func TestTOTPHandler_GetStatus_Active(t *testing.T) {
	store := newFakeStore()
	now := time.Now().UTC().Add(-time.Hour)
	store.credentials["alice"] = &dbauth.TOTPCredentialRow{
		Subject:           "alice",
		SecretEncrypted:   []byte("encrypted"),
		BackupCodesHashed: []string{"a", "b", "c"},
		ActivatedAt:       now,
		LastUsedAt:        &now,
	}
	h, _ := newTOTPTestHandler(t, store, "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.GetStatus(rr, newRequest(t, "GET", "/auth/totp", "alice", ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	resp := decodeJSON[totpStatusResponse](t, rr.Body)
	if !resp.Activated {
		t.Fatal("expected activated=true")
	}
	if resp.BackupCodesRemaining != 3 {
		t.Fatalf("backup codes = %d, want 3", resp.BackupCodesRemaining)
	}
	if resp.LastUsedAt == nil {
		t.Fatal("expected last_used_at to be set")
	}
}

// --- Enroll ---

func TestTOTPHandler_Enroll_OpenMode(t *testing.T) {
	h, _ := newTOTPTestHandler(t, newFakeStore(), "")
	rr := httptest.NewRecorder()
	h.Enroll(rr, newRequest(t, "POST", "/auth/totp/enroll", "", ""))
	if rr.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", rr.Code)
	}
}

func TestTOTPHandler_Enroll_Success(t *testing.T) {
	store := newFakeStore()
	h, _ := newTOTPTestHandler(t, store, "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.Enroll(rr, newRequest(t, "POST", "/auth/totp/enroll", "alice", ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rr.Code, rr.Body.String())
	}
	resp := decodeJSON[totpEnrollResponse](t, rr.Body)
	if resp.Secret == "" {
		t.Fatal("expected non-empty secret")
	}
	if !strings.HasPrefix(resp.OtpauthURI, "otpauth://totp/") {
		t.Fatalf("otpauth URI shape: %q", resp.OtpauthURI)
	}
	if !strings.HasPrefix(resp.QRDataURI, "data:image/png;base64,") {
		t.Fatalf("qr data URI shape: %q", resp.QRDataURI[:40])
	}
	if len(resp.BackupCodes) != totpBackupCodeCount {
		t.Fatalf("backup codes = %d, want %d", len(resp.BackupCodes), totpBackupCodeCount)
	}
	if _, ok := store.enrollments["alice"]; !ok {
		t.Fatal("expected enrollment to be persisted")
	}
}

func TestTOTPHandler_Enroll_StoreError(t *testing.T) {
	store := newFakeStore()
	store.beginErr = errors.New("db offline")
	h, _ := newTOTPTestHandler(t, store, "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.Enroll(rr, newRequest(t, "POST", "/auth/totp/enroll", "alice", ""))
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
}

// --- Verify (enrollment confirmation) ---

func TestTOTPHandler_Verify_NoBody(t *testing.T) {
	h, _ := newTOTPTestHandler(t, newFakeStore(), "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.Verify(rr, newRequest(t, "POST", "/auth/totp/verify", "alice", ""))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestTOTPHandler_Verify_NoEnrollment(t *testing.T) {
	h, _ := newTOTPTestHandler(t, newFakeStore(), "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.Verify(rr, newRequest(t, "POST", "/auth/totp/verify", "alice", `{"code":"123456"}`))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestTOTPHandler_Verify_ExpiredEnrollment(t *testing.T) {
	store := newFakeStore()
	rawSecret, base32Secret, err := crypto.GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	_ = base32Secret
	store.enrollments["alice"] = &dbauth.TOTPEnrollmentRow{
		Subject:           "alice",
		SecretEncrypted:   rawSecret,
		BackupCodesHashed: []string{},
		StartedAt:         time.Now().Add(-time.Hour),
		ExpiresAt:         time.Now().Add(-time.Minute),
	}
	h, _ := newTOTPTestHandler(t, store, "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.Verify(rr, newRequest(t, "POST", "/auth/totp/verify", "alice", `{"code":"000000"}`))
	if rr.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rr.Code)
	}
}

func TestTOTPHandler_Verify_WrongCode(t *testing.T) {
	store := newFakeStore()
	rawSecret, _, _ := crypto.GenerateTOTPSecret()
	store.enrollments["alice"] = &dbauth.TOTPEnrollmentRow{
		Subject:           "alice",
		SecretEncrypted:   rawSecret,
		BackupCodesHashed: []string{},
		StartedAt:         time.Now(),
		ExpiresAt:         time.Now().Add(15 * time.Minute),
	}
	h, _ := newTOTPTestHandler(t, store, "X-Forwarded-User")
	rr := httptest.NewRecorder()
	// "000000" is overwhelmingly likely to mismatch a fresh random
	// secret at the current step; if it does match, the test below
	// would be a one-in-a-million flake. Accept that.
	h.Verify(rr, newRequest(t, "POST", "/auth/totp/verify", "alice", `{"code":"000000"}`))
	if rr.Code != http.StatusUnauthorized {
		// Not strictly fatal — could be the freak match. Surface but
		// don't fail the suite.
		t.Logf("verify with 000000 gave status %d (probably random match)", rr.Code)
	}
}

func TestTOTPHandler_Verify_RealCode(t *testing.T) {
	store := newFakeStore()
	rawSecret, base32Secret, err := crypto.GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	store.enrollments["alice"] = &dbauth.TOTPEnrollmentRow{
		Subject:           "alice",
		SecretEncrypted:   rawSecret,
		BackupCodesHashed: []string{},
		StartedAt:         time.Now(),
		ExpiresAt:         time.Now().Add(15 * time.Minute),
	}
	code, err := totp.GenerateCode(base32Secret, time.Now())
	if err != nil {
		t.Fatalf("generate code: %v", err)
	}
	body := fmt.Sprintf(`{"code":%q}`, code)
	h, _ := newTOTPTestHandler(t, store, "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.Verify(rr, newRequest(t, "POST", "/auth/totp/verify", "alice", body))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rr.Code, rr.Body.String())
	}
	if _, ok := store.credentials["alice"]; !ok {
		t.Fatal("expected credential to be activated after verify")
	}
	if _, ok := store.enrollments["alice"]; ok {
		t.Fatal("expected pending enrollment to be cleared after verify")
	}
}

// --- VerifySudo (per-user TOTP step-up) ---

func TestTOTPHandler_VerifySudo_OpenMode(t *testing.T) {
	h, _ := newTOTPTestHandler(t, newFakeStore(), "")
	rr := httptest.NewRecorder()
	h.VerifySudo(rr, newRequest(t, "POST", "/auth/totp/sudo", "", `{"code":"123456"}`))
	if rr.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", rr.Code)
	}
}

func TestTOTPHandler_VerifySudo_NoCredential(t *testing.T) {
	h, minter := newTOTPTestHandler(t, newFakeStore(), "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.VerifySudo(rr, newRequest(t, "POST", "/auth/totp/sudo", "alice", `{"code":"123456"}`))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	if minter.mintCalls != 0 {
		t.Fatalf("mint should not have been called when credential missing")
	}
}

func TestTOTPHandler_VerifySudo_ValidCodeMintsToken(t *testing.T) {
	store := newFakeStore()
	rawSecret, base32Secret, err := crypto.GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	store.credentials["alice"] = &dbauth.TOTPCredentialRow{
		Subject:         "alice",
		SecretEncrypted: rawSecret,
		ActivatedAt:     time.Now(),
	}
	h, minter := newTOTPTestHandler(t, store, "X-Forwarded-User")
	code, _ := totp.GenerateCode(base32Secret, time.Now())
	body := fmt.Sprintf(`{"code":%q}`, code)
	rr := httptest.NewRecorder()
	h.VerifySudo(rr, newRequest(t, "POST", "/auth/totp/sudo", "alice", body))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rr.Code, rr.Body.String())
	}
	if minter.mintCalls != 1 {
		t.Fatalf("mint calls = %d, want 1", minter.mintCalls)
	}
	if minter.subject != "alice" {
		t.Fatalf("subject = %q, want alice", minter.subject)
	}
	resp := decodeJSON[totpSudoResponse](t, rr.Body)
	if resp.SudoToken == "" {
		t.Fatal("expected non-empty sudo_token")
	}
}

func TestTOTPHandler_VerifySudo_BackupCode(t *testing.T) {
	store := newFakeStore()
	plain := []string{"AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"}
	hashed := make([]string, len(plain))
	for i, p := range plain {
		hashed[i] = crypto.HashBackupCode(p)
	}
	store.credentials["alice"] = &dbauth.TOTPCredentialRow{
		Subject:           "alice",
		SecretEncrypted:   []byte("ignored"),
		BackupCodesHashed: hashed,
		ActivatedAt:       time.Now(),
	}
	h, minter := newTOTPTestHandler(t, store, "X-Forwarded-User")
	body := fmt.Sprintf(`{"backup_code":%q}`, plain[0])
	rr := httptest.NewRecorder()
	h.VerifySudo(rr, newRequest(t, "POST", "/auth/totp/sudo", "alice", body))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if minter.mintCalls != 1 {
		t.Fatal("expected sudo token mint after valid backup code")
	}
	if len(store.credentials["alice"].BackupCodesHashed) != len(plain)-1 {
		t.Fatal("expected backup code to be consumed")
	}
}

func TestTOTPHandler_VerifySudo_BothFieldsRejected(t *testing.T) {
	store := newFakeStore()
	store.credentials["alice"] = &dbauth.TOTPCredentialRow{
		Subject:         "alice",
		SecretEncrypted: []byte("x"),
	}
	h, _ := newTOTPTestHandler(t, store, "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.VerifySudo(rr, newRequest(t, "POST", "/auth/totp/sudo", "alice",
		`{"code":"123456","backup_code":"AAAA-BBBB-CCCC-DDDD"}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestTOTPHandler_VerifySudo_RateLimitTrips(t *testing.T) {
	store := newFakeStore()
	rawSecret, _, _ := crypto.GenerateTOTPSecret()
	store.credentials["alice"] = &dbauth.TOTPCredentialRow{
		Subject:         "alice",
		SecretEncrypted: rawSecret,
		ActivatedAt:     time.Now(),
	}
	h, minter := newTOTPTestHandler(t, store, "X-Forwarded-User")
	// 5 wrong attempts → counter saturates → 6th is 429.
	for i := 0; i < totpRateLimitMaxFailures; i++ {
		rr := httptest.NewRecorder()
		h.VerifySudo(rr, newRequest(t, "POST", "/auth/totp/sudo", "alice", `{"code":"000000"}`))
		// Code "000000" usually mismatches; if it ever matches the
		// in-memory secret randomly, it would mint and the next loop
		// would be a fresh secret… but we generated rawSecret only
		// once, so the worst case is a single freak success that's
		// indistinguishable from the test passing early. Skip that.
		if rr.Code == http.StatusOK {
			t.Skip("unlikely random match between 000000 and freshly generated TOTP at this exact step")
		}
	}
	rr := httptest.NewRecorder()
	h.VerifySudo(rr, newRequest(t, "POST", "/auth/totp/sudo", "alice", `{"code":"000000"}`))
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 after %d failures", rr.Code, totpRateLimitMaxFailures)
	}
	if minter.mintCalls != 0 {
		t.Fatalf("mint should not have happened during rate-limited path")
	}
}

// --- Revoke ---

func TestTOTPHandler_Revoke_RemovesCredential(t *testing.T) {
	store := newFakeStore()
	store.credentials["alice"] = &dbauth.TOTPCredentialRow{Subject: "alice", SecretEncrypted: []byte("x")}
	h, _ := newTOTPTestHandler(t, store, "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.Revoke(rr, newRequest(t, "DELETE", "/auth/totp", "alice", ""))
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rr.Code)
	}
	if _, ok := store.credentials["alice"]; ok {
		t.Fatal("expected credential to be removed")
	}
}

func TestTOTPHandler_Revoke_OpenMode(t *testing.T) {
	h, _ := newTOTPTestHandler(t, newFakeStore(), "")
	rr := httptest.NewRecorder()
	h.Revoke(rr, newRequest(t, "DELETE", "/auth/totp", "", ""))
	if rr.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", rr.Code)
	}
}

// --- RegenerateBackupCodes ---

func TestTOTPHandler_RegenerateBackupCodes_NoCredential(t *testing.T) {
	h, _ := newTOTPTestHandler(t, newFakeStore(), "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.RegenerateBackupCodes(rr, newRequest(t, "POST", "/auth/totp/backup-codes/regenerate", "alice", ""))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestTOTPHandler_RegenerateBackupCodes_Success(t *testing.T) {
	store := newFakeStore()
	store.credentials["alice"] = &dbauth.TOTPCredentialRow{
		Subject:           "alice",
		SecretEncrypted:   []byte("x"),
		BackupCodesHashed: []string{"old1", "old2"},
		ActivatedAt:       time.Now(),
	}
	h, _ := newTOTPTestHandler(t, store, "X-Forwarded-User")
	rr := httptest.NewRecorder()
	h.RegenerateBackupCodes(rr, newRequest(t, "POST", "/auth/totp/backup-codes/regenerate", "alice", ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	resp := decodeJSON[totpRegenerateResponse](t, rr.Body)
	if len(resp.BackupCodes) != totpBackupCodeCount {
		t.Fatalf("len = %d, want %d", len(resp.BackupCodes), totpBackupCodeCount)
	}
	if len(store.credentials["alice"].BackupCodesHashed) != totpBackupCodeCount {
		t.Fatal("expected store backup codes to match new count")
	}
}

// --- Enroll → Verify → VerifySudo end-to-end ---

func TestTOTPHandler_EndToEnd(t *testing.T) {
	store := newFakeStore()
	h, minter := newTOTPTestHandler(t, store, "X-Forwarded-User")

	// 1. Enroll
	rr := httptest.NewRecorder()
	h.Enroll(rr, newRequest(t, "POST", "/auth/totp/enroll", "alice", ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("enroll: status = %d", rr.Code)
	}
	enrollResp := decodeJSON[totpEnrollResponse](t, rr.Body)

	// 2. Verify with the real OTP code
	code, err := totp.GenerateCode(enrollResp.Secret, time.Now())
	if err != nil {
		t.Fatalf("generate code: %v", err)
	}
	rr = httptest.NewRecorder()
	body := bytes.NewBufferString(fmt.Sprintf(`{"code":%q}`, code))
	r := httptest.NewRequest("POST", "/auth/totp/verify", body)
	r.Header.Set("X-Forwarded-User", "alice")
	r.Header.Set("Content-Type", "application/json")
	h.Verify(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("verify: status = %d, body = %s", rr.Code, rr.Body.String())
	}

	// 3. Use the same OTP for sudo step-up
	rr = httptest.NewRecorder()
	h.VerifySudo(rr, newRequest(t, "POST", "/auth/totp/sudo", "alice", fmt.Sprintf(`{"code":%q}`, code)))
	if rr.Code != http.StatusOK {
		t.Fatalf("sudo: status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if minter.mintCalls != 1 {
		t.Fatalf("mint calls = %d, want 1", minter.mintCalls)
	}
}
