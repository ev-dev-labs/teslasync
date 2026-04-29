package api

import (
	"bytes"
	"context"
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

func makeTestAutomation(id int64) *models.AutomationFull {
	return &models.AutomationFull{
		Automation: models.Automation{
			ID:      id,
			Name:    "test-automation",
			Enabled: true,
		},
	}
}

func setupWebhookReceiver(repo *mockWebhookReceiverRepo, engine *mockReceiverEngine) (*WebhookReceiverHandler, *chi.Mux) {
	wt := trigger.NewWebhookTrigger(repo, engine)
	handler := NewWebhookReceiverHandler(wt)

	r := chi.NewRouter()
	r.Post("/api/v1/automations/webhook/{token}", handler.Receive)
	return handler, r
}

func assertWebhookUnavailable(t *testing.T, rec *httptest.ResponseRecorder, engine *mockReceiverEngine) {
	t.Helper()
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unavailable typed webhook kind, got %d: %s", rec.Code, rec.Body.String())
	}
	if engine.callCount != 0 {
		t.Fatalf("engine should not be called for unavailable typed webhook kind, got %d calls", engine.callCount)
	}
}

// ── Tests ───────────────────────────────────────────────────────────────

func TestWebhookReceiver_ValidPayload_Returns404WhenWebhookKindUnavailable(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "test-token-abc123"
	repo.automations[token] = makeTestAutomation(1)

	body := []byte(`{"event":"door_opened","value":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assertWebhookUnavailable(t, rec, engine)
}

func TestWebhookReceiver_EmptyBody_Returns404WhenWebhookKindUnavailable(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "empty-body-token"
	repo.automations[token] = makeTestAutomation(2)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assertWebhookUnavailable(t, rec, engine)
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
	auto := makeTestAutomation(3)
	auto.Enabled = false
	repo.automations[token] = auto

	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader([]byte(`{}`)))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for disabled automation, got %d", rec.Code)
	}
}

func TestWebhookReceiver_ValidHMAC_Returns404WhenWebhookKindUnavailable(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "hmac-token"
	repo.automations[token] = makeTestAutomation(4)

	payload := []byte(`{"temperature":42}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader(payload))
	req.Header.Set("X-Webhook-Signature", "typed-webhook-unavailable")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assertWebhookUnavailable(t, rec, engine)
}

func TestWebhookReceiver_InvalidHMAC_Returns404WhenWebhookKindUnavailable(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "hmac-fail-token"
	repo.automations[token] = makeTestAutomation(5)

	payload := []byte(`{"temperature":42}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader(payload))
	req.Header.Set("X-Webhook-Signature", "deadbeef0000")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assertWebhookUnavailable(t, rec, engine)
}

func TestWebhookReceiver_MissingSignature_Returns404WhenWebhookKindUnavailable(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "hmac-missing-sig-token"
	repo.automations[token] = makeTestAutomation(6)

	payload := []byte(`{"temperature":42}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader(payload))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assertWebhookUnavailable(t, rec, engine)
}

func TestWebhookReceiver_InvalidJSON_Returns404WhenWebhookKindUnavailable(t *testing.T) {
	repo := newMockWebhookReceiverRepo()
	engine := &mockReceiverEngine{}
	_, router := setupWebhookReceiver(repo, engine)

	token := "invalid-json-token"
	repo.automations[token] = makeTestAutomation(7)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/automations/webhook/"+token, bytes.NewReader([]byte(`not-json{`)))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assertWebhookUnavailable(t, rec, engine)
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
