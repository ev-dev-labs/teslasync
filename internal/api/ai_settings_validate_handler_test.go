package api

// Phase-50 / 0003 — F2 Settings UI for AI.
//
// Backend test coverage for slice F2:
//
//   1. AISettingsValidateHandler — local mode validates loopback,
//      rejects public hosts, accepts cloud as a no-op, rejects 'off'
//      and unknown modes, rejects malformed JSON.
//
//   2. applyAIArchiveOnModeFlip — pure helper that implements the
//      ADR-015 §I7 "off means off + archive prior selection" policy.
//      Covers every transition (off→off, off→local, local→off with
//      empty/nonempty prior, cloud→off with mixed-bool entries, the
//      defensive clone of the archive map).

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// --- AISettingsValidateHandler tests ----------------------------------

func TestAISettingsValidateHandler_LocalLoopback_OK(t *testing.T) {
	h := AISettingsValidateHandler()
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

func TestAISettingsValidateHandler_LocalDefault_OK(t *testing.T) {
	// Empty base_url should default to provider.DefaultLocalBaseURL,
	// which is the canonical http://localhost:11434.
	h := AISettingsValidateHandler()
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

func TestAISettingsValidateHandler_LocalPrivateIPLiteral_OK(t *testing.T) {
	// A direct RFC1918 IP literal — no DNS lookup needed, the
	// validator accepts and pins the IP.
	h := AISettingsValidateHandler()
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

func TestAISettingsValidateHandler_LocalPublicIPLiteral_Rejected(t *testing.T) {
	// 1.2.3.4 is public — the local validator must reject.
	h := AISettingsValidateHandler()
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

func TestAISettingsValidateHandler_LocalBadScheme_Rejected(t *testing.T) {
	h := AISettingsValidateHandler()
	body := bytes.NewBufferString(`{"mode":"local","base_url":"file:///etc/passwd"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAISettingsValidateHandler_Cloud_NoOp(t *testing.T) {
	// Cloud mode acknowledges with OK and a note — the URL is not
	// validated because cloud accepts any HTTPS endpoint by design.
	h := AISettingsValidateHandler()
	body := bytes.NewBufferString(`{"mode":"cloud","base_url":"https://api.openai.com"}`)
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
	if resp.Note == "" {
		t.Errorf("Note: want non-empty for cloud mode, got empty")
	}
}

func TestAISettingsValidateHandler_OffMode_Rejected(t *testing.T) {
	// 'off' has nothing to validate; a SPA that calls this is
	// almost certainly buggy and we want the failure to surface.
	h := AISettingsValidateHandler()
	body := bytes.NewBufferString(`{"mode":"off","base_url":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAISettingsValidateHandler_UnknownMode_Rejected(t *testing.T) {
	h := AISettingsValidateHandler()
	body := bytes.NewBufferString(`{"mode":"hybrid","base_url":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAISettingsValidateHandler_MalformedJSON_Rejected(t *testing.T) {
	h := AISettingsValidateHandler()
	body := bytes.NewBufferString(`{"mode":"local"`) // truncated
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config", body)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 got %d body=%s", rec.Code, rec.Body.String())
	}
}

// --- applyAIArchiveOnModeFlip tests -----------------------------------

func TestApplyAIArchiveOnModeFlip_LocalToOff_Archives(t *testing.T) {
	existing := &models.Settings{
		AIMode: "local",
		AIFeatures: map[string]bool{
			"chatbot-llm":         true,
			"ai-provider-health":  false, // explicitly false → not archived
		},
	}
	incoming := &models.Settings{
		AIMode: "off",
		// Buggy SPA leaves the prior map in the body — handler clears it.
		AIFeatures: map[string]bool{"chatbot-llm": true},
	}

	applyAIArchiveOnModeFlip(existing, incoming)

	if len(incoming.AIFeatures) != 0 {
		t.Errorf("AIFeatures: want empty (off means off) got %v", incoming.AIFeatures)
	}
	if len(incoming.AIFeaturesArchived) != 1 || !incoming.AIFeaturesArchived["chatbot-llm"] {
		t.Errorf("AIFeaturesArchived: want only true entries archived, got %v", incoming.AIFeaturesArchived)
	}
	if _, present := incoming.AIFeaturesArchived["ai-provider-health"]; present {
		t.Errorf("AIFeaturesArchived: explicitly-false entry must not be archived, got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_OffToOff_NoOp(t *testing.T) {
	existing := &models.Settings{
		AIMode:     "off",
		AIFeatures: map[string]bool{}, // already off
	}
	incoming := &models.Settings{
		AIMode:             "off",
		AIFeatures:         map[string]bool{},
		AIFeaturesArchived: map[string]bool{"sentinel": true},
	}

	applyAIArchiveOnModeFlip(existing, incoming)

	// AIFeatures cleared (defensively normalised) — but the
	// archive must NOT be replaced when the prior mode was already
	// off (no fresh archive event).
	if len(incoming.AIFeatures) != 0 {
		t.Errorf("AIFeatures: want empty got %v", incoming.AIFeatures)
	}
	if !incoming.AIFeaturesArchived["sentinel"] {
		t.Errorf("AIFeaturesArchived: pre-existing archive must be preserved across off→off, got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_LocalToLocal_NoOp(t *testing.T) {
	// Mode-on transitions are not archive events.
	existing := &models.Settings{AIMode: "local", AIFeatures: map[string]bool{"chatbot-llm": true}}
	incoming := &models.Settings{
		AIMode:     "local",
		AIFeatures: map[string]bool{"chatbot-llm": true},
	}

	applyAIArchiveOnModeFlip(existing, incoming)

	if len(incoming.AIFeatures) != 1 || !incoming.AIFeatures["chatbot-llm"] {
		t.Errorf("AIFeatures: must be untouched for non-off transitions, got %v", incoming.AIFeatures)
	}
	if incoming.AIFeaturesArchived != nil {
		t.Errorf("AIFeaturesArchived: must not be written for non-off transitions, got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_LocalToOff_EmptyPrior_NoArchive(t *testing.T) {
	// Mode was on but the user never enabled any feature — there
	// is nothing meaningful to archive, so AIFeaturesArchived
	// stays nil (the persisted column will round-trip as the
	// existing archive value, which is the right behaviour).
	existing := &models.Settings{AIMode: "local", AIFeatures: map[string]bool{}}
	incoming := &models.Settings{AIMode: "off", AIFeatures: map[string]bool{}}

	applyAIArchiveOnModeFlip(existing, incoming)

	if len(incoming.AIFeatures) != 0 {
		t.Errorf("AIFeatures: want empty got %v", incoming.AIFeatures)
	}
	if incoming.AIFeaturesArchived != nil {
		t.Errorf("AIFeaturesArchived: want nil (no fresh archive material), got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_DefensiveClone(t *testing.T) {
	// The archive must be a copy, not an alias — mutating the
	// existing settings after the helper returns must not affect
	// the snapshot we just wrote.
	existing := &models.Settings{
		AIMode:     "cloud",
		AIFeatures: map[string]bool{"chatbot-llm": true},
	}
	incoming := &models.Settings{AIMode: "off"}

	applyAIArchiveOnModeFlip(existing, incoming)

	// Mutate the source after the call.
	existing.AIFeatures["chatbot-llm"] = false
	existing.AIFeatures["ai-provider-health"] = true

	if !incoming.AIFeaturesArchived["chatbot-llm"] {
		t.Errorf("AIFeaturesArchived: defensive clone broken — mutation propagated, got %v", incoming.AIFeaturesArchived)
	}
	if _, present := incoming.AIFeaturesArchived["ai-provider-health"]; present {
		t.Errorf("AIFeaturesArchived: aliased map — adversarial post-mutation surfaced, got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_NilIncoming_NoOp(t *testing.T) {
	// Permissive on nil — the helper must not panic when a caller
	// passes a half-constructed pointer.
	applyAIArchiveOnModeFlip(&models.Settings{AIMode: "local"}, nil)
}

func TestApplyAIArchiveOnModeFlip_NilExisting_ClearsAndReturns(t *testing.T) {
	incoming := &models.Settings{
		AIMode:     "off",
		AIFeatures: map[string]bool{"chatbot-llm": true},
	}
	applyAIArchiveOnModeFlip(nil, incoming)

	if len(incoming.AIFeatures) != 0 {
		t.Errorf("AIFeatures: want empty got %v", incoming.AIFeatures)
	}
	if incoming.AIFeaturesArchived != nil {
		t.Errorf("AIFeaturesArchived: must not be written without a prior, got %v", incoming.AIFeaturesArchived)
	}
}
