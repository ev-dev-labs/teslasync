package aisettingsvalidate

// Phase-50 / 0003 — F2 Settings UI for AI.
// Phase-50 / Azure adapter — extended for cloud-probe validation.
//
// Backend test coverage for the validate handler:
//
//   1. Handler — local mode validates loopback,
//      rejects public hosts, rejects 'off' and unknown modes, rejects
//      malformed JSON.
//   2. Cloud-mode probe — exercises the in-test mock provider to
//      cover the success path, the error-classification matrix
//      (401/403 → unauthorized, 404 → not_found, 5xx → upstream_error,
//      timeout → timeout), the missing-api-key pre-flight check, and
//      the saved-config fallback (api_key omitted from request).
//   3. applyAIArchiveOnModeFlip — pure helper that implements the
//      ADR-015 §I7 "off means off + archive prior selection" policy.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
) // --- test helpers -----------------------------------------------------

// stubSettings is the minimal SettingsReader the validate handler
// needs. AIMode + AIFeatureEnabled are unused by the handler (it
// gates on req.Mode, not the saved mode) but required by the
// interface; AIProviderConfig is the only call that actually fires
// from the cloud branch.
type stubSettings struct {
	cfg map[string]any
}

func (s stubSettings) AIMode(_ context.Context) (string, error) {
	return provider.ModeOff, nil
}
func (s stubSettings) AIFeatureEnabled(_ context.Context, _ string) (bool, error) {
	return false, nil
}
func (s stubSettings) AIProviderConfig(_ context.Context) (map[string]any, error) {
	if s.cfg == nil {
		return map[string]any{}, nil
	}
	return s.cfg, nil
}

// fakeProvider is the in-test Provider. Each instance is built with a
// fixed Chat response (or error) so individual tests can drive the
// classifier through every branch without spinning up an HTTP server.
type fakeProvider struct {
	name     string
	chatErr  error
	chatResp *provider.ChatResponse
	delay    time.Duration
}

func (f *fakeProvider) Name() string { return f.name }
func (f *fakeProvider) Chat(ctx context.Context, _ provider.ChatRequest) (*provider.ChatResponse, error) {
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if f.chatErr != nil {
		return nil, f.chatErr
	}
	if f.chatResp != nil {
		return f.chatResp, nil
	}
	return &provider.ChatResponse{
		Message: provider.Message{Role: "assistant", Content: "pong"},
	}, nil
}
func (f *fakeProvider) Stream(_ context.Context, _ provider.ChatRequest) (<-chan provider.Chunk, error) {
	return nil, provider.ErrCapabilityNotSupported
}
func (f *fakeProvider) Embed(_ context.Context, _ provider.EmbedRequest) (*provider.EmbedResponse, error) {
	return nil, provider.ErrCapabilityNotSupported
}
func (f *fakeProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{Tools: false, Streaming: false, Embeddings: false}
}

// newTestValidateHandler wires a fresh registry + stubSettings with
// the supplied saved config and the supplied fake provider builder.
// All cloud-probe tests funnel through this so each test stays a
// self-contained unit.
func newTestValidateHandler(
	savedCfg map[string]any,
	providerName string,
	build provider.Builder,
) http.HandlerFunc {
	settings := stubSettings{cfg: savedCfg}
	reg := provider.NewRegistry(settings)
	if build != nil {
		reg.Register(providerName, build)
	}
	return Handler(reg, settings)
}

// emptyHandler is the local-mode test fixture — no cloud probe is
// exercised, so the registry can be empty.
func emptyHandler() http.HandlerFunc {
	return newTestValidateHandler(nil, "", nil)
}

// --- Handler tests ----------------------------------

