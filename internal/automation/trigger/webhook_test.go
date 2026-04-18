package trigger

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Mock Webhook Repo ──────────────────────────────────

type mockWebhookRepo struct {
	automations map[string]*models.Automation // token → automation
	disabled    map[int64]string
	returnErr   error
}

func newMockWebhookRepo() *mockWebhookRepo {
	return &mockWebhookRepo{
		automations: make(map[string]*models.Automation),
		disabled:    make(map[int64]string),
	}
}

func (r *mockWebhookRepo) GetByWebhookToken(_ context.Context, token string) (*models.Automation, error) {
	if r.returnErr != nil {
		return nil, r.returnErr
	}
	a, ok := r.automations[token]
	if !ok {
		return nil, nil
	}
	return a, nil
}

func (r *mockWebhookRepo) SetAutoDisabled(_ context.Context, id int64, reason string) error {
	r.disabled[id] = reason
	return nil
}

// ─── Helpers ────────────────────────────────────────────

func makeWebhookAutomation(id int64, name string, cfg WebhookConfig) *models.Automation {
	raw, _ := json.Marshal(cfg)
	return &models.Automation{
		ID:            id,
		Name:          name,
		Enabled:       true,
		TriggerType:   "webhook",
		TriggerConfig: raw,
	}
}

