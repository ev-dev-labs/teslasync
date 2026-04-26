package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ── Mock Webhook Repo (satisfies trigger.WebhookRepo) ───────────────────

type mockWebhookReceiverRepo struct {
	automations map[string]*models.AutomationFull
	disabled    map[int64]string
}

func newMockWebhookReceiverRepo() *mockWebhookReceiverRepo {
	return &mockWebhookReceiverRepo{
		automations: make(map[string]*models.AutomationFull),
		disabled:    make(map[int64]string),
	}
}

func (r *mockWebhookReceiverRepo) GetByWebhookToken(_ context.Context, token string) (*models.AutomationFull, error) {
	a, ok := r.automations[token]
	if !ok {
		return nil, nil
	}
	return a, nil
}

func (r *mockWebhookReceiverRepo) SetAutoDisabled(_ context.Context, id int64, reason string) error {
	r.disabled[id] = reason
	return nil
}

// ── Mock Engine ─────────────────────────────────────────────────────────

type mockReceiverEngine struct {
	callCount int
}

func (e *mockReceiverEngine) Evaluate(_ context.Context, _ int64, _ json.RawMessage) error {
	e.callCount++
	return nil
}

// ── Helpers ─────────────────────────────────────────────────────────────

func makeTestAutomation(id int64, token string, secret *string) *models.AutomationFull {
	cfg := map[string]interface{}{"webhook_token": token}
	if secret != nil {
		cfg["secret"] = *secret
	}
	raw, _ := json.Marshal(cfg)
	return &models.AutomationFull{
		Automation: models.Automation{
			ID:      id,
			Name:    "test-automation",
			Enabled: true,
		},
		Triggers: []any{json.RawMessage(raw)},
	}
}

func setupWebhookReceiver(repo *mockWebhookReceiverRepo, engine *mockReceiverEngine) (*WebhookReceiverHandler, *chi.Mux) {
	wt := trigger.NewWebhookTrigger(repo, engine)
	handler := NewWebhookReceiverHandler(wt)

	r := chi.NewRouter()
	r.Post("/api/v1/automations/webhook/{token}", handler.Receive)
	return handler, r
}

func testHMAC(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

// strPtr is already defined in telemetry_sessions.go (same package).

// ── Tests ───────────────────────────────────────────────────────────────

func TestWebhookReceiver_ValidPayload_Returns200(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "test-token-abc123"
	repo.automations[token] = makeTestAutomation(1, token, nil)

	body := []byte(`{"event":"door_opened","value":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !resp["accepted"] {
		t.Fatal("expected accepted=true")
	}
	if engine.callCount != 1 {
		t.Fatalf("expected engine called once, got %d", engine.callCount)
	}
}

func TestWebhookReceiver_EmptyBody_Returns200(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "empty-body-token"
	repo.automations[token] = makeTestAutomation(2, token, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for empty body, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWebhookReceiver_UnknownToken_Returns404(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/nonexistent-token", bytes.NewReader([]byte(`{}`)))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown token, got %d: %s", rec.Code, rec.Body.String())
	}
	if engine.callCount != 0 {
		t.Fatal("engine should not be called for unknown token")
	}
}

func TestWebhookReceiver_DisabledAutomation_Returns404(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "disabled-token"
	auto := makeTestAutomation(3, token, nil)
	auto.Enabled = false
	repo.automations[token] = auto

	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader([]byte(`{}`)))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for disabled automation, got %d", rec.Code)
	}
}

func TestWebhookReceiver_ValidHMAC_Returns200(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	secret := "super-secret-key"
	token := "hmac-token"
	repo.automations[token] = makeTestAutomation(4, token, strPtr(secret))

	payload := []byte(`{"temperature":42}`)
	sig := testHMAC(payload, secret)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader(payload))
	req.Header.Set("X-Webhook-Signature", sig)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid HMAC, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWebhookReceiver_InvalidHMAC_Returns403(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	secret := "super-secret-key"
	token := "hmac-fail-token"
	repo.automations[token] = makeTestAutomation(5, token, strPtr(secret))

	payload := []byte(`{"temperature":42}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader(payload))
	req.Header.Set("X-Webhook-Signature", "deadbeef0000")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for invalid HMAC, got %d: %s", rec.Code, rec.Body.String())
	}
	if engine.callCount != 0 {
		t.Fatal("engine should not be called with invalid HMAC")
	}
}

func TestWebhookReceiver_MissingSignatureWithSecret_Returns403(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	secret := "super-secret-key"
	token := "hmac-missing-sig-token"
	repo.automations[token] = makeTestAutomation(6, token, strPtr(secret))

	payload := []byte(`{"temperature":42}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader(payload))
	// No X-Webhook-Signature header
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when secret configured but no signature sent, got %d", rec.Code)
	}
}

func TestWebhookReceiver_InvalidJSON_Returns400(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "invalid-json-token"
	repo.automations[token] = makeTestAutomation(7, token, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader([]byte(`not-json{`)))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid JSON, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWebhookReceiver_WrongMethod_Returns405(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/automations/webhook/some-token", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET, got %d", rec.Code)
	}
}

func TestSafeTokenPrefix_Short(t *testing.T) {
	if got := safeTokenPrefix("ab"); got != "a***" {
		t.Fatalf("expected 'a***', got %q", got)
	}
}

func TestSafeTokenPrefix_Long(t *testing.T) {
	if got := safeTokenPrefix("abcdefghijklmnop"); got != "abcdefgh***" {
		t.Fatalf("expected 'abcdefgh***', got %q", got)
	}
}
