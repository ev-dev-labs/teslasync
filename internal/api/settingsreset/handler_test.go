package settingsreset

// Handler tests for POST /settings/reset.
//
// The orchestrator is fully covered by internal/database/settings_reset_test.go;
// these tests focus on the HTTP boundary:
//
//   - empty body → reset all whitelisted sections
//   - explicit section → reset that one section
//   - deny-listed section → 400 SECTION_DENIED
//   - unknown section → 400 SECTION_UNKNOWN
//   - quiet_hours requires user (sentinel mapped to 401)
//   - oversized body → 400
//   - unknown JSON field → 400
//   - nil repo → 500

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
)

// stubResetExecutor records the inputs and returns canned results.
type stubResetExecutor struct {
	gotUser     string
	gotSections []settingsdb.SettingsResetSection
	result      *settingsdb.SettingsResetResult
	err         error
	calls       int
}

func (s *stubResetExecutor) ResetSections(_ context.Context, userID string, sections []settingsdb.SettingsResetSection) (*settingsdb.SettingsResetResult, error) {
	s.calls++
	s.gotUser = userID
	s.gotSections = append([]settingsdb.SettingsResetSection(nil), sections...)
	if s.err != nil {
		return nil, s.err
	}
	if s.result != nil {
		return s.result, nil
	}
	// Synthesize a result that mirrors the request shape.
	out := &settingsdb.SettingsResetResult{}
	for _, sec := range sections {
		out.Sections = append(out.Sections, settingsdb.SettingsResetSectionResult{
			Section: string(sec),
			Reset:   1,
		})
		out.Reset++
	}
	return out, nil
}

func newResetRequest(t *testing.T, body string, header string) *http.Request {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(http.MethodPost, "/api/v1/settings/reset", nil)
	} else {
		r = httptest.NewRequest(http.MethodPost, "/api/v1/settings/reset",
			bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
	}
	if header != "" {
		r.Header.Set("X-Test-Subject", header)
	}
	return r
}

func decodeResetResult(t *testing.T, w *httptest.ResponseRecorder) *settingsdb.SettingsResetResult {
	t.Helper()
	var out settingsdb.SettingsResetResult
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (body=%q)", err, w.Body.String())
	}
	return &out
}

func TestSettingsResetHandler_NilRepoReturns500(t *testing.T) {
	h := NewSettingsResetHandler(nil, "X-Test-Subject")
	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{}`, "alice"))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
}

func TestSettingsResetHandler_EmptyBodyResetsAll(t *testing.T) {
	stub := &stubResetExecutor{}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, "", "alice"))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	wantAll := settingsdb.AllSettingsResetSections()
	if len(stub.gotSections) != len(wantAll) {
		t.Fatalf("sections len = %d, want %d", len(stub.gotSections), len(wantAll))
	}
	for i, s := range wantAll {
		if stub.gotSections[i] != s {
			t.Errorf("section[%d] = %q, want %q", i, stub.gotSections[i], s)
		}
	}
	if stub.gotUser != "alice" {
		t.Errorf("user = %q, want alice", stub.gotUser)
	}
	got := decodeResetResult(t, w)
	if got.Reset != int64(len(wantAll)) {
		t.Errorf("Reset count = %d, want %d", got.Reset, len(wantAll))
	}
}

func TestSettingsResetHandler_EmptyJSONObjectResetsAll(t *testing.T) {
	stub := &stubResetExecutor{}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{}`, "alice"))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	wantAll := settingsdb.AllSettingsResetSections()
	if len(stub.gotSections) != len(wantAll) {
		t.Fatalf("sections len = %d, want %d", len(stub.gotSections), len(wantAll))
	}
}

func TestSettingsResetHandler_SingleSection(t *testing.T) {
	stub := &stubResetExecutor{}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{"section":"alert_rules"}`, "alice"))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	if len(stub.gotSections) != 1 || stub.gotSections[0] != settingsdb.ResetSectionAlertRules {
		t.Fatalf("sections = %v, want [alert_rules]", stub.gotSections)
	}
}

func TestSettingsResetHandler_NormalisesCaseAndWhitespace(t *testing.T) {
	stub := &stubResetExecutor{}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{"section":"  Alert_Rules  "}`, "alice"))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	if len(stub.gotSections) != 1 || stub.gotSections[0] != settingsdb.ResetSectionAlertRules {
		t.Fatalf("sections = %v, want [alert_rules]", stub.gotSections)
	}
}

func TestSettingsResetHandler_DenyListedSectionReturns400(t *testing.T) {
	stub := &stubResetExecutor{}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{"section":"tariffs"}`, "alice"))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "SECTION_DENIED") {
		t.Errorf("body should contain SECTION_DENIED code; got %s", w.Body.String())
	}
	if stub.calls != 0 {
		t.Errorf("repo must not be called for denied sections; calls=%d", stub.calls)
	}
}

func TestSettingsResetHandler_UnknownSectionReturns400(t *testing.T) {
	stub := &stubResetExecutor{}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{"section":"bogus"}`, "alice"))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if !strings.Contains(w.Body.String(), "SECTION_UNKNOWN") {
		t.Errorf("body should contain SECTION_UNKNOWN code; got %s", w.Body.String())
	}
	if stub.calls != 0 {
		t.Errorf("repo must not be called for unknown sections; calls=%d", stub.calls)
	}
}

func TestSettingsResetHandler_QuietHoursWithoutUserReturns401(t *testing.T) {
	stub := &stubResetExecutor{
		err: settingsdb.ErrSettingsResetQuietHoursRequiresUser,
	}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{"section":"quiet_hours"}`, ""))

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401, body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "MISSING_IDENTITY") {
		t.Errorf("body should contain MISSING_IDENTITY code; got %s", w.Body.String())
	}
}

func TestSettingsResetHandler_UnknownJSONFieldReturns400(t *testing.T) {
	stub := &stubResetExecutor{}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{"foo":"bar"}`, "alice"))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", w.Code, w.Body.String())
	}
}

func TestSettingsResetHandler_OversizedBodyReturns400(t *testing.T) {
	stub := &stubResetExecutor{}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	huge := `{"section":"` + strings.Repeat("x", int(MaxSettingsResetBodyBytes)+1024) + `"}`
	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, huge, "alice"))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", w.Code, w.Body.String())
	}
}

func TestSettingsResetHandler_RepoErrorReturns500(t *testing.T) {
	stub := &stubResetExecutor{err: errors.New("boom")}
	h := NewSettingsResetHandler(stub, "X-Test-Subject")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{"section":"alert_rules"}`, "alice"))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", w.Code, w.Body.String())
	}
}

func TestSettingsResetHandler_OpenModeAllowsResetExceptQuietHours(t *testing.T) {
	// When ForwardAuth header is empty, actorFromRequest returns "".
	// Sections other than quiet_hours are install-global so they
	// remain valid and the orchestrator gets called with userID="".
	stub := &stubResetExecutor{}
	h := NewSettingsResetHandler(stub, "")

	w := httptest.NewRecorder()
	h.Reset(w, newResetRequest(t, `{"section":"alert_rules"}`, "irrelevant"))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	if stub.gotUser != "" {
		t.Errorf("expected empty userID in open mode; got %q", stub.gotUser)
	}
}
