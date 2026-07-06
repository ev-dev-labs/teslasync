package inboundwebhook

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// doRequest drives the handler with a raw string body and returns the
// recorder plus the decoded JSON response map. A body of "" is sent as an
// empty reader (which decodes to io.EOF → 400).
func doRequest(t *testing.T, body string) (*httptest.ResponseRecorder, map[string]interface{}) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/inbound", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	NewWebhookHandler().InboundWebhook(rec, req)

	var decoded map[string]interface{}
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("response is not valid JSON: %v (body=%q)", err, rec.Body.String())
		}
	}
	return rec, decoded
}

// ── Handler happy paths + branch coverage ────────────────────────────────

func TestInboundWebhook_Table(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		wantStatus  int
		wantFields  map[string]string // exact string fields expected in the JSON body
		wantErrCode string            // when set, asserts the {"code":...} error code
	}{
		{
			name:       "alert minimal defaults applied",
			body:       `{"event":"alert"}`,
			wantStatus: http.StatusCreated,
			wantFields: map[string]string{"status": "alert_logged"},
		},
		{
			name:       "alert fully populated",
			body:       `{"event":"alert","title":"Battery low","severity":"critical","message":"12%","vehicle":"5YJ3","data":{"soc":12}}`,
			wantStatus: http.StatusCreated,
			wantFields: map[string]string{"status": "alert_logged"},
		},
		{
			name:       "note with fields",
			body:       `{"event":"note","title":"t","message":"m"}`,
			wantStatus: http.StatusOK,
			wantFields: map[string]string{"status": "noted"},
		},
		{
			name:       "note minimal",
			body:       `{"event":"note"}`,
			wantStatus: http.StatusOK,
			wantFields: map[string]string{"status": "noted"},
		},
		{
			name:       "unknown event command echoes event",
			body:       `{"event":"command"}`,
			wantStatus: http.StatusOK,
			wantFields: map[string]string{"status": "received", "event": "command"},
		},
		{
			name:       "unknown custom event echoes event",
			body:       `{"event":"door_opened","message":"front left"}`,
			wantStatus: http.StatusOK,
			wantFields: map[string]string{"status": "received", "event": "door_opened"},
		},
		{
			name:       "whitespace event is not required-error and echoes verbatim",
			body:       `{"event":"  "}`,
			wantStatus: http.StatusOK,
			wantFields: map[string]string{"status": "received", "event": "  "},
		},
		{
			name:       "unknown top-level fields are ignored (lenient)",
			body:       `{"event":"note","unexpected":"ignored"}`,
			wantStatus: http.StatusOK,
			wantFields: map[string]string{"status": "noted"},
		},
		{
			name:        "missing event field",
			body:        `{"title":"x"}`,
			wantStatus:  http.StatusBadRequest,
			wantFields:  map[string]string{"error": "event field is required"},
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "explicit empty event",
			body:        `{"event":""}`,
			wantStatus:  http.StatusBadRequest,
			wantFields:  map[string]string{"error": "event field is required"},
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "malformed json",
			body:        `not-json{`,
			wantStatus:  http.StatusBadRequest,
			wantFields:  map[string]string{"error": "invalid JSON payload"},
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "empty body decodes to EOF",
			body:        ``,
			wantStatus:  http.StatusBadRequest,
			wantFields:  map[string]string{"error": "invalid JSON payload"},
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "json null decodes but has no event",
			body:        `null`,
			wantStatus:  http.StatusBadRequest,
			wantFields:  map[string]string{"error": "event field is required"},
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "wrong type for event field",
			body:        `{"event":123}`,
			wantStatus:  http.StatusBadRequest,
			wantFields:  map[string]string{"error": "invalid JSON payload"},
			wantErrCode: "BAD_REQUEST",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec, body := doRequest(t, tt.body)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			for k, want := range tt.wantFields {
				got, ok := body[k].(string)
				if !ok {
					t.Fatalf("body[%q] missing or not a string in %v", k, body)
				}
				if got != want {
					t.Errorf("body[%q] = %q, want %q", k, got, want)
				}
			}
			if tt.wantErrCode != "" {
				if got, _ := body["code"].(string); got != tt.wantErrCode {
					t.Errorf("body[code] = %v, want %q", body["code"], tt.wantErrCode)
				}
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
			}
		})
	}
}