func TestHandler_LocalLoopback_OK(t *testing.T) {
	h := emptyHandler()
	body := bytes.NewBufferString(`{"mode":"local","base_url":"http://localhost:11434"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp validateConfigResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.OK {
		t.Errorf("OK: want true got %v", resp.OK)
	}
	if resp.Mode != "local" {
		t.Errorf("Mode: want local got %q", resp.Mode)
	}
	if resp.BaseURL != "http://localhost:11434" {
		t.Errorf("BaseURL: want canonical loopback got %q", resp.BaseURL)
	}
	// localhost is in LocalAllowedHostnames so PinnedIP is empty by design.
	if resp.PinnedIP != "" {
		t.Errorf("PinnedIP: want '' for allowlisted hostname got %q", resp.PinnedIP)
	}
}

func TestHandler_LocalDefault_OK(t *testing.T) {
	// Empty base_url should default to provider.DefaultLocalBaseURL,
	// which is the canonical http://localhost:11434.
	h := emptyHandler()
	body := bytes.NewBufferString(`{"mode":"local","base_url":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp validateConfigResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.BaseURL != "http://localhost:11434" {
		t.Errorf("BaseURL default: want canonical loopback got %q", resp.BaseURL)
	}
}

func TestHandler_LocalPrivateIPLiteral_OK(t *testing.T) {
	// A direct RFC1918 IP literal — no DNS lookup needed, the
	// validator accepts and pins the IP.
	h := emptyHandler()
	body := bytes.NewBufferString(`{"mode":"local","base_url":"http://10.0.0.42:11434"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp validateConfigResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.PinnedIP != "10.0.0.42" {
		t.Errorf("PinnedIP: want 10.0.0.42 got %q", resp.PinnedIP)
	}
}

func TestHandler_LocalPublicIPLiteral_Rejected(t *testing.T) {
	// 1.2.3.4 is public — the local validator must reject.
	h := emptyHandler()
	body := bytes.NewBufferString(`{"mode":"local","base_url":"http://1.2.3.4:11434"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422 got %d body=%s", rec.Code, rec.Body.String())
	}
	// 422 body uses the standard `{error, code}` shape produced by
	// writeErrorCode so the SPA's ApiError parser surfaces both
	// fields without special-casing.
	var resp struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Code != "not_local" {
		t.Errorf("code: want 'not_local' got %q", resp.Code)
	}
	if !strings.Contains(resp.Error, "public IP") {
		t.Errorf("error: want 'public IP' substring got %q", resp.Error)
	}
}

func TestHandler_LocalBadScheme_Rejected(t *testing.T) {
	h := emptyHandler()
	body := bytes.NewBufferString(`{"mode":"local","base_url":"file:///etc/passwd"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandler_Cloud_MissingAPIKey_Rejected(t *testing.T) {
	// Cloud mode now actually probes the upstream — a request
	// with no api_key (and no saved key in settings) must be
	// rejected up front with the missing_api_key code so the SPA
	// can render a precise message instead of a generic adapter
	// error.
	h := newTestValidateHandler(nil, "openai", func(_ provider.ProviderConfig) (provider.Provider, error) {
		return &fakeProvider{name: "openai"}, nil
	})
	body := bytes.NewBufferString(`{"mode":"cloud","provider":"openai","base_url":"https://api.openai.com","model":"gpt-4o-mini"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Code != "missing_api_key" {
		t.Errorf("code: want missing_api_key got %q", resp.Code)
	}
}

func TestHandler_Cloud_ProbeOK(t *testing.T) {
	// Happy path: api_key supplied, fake provider returns a clean
	// chat response, handler returns 200 OK with the probed model.
	build := func(cfg provider.ProviderConfig) (provider.Provider, error) {
		if cfg.APIKey == "" {
			return nil, fmt.Errorf("test bug: APIKey not propagated to builder")
		}
		return &fakeProvider{name: "openai"}, nil
	}
	h := newTestValidateHandler(nil, "openai", build)
	body := bytes.NewBufferString(`{"mode":"cloud","provider":"openai","base_url":"https://api.openai.com","model":"gpt-4o-mini","api_key":"sk-test"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp validateConfigResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.OK {
		t.Errorf("OK: want true got %v", resp.OK)
	}
	if resp.ProbedModel != "gpt-4o-mini" {
		t.Errorf("ProbedModel: want gpt-4o-mini got %q", resp.ProbedModel)
	}
}

func TestHandler_Cloud_ProbeFallsBackToSavedAPIKey(t *testing.T) {
	// Editing a non-secret field (e.g. deployment) shouldn't force
	// the user to re-type the api_key — the handler should fall
	// back to the saved value when the request omits it.
	saved := map[string]any{
		"default": "openai",
		"openai": map[string]any{
			"base_url": "https://api.openai.com",
			"model":    "gpt-4o-mini",
			"api_key":  "sk-saved-key",
		},
	}
	got := struct{ APIKey string }{}
	build := func(cfg provider.ProviderConfig) (provider.Provider, error) {
		got.APIKey = cfg.APIKey
		return &fakeProvider{name: "openai"}, nil
	}
	h := newTestValidateHandler(saved, "openai", build)
	body := bytes.NewBufferString(`{"mode":"cloud","provider":"openai"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 got %d body=%s", rec.Code, rec.Body.String())
	}
	if got.APIKey != "sk-saved-key" {
		t.Errorf("APIKey: want fallback to saved sk-saved-key, got %q", got.APIKey)
	}
}

func TestHandler_Cloud_Probe401_Unauthorized(t *testing.T) {
	build := func(_ provider.ProviderConfig) (provider.Provider, error) {
		return &fakeProvider{
			name: "openai",
			chatErr: fmt.Errorf("%w: openai chat status 401: bad key",
				provider.ErrUpstream),
		}, nil
	}
	h := newTestValidateHandler(nil, "openai", build)
	body := bytes.NewBufferString(`{"mode":"cloud","provider":"openai","base_url":"https://api.openai.com","model":"gpt-4o-mini","api_key":"sk-bad"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Code != "unauthorized" {
		t.Errorf("code: want unauthorized got %q", resp.Code)
	}
}

func TestHandler_Cloud_Probe404_NotFound(t *testing.T) {
	build := func(_ provider.ProviderConfig) (provider.Provider, error) {
		return &fakeProvider{
			name: "azure",
			chatErr: fmt.Errorf("%w: azure chat status 404: deployment not found",
				provider.ErrUpstream),
		}, nil
	}
	h := newTestValidateHandler(nil, "azure", build)
	body := bytes.NewBufferString(`{"mode":"cloud","provider":"azure","flavor":"openai","base_url":"https://r.openai.azure.com","model":"gpt-4o","deployment":"missing","api_key":"k"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Code != "not_found" {
		t.Errorf("code: want not_found got %q", resp.Code)
	}
}

func TestHandler_Cloud_Probe500_UpstreamError(t *testing.T) {
	build := func(_ provider.ProviderConfig) (provider.Provider, error) {
		return &fakeProvider{
			name: "openai",
			chatErr: fmt.Errorf("%w: openai chat status 503: bad gateway",
				provider.ErrUpstream),
		}, nil
	}
	h := newTestValidateHandler(nil, "openai", build)
	body := bytes.NewBufferString(`{"mode":"cloud","provider":"openai","base_url":"https://api.openai.com","model":"gpt-4o-mini","api_key":"k"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Code != "upstream_error" {
		t.Errorf("code: want upstream_error got %q", resp.Code)
	}
}

func TestHandler_Cloud_UnknownProvider_Rejected(t *testing.T) {
	// Provider name not registered in the registry → unknown_provider.
	h := newTestValidateHandler(nil, "openai", func(_ provider.ProviderConfig) (provider.Provider, error) {
		return &fakeProvider{name: "openai"}, nil
	})
	body := bytes.NewBufferString(`{"mode":"cloud","provider":"nonsense","base_url":"https://x","model":"y","api_key":"k"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Code != "unknown_provider" {
		t.Errorf("code: want unknown_provider got %q", resp.Code)
	}
}

func TestHandler_Cloud_AzureMissingDeployment_Rejected(t *testing.T) {
	// Azure OpenAI Service flavor needs deployment OR model — when
	// both are empty the handler short-circuits with
	// missing_deployment so the SPA can render a precise message.
	h := newTestValidateHandler(nil, "azure", func(_ provider.ProviderConfig) (provider.Provider, error) {
		return &fakeProvider{name: "azure"}, nil
	})
	body := bytes.NewBufferString(`{"mode":"cloud","provider":"azure","flavor":"openai","base_url":"https://r.openai.azure.com","api_key":"k"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422 got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Code != "missing_deployment" {
		t.Errorf("code: want missing_deployment got %q", resp.Code)
	}
}

func TestHandler_OffMode_Rejected(t *testing.T) {
	// 'off' has nothing to validate; a SPA that calls this is
	// almost certainly buggy and we want the failure to surface.
	h := emptyHandler()
	body := bytes.NewBufferString(`{"mode":"off","base_url":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandler_UnknownMode_Rejected(t *testing.T) {
	h := emptyHandler()
	body := bytes.NewBufferString(`{"mode":"hybrid","base_url":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandler_MalformedJSON_Rejected(t *testing.T) {
	h := emptyHandler()
	body := bytes.NewBufferString(`{"mode":"local"`) // truncated
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 got %d body=%s", rec.Code, rec.Body.String())
	}
}