func computeHMAC(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

// ─── HandleWebhook Tests ────────────────────────────────

func TestWebhookTrigger_ValidWebhook_Fires(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	token := "abc-123-def"
	auto := makeWebhookAutomation(1, "door-webhook", WebhookConfig{WebhookToken: token})
	repo.automations[token] = auto

	payload := []byte(`{"event":"door_opened","value":true}`)
	err := wt.HandleWebhook(context.Background(), token, payload, "", "192.168.1.100")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	// Verify snapshot contents.
	call := engine.lastCall()
	if call.AutomationID != 1 {
		t.Fatalf("expected automation_id 1, got %d", call.AutomationID)
	}

	var snap webhookSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.WebhookToken != token {
		t.Fatalf("expected token %q, got %q", token, snap.WebhookToken)
	}
	if snap.RemoteIP != "192.168.1.100" {
		t.Fatalf("expected remote_ip 192.168.1.100, got %q", snap.RemoteIP)
	}

	// Verify payload is embedded.
	var payloadData map[string]interface{}
	if err := json.Unmarshal(snap.Payload, &payloadData); err != nil {
		t.Fatalf("failed to unmarshal payload: %v", err)
	}
	if payloadData["event"] != "door_opened" {
		t.Fatalf("expected event 'door_opened', got %v", payloadData["event"])
	}
}

func TestWebhookTrigger_InvalidToken_Returns404(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	err := wt.HandleWebhook(context.Background(), "nonexistent-token", []byte(`{}`), "", "10.0.0.1")
	if err != ErrWebhookNotFound {
		t.Fatalf("expected ErrWebhookNotFound, got %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire for invalid token")
	}
}

func TestWebhookTrigger_EmptyToken_ReturnsError(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	err := wt.HandleWebhook(context.Background(), "", []byte(`{}`), "", "10.0.0.1")
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}

func TestWebhookTrigger_DisabledAutomation_ReturnsNotFound(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	token := "disabled-token"
	auto := makeWebhookAutomation(2, "disabled-webhook", WebhookConfig{WebhookToken: token})
	auto.Enabled = false
	repo.automations[token] = auto

	err := wt.HandleWebhook(context.Background(), token, []byte(`{}`), "", "10.0.0.1")
	if err != ErrWebhookNotFound {
		t.Fatalf("expected ErrWebhookNotFound for disabled automation, got %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire for disabled automation")
	}
}

func TestWebhookTrigger_AutoDisabledAutomation_ReturnsNotFound(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	token := "auto-disabled-token"
	auto := makeWebhookAutomation(3, "auto-disabled-webhook", WebhookConfig{WebhookToken: token})
	auto.AutoDisabled = true
	repo.automations[token] = auto

	err := wt.HandleWebhook(context.Background(), token, []byte(`{}`), "", "10.0.0.1")
	if err != ErrWebhookNotFound {
		t.Fatalf("expected ErrWebhookNotFound for auto-disabled automation, got %v", err)
	}
}

func TestWebhookTrigger_ValidHMAC_Fires(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	secret := "my-secret-key"
	token := "hmac-token"
	auto := makeWebhookAutomation(4, "hmac-webhook", WebhookConfig{
		WebhookToken: token,
		Secret:       strPtr(secret),
	})
	repo.automations[token] = auto

	payload := []byte(`{"temperature":42}`)
	sig := computeHMAC(payload, secret)

	err := wt.HandleWebhook(context.Background(), token, payload, sig, "10.0.0.1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestWebhookTrigger_InvalidHMAC_RejectsRequest(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	secret := "my-secret-key"
	token := "hmac-token"
	auto := makeWebhookAutomation(5, "hmac-webhook", WebhookConfig{
		WebhookToken: token,
		Secret:       strPtr(secret),
	})
	repo.automations[token] = auto

	payload := []byte(`{"temperature":42}`)
	badSig := "deadbeef0000"

	err := wt.HandleWebhook(context.Background(), token, payload, badSig, "10.0.0.1")
	if err != ErrWebhookSignatureInvalid {
		t.Fatalf("expected ErrWebhookSignatureInvalid, got %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire with invalid HMAC")
	}
}

func TestWebhookTrigger_MissingSignature_WithSecret_Rejects(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	secret := "my-secret-key"
	token := "hmac-token"
	auto := makeWebhookAutomation(6, "hmac-webhook", WebhookConfig{
		WebhookToken: token,
		Secret:       strPtr(secret),
	})
	repo.automations[token] = auto

	payload := []byte(`{"temperature":42}`)

	err := wt.HandleWebhook(context.Background(), token, payload, "", "10.0.0.1")
	if err != ErrWebhookSignatureInvalid {
		t.Fatalf("expected ErrWebhookSignatureInvalid for missing signature, got %v", err)
	}
}

func TestWebhookTrigger_EmptyPayload_UsesEmptyObject(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	token := "empty-payload-token"
	auto := makeWebhookAutomation(7, "empty-payload-webhook", WebhookConfig{WebhookToken: token})
	repo.automations[token] = auto

	err := wt.HandleWebhook(context.Background(), token, nil, "", "10.0.0.1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	// Verify payload defaults to {}.
	call := engine.lastCall()
	var snap webhookSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if string(snap.Payload) != "{}" {
		t.Fatalf("expected empty payload '{}', got %q", string(snap.Payload))
	}
}

func TestWebhookTrigger_InvalidJSON_ReturnsError(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	token := "invalid-json-token"
	auto := makeWebhookAutomation(8, "invalid-json-webhook", WebhookConfig{WebhookToken: token})
	repo.automations[token] = auto

	err := wt.HandleWebhook(context.Background(), token, []byte(`not-json{`), "", "10.0.0.1")
	if err == nil {
		t.Fatal("expected error for invalid JSON payload")
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire with invalid JSON payload")
	}
}

func TestWebhookTrigger_InvalidConfig_AutoDisables(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	token := "bad-config-token"
	auto := &models.Automation{
		ID:            9,
		Name:          "bad-config-webhook",
		Enabled:       true,
		TriggerType:   "webhook",
		TriggerConfig: json.RawMessage(`{invalid-json`),
	}
	repo.automations[token] = auto

	err := wt.HandleWebhook(context.Background(), token, []byte(`{}`), "", "10.0.0.1")
	if err == nil {
		t.Fatal("expected error for invalid config")
	}

	if _, disabled := repo.disabled[9]; !disabled {
		t.Fatal("expected automation 9 to be auto-disabled")
	}
}

func TestWebhookTrigger_RepoError_ReturnsError(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	repo.returnErr = fmt.Errorf("db connection lost")

	err := wt.HandleWebhook(context.Background(), "any-token", []byte(`{}`), "", "10.0.0.1")
	if err == nil {
		t.Fatal("expected error from repo failure")
	}
}

func TestWebhookTrigger_EngineError_ReturnsError(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{returnErr: fmt.Errorf("action failed")}
	wt := NewWebhookTrigger(repo, engine)

	token := "engine-error-token"
	auto := makeWebhookAutomation(10, "engine-error-webhook", WebhookConfig{WebhookToken: token})
	repo.automations[token] = auto

	err := wt.HandleWebhook(context.Background(), token, []byte(`{}`), "", "10.0.0.1")
	if err == nil {
		t.Fatal("expected error from engine failure")
	}
}

func TestWebhookTrigger_NoSecret_IgnoresSignature(t *testing.T) {
	repo := newMockWebhookRepo()
	engine := &mockEngine{}
	wt := NewWebhookTrigger(repo, engine)

	token := "no-secret-token"
	auto := makeWebhookAutomation(11, "no-secret-webhook", WebhookConfig{WebhookToken: token})
	repo.automations[token] = auto

	// Pass a garbage signature — should be ignored since no secret is configured.
	err := wt.HandleWebhook(context.Background(), token, []byte(`{"ok":true}`), "garbage-sig", "10.0.0.1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

// ─── WebhookConfig Parsing Tests ────────────────────────

func TestParseWebhookConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{"webhook_token":"abc-123","secret":"my-secret"}`)
	cfg, err := parseWebhookConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.WebhookToken != "abc-123" {
		t.Fatalf("expected token 'abc-123', got %q", cfg.WebhookToken)
	}
	if cfg.Secret == nil || *cfg.Secret != "my-secret" {
		t.Fatalf("expected secret 'my-secret', got %v", cfg.Secret)
	}
}

func TestParseWebhookConfig_NoSecret(t *testing.T) {
	raw := json.RawMessage(`{"webhook_token":"abc-123"}`)
	cfg, err := parseWebhookConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Secret != nil {
		t.Fatalf("expected nil secret, got %v", cfg.Secret)
	}
}

func TestParseWebhookConfig_Empty(t *testing.T) {
	_, err := parseWebhookConfig(nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestParseWebhookConfig_InvalidJSON(t *testing.T) {
	_, err := parseWebhookConfig(json.RawMessage(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseWebhookConfig_MissingToken(t *testing.T) {
	raw := json.RawMessage(`{"secret":"my-secret"}`)
	_, err := parseWebhookConfig(raw)
	if err == nil {
		t.Fatal("expected error for missing webhook_token")
	}
}

// ─── HMAC Validation Tests ──────────────────────────────

func TestValidateHMAC_Valid(t *testing.T) {
	payload := []byte(`{"test":true}`)
	secret := "test-secret"
	sig := computeHMAC(payload, secret)

	if !validateHMAC(payload, sig, secret) {
		t.Fatal("expected valid HMAC to pass")
	}
}

func TestValidateHMAC_Invalid(t *testing.T) {
	payload := []byte(`{"test":true}`)
	if validateHMAC(payload, "wrong-signature", "test-secret") {
		t.Fatal("expected invalid HMAC to fail")
	}
}

func TestValidateHMAC_EmptySignature(t *testing.T) {
	payload := []byte(`{"test":true}`)
	if validateHMAC(payload, "", "test-secret") {
		t.Fatal("expected empty signature to fail")
	}
}

func TestValidateHMAC_DifferentPayload(t *testing.T) {
	secret := "test-secret"
	sig := computeHMAC([]byte(`{"test":true}`), secret)

	// Different payload should fail.
	if validateHMAC([]byte(`{"test":false}`), sig, secret) {
		t.Fatal("expected different payload to fail HMAC")
	}
}

func TestValidateHMAC_DifferentSecret(t *testing.T) {
	payload := []byte(`{"test":true}`)
	sig := computeHMAC(payload, "secret-a")

	if validateHMAC(payload, sig, "secret-b") {
		t.Fatal("expected different secret to fail HMAC")
	}
}