// ── Body-size limit (413) ────────────────────────────────────────────────

func TestInboundWebhook_BodyTooLarge(t *testing.T) {
	huge := strings.Repeat("A", maxWebhookBodyBytes+1024)
	body := `{"event":"note","message":"` + huge + `"}`

	rec, decoded := doRequest(t, body)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (body=%s)", rec.Code, rec.Body.String())
	}
	if got, _ := decoded["error"].(string); got != "request body too large" {
		t.Errorf("error = %v, want 'request body too large'", decoded["error"])
	}
}

func TestInboundWebhook_BodyAtLimitAccepted(t *testing.T) {
	// A payload that is comfortably under the cap must still be processed.
	pad := strings.Repeat("A", maxWebhookBodyBytes/2)
	body := `{"event":"note","message":"` + pad + `"}`

	rec, decoded := doRequest(t, body)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body len=%d)", rec.Code, len(body))
	}
	if got, _ := decoded["status"].(string); got != "noted" {
		t.Errorf("status field = %v, want noted", decoded["status"])
	}
}

// ── Nil-body safety ──────────────────────────────────────────────────────

func TestInboundWebhook_NilBody(t *testing.T) {
	// A hand-built request with an explicitly nil body must not panic; it
	// should decode to EOF and return 400.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/inbound", nil)
	req.Body = nil
	rec := httptest.NewRecorder()

	NewWebhookHandler().InboundWebhook(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid JSON payload") {
		t.Errorf("body = %q, want 'invalid JSON payload'", rec.Body.String())
	}
}

// ── Data field survives decode ───────────────────────────────────────────

func TestInboundWebhook_ArbitraryDataAccepted(t *testing.T) {
	// Nested, mixed-type data must not break decoding; the endpoint stays lenient.
	body := `{"event":"alert","data":{"nested":{"a":[1,2,3],"b":true,"c":null},"n":3.14}}`
	rec, decoded := doRequest(t, body)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if got, _ := decoded["status"].(string); got != "alert_logged" {
		t.Errorf("status = %v, want alert_logged", decoded["status"])
	}
}

// ── Pure classify() logic (defaults + branch selection) ──────────────────

func TestClassify_Table(t *testing.T) {
	tests := []struct {
		name         string
		in           inboundPayload
		wantStatus   int
		wantBody     map[string]interface{}
		wantTitle    string // expected p.Title AFTER classify (defaults applied)
		wantSeverity string // expected p.Severity AFTER classify
	}{
		{
			name:         "alert applies both defaults",
			in:           inboundPayload{Event: "alert"},
			wantStatus:   http.StatusCreated,
			wantBody:     map[string]interface{}{"status": "alert_logged"},
			wantTitle:    defaultAlertTitle,
			wantSeverity: defaultAlertSeverity,
		},
		{
			name:         "alert preserves provided title and severity",
			in:           inboundPayload{Event: "alert", Title: "Custom", Severity: "critical"},
			wantStatus:   http.StatusCreated,
			wantBody:     map[string]interface{}{"status": "alert_logged"},
			wantTitle:    "Custom",
			wantSeverity: "critical",
		},
		{
			name:         "alert defaults only the empty severity",
			in:           inboundPayload{Event: "alert", Title: "Custom"},
			wantStatus:   http.StatusCreated,
			wantBody:     map[string]interface{}{"status": "alert_logged"},
			wantTitle:    "Custom",
			wantSeverity: defaultAlertSeverity,
		},
		{
			name:         "alert defaults only the empty title",
			in:           inboundPayload{Event: "alert", Severity: "warning"},
			wantStatus:   http.StatusCreated,
			wantBody:     map[string]interface{}{"status": "alert_logged"},
			wantTitle:    defaultAlertTitle,
			wantSeverity: "warning",
		},
		{
			name:         "note applies no defaults",
			in:           inboundPayload{Event: "note"},
			wantStatus:   http.StatusOK,
			wantBody:     map[string]interface{}{"status": "noted"},
			wantTitle:    "",
			wantSeverity: "",
		},
		{
			name:         "unknown event echoes and applies no defaults",
			in:           inboundPayload{Event: "command"},
			wantStatus:   http.StatusOK,
			wantBody:     map[string]interface{}{"status": "received", "event": "command"},
			wantTitle:    "",
			wantSeverity: "",
		},
		{
			name:         "empty event falls through to default branch",
			in:           inboundPayload{Event: ""},
			wantStatus:   http.StatusOK,
			wantBody:     map[string]interface{}{"status": "received", "event": ""},
			wantTitle:    "",
			wantSeverity: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := tt.in
			got := classify(&p)

			if got.status != tt.wantStatus {
				t.Errorf("status = %d, want %d", got.status, tt.wantStatus)
			}
			if !mapsEqual(got.body, tt.wantBody) {
				t.Errorf("body = %v, want %v", got.body, tt.wantBody)
			}
			if p.Title != tt.wantTitle {
				t.Errorf("post-classify Title = %q, want %q", p.Title, tt.wantTitle)
			}
			if p.Severity != tt.wantSeverity {
				t.Errorf("post-classify Severity = %q, want %q", p.Severity, tt.wantSeverity)
			}
		})
	}
}

// classify must never return a zero status for any event string.
func TestClassify_NeverZeroStatus(t *testing.T) {
	for _, ev := range []string{"", "alert", "note", "command", "random", "ALERT"} {
		p := inboundPayload{Event: ev}
		if got := classify(&p); got.status == 0 {
			t.Errorf("classify(event=%q) returned zero status", ev)
		}
	}
}

// Event matching is case-sensitive: "Alert" is not the alert branch.
func TestClassify_CaseSensitiveEventMatching(t *testing.T) {
	p := inboundPayload{Event: "Alert"}
	got := classify(&p)
	if got.status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (uppercase Alert must hit default)", got.status)
	}
	if got.body["status"] != "received" {
		t.Errorf("body[status] = %v, want received", got.body["status"])
	}
	if p.Title == defaultAlertTitle {
		t.Error("default title must not be applied for non-canonical event casing")
	}
}

// ── isMaxBytesError ──────────────────────────────────────────────────────

func TestIsMaxBytesError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"direct MaxBytesError", &http.MaxBytesError{Limit: 10}, true},
		{"wrapped MaxBytesError", fmt.Errorf("decode: %w", &http.MaxBytesError{Limit: 10}), true},
		{"plain error", errors.New("boom"), false},
		{"eof", io.EOF, false},
		{"nil", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isMaxBytesError(tt.err); got != tt.want {
				t.Errorf("isMaxBytesError(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

// ── Constructor ──────────────────────────────────────────────────────────

func TestNewWebhookHandler(t *testing.T) {
	if NewWebhookHandler() == nil {
		t.Fatal("NewWebhookHandler returned nil")
	}
}

// ── Concurrency (meaningful under -race) ─────────────────────────────────

func TestInboundWebhook_ConcurrentRequests(t *testing.T) {
	h := NewWebhookHandler()
	bodies := []string{
		`{"event":"alert","title":"a"}`,
		`{"event":"note","message":"b"}`,
		`{"event":"command"}`,
		`{"bad":true}`,
	}

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/inbound",
				strings.NewReader(bodies[i%len(bodies)]))
			rec := httptest.NewRecorder()
			h.InboundWebhook(rec, req)
			if rec.Code == 0 {
				t.Errorf("goroutine %d: no status written", i)
			}
		}(i)
	}
	wg.Wait()
}

// mapsEqual compares two decoded/response maps by JSON round-trip so
// string-vs-interface value typing doesn't cause false negatives.
func mapsEqual(a, b map[string]interface{}) bool {
	ab, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return string(ab) == string(bb)
}
